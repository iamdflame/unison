// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import {UnisonExchange} from "../../src/core/UnisonExchange.sol";
import {ExchangeBase} from "../../src/core/ExchangeBase.sol";
import {IReferenceAdapter} from "../../src/interfaces/IReferenceAdapter.sol";
import {AggregatorV3Interface} from "../../src/interfaces/external/AggregatorV3Interface.sol";
import {ChainlinkCausalReference} from "../../src/pricing/ChainlinkCausalReference.sol";
import {LiquidityVault, IUnisonVenue} from "../../src/liquidity/LiquidityVault.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {MockOCR} from "./CausalReference.t.sol";

/// @notice Curve sources that misbehave in every way a reply can. Under `try`/`catch`, the first three reverted the
///         whole clear: a reply too short to decode, a word too wide for its field, an address with no code.
contract ShortReply {
    fallback() external {
        assembly {
            mstore(0, 1)
            return(0, 0x40) // two words, not the six a Curve needs
        }
    }
}

contract DirtyReply {
    fallback() external {
        assembly {
            mstore(0x00, not(0)) // bidTop = 2^256 - 1: not a uint32
            mstore(0x20, 1)
            mstore(0x40, 1)
            mstore(0x60, 1)
            mstore(0x80, 1)
            mstore(0xa0, 1)
            return(0, 0xc0)
        }
    }
}

contract Reverter {
    fallback() external {
        revert("no quote");
    }
}

contract GasBurner {
    fallback() external {
        while (true) {}
    }
}

contract HugeReply {
    fallback() external {
        assembly {
            return(0, 192000) // 6,000 words of zeros: affordable to send, costly to copy whole
        }
    }
}

/// @notice Phase A (docs/ROADMAP.md): a stopped market returns its sealed orders without an oracle, no curve source
///         quotes while a market is closed, no key can add a gateway, and no curve source can block a clear.
contract PhaseATest is Test {
    // Wed 2025-10-08 12:00 UTC
    uint256 internal constant T0 = 1_759_924_800;
    uint256 internal constant LAG = 13;
    uint8 internal constant SKEW = 2;

    UnisonExchange internal ex;
    ChainlinkCausalReference internal cref;
    MockOCR internal nvdaUsd;
    MockOCR internal ausdUsd;
    MockERC20 internal nvda;
    MockERC20 internal ausd;
    LiquidityVault internal vault;
    uint256 internal mkt;
    uint80 internal q0;

    address internal lp = makeAddr("lp");
    address internal bob = makeAddr("bob"); // seller
    address internal alice = makeAddr("alice"); // buyer

    function setUp() public {
        vm.warp(T0 - 600);
        nvda = new MockERC20("Anchored NVDA", "aNVDA", 18);
        ausd = new MockERC20("Agora USD", "AUSD", 6);
        nvdaUsd = new MockOCR(8);
        ausdUsd = new MockOCR(8);
        q0 = ausdUsd.report(1e8, vm.getBlockTimestamp() - LAG);
        vm.warp(T0 - 100);
        nvdaUsd.report(180e8, vm.getBlockTimestamp() - LAG);

        UnisonExchange impl = new UnisonExchange();
        ex = UnisonExchange(
            address(new ERC1967Proxy(address(impl), abi.encodeCall(UnisonExchange.initialize, (address(this)))))
        );
        ex.listToken(address(nvda), false);
        ex.listToken(address(ausd), false);
        cref = new ChainlinkCausalReference(address(this));
        mkt = ex.createMarket(
            UnisonExchange.MarketParams({
                base: address(nvda),
                quote: address(ausd),
                refAdapter: address(cref),
                tickSize: 10_000,
                minTick: 1,
                maxTick: uint32((1 << 21) - 1),
                maxBandTicks: 2001,
                bandBps: 100,
                feeBps: 0,
                maxFeeBps: 10,
                shards: 2,
                permissioned: false,
                strictAfterClose: true
            })
        );
        cref.setFeed(
            mkt,
            AggregatorV3Interface(address(nvdaUsd)),
            AggregatorV3Interface(address(ausdUsd)),
            6,
            3900,
            90_000,
            0,
            0,
            50
        );
        ex.setCausal(mkt, address(cref), true, SKEW);
        vault = new LiquidityVault(address(this), IUnisonVenue(address(ex)), mkt, "Unison aNVDA Liquidity", "uNVDA-LP", _params(250));
        ex.addSource(mkt, address(vault));
        _fund(bob, 100e18, 0);
        _fund(alice, 0, 100_000e6);
        ausd.mint(lp, 100_000e6);
        vm.warp(T0);
    }

    // ------------------------------------------------------------------ helpers

    function _params(uint8 closedMult) internal pure returns (LiquidityVault.Params memory) {
        return LiquidityVault.Params({
            spreadBps: 20,
            depthBps: 100,
            widthTicks: 5,
            maxSkewTicks: 10,
            maxAuctionBps: 2000,
            swingBps: 30,
            extMult: 2,
            closedMult: closedMult,
            paused: false
        });
    }

    function _fund(address a, uint256 n, uint256 q) internal {
        nvda.mint(a, n);
        ausd.mint(a, q);
        vm.startPrank(a);
        nvda.approve(address(ex), type(uint256).max);
        ausd.approve(address(ex), type(uint256).max);
        if (n > 0) ex.deposit(address(nvda), n);
        if (q > 0) ex.deposit(address(ausd), q);
        vm.stopPrank();
    }

    function _next(uint256 dt) internal {
        vm.roll(vm.getBlockNumber() + 1);
        vm.warp(vm.getBlockTimestamp() + dt);
    }

    function _observe(int256 px, uint256 observedAt) internal returns (uint80 r) {
        if (vm.getBlockTimestamp() < observedAt + LAG) vm.warp(observedAt + LAG);
        vm.roll(vm.getBlockNumber() + 1);
        r = nvdaUsd.report(px, observedAt);
    }

    function _payload(uint80 r) internal view returns (bytes memory) {
        return abi.encode(r, q0);
    }

    function _seedVault() internal {
        vm.startPrank(lp);
        ausd.approve(address(vault), 50_000e6);
        vault.requestDeposit(50_000e6);
        vm.stopPrank();
        _observe(180e8, vm.getBlockTimestamp() + 1);
        _next(1);
        ex.clear(mkt, "");
        assertEq(vault.process(), 1);
    }

    function _sell(address who, uint256 tick, uint256 qty) internal returns (uint256) {
        vm.prank(who);
        return ex.placeOrder(mkt, 1, tick, qty, 0);
    }

    /// @dev Bob's sealed sell, waiting for Chainlink's next observation, which hasn't come.
    function _sealedSell() internal returns (uint256 slot, uint256 batch) {
        _seedVault();
        _next(5);
        batch = vm.getBlockNumber();
        slot = _sell(bob, 17_900, 1e18);
        _next(1);
        vm.expectRevert(ChainlinkCausalReference.NotYet.selector);
        ex.clear(mkt, ""); // an open market waits for its observation
    }

    function _expectReturned(uint256 slot, uint256 batch, uint8 reason) internal {
        UnisonExchange.Market memory before = ex.market(mkt);
        vm.expectEmit(true, true, false, true, address(ex));
        emit ExchangeBase.AuctionReturned(mkt, batch, reason);
        (uint256 tick, uint256 vol) = ex.clear(mkt, ""); // no observation needed
        assertEq(vol, 0, "nothing trades");
        assertEq(tick, 0);
        UnisonExchange.Market memory m = ex.market(mkt);
        assertEq(m.lastCleared, batch, "the auction ran");
        assertEq(m.lastStatus, uint8(IReferenceAdapter.Status.HALTED));
        assertEq(m.lastRefPrice, before.lastRefPrice, "no price was used: the last one carries forward");
        assertEq(m.lastRefTimeMs, before.lastRefTimeMs, "and keeps its time: vault queues keep their clock");
        vm.prank(bob);
        ex.cancelOrder(slot); // its auction ran: it settles, and the base comes back
        assertEq(ex.balanceOf(bob, address(nvda)), 100e18, "every unit back");
    }

    // ------------------------------------------------------------------ stopping returns everything

    function test_pause_returnsSealedOrdersWithoutAnObservation() public {
        (uint256 slot, uint256 batch) = _sealedSell();
        ex.pause();
        _expectReturned(slot, batch, 1);
    }

    function test_pause_stopsOrderEntry() public {
        ex.pause();
        vm.expectRevert(PausableUpgradeable.EnforcedPause.selector);
        _sell(bob, 17_900, 1e18);
    }

    function test_halt_returnsSealedOrdersWithoutAnObservation() public {
        (uint256 slot, uint256 batch) = _sealedSell();
        ex.setHalt(mkt, true);
        _expectReturned(slot, batch, 2);
    }

    function test_halt_ignoresTheOracle_evenWithAnObservation() public {
        (uint256 slot, uint256 batch) = _sealedSell();
        uint80 r = _observe(181e8, vm.getBlockTimestamp() + 1); // an observation after the seal now exists
        _next(1);
        ex.setHalt(mkt, true);
        UnisonExchange.Market memory before = ex.market(mkt);
        (, uint256 vol) = ex.clear(mkt, _payload(r)); // the payload is not read
        assertEq(vol, 0);
        assertEq(ex.market(mkt).lastRefPrice, before.lastRefPrice, "a halted market prices at nothing");
        assertGe(ex.market(mkt).lastCleared, batch, "the order's batch is covered");
        vm.prank(bob);
        ex.cancelOrder(slot);
        assertEq(ex.balanceOf(bob, address(nvda)), 100e18);
    }

    function test_inactiveMarket_returnsSealedOrders() public {
        (uint256 slot, uint256 batch) = _sealedSell();
        UnisonExchange.Market memory m = ex.market(mkt);
        ex.setMarketParams(mkt, m.bandBps, m.feeBps, m.maxBandTicks, false);
        _expectReturned(slot, batch, 3);
    }

    function test_returnOnly_needsSomethingToClear() public {
        ex.pause();
        _next(1);
        ex.clear(mkt, ""); // returns whatever waited up to the last block, even nothing
        uint256 last = ex.market(mkt).lastCleared; // read first: expectRevert applies to the next call
        vm.expectRevert(ExchangeBase.NothingToClear.selector);
        ex.clearUpTo(mkt, last, "");
    }

    // ------------------------------------------------------------------ no house curve while closed

    function test_closedMarket_vaultDoesNotQuote_evenWhenItWould() public {
        _seedVault();
        vault.setParams(_params(1)); // a vault set to quote a closed market as tightly as an open one
        vm.warp(vm.getBlockTimestamp() + 2 hours); // the feed falls silent past its 3,900 s maximum age
        vm.roll(vm.getBlockNumber() + 1);
        _sell(bob, 17_900, 1e18); // inside the band, below where the vault would have bid
        _next(1);
        (uint256 q0Before) = ex.balanceOf(address(vault), address(ausd));
        (, uint256 vol) = ex.clear(mkt, "");
        assertEq(ex.market(mkt).lastStatus, uint8(IReferenceAdapter.Status.CLOSED), "a DISCOVERY call auction");
        assertEq(vol, 0, "nobody else is in the auction, and the house isn't");
        assertEq(ex.balanceOf(address(vault), address(ausd)), q0Before, "the vault traded nothing");
    }

    // ------------------------------------------------------------------ gateways come only with an upgrade

    function test_gatewayRole_lockedAfterV2() public {
        address gw = makeAddr("gateway");
        ex.grantRole(ex.GATEWAY_ROLE(), gw); // a fresh deployment grants its gateway first
        ex.initializeV2();
        assertEq(ex.getRoleAdmin(ex.GATEWAY_ROLE()), ex.LOCKED_ROLE());
        assertEq(ex.getRoleAdmin(ex.LOCKED_ROLE()), ex.LOCKED_ROLE(), "the lock administers itself");
        bytes32 locked = ex.LOCKED_ROLE();
        bytes32 gateway = ex.GATEWAY_ROLE();
        vm.expectRevert(abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, address(this), locked));
        ex.grantRole(gateway, makeAddr("another gateway"));
        vm.expectRevert(abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, address(this), locked));
        ex.grantRole(locked, address(this)); // nor can the admin grant itself the lock
        assertTrue(ex.hasRole(gateway, gw), "the gateway already granted keeps its role");
        vm.expectRevert(); // once only
        ex.initializeV2();
    }

    function test_initializeV2_adminOnly() public {
        vm.prank(makeAddr("nobody"));
        vm.expectRevert();
        ex.initializeV2();
    }

    function test_revokeGateway_guardianOnly_oneWay() public {
        address gw = makeAddr("gateway");
        ex.grantRole(ex.GATEWAY_ROLE(), gw);
        ex.initializeV2();
        address nobody = makeAddr("nobody");
        bytes32 guardian = ex.GUARDIAN_ROLE();
        vm.prank(nobody);
        vm.expectRevert(abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, nobody, guardian));
        ex.revokeGateway(gw);
        vm.expectEmit(true, false, false, true, address(ex));
        emit ExchangeBase.GatewayRevoked(gw, address(this));
        ex.revokeGateway(gw);
        assertFalse(ex.hasRole(ex.GATEWAY_ROLE(), gw));
        vm.expectRevert(ExchangeBase.InvalidParams.selector); // nothing left to revoke
        ex.revokeGateway(gw);
    }

    function test_version() public view {
        assertEq(ex.version(), 2);
    }

    // ------------------------------------------------------------------ no curve source can block a clear

    function _sellAndClear() internal returns (uint256 vol) {
        _next(5);
        uint256 sealedAt = vm.getBlockTimestamp();
        _sell(bob, 17_900, 1e18);
        uint80 r = _observe(181e8, sealedAt + 9);
        _next(1);
        (, vol) = ex.clear(mkt, _payload(r));
    }

    function test_malformedReplies_cannotBlockAClear() public {
        _seedVault();
        ex.addSource(mkt, address(new ShortReply()));
        ex.addSource(mkt, address(new DirtyReply()));
        ex.addSource(mkt, address(0xdead)); // no code
        assertEq(_sellAndClear(), 1e18, "the vault still buys; the broken sources are skipped");
    }

    function test_revertsBurnsAndFloods_cannotBlockAClear() public {
        _seedVault();
        ex.addSource(mkt, address(new Reverter()));
        ex.addSource(mkt, address(new GasBurner()));
        ex.addSource(mkt, address(new HugeReply()));
        assertEq(_sellAndClear(), 1e18, "the vault still buys; the broken sources are skipped");
    }
}

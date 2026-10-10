// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {UnisonExchange} from "../../src/core/UnisonExchange.sol";
import {ExchangeBase} from "../../src/core/ExchangeBase.sol";
import {AggregatorV3Interface} from "../../src/interfaces/external/AggregatorV3Interface.sol";

interface IWMONv3 {
    function deposit() external payable;
}

/// @notice Phase A rehearsed on Monad mainnet state (chain 143): the LIVE exchange upgraded in place, then stopped with a
///         real sealed order waiting:
///           forge test --fork-url https://rpc.monad.xyz --match-contract UpgradePhaseAForkTest -vv
///         On a fork from before 10 October 2026 the upgrade is v3 itself, exactly as script/UpgradePhaseA.s.sol ran it.
///         Mainnet has run v3 since then (block 112,255,125), so on today's state it is the next upgrade: today's source
///         over today's state. Pin --fork-block-number for a reproducible run.
contract UpgradePhaseAForkTest is Test {
    address internal constant EXCHANGE = 0x1696170d40E703F1378989383c21Ec96ED1Adf75;
    address internal constant V2_IMPL = 0xBcE55ebB12E017a2A1a484375Fa006E32Fb656eF; // live 6 to 10 October 2026
    address internal constant ADMIN = 0x55DF8EA97d41b7F487c6Dcc077dFd0B487E3557D;
    address internal constant GUARDIAN = 0x0562b2b0914b3Bb082A623657729452fc9bf26E4;
    address internal constant GATEWAY = 0xfB246Ac236872534305d7d058B22AdB7Cb58033A;
    address internal constant WMON = 0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A;
    address internal constant AUSD = 0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a;
    address internal constant MENTO_AUSD_USDM_POOL = 0xb0a0264Ce6847F101b76ba36A4a3083ba489F501;
    address internal constant CL_MON_USD = 0xBcD78f76005B7515837af6b50c7C52BCf73822fb;
    address internal constant CL_AUSD_USD = 0xE20751C7B5867bCBef815ffc1b284c3f412a9e13;
    uint256 internal constant WMON_MARKET = 1;
    uint256 internal constant SKEW = 2;

    UnisonExchange internal ex = UnisonExchange(EXCHANGE);
    address internal alice = makeAddr("alice");

    function setUp() public {
        if (block.chainid != 143) vm.skip(true);
    }

    /// @dev v2 had no version().
    function _liveVersion() internal view returns (uint256) {
        try ex.version() returns (uint256 v) {
            return v;
        } catch {
            return 2;
        }
    }

    /// @dev initializeV3 runs once: on a proxy already at v3 the upgrade carries no call.
    function _upgrade() internal {
        UnisonExchange impl = new UnisonExchange();
        bytes memory init = _liveVersion() < 3 ? abi.encodeCall(UnisonExchange.initializeV3, ()) : bytes("");
        vm.prank(ADMIN);
        ex.upgradeToAndCall(address(impl), init);
    }

    /// @dev Alice seals a sell of 5 WMON (funded from the exchange's custody, on the fork only): on a causal market it
    ///      waits for Chainlink's next observation, which a fork never receives.
    function _sealedSell() internal returns (uint256 slot, uint256 batch) {
        vm.prank(EXCHANGE);
        IERC20(WMON).transfer(alice, 5e18);
        UnisonExchange.Market memory m = ex.market(WMON_MARKET);
        uint256 tick = m.lastRefPrice / m.tickSize; // at the last reference: inside any band
        vm.startPrank(alice);
        IERC20(WMON).approve(EXCHANGE, 5e18);
        ex.deposit(WMON, 5e18);
        batch = block.number;
        slot = ex.placeOrder(WMON_MARKET, 1, tick, 5e18, 0);
        vm.stopPrank();
        vm.roll(block.number + 1);
        vm.warp(block.timestamp + 1);
    }

    function test_fork_upgradeCarriesStateOverAndLocksTheGateway() public {
        UnisonExchange.Market memory before = ex.market(WMON_MARKET);
        _upgrade();
        assertEq(ex.version(), 3);
        UnisonExchange.Market memory m = ex.market(WMON_MARKET);
        assertEq(m.receiptHash, before.receiptHash, "the receipt chain carries over");
        assertEq(m.lastCleared, before.lastCleared);
        assertEq(m.lastRefPrice, before.lastRefPrice);
        assertTrue(ex.hasRole(ex.GATEWAY_ROLE(), GATEWAY), "the passkey gateway keeps its role");
        assertEq(ex.getRoleAdmin(ex.GATEWAY_ROLE()), ex.LOCKED_ROLE());
        bytes32 gateway = ex.GATEWAY_ROLE();
        bytes32 locked = ex.LOCKED_ROLE();
        vm.prank(ADMIN);
        vm.expectRevert(abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, ADMIN, locked));
        ex.grantRole(gateway, ADMIN); // the admin can no longer make itself a gateway and move anyone's funds
    }

    function test_fork_pauseReturnsASealedOrder() public {
        _upgrade();
        (uint256 slot, uint256 batch) = _sealedSell();
        vm.prank(GUARDIAN);
        ex.pause();
        vm.expectEmit(true, true, false, true, EXCHANGE);
        emit ExchangeBase.AuctionReturned(WMON_MARKET, block.number - 1, 1);
        (, uint256 vol) = ex.clear(WMON_MARKET, ""); // no observation needed, none read
        assertEq(vol, 0);
        assertGe(ex.market(WMON_MARKET).lastCleared, batch);
        vm.prank(alice);
        ex.cancelOrder(slot);
        assertEq(ex.balanceOf(alice, WMON), 5e18, "every WMON back");
    }

    function test_fork_haltReturnsASealedOrder() public {
        _upgrade();
        (uint256 slot,) = _sealedSell();
        vm.prank(GUARDIAN);
        ex.setHalt(WMON_MARKET, true);
        (, uint256 vol) = ex.clear(WMON_MARKET, "");
        assertEq(vol, 0);
        vm.prank(alice);
        ex.cancelOrder(slot);
        assertEq(ex.balanceOf(alice, WMON), 5e18, "every WMON back");
    }

    /// The code that runs: on today's state the live v3 bytecode, not upgraded. Two traders cross on WMON/AUSD just
    /// before Chainlink's latest real MON/USD observation (the fork's clock is set back for them), so that observation is
    /// the first after their seal, and the clear names it.
    function test_fork_v3_clearsAtTheNextObservation() public {
        if (_liveVersion() < 3) _upgrade();
        AggregatorV3Interface feed = AggregatorV3Interface(CL_MON_USD);
        (uint80 r,, uint256 obs,,) = feed.latestRoundData();
        (,, uint256 prevObs,,) = feed.getRoundData(r - 1);
        // the last clear already used this observation, or the two latest are too close to seal between them
        if (obs * 1000 <= ex.market(WMON_MARKET).lastRefTimeMs || obs - prevObs < 2) vm.skip(true);
        uint256 now_ = vm.getBlockTimestamp();

        address bob = makeAddr("bob");
        vm.deal(alice, 1000 ether);
        vm.startPrank(alice);
        IWMONv3(WMON).deposit{value: 1000 ether}();
        IERC20(WMON).approve(EXCHANGE, 1000e18);
        ex.deposit(WMON, 1000e18);
        vm.stopPrank();
        vm.prank(MENTO_AUSD_USDM_POOL);
        IERC20(AUSD).transfer(bob, 100e6);
        vm.startPrank(bob);
        IERC20(AUSD).approve(EXCHANGE, 100e6);
        ex.deposit(AUSD, 100e6);
        vm.stopPrank();

        (, int256 mon,,,) = feed.getRoundData(r);
        (uint80 q,,,,) = AggregatorV3Interface(CL_AUSD_USD).latestRoundData();
        while (true) {
            (,, uint256 qObs,,) = AggregatorV3Interface(CL_AUSD_USD).getRoundData(q);
            if (qObs <= obs) break; // the AUSD/USD round in force at the observation
            --q;
        }
        (, int256 ausd,,,) = AggregatorV3Interface(CL_AUSD_USD).getRoundData(q);
        uint256 px = (uint256(mon) * 1e6) / uint256(ausd); // AUSD (6 decimals) per WMON; tick size 1

        vm.warp(obs - SKEW - 1);
        vm.roll(vm.getBlockNumber() + 1);
        vm.prank(alice);
        ex.placeOrder(WMON_MARKET, 1, px - px / 100, 1000e18, 0); // sells at up to 1% under
        vm.prank(bob);
        ex.placeOrder(WMON_MARKET, 0, px + px / 100, 1000e18, 0); // buys at up to 1% over
        vm.warp(now_);
        vm.roll(vm.getBlockNumber() + 1);

        (, uint256 vol) = ex.clear(WMON_MARKET, abi.encode(r, q));
        assertEq(vol, 1000e18, "the cross fills");
        assertEq(ex.market(WMON_MARKET).lastRefTimeMs, obs * 1000, "priced at Chainlink's observation");
    }

    function test_fork_beforeTheUpgrade_aPauseHeldTheOrder() public {
        // the behaviour Phase A removed, shown on the same state: paused, the clear reverts and the order can't leave.
        // On a fork after 10 October the exchange first goes back to the v2 code that v3 replaced.
        if (_liveVersion() >= 3) {
            vm.prank(ADMIN);
            ex.upgradeToAndCall(V2_IMPL, "");
        }
        (uint256 slot,) = _sealedSell();
        vm.prank(GUARDIAN);
        ex.pause();
        vm.expectRevert();
        ex.clear(WMON_MARKET, "");
        vm.prank(alice);
        vm.expectRevert(ExchangeBase.Sealed.selector);
        ex.cancelOrder(slot);
    }
}

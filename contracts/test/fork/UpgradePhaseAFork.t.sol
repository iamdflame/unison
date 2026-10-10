// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {UnisonExchange} from "../../src/core/UnisonExchange.sol";
import {ExchangeBase} from "../../src/core/ExchangeBase.sol";

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
    uint256 internal constant WMON_MARKET = 1;

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

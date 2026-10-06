// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {UnisonExchange} from "../../src/core/UnisonExchange.sol";
import {ManualReference} from "../../src/pricing/ManualReference.sol";
import {IReferenceAdapter} from "../../src/interfaces/IReferenceAdapter.sol";
import {MockERC20} from "../mocks/MockERC20.sol";

/// @notice The pending area is addressed by block number. Two batches still waiting to be cleared must never share
///         storage, however far apart their blocks are; otherwise the newer batch overwrites the older one and the
///         older one's orders can never settle.
contract PendingRingTest is Test {
    UnisonExchange internal ex;
    ManualReference internal ref;
    MockERC20 internal nvda;
    MockERC20 internal ausd;
    uint256 internal mkt;

    address internal bob = makeAddr("bob"); // seller
    address internal alice = makeAddr("alice"); // buyer

    function setUp() public {
        vm.warp(1_760_000_000);
        nvda = new MockERC20("Anchored NVDA", "aNVDA", 18);
        ausd = new MockERC20("Agora USD", "AUSD", 6);
        ref = new ManualReference(address(this));
        UnisonExchange impl = new UnisonExchange();
        ex = UnisonExchange(
            address(new ERC1967Proxy(address(impl), abi.encodeCall(UnisonExchange.initialize, (address(this)))))
        );
        ex.listToken(address(nvda), false);
        ex.listToken(address(ausd), false);
        mkt = ex.createMarket(
            UnisonExchange.MarketParams({
                base: address(nvda),
                quote: address(ausd),
                refAdapter: address(ref),
                tickSize: 10_000,
                minTick: 1,
                maxTick: uint32((1 << 21) - 1),
                maxBandTicks: 2001,
                bandBps: 100,
                feeBps: 0,
                maxFeeBps: 10,
                shards: 1,
                permissioned: false,
                strictAfterClose: false
            })
        );
        nvda.mint(bob, 10e18);
        ausd.mint(alice, 10_000e6);
        vm.startPrank(bob);
        nvda.approve(address(ex), type(uint256).max);
        ex.deposit(address(nvda), 10e18);
        vm.stopPrank();
        vm.startPrank(alice);
        ausd.approve(address(ex), type(uint256).max);
        ex.deposit(address(ausd), 10_000e6);
        vm.stopPrank();
    }

    function _clear() internal returns (uint256 tick, uint256 vol) {
        vm.roll(vm.getBlockNumber() + 1);
        vm.warp(vm.getBlockTimestamp() + 1);
        ref.post(mkt, 180e6, vm.getBlockTimestamp() * 1000, IReferenceAdapter.Status.OPEN);
        return ex.clear(mkt, "");
    }

    /// Two batches exactly one ring length apart, both waiting: both must reach the auction.
    function test_batchesOneRingApart_bothTrade() public {
        vm.prank(bob);
        uint256 ask = ex.placeOrder(mkt, 1, 18_000, 1e18, 0); // sells 1 at $180
        vm.roll(vm.getBlockNumber() + 256);
        vm.warp(vm.getBlockTimestamp() + 103);
        vm.prank(alice);
        uint256 bid = ex.placeOrder(mkt, 0, 18_000, 1e18, 0); // buys 1 at $180
        (, uint256 vol) = _clear();
        assertEq(vol, 1e18, "both orders were in the auction");
        vm.prank(bob);
        ex.cancelOrder(ask); // settles: nothing is stuck
        vm.prank(alice);
        ex.cancelOrder(bid);
        assertEq(ex.balanceOf(bob, address(nvda)), 9e18);
        assertEq(ex.balanceOf(alice, address(nvda)), 1e18);
    }

    /// A full ring apart, the two batches would share storage: the newer order is refused instead, and the waiting
    /// one is untouched.
    function test_aWaitingBatchIsNeverOverwritten() public {
        vm.prank(bob);
        uint256 ask = ex.placeOrder(mkt, 1, 18_000, 1e18, 0);
        vm.roll(vm.getBlockNumber() + 65_536);
        vm.warp(vm.getBlockTimestamp() + 26_215);
        vm.prank(alice);
        vm.expectRevert(UnisonExchangeErrors.PendingFull.selector);
        ex.placeOrder(mkt, 0, 18_000, 1e18, 0);
        // the next block is free again; the waiting ask still trades
        vm.roll(vm.getBlockNumber() + 1);
        vm.prank(alice);
        ex.placeOrder(mkt, 0, 18_000, 1e18, 0);
        (, uint256 vol) = _clear();
        assertEq(vol, 1e18);
        vm.prank(bob);
        ex.cancelOrder(ask);
        assertEq(ex.balanceOf(bob, address(nvda)), 9e18);
    }
}

library UnisonExchangeErrors {
    error PendingFull();
}

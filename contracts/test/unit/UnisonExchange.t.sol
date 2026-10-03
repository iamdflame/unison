// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {UnisonExchange} from "../../src/core/UnisonExchange.sol";
import {ExchangeBase} from "../../src/core/ExchangeBase.sol";
import {ManualReference} from "../../src/pricing/ManualReference.sol";
import {IReferenceAdapter} from "../../src/interfaces/IReferenceAdapter.sol";
import {ExchangeLayout as L} from "../../src/core/ExchangeLayout.sol";
import {MockERC20} from "../mocks/MockERC20.sol";

contract UnisonExchangeTest is Test {
    UnisonExchange internal ex;
    ManualReference internal ref;
    MockERC20 internal nvda; // 18 decimals
    MockERC20 internal ausd; // 6 decimals
    uint256 internal mkt;

    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal carol = makeAddr("carol");
    address internal keeper = makeAddr("keeper");

    uint256 internal constant TICK = 10_000; // $0.01 in AUSD units
    uint256 internal constant BID = 0;
    uint256 internal constant ASK = 1;

    function setUp() public {
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
                tickSize: uint64(TICK),
                minTick: 1,
                maxTick: uint32((1 << 21) - 1),
                maxBandTicks: 2001,
                bandBps: 100,
                feeBps: 2,
                maxFeeBps: 10,
                shards: 4,
                permissioned: false,
                strictAfterClose: false
            })
        );

        _fund(alice, 0, 1_000_000e6);
        _fund(bob, 1_000e18, 0);
        _fund(carol, 1_000e18, 1_000_000e6);
        // seed the protocol dust reserve
        ausd.mint(address(this), 10e6);
        ausd.approve(address(ex), type(uint256).max);
        ex.fundProtocol(address(ausd), 10e6);
    }

    function _fund(address who, uint256 nvdaAmt, uint256 ausdAmt) internal {
        nvda.mint(who, nvdaAmt);
        ausd.mint(who, ausdAmt);
        vm.startPrank(who);
        nvda.approve(address(ex), type(uint256).max);
        ausd.approve(address(ex), type(uint256).max);
        if (nvdaAmt > 0) ex.deposit(address(nvda), nvdaAmt);
        if (ausdAmt > 0) ex.deposit(address(ausd), ausdAmt);
        vm.stopPrank();
    }

    function _place(address who, uint256 side, uint256 tick, uint256 qty, uint256 flags) internal returns (uint256 s) {
        vm.prank(who);
        s = ex.placeOrder(mkt, side, tick, qty, flags);
    }

    function _nextBlockAndRef(uint256 price, IReferenceAdapter.Status st) internal {
        vm.roll(block.number + 1);
        vm.warp(block.timestamp + 1);
        ref.post(mkt, price, block.timestamp * 1000, st);
    }

    function _clear() internal returns (uint256 tick, uint256 vol) {
        vm.prank(keeper);
        (tick, vol) = ex.clear(mkt, "");
    }

    function _claim(address who, uint256 slot) internal {
        uint256[] memory s = new uint256[](1);
        s[0] = slot;
        ex.claim(who, s);
    }

    // ------------------------------------------------------------------ golden path

    function test_goldenPath_uniformPriceAtReference() public {
        uint256 a = _place(alice, BID, 18_100, 10e18, 0); // buy 10 @ $181
        uint256 b = _place(bob, ASK, 17_900, 10e18, 0); // sell 10 @ $179

        _nextBlockAndRef(180e6, IReferenceAdapter.Status.OPEN);
        (uint256 tick, uint256 vol) = _clear();
        assertEq(tick, 18_000, "clears at the reference tick (tie-break)");
        assertEq(vol, 10e18);

        uint256 aliceQuoteBefore = ex.balanceOf(alice, address(ausd));
        _claim(alice, a);
        _claim(bob, b);

        assertEq(ex.balanceOf(alice, address(nvda)), 10e18, "alice received 10 aNVDA");
        // alice paid 1800 + 2bps fee (0.36) from her lock; lock refunded
        uint256 paid = (1_000_000e6) - ex.balanceOf(alice, address(ausd));
        assertApproxEqAbs(paid, 1800e6 + 360_000, 2, "alice paid notional + fee");
        assertGt(ex.balanceOf(alice, address(ausd)), aliceQuoteBefore, "unused lock refunded at claim");
        assertApproxEqAbs(ex.balanceOf(bob, address(ausd)), 1800e6 - 360_000, 2, "bob received notional - fee");
        assertEq(ex.balanceOf(bob, address(nvda)), 990e18, "bob delivered 10");
        assertEq(ex.openOrderBitmap(alice), 0, "alice order slot freed");
        assertEq(ex.openOrderBitmap(bob), 0, "bob order slot freed");

        // withdraw works end to end
        vm.prank(alice);
        ex.withdraw(address(nvda), 10e18, alice);
        assertEq(nvda.balanceOf(alice), 10e18);
    }

    function test_proRata_sameBlockBuyersShareEqually() public {
        uint256 a = _place(alice, BID, 18_050, 10e18, 0);
        uint256 c = _place(carol, BID, 18_050, 10e18, 0); // same limit, same batch
        uint256 b = _place(bob, ASK, 17_950, 10e18, 0); // only 10 available

        _nextBlockAndRef(180e6, IReferenceAdapter.Status.OPEN);
        (, uint256 vol) = _clear();
        assertEq(vol, 10e18);
        _claim(alice, a);
        _claim(carol, c);
        _claim(bob, b);
        // each buyer gets ~5 regardless of who submitted first
        assertApproxEqAbs(ex.balanceOf(alice, address(nvda)), 5e18, 2);
        assertApproxEqAbs(ex.balanceOf(carol, address(nvda)) - 1_000e18, 5e18, 2);
        // the remaining 5 each still rest in the book
        (, uint256 filledA, uint256 restA,,) = ex.previewOrder(alice, a);
        assertEq(filledA, 5e18);
        assertEq(restA, 5e18);
        assertEq(ex.orderOf(alice, a).qty, 10e18, "order keeps its original size");
    }

    function test_laterBlockOrdersCannotJoinEarlierAuction() public {
        _place(bob, ASK, 17_950, 10e18, 0); // batch N

        vm.roll(block.number + 1);
        vm.warp(block.timestamp + 1);
        // batch N+1: alice bids *before* the keeper clears batch N in the same block
        uint256 a = _place(alice, BID, 18_100, 10e18, 0);
        ref.post(mkt, 180e6, block.timestamp * 1000, IReferenceAdapter.Status.OPEN);
        (, uint256 vol) = _clear(); // clears only batches <= N
        assertEq(vol, 0, "alice's batch N+1 order did not participate");
        assertEq(ex.orderOf(alice, a).state, L.STATE_OPEN);

        _nextBlockAndRef(180e6, IReferenceAdapter.Status.OPEN);
        (, vol) = _clear();
        assertEq(vol, 10e18, "it trades in its own batch");
    }

    function test_restingOrderFillsInLaterBatch() public {
        uint256 a = _place(alice, BID, 17_990, 10e18, 0); // rests below ref
        _nextBlockAndRef(180e6, IReferenceAdapter.Status.OPEN);
        (, uint256 vol) = _clear();
        assertEq(vol, 0);

        uint256 b = _place(bob, ASK, 17_980, 4e18, 0); // new seller crosses the resting bid
        _nextBlockAndRef(180e6, IReferenceAdapter.Status.OPEN);
        (uint256 tick, uint256 vol2) = _clear();
        assertEq(vol2, 4e18);
        assertTrue(tick >= 17_980 && tick <= 17_990);
        _claim(alice, a);
        _claim(bob, b);
        assertApproxEqAbs(ex.balanceOf(alice, address(nvda)), 4e18, 2);
        (,, uint256 rest,,) = ex.previewOrder(alice, a);
        assertEq(rest, 6e18, "remaining 6 still resting");
    }

    function test_ioc_remainderCancelledAfterFirstAuction() public {
        uint256 a = _place(alice, BID, 18_100, 10e18, 1); // IOC
        uint256 b = _place(bob, ASK, 17_950, 4e18, 0);
        _nextBlockAndRef(180e6, IReferenceAdapter.Status.OPEN);
        (, uint256 vol) = _clear();
        assertEq(vol, 4e18);
        assertEq(ex.bookTotal(mkt, BID), 0, "IOC remainder removed from the book");

        uint256 before = ex.balanceOf(alice, address(ausd));
        _claim(alice, a);
        _claim(bob, b);
        assertApproxEqAbs(ex.balanceOf(alice, address(nvda)), 4e18, 2);
        assertEq(ex.openOrderBitmap(alice), 0, "IOC order closed");
        assertGt(ex.balanceOf(alice, address(ausd)), before, "full remaining lock refunded");

        // a later seller cannot fill the cancelled IOC remainder
        _place(carol, ASK, 17_900, 6e18, 0);
        _nextBlockAndRef(180e6, IReferenceAdapter.Status.OPEN);
        (, uint256 vol3) = _clear();
        assertEq(vol3, 0);
    }

    function test_cancelPendingAndLive() public {
        uint256 a = _place(alice, BID, 17_000, 10e18, 0);
        uint256 balBefore = ex.balanceOf(alice, address(ausd));
        vm.prank(alice);
        ex.cancelOrder(a);
        assertEq(ex.openOrderBitmap(alice), 0);
        assertGt(ex.balanceOf(alice, address(ausd)), balBefore);

        uint256 a2 = _place(alice, BID, 17_000, 10e18, 0);
        _nextBlockAndRef(180e6, IReferenceAdapter.Status.OPEN);
        _clear(); // merged, resting
        assertEq(ex.bookTotal(mkt, BID), 10e18);
        vm.prank(alice);
        ex.cancelOrder(a2);
        assertEq(ex.bookTotal(mkt, BID), 0);
        assertEq(ex.balanceOf(alice, address(ausd)), 1_000_000e6, "all funds returned");
    }

    function test_halted_noTradeOrdersMerged() public {
        _place(alice, BID, 18_100, 10e18, 0);
        _place(bob, ASK, 17_900, 10e18, 0);
        _nextBlockAndRef(180e6, IReferenceAdapter.Status.HALTED);
        (, uint256 vol) = _clear();
        assertEq(vol, 0, "no trading during a mirrored halt");
        assertEq(ex.bookTotal(mkt, BID), 10e18);

        _nextBlockAndRef(180e6, IReferenceAdapter.Status.OPEN);
        (, uint256 vol2) = _clear();
        assertEq(vol2, 10e18, "trades once the halt lifts");
    }

    function test_staleReference_reverts() public {
        _place(alice, BID, 18_100, 10e18, 0);
        vm.roll(block.number + 1);
        vm.warp(block.timestamp + 1);
        // published before the batch's block timestamp -> rejected
        ref.post(mkt, 180e6, (block.timestamp - 2) * 1000, IReferenceAdapter.Status.OPEN);
        vm.expectRevert(ExchangeBase.StaleReference.selector);
        ex.clear(mkt, "");
    }

    function test_nothingToClear_sameBlock() public {
        vm.expectRevert(ExchangeBase.NothingToClear.selector);
        ex.clear(mkt, "");
    }

    function test_manyAccountsAcrossShards() public {
        uint256 n = 12;
        address[] memory buyers = new address[](n);
        uint256[] memory slots = new uint256[](n);
        for (uint256 i = 0; i < n; i++) {
            buyers[i] = makeAddr(string(abi.encode("buyer", i)));
            _fund(buyers[i], 0, 10_000e6);
            slots[i] = _place(buyers[i], BID, 18_020, 1e18, 0);
        }
        uint256 b = _place(bob, ASK, 17_980, 6e18, 0);
        _nextBlockAndRef(180e6, IReferenceAdapter.Status.OPEN);
        (, uint256 vol) = _clear();
        assertEq(vol, 6e18);
        uint256 got;
        for (uint256 i = 0; i < n; i++) {
            _claim(buyers[i], slots[i]);
            got += ex.balanceOf(buyers[i], address(nvda));
        }
        _claim(bob, b);
        assertApproxEqAbs(got, 6e18, n * 2, "pro-rata across all shards sums to V");
        assertEq(ex.bookTotal(mkt, BID), 6e18);
    }

    function test_solvency_afterFullCycle() public {
        _place(alice, BID, 18_100, 7e18, 0);
        _place(carol, BID, 18_050, 5e18, 0);
        _place(bob, ASK, 17_900, 9e18, 0);
        _place(carol, ASK, 18_000, 4e18, 0);
        _nextBlockAndRef(180e6, IReferenceAdapter.Status.OPEN);
        _clear();
        // claim everything
        address[3] memory users = [alice, bob, carol];
        for (uint256 u = 0; u < 3; u++) {
            uint256 bm = ex.openOrderBitmap(users[u]);
            for (uint256 i = 0; i < 55; i++) {
                if (bm & (1 << i) != 0) _claim(users[u], i);
            }
        }
        // physical balances must cover every ledger balance (free) + remaining resting locks
        uint256 ledgerN = ex.balanceOf(alice, address(nvda)) + ex.balanceOf(bob, address(nvda))
            + ex.balanceOf(carol, address(nvda)) + ex.balanceOf(address(ex), address(nvda));
        assertGe(nvda.balanceOf(address(ex)), ledgerN, "base solvency");
        uint256 ledgerQ = ex.balanceOf(alice, address(ausd)) + ex.balanceOf(bob, address(ausd))
            + ex.balanceOf(carol, address(ausd)) + ex.balanceOf(address(ex), address(ausd));
        assertGe(ausd.balanceOf(address(ex)), ledgerQ, "quote solvency");
    }
}

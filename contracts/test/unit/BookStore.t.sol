// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {BookStore} from "../../src/core/BookStore.sol";
import {OrderMath} from "../../src/core/OrderMath.sol";

/// @dev Exposes one book shard and records order snapshots like the exchange will.
contract BookHarness {
    BookStore.Key internal key = BookStore.Key({market: 1, side: 0, shard: 0});
    uint256 internal constant B = 1e18;

    OrderMath.Snapshot[] public orders;
    uint256[] public orderTick;

    function add(uint256 tick, uint256 qty) external returns (uint256 id) {
        (uint256 e, uint256 s, uint256 a) = BookStore.add(key, tick, qty);
        orders.push(OrderMath.Snapshot({qty: qty, epoch: e, survival: s, acc: a}));
        orderTick.push(tick);
        return orders.length - 1;
    }

    function fill(uint256 tick, uint256 ratio, uint256 price) external returns (uint256) {
        return BookStore.fill(key, tick, ratio, price);
    }

    function remaining(uint256 tick) external view returns (uint256) {
        return BookStore.remainingAt(key, tick);
    }

    function total() external view returns (uint256) {
        return BookStore.total(key);
    }

    function sumAbove(uint256 tick) external view returns (uint256) {
        return BookStore.sumAbove(key, tick);
    }

    function sumBelow(uint256 tick) external view returns (uint256) {
        return BookStore.sumBelow(key, tick);
    }

    function cancel(uint256 tick, uint256 qty) external returns (uint256) {
        return BookStore.remove(key, tick, qty);
    }

    function valueOf(uint256 id) external view returns (OrderMath.Valuation memory) {
        OrderMath.Snapshot memory o = orders[id];
        BookStore.Level memory l = BookStore.readLevel(key, orderTick[id]);
        uint256 fin = l.epoch != o.epoch ? BookStore.epochFinal(key, orderTick[id], o.epoch) : 0;
        return OrderMath.value(o, l.epoch, l.survival, l.acc, fin, B);
    }
}

contract BookStoreTest is Test {
    BookHarness internal h;
    uint256 internal constant B = 1e18;
    uint256 internal constant P = 180_000000; // $180.00 in 6-dec quote units per whole token

    function setUp() public {
        h = new BookHarness();
    }

    function test_singleOrder_partialThenFull() public {
        uint256 id = h.add(18_000, 10e18);
        assertEq(h.total(), 10e18);

        // 30% partial fill at $180
        uint256 f1 = h.fill(18_000, 0.3e18, P);
        assertEq(f1, 3e18);
        OrderMath.Valuation memory v = h.valueOf(id);
        assertApproxEqAbs(v.filledFloor, 3e18, 1);
        assertApproxEqAbs(v.quoteFloor, 540_000000, 1); // 3 * $180
        assertFalse(v.closed);

        // remaining 7 fully filled at $181
        uint256 f2 = h.fill(18_000, 1e18, 181_000000);
        assertEq(f2, 7e18);
        v = h.valueOf(id);
        assertTrue(v.closed);
        assertEq(v.filledFloor, 10e18);
        // quote = 3*180 + 7*181 = 1807
        assertApproxEqAbs(v.quoteFloor, 1807_000000, 2);
        assertEq(h.total(), 0);
    }

    function test_proRata_lateJoinerOnlySharesLaterFills() public {
        uint256 a = h.add(18_000, 10e18);
        h.fill(18_000, 0.5e18, P); // A gets 5 filled
        uint256 b = h.add(18_000, 5e18); // level now 5 (A) + 5 (B) = 10
        h.fill(18_000, 0.2e18, P); // 2 filled pro-rata: A 1, B 1

        OrderMath.Valuation memory va = h.valueOf(a);
        OrderMath.Valuation memory vb = h.valueOf(b);
        assertApproxEqAbs(va.filledFloor, 6e18, 2);
        assertApproxEqAbs(vb.filledFloor, 1e18, 2);
        assertApproxEqAbs(va.quoteFloor, 6 * P, 2);
        assertApproxEqAbs(vb.quoteFloor, 1 * P, 2);
        assertEq(h.remaining(18_000), 8e18);
    }

    function test_hierarchySums() public {
        h.add(100, 1e18);
        h.add(300, 2e18); // different bucket
        h.add(20_000, 3e18); // different super
        h.add(20_001, 4e18);
        assertEq(h.sumAbove(100), 9e18);
        assertEq(h.sumAbove(300), 7e18);
        assertEq(h.sumAbove(20_000), 4e18);
        assertEq(h.sumBelow(20_001), 6e18);
        assertEq(h.sumBelow(300), 1e18);
        assertEq(h.sumBelow(100), 0);
        assertEq(h.total(), 10e18);
    }

    function test_cancelClampsToAggregate() public {
        h.add(500, 5e18);
        uint256 removed = h.cancel(500, 7e18);
        assertEq(removed, 5e18);
        assertEq(h.total(), 0);
    }

    /// Fuzz: random partial fills; lazy per-order valuation must match exact pro-rata bookkeeping.
    function testFuzz_lazyMatchesExact(uint256 seed) public {
        uint256 tick = 18_000;
        uint256 nOrders = 1 + (seed % 5);
        uint256[] memory ids = new uint256[](nOrders);
        uint256[] memory exactRemaining = new uint256[](nOrders);
        uint256[] memory exactFilled = new uint256[](nOrders);
        uint256[] memory exactQuote = new uint256[](nOrders);

        for (uint256 i = 0; i < nOrders; i++) {
            uint256 q = 1e18 + (uint256(keccak256(abi.encode(seed, i))) % 1e21);
            ids[i] = h.add(tick, q);
            exactRemaining[i] = q;
        }

        uint256 rounds = 1 + ((seed >> 8) % 6);
        for (uint256 r = 0; r < rounds; r++) {
            uint256 ratio = 1e15 + (uint256(keccak256(abi.encode(seed, "r", r))) % (0.9e18));
            uint256 price = 100_000000 + (uint256(keccak256(abi.encode(seed, "p", r))) % 100_000000);
            h.fill(tick, ratio, price);
            for (uint256 i = 0; i < nOrders; i++) {
                uint256 f = (exactRemaining[i] * ratio) / 1e18;
                exactRemaining[i] -= f;
                exactFilled[i] += f;
                exactQuote[i] += (f * price) / B;
            }
        }

        for (uint256 i = 0; i < nOrders; i++) {
            OrderMath.Valuation memory v = h.valueOf(ids[i]);
            // Lazy fixed-point vs per-round integer bookkeeping. The reference floors once per round,
            // so it drifts by up to `rounds` units by itself; plus a 1e-15 relative fixed-point bound.
            uint256 tolBase = exactFilled[i] / 1e15 + rounds + 3;
            uint256 tolQuote = exactQuote[i] / 1e15 + rounds + 3;
            assertApproxEqAbs(v.filledFloor, exactFilled[i], tolBase, "filled");
            assertApproxEqAbs(v.quoteFloor, exactQuote[i], tolQuote, "quote");
            assertLe(v.filledFloor, v.filledCeil);
            assertLe(v.quoteFloor, v.quoteCeil);
        }
    }
}

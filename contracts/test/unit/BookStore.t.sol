// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {BookStore} from "../../src/core/BookStore.sol";

/// @dev Exposes one book (one side) and tracks orders the way the exchange does.
contract BookHarness {
    BookStore.Key internal key;
    uint256 internal constant B = 1e18;

    struct Ord {
        uint256 qty;
        uint256 tick;
        BookStore.Snap snap;
        uint256 credited; // bids: base drawn; asks: gross quote drawn
        bool open;
    }

    Ord[] internal ords;

    constructor(uint256 side) {
        key = BookStore.Key({market: 1, side: side, shard: 0});
    }

    function isBid() public view returns (bool) {
        return key.side == 0;
    }

    function count() external view returns (uint256) {
        return ords.length;
    }

    function isOpen(uint256 id) external view returns (bool) {
        return ords[id].open;
    }

    function credited(uint256 id) external view returns (uint256) {
        return ords[id].credited;
    }

    function add(uint256 tick, uint256 qty) external returns (uint256) {
        BookStore.Snap memory s = BookStore.add(key, tick, qty);
        ords.push(Ord({qty: qty, tick: tick, snap: s, credited: 0, open: true}));
        return ords.length - 1;
    }

    function fill(uint256 tick, uint256 f, uint256 price) external returns (bool) {
        return BookStore.fill(key, tick, f, price, B, isBid());
    }

    function value(uint256 id) public view returns (BookStore.Valuation memory) {
        Ord storage o = ords[id];
        return BookStore.value(key, o.tick, o.snap, o.qty, isBid(), B);
    }

    /// Draws what the order is owed so far (bids: base filled, asks: gross quote).
    function drawFor(uint256 id) external returns (uint256 got) {
        Ord storage o = ords[id];
        BookStore.Valuation memory v = value(id);
        uint256 target = isBid() ? o.qty - v.remainder : v.quote;
        if (target > o.credited) {
            got = BookStore.draw(key, o.tick, o.snap.epoch, target - o.credited, BookStore.POT);
            o.credited += got;
        }
    }

    function leave(uint256 id) external returns (uint256 removed) {
        Ord storage o = ords[id];
        BookStore.Valuation memory v = value(id);
        removed = BookStore.leave(key, o.tick, o.snap.epoch, v.remainder);
        o.open = false;
    }

    function forceClose(uint256 tick) external returns (uint256) {
        return BookStore.forceClose(key, tick, isBid());
    }

    function drawRet(uint256 id) external returns (uint256) {
        Ord storage o = ords[id];
        return BookStore.draw(key, o.tick, o.snap.epoch, value(id).remainder, BookStore.RET);
    }

    function level(uint256 tick) external view returns (BookStore.Level memory) {
        return BookStore.readLevel(key, tick);
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

    function nextNonEmpty(uint256 from, uint256 to) external view returns (uint256) {
        return BookStore.nextNonEmpty(key, from, to);
    }
}

contract BookStoreTest is Test {
    uint256 internal constant B = 1e18;
    uint256 internal constant P = 180_000000; // $180.00 in 6-dec quote units per whole token
    uint256 internal constant T = 18_000;

    BookHarness internal bids;
    BookHarness internal asks;

    function setUp() public {
        bids = new BookHarness(0);
        asks = new BookHarness(1);
    }

    function test_bid_partialThenFull() public {
        uint256 id = bids.add(T, 10e18);
        bids.fill(T, 3e18, P);
        BookStore.Valuation memory v = bids.value(id);
        assertEq(v.remainder, 7e18);
        assertEq(v.quote, 540_000000);
        assertFalse(v.closed);
        assertEq(bids.drawFor(id), 3e18, "base drawn = fill");

        assertTrue(bids.fill(T, 7e18, 181_000000), "closes");
        v = bids.value(id);
        assertTrue(v.closed);
        assertEq(v.remainder, 0);
        assertEq(v.quote, 540_000000 + 1267_000000);
        assertEq(bids.drawFor(id), 7e18);
        assertEq(bids.total(), 0);
        assertEq(bids.remaining(T), 0);
    }

    function test_ask_proRata() public {
        uint256 a = asks.add(T, 6e18);
        uint256 b = asks.add(T, 4e18);
        asks.fill(T, 5e18, P);
        assertEq(asks.value(a).remainder, 3e18);
        assertEq(asks.value(b).remainder, 2e18);
        assertEq(asks.value(a).quote, 540_000000);
        assertEq(asks.value(b).quote, 360_000000);
        assertEq(asks.drawFor(a) + asks.drawFor(b), 900_000000, "pot = f*p exactly");
        assertEq(asks.leave(a), 3e18);
        assertEq(asks.leave(b), 2e18);
        assertEq(asks.total(), 0, "book empties exactly");
    }

    function test_laterJoiner_onlySharesLaterFills() public {
        uint256 a = bids.add(T, 10e18);
        bids.fill(T, 5e18, P);
        uint256 b = bids.add(T, 10e18);
        bids.fill(T, 3e18, P); // 3 of 15 = 20%
        assertEq(bids.value(a).remainder, 4e18);
        assertEq(bids.value(b).remainder, 8e18);
        assertEq(bids.drawFor(a), 6e18);
        assertEq(bids.drawFor(b), 2e18);
    }

    function test_rescale_manyDeepFills() public {
        uint256 a = asks.add(T, 1e24);
        uint256 filled;
        uint256 proceeds; // Σ floor(f·p/B)
        for (uint256 i = 0; i < 9; ++i) {
            uint256 rem = asks.remaining(T);
            uint256 f = (rem * 99) / 100;
            asks.fill(T, f, P + i);
            filled += f;
            proceeds += (f * (P + i)) / B;
        }
        BookStore.Level memory l = asks.level(T);
        assertGt(l.scale, 0, "rescaled");
        uint256 b = asks.add(T, 5e18); // joins in a later scale
        uint256 rem2 = asks.remaining(T);
        asks.fill(T, rem2 / 2, P);
        filled += rem2 / 2;
        proceeds += ((rem2 / 2) * P) / B;

        // lazy remainders never undercount the real quantity
        BookStore.Valuation memory va = asks.value(a);
        BookStore.Valuation memory vb = asks.value(b);
        assertGe(va.remainder + vb.remainder, asks.remaining(T));
        // quote shares stay within the pot and distribute (almost) all of it
        uint256 got = asks.drawFor(a) + asks.drawFor(b);
        assertLe(got, proceeds);
        assertGe(got + 4, proceeds);
        // everyone leaves: the book empties exactly, base is conserved
        uint256 back = asks.leave(a) + asks.leave(b);
        assertEq(back + filled, 1e24 + 5e18, "base conserved");
        assertEq(asks.total(), 0);
    }

    function test_closeInPlace_thenArchiveOnReuse() public {
        uint256 a = bids.add(T, 2e18);
        bids.fill(T, 2e18, P); // closed in place
        assertTrue(bids.level(T).closed);
        uint256 b = bids.add(T, 3e18); // archives epoch 0, opens epoch 1
        assertEq(bids.level(T).epoch, 1);
        bids.fill(T, 1e18, P);
        BookStore.Valuation memory va = bids.value(a);
        assertTrue(va.closed);
        assertEq(va.quote, 360_000000);
        assertEq(bids.drawFor(a), 2e18, "drawn from the archived pot");
        // 1/3 of S is not exact: the lazy remainder rounds UP (never undercounts the book)
        assertApproxEqAbs(bids.value(b).remainder, 2e18, 1);
        assertGe(bids.value(b).remainder, 2e18);
        assertApproxEqAbs(bids.drawFor(b), 1e18, 1);
    }

    function test_forceClose_iocAsk_returnsRemainder() public {
        uint256 a = asks.add(T, 6e18);
        uint256 b = asks.add(T, 4e18);
        asks.fill(T, 4e18, P);
        assertEq(asks.forceClose(T), 6e18);
        assertEq(asks.total(), 0);
        BookStore.Valuation memory va = asks.value(a);
        assertTrue(va.closed);
        assertEq(va.remainder, 3.6e18);
        assertEq(asks.drawRet(a) + asks.drawRet(b), 6e18, "return pot = remainder");
        assertEq(asks.drawFor(a) + asks.drawFor(b), 720_000000);
    }

    function test_hierarchy_sumsAndScan() public {
        bids.add(100, 1);
        bids.add(200, 2); // other bucket
        bids.add(20_000, 4); // other super
        assertEq(bids.sumAbove(99), 7);
        assertEq(bids.sumAbove(100), 6);
        assertEq(bids.sumAbove(200), 4);
        assertEq(bids.sumBelow(201), 3);
        assertEq(bids.sumBelow(20_001), 7);
        assertEq(bids.nextNonEmpty(1, 1_000_000), 100);
        assertEq(bids.nextNonEmpty(101, 1_000_000), 200);
        assertEq(bids.nextNonEmpty(201, 1_000_000), 20_000);
        assertEq(bids.nextNonEmpty(20_001, 1_000_000), type(uint256).max);
        assertEq(bids.nextNonEmpty(101, 199), type(uint256).max);
    }

    struct Acc {
        uint256 added;
        uint256 filled;
        uint256 removed;
        uint256 owedQuoteX; // Σ f·p (exact, scaled by B)
        uint256 potQuote; // Σ floor(f·p/B)
    }

    /// Random adds / exact fills / leaves / draws on one level, then everyone leaves.
    function testFuzz_conservation(uint256 seed, bool bidSide) public {
        BookHarness h = bidSide ? bids : asks;
        Acc memory acc;
        uint256[] memory paid = new uint256[](64); // bids: quote owed by each order when it ended
        for (uint256 i = 0; i < 48; ++i) {
            uint256 r = uint256(keccak256(abi.encode(seed, i)));
            uint256 op = r % 10;
            uint256 n = h.count();
            if (op < 3 || n == 0) {
                if (n >= 60) continue;
                uint256 q = 1 + ((r >> 8) % 50e18);
                h.add(T, q);
                acc.added += q;
            } else if (op < 7) {
                uint256 rem = h.remaining(T);
                if (rem == 0) continue;
                uint256 f = (r >> 8) % 4 == 0 ? rem : 1 + ((r >> 16) % rem);
                uint256 p = 100e6 + ((r >> 128) % 200e6);
                h.fill(T, f, p);
                acc.filled += f;
                acc.owedQuoteX += f * p;
                acc.potQuote += (f * p) / B;
            } else if (op < 9) {
                uint256 id = (r >> 8) % n;
                if (!h.isOpen(id)) continue;
                h.drawFor(id);
                if (bidSide) paid[id] = h.value(id).quote;
                acc.removed += h.leave(id);
            } else {
                h.drawFor((r >> 8) % n);
            }
        }
        // everyone leaves and draws what is owed
        uint256 drawn;
        for (uint256 id = 0; id < h.count(); ++id) {
            if (h.isOpen(id)) {
                h.drawFor(id);
                if (bidSide) paid[id] = h.value(id).quote;
                acc.removed += h.leave(id);
            } else {
                h.drawFor(id);
            }
            drawn += h.credited(id);
        }
        assertEq(h.total(), 0, "book empties exactly");
        assertEq(acc.added, acc.filled + acc.removed, "base conserved through the book");
        if (bidSide) {
            assertLe(drawn, acc.filled, "buyers never receive more base than was filled");
            uint256 totalPaid;
            for (uint256 id = 0; id < h.count(); ++id) totalPaid += paid[id];
            assertGe(totalPaid * B, acc.owedQuoteX, "buyers pay at least the exact fill cost");
        } else {
            assertLe(drawn, acc.potQuote, "sellers never receive more quote than the fills");
        }
    }
}

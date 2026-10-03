// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {Clearing} from "../../src/core/Clearing.sol";

contract ClearingHarness {
    function compute(Clearing.Input memory x) external pure returns (Clearing.Result memory) {
        return Clearing.compute(x);
    }
}

contract ClearingTest is Test {
    ClearingHarness internal h;

    function setUp() public {
        h = new ClearingHarness();
    }

    function _input(uint256 lo, uint256 hi, uint256 refTick) internal pure returns (Clearing.Input memory x) {
        uint256 n = hi - lo + 1;
        x.lo = lo;
        x.hi = hi;
        x.refTick = refTick;
        x.bids = new uint256[](n);
        x.asks = new uint256[](n);
    }

    // ---------------------------------------------------------------- unit scenarios

    function test_noCross_noTrade() public view {
        Clearing.Input memory x = _input(100, 110, 105);
        x.bids[0] = 10; // bid at 100
        x.asks[10] = 10; // ask at 110
        Clearing.Result memory r = h.compute(x);
        assertFalse(r.traded);
        assertEq(r.volume, 0);
    }

    function test_simpleCross_uniformPrice() public view {
        // bid 10 @ 108, ask 10 @ 102 -> any tick in [102,108] executes 10; imbalance 0 everywhere;
        // tie-break: closest to ref (105).
        Clearing.Input memory x = _input(100, 110, 105);
        x.bids[8] = 10; // 108
        x.asks[2] = 10; // 102
        Clearing.Result memory r = h.compute(x);
        assertTrue(r.traded);
        assertEq(r.volume, 10);
        assertEq(r.tick, 105);
        assertEq(r.bidRatio, 1e18);
        assertEq(r.askRatio, 1e18);
    }

    function test_proRataAtMarginalTick() public view {
        // bids: 30 @ 105; asks: 10 @ 103 + 10 @ 105 -> at 105 D=30,S=20 E=20; at 103/104 E=10.
        Clearing.Input memory x = _input(100, 110, 104);
        x.bids[5] = 30;
        x.asks[3] = 10;
        x.asks[5] = 10;
        Clearing.Result memory r = h.compute(x);
        assertEq(r.tick, 105);
        assertEq(r.volume, 20);
        // bid marginal level is tick 105 -> index hi-105+1 = 6
        assertEq(r.bidMarginal, 6);
        assertEq(r.bidMarginalFill, 20);
        assertEq(r.bidRatio, (uint256(20) * 1e18) / 30);
        // asks fully filled up to tick 105 -> marginal is tick 105 with full fill
        assertEq(r.askMarginal, 6);
        assertEq(r.askRatio, 1e18);
    }

    function test_aboveAndBelowClasses() public view {
        Clearing.Input memory x = _input(100, 110, 105);
        x.bidAbove = 50; // aggressive buyers above band
        x.askBelow = 20; // aggressive sellers below band
        x.asks[10] = 40; // ask @ 110
        Clearing.Result memory r = h.compute(x);
        // At 110: D=50, S=60 -> E=50 ; below 110: S=20 -> E=20. So t*=110, V=50.
        assertEq(r.tick, 110);
        assertEq(r.volume, 50);
        assertEq(r.bidMarginal, 0); // ABOVE class absorbs all
        assertEq(r.bidRatio, 1e18);
        assertEq(r.askMarginal, 11); // tick 110 is ask level lo+(11-1)
        assertEq(r.askMarginalFill, 30);
    }

    function test_tieBreak_imbalanceThenDistance() public view {
        // bid 10 @ 104, ask 10 @ 104, ask 5 @ 106, bid 5 @ 106
        Clearing.Input memory x = _input(100, 110, 100);
        x.bids[4] = 10;
        x.asks[4] = 10;
        x.bids[6] = 5;
        x.asks[6] = 5;
        Clearing.Result memory r = h.compute(x);
        // t=104: D=15,S=10 E=10 ; t=105: D=5,S=10 E=5 ; t=106: D=5,S=15 E=5 -> best 104
        assertEq(r.tick, 104);
        assertEq(r.volume, 10);
    }

    function test_revert_badArrays() public {
        Clearing.Input memory x = _input(100, 110, 105);
        x.bids = new uint256[](3);
        vm.expectRevert(Clearing.BadArrays.selector);
        h.compute(x);
    }

    // ---------------------------------------------------------------- fuzz properties

    function _bruteForce(Clearing.Input memory x)
        internal
        pure
        returns (uint256 bestE, uint256 bestTick, bool found)
    {
        uint256 n = x.hi - x.lo + 1;
        uint256 bestImb = type(uint256).max;
        uint256 bestDist = type(uint256).max;
        for (uint256 i = 0; i < n; i++) {
            uint256 d = x.bidAbove;
            for (uint256 j = i; j < n; j++) d += x.bids[j];
            uint256 s = x.askBelow;
            for (uint256 j = 0; j <= i; j++) s += x.asks[j];
            uint256 e = d < s ? d : s;
            if (e == 0) continue;
            uint256 imb = d > s ? d - s : s - d;
            uint256 t = x.lo + i;
            uint256 dist = t > x.refTick ? t - x.refTick : x.refTick - t;
            if (!found || e > bestE || (e == bestE && (imb < bestImb || (imb == bestImb && dist < bestDist)))) {
                found = true;
                bestE = e;
                bestImb = imb;
                bestDist = dist;
                bestTick = t;
            }
        }
    }

    function testFuzz_matchesBruteForceAndConserves(uint256 seed, uint8 nRaw, uint16 refOff) public view {
        uint256 n = bound(uint256(nRaw), 1, 40);
        uint256 lo = 1000;
        Clearing.Input memory x = _input(lo, lo + n - 1, lo + (uint256(refOff) % n));
        x.bidAbove = (seed % 7 == 0) ? (seed >> 8) % 1e20 : 0;
        x.askBelow = (seed % 5 == 0) ? (seed >> 16) % 1e20 : 0;
        for (uint256 i = 0; i < n; i++) {
            uint256 rb = uint256(keccak256(abi.encode(seed, "b", i)));
            uint256 ra = uint256(keccak256(abi.encode(seed, "a", i)));
            x.bids[i] = (rb % 3 == 0) ? (rb >> 8) % 1e24 : 0;
            x.asks[i] = (ra % 3 == 0) ? (ra >> 8) % 1e24 : 0;
        }

        Clearing.Result memory r = h.compute(x);
        (uint256 bestE, uint256 bestTick, bool found) = _bruteForce(x);

        assertEq(r.traded, found, "traded");
        if (!found) return;
        assertEq(r.volume, bestE, "volume is the maximum executable");
        assertEq(r.tick, bestTick, "tie-break order");

        // Bid side conservation: full levels before marginal + marginal fill == V.
        uint256 bidSum = r.bidMarginal == 0 ? 0 : x.bidAbove;
        for (uint256 j = 1; j < r.bidMarginal; j++) bidSum += x.bids[n - j];
        bidSum += r.bidMarginalFill;
        assertEq(bidSum, r.volume, "bid side sums to V");

        uint256 askSum = r.askMarginal == 0 ? 0 : x.askBelow;
        for (uint256 j = 1; j < r.askMarginal; j++) askSum += x.asks[j - 1];
        askSum += r.askMarginalFill;
        assertEq(askSum, r.volume, "ask side sums to V");

        // Limit respect: the marginal bid tick is >= t*, marginal ask tick is <= t*.
        if (r.bidMarginal > 0) assertGe(Clearing.bidLevelTick(x.hi, r.bidMarginal), r.tick, "bid limit respected");
        if (r.askMarginal > 0) assertLe(Clearing.askLevelTick(x.lo, r.askMarginal), r.tick, "ask limit respected");

        assertLe(r.bidRatio, 1e18);
        assertLe(r.askRatio, 1e18);
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {Clearing} from "../../src/core/Clearing.sol";

/// @notice Symbolic properties of the uniform-price clearing (docs/THREAT_MODEL.md promised Halmos on `Clearing`),
///         proven by halmos for every input of two instances, not sampled:
///           * `check_band2_*`: a two-tick band, any uint64 quantity;
///           * `check_band3_*`: a three-tick band with the reference in the middle, so the distance tie-break and the
///             equal-on-every-key case are reachable, with quantities below 2^16. `Clearing.compute` only adds and
///             compares quantities, so the small domain keeps every branch while it bounds the solver's work (three
///             ticks of uint64 explore about a million paths and did not finish in six hours).
///         CI runs each property on its own with a time limit and lists which were proven (.github/workflows/ci.yml,
///         "halmos"). `forge test` skips these (`check_`, not `test_`).
contract ClearingHalmos is Test {
    function _input(
        uint256 lo,
        uint256 refTick,
        uint256[] memory bids,
        uint256[] memory asks,
        uint256 above,
        uint256 below,
        uint256 cap
    ) internal pure returns (Clearing.Input memory x) {
        x.lo = lo;
        x.hi = lo + bids.length - 1;
        x.refTick = refTick;
        x.bidAbove = above;
        x.askBelow = below;
        x.bids = bids;
        x.asks = asks;
        x.maxVolume = cap;
    }

    /// demand at tick lo + i: every bid willing to pay it (limits at or above it)
    function _demand(Clearing.Input memory x, uint256 i) internal pure returns (uint256 d) {
        d = x.bidAbove;
        for (uint256 k = i; k < x.bids.length; ++k) {
            d += x.bids[k];
        }
    }

    /// supply at tick lo + i: every ask willing to sell there (limits at or below it)
    function _supply(Clearing.Input memory x, uint256 i) internal pure returns (uint256 s) {
        s = x.askBelow;
        for (uint256 k = 0; k <= i; ++k) {
            s += x.asks[k];
        }
    }

    function _min(uint256 a, uint256 b) internal pure returns (uint256) {
        return a < b ? a : b;
    }

    // ------------------------------------------------------------------ the properties, for any instance

    /// No trade means nothing crosses anywhere in the band; a trade prices inside the band, never fills more than
    /// either side offers at its price, and respects the volume cap.
    function _pricesInsideTheBand_andNeverOverfills(Clearing.Input memory x) internal pure {
        Clearing.Result memory r = Clearing.compute(x);
        if (!r.traded) {
            assert(r.volume == 0);
            for (uint256 i = 0; i < x.bids.length; ++i) {
                assert(_min(_demand(x, i), _supply(x, i)) == 0);
            }
            return;
        }
        assert(r.tick >= x.lo && r.tick <= x.hi);
        uint256 t = r.tick - x.lo;
        assert(r.volume > 0);
        assert(r.volume <= _demand(x, t));
        assert(r.volume <= _supply(x, t));
        if (x.maxVolume != 0) assert(r.volume <= x.maxVolume);
    }

    /// The price is a maximum-volume price: no tick in the band would trade more, and without a cap the auction
    /// executes exactly what crosses there.
    function _maximizesVolume(Clearing.Input memory x) internal pure {
        Clearing.Result memory r = Clearing.compute(x);
        if (!r.traded) return;
        uint256 t = r.tick - x.lo;
        uint256 best = _min(_demand(x, t), _supply(x, t));
        for (uint256 i = 0; i < x.bids.length; ++i) {
            assert(_min(_demand(x, i), _supply(x, i)) <= best);
        }
        assert(r.volume == best);
    }

    /// The marginal level on each side is filled by exactly what the auction volume needs, never more than it holds.
    function _marginalFillsAreExact(Clearing.Input memory x) internal pure {
        Clearing.Result memory r = Clearing.compute(x);
        if (!r.traded) return;
        uint256 n = x.bids.length;
        assert(r.bidMarginalFill > 0 && r.bidMarginalFill <= r.volume);
        assert(r.askMarginalFill > 0 && r.askMarginalFill <= r.volume);
        // level 0 is the outside class (above the band / below it); level j is tick hi - (j - 1) for bids, lo + j - 1 for asks
        uint256 bidLevel = r.bidMarginal == 0 ? x.bidAbove : x.bids[n - r.bidMarginal];
        uint256 askLevel = r.askMarginal == 0 ? x.askBelow : x.asks[r.askMarginal - 1];
        assert(r.bidMarginalFill <= bidLevel);
        assert(r.askMarginalFill <= askLevel);
    }

    // ------------------------------------------------------------------ two ticks, any uint64 quantity

    function _two(uint64[2] memory b, uint64[2] memory a)
        internal
        pure
        returns (uint256[] memory bids, uint256[] memory asks)
    {
        bids = new uint256[](2);
        asks = new uint256[](2);
        for (uint256 i = 0; i < 2; ++i) {
            bids[i] = b[i];
            asks[i] = a[i];
        }
    }

    function check_band2_pricesInsideTheBand_andNeverOverfills(
        uint64[2] memory b,
        uint64[2] memory a,
        uint64 above,
        uint64 below,
        uint64 cap
    ) public pure {
        (uint256[] memory bids, uint256[] memory asks) = _two(b, a);
        _pricesInsideTheBand_andNeverOverfills(_input(100, 100, bids, asks, above, below, cap));
    }

    function check_band2_maximizesVolume(uint64[2] memory b, uint64[2] memory a, uint64 above, uint64 below)
        public
        pure
    {
        (uint256[] memory bids, uint256[] memory asks) = _two(b, a);
        _maximizesVolume(_input(100, 100, bids, asks, above, below, 0));
    }

    function check_band2_marginalFillsAreExact(uint64[2] memory b, uint64[2] memory a, uint64 above, uint64 below)
        public
        pure
    {
        (uint256[] memory bids, uint256[] memory asks) = _two(b, a);
        _marginalFillsAreExact(_input(100, 100, bids, asks, above, below, 0));
    }

    // ------------------------------------------------------------------ three ticks, quantities below 2^16

    function _three(uint16[3] memory b, uint16[3] memory a)
        internal
        pure
        returns (uint256[] memory bids, uint256[] memory asks)
    {
        bids = new uint256[](3);
        asks = new uint256[](3);
        for (uint256 i = 0; i < 3; ++i) {
            bids[i] = b[i];
            asks[i] = a[i];
        }
    }

    function check_band3_pricesInsideTheBand_andNeverOverfills(
        uint16[3] memory b,
        uint16[3] memory a,
        uint16 above,
        uint16 below,
        uint16 cap
    ) public pure {
        (uint256[] memory bids, uint256[] memory asks) = _three(b, a);
        _pricesInsideTheBand_andNeverOverfills(_input(100, 101, bids, asks, above, below, cap));
    }

    function check_band3_maximizesVolume(uint16[3] memory b, uint16[3] memory a, uint16 above, uint16 below)
        public
        pure
    {
        (uint256[] memory bids, uint256[] memory asks) = _three(b, a);
        _maximizesVolume(_input(100, 101, bids, asks, above, below, 0));
    }

    function check_band3_marginalFillsAreExact(uint16[3] memory b, uint16[3] memory a, uint16 above, uint16 below)
        public
        pure
    {
        (uint256[] memory bids, uint256[] memory asks) = _three(b, a);
        _marginalFillsAreExact(_input(100, 101, bids, asks, above, below, 0));
    }
}

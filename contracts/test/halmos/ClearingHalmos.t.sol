// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {Clearing} from "../../src/core/Clearing.sol";

/// @notice Symbolic properties of the uniform-price clearing (docs/THREAT_MODEL.md promised Halmos on `Clearing`),
///         proven by halmos for every quantity on a three-tick band, not sampled:
///           halmos --match-contract ClearingHalmos --loop 4
///         `forge test` skips these (`check_`, not `test_`). Quantities are uint64, so no sum can overflow.
contract ClearingHalmos is Test {
    uint256 internal constant LO = 100;
    uint256 internal constant HI = 102;

    function _input(uint64[3] memory bids, uint64[3] memory asks, uint64 above, uint64 below, uint64 cap)
        internal
        pure
        returns (Clearing.Input memory x)
    {
        x.lo = LO;
        x.hi = HI;
        x.refTick = 101;
        x.bidAbove = above;
        x.askBelow = below;
        x.bids = new uint256[](3);
        x.asks = new uint256[](3);
        for (uint256 i = 0; i < 3; ++i) {
            x.bids[i] = bids[i];
            x.asks[i] = asks[i];
        }
        x.maxVolume = cap;
    }

    /// demand at tick lo + i: every bid willing to pay it (limits at or above it)
    function _demand(Clearing.Input memory x, uint256 i) internal pure returns (uint256 d) {
        d = x.bidAbove;
        for (uint256 k = i; k < 3; ++k) {
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

    /// No trade means nothing crosses anywhere in the band; a trade prices inside the band, never fills more than
    /// either side offers at its price, and respects the volume cap.
    function check_pricesInsideTheBand_andNeverOverfills(
        uint64[3] memory bids,
        uint64[3] memory asks,
        uint64 above,
        uint64 below,
        uint64 cap
    ) public pure {
        Clearing.Input memory x = _input(bids, asks, above, below, cap);
        Clearing.Result memory r = Clearing.compute(x);
        if (!r.traded) {
            assert(r.volume == 0);
            for (uint256 i = 0; i < 3; ++i) {
                assert(_min(_demand(x, i), _supply(x, i)) == 0);
            }
            return;
        }
        assert(r.tick >= LO && r.tick <= HI);
        uint256 t = r.tick - LO;
        assert(r.volume > 0);
        assert(r.volume <= _demand(x, t) && r.volume <= _supply(x, t));
        if (cap != 0) assert(r.volume <= cap);
    }

    /// The price is a maximum-volume price: no tick in the band would trade more, and without a cap the auction
    /// executes exactly what crosses there.
    function check_maximizesVolume(uint64[3] memory bids, uint64[3] memory asks, uint64 above, uint64 below)
        public
        pure
    {
        Clearing.Input memory x = _input(bids, asks, above, below, 0);
        Clearing.Result memory r = Clearing.compute(x);
        if (!r.traded) return;
        uint256 t = r.tick - LO;
        uint256 best = _min(_demand(x, t), _supply(x, t));
        for (uint256 i = 0; i < 3; ++i) {
            assert(_min(_demand(x, i), _supply(x, i)) <= best);
        }
        assert(r.volume == best);
    }

    /// The marginal level on each side is filled by exactly what the auction volume needs, never more than it holds.
    function check_marginalFillsAreExact(uint64[3] memory bids, uint64[3] memory asks, uint64 above, uint64 below)
        public
        pure
    {
        Clearing.Input memory x = _input(bids, asks, above, below, 0);
        Clearing.Result memory r = Clearing.compute(x);
        if (!r.traded) return;
        assert(r.bidMarginalFill > 0 && r.bidMarginalFill <= r.volume);
        assert(r.askMarginalFill > 0 && r.askMarginalFill <= r.volume);
        // level 0 is the outside class (above the band / below it); level j is tick hi - (j - 1) for bids, lo + j - 1 for asks
        uint256 bidLevel = r.bidMarginal == 0 ? x.bidAbove : x.bids[3 - r.bidMarginal];
        uint256 askLevel = r.askMarginal == 0 ? x.askBelow : x.asks[r.askMarginal - 1];
        assert(r.bidMarginalFill <= bidLevel);
        assert(r.askMarginalFill <= askLevel);
    }
}

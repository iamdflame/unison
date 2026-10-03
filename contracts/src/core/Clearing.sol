// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @title Clearing — uniform-price frequent-batch-auction clearing (SPEC §5)
/// @notice Pure library: given aggregated liquidity inside a price band, finds the single
///         clearing tick t* that maximizes executed volume and the marginal level + pro-rata
///         ratio on each side. Arrival order inside a batch has no influence on the result.
/// @dev    Levels in priority order:
///           BID: [ABOVE(hi), hi, hi-1, ..., lo]   (index 0 = ABOVE, index j = tick hi-(j-1))
///           ASK: [BELOW(lo), lo, lo+1, ..., hi]   (index 0 = BELOW, index j = tick lo+(j-1))
///         Every level before the marginal level is fully filled, the marginal level is filled
///         by `ratio` (1e18 = 100%), every later level gets nothing. All fills at price(t*).
library Clearing {
    uint256 internal constant ONE = 1e18;

    error EmptyBand();
    error BadArrays();

    struct Input {
        uint256 lo; // lowest tick in band (inclusive)
        uint256 hi; // highest tick in band (inclusive)
        uint256 refTick; // reference tick, used only for tie-breaking
        uint256 bidAbove; // bid liquidity with limit tick > hi (willing at every band price)
        uint256 askBelow; // ask liquidity with limit tick < lo (willing at every band price)
        uint256[] bids; // bids[i] = bid liquidity with limit exactly lo + i
        uint256[] asks; // asks[i] = ask liquidity with limit exactly lo + i
    }

    struct Result {
        bool traded;
        uint256 tick; // clearing tick t*
        uint256 volume; // executed volume V (base units)
        uint256 bidMarginal; // marginal bid level index in priority order
        uint256 bidRatio; // fill ratio of the marginal bid level (1e18 = full)
        uint256 bidMarginalFill; // exact base units filled at the marginal bid level
        uint256 askMarginal; // marginal ask level index in priority order
        uint256 askRatio; // fill ratio of the marginal ask level (1e18 = full)
        uint256 askMarginalFill; // exact base units filled at the marginal ask level
    }

    /// @notice Computes the clearing result for one batch.
    function compute(Input memory x) internal pure returns (Result memory r) {
        if (x.hi < x.lo) revert EmptyBand();
        uint256 n = x.hi - x.lo + 1;
        if (x.bids.length != n || x.asks.length != n) revert BadArrays();

        // Suffix sums for demand D(t) and prefix sums for supply S(t), computed on the fly.
        uint256[] memory demand = new uint256[](n);
        uint256 acc = x.bidAbove;
        for (uint256 i = n; i > 0;) {
            unchecked {
                --i;
            }
            acc += x.bids[i];
            demand[i] = acc;
        }

        uint256 supplyAcc = x.askBelow;
        uint256 bestE;
        uint256 bestImb = type(uint256).max;
        uint256 bestDist = type(uint256).max;
        uint256 bestIdx;
        bool found;

        for (uint256 i = 0; i < n;) {
            supplyAcc += x.asks[i];
            uint256 d = demand[i];
            uint256 e = d < supplyAcc ? d : supplyAcc;
            if (e > 0) {
                uint256 imb = d > supplyAcc ? d - supplyAcc : supplyAcc - d;
                uint256 t = x.lo + i;
                uint256 dist = t > x.refTick ? t - x.refTick : x.refTick - t;
                bool better;
                if (!found || e > bestE) {
                    better = true;
                } else if (e == bestE) {
                    if (imb < bestImb) better = true;
                    else if (imb == bestImb && dist < bestDist) better = true;
                    // equal on all keys: keep the lower tick (already stored, since we scan upward)
                }
                if (better) {
                    found = true;
                    bestE = e;
                    bestImb = imb;
                    bestDist = dist;
                    bestIdx = i;
                }
            }
            unchecked {
                ++i;
            }
        }

        if (!found) return r; // no crossing liquidity inside the band

        r.traded = true;
        r.volume = bestE;
        r.tick = x.lo + bestIdx;

        (r.bidMarginal, r.bidRatio, r.bidMarginalFill) = _allocateBids(x, n, bestE);
        (r.askMarginal, r.askRatio, r.askMarginalFill) = _allocateAsks(x, n, bestE);
    }

    /// @dev Walks bid levels from the best (ABOVE) downward until V is exhausted.
    function _allocateBids(Input memory x, uint256 n, uint256 v)
        private
        pure
        returns (uint256 marginal, uint256 ratio, uint256 fill)
    {
        if (v <= x.bidAbove) {
            return (0, _ratio(v, x.bidAbove), v);
        }
        uint256 cum = x.bidAbove;
        for (uint256 j = 1; j <= n;) {
            uint256 q = x.bids[n - j]; // tick hi-(j-1)  => bids index (hi - lo) - (j-1) = n - j
            if (cum + q >= v) {
                uint256 need = v - cum;
                return (j, _ratio(need, q), need);
            }
            cum += q;
            unchecked {
                ++j;
            }
        }
        // Unreachable when v <= D(t*), kept for safety.
        revert BadArrays();
    }

    /// @dev Walks ask levels from the best (BELOW) upward until V is exhausted.
    function _allocateAsks(Input memory x, uint256 n, uint256 v)
        private
        pure
        returns (uint256 marginal, uint256 ratio, uint256 fill)
    {
        if (v <= x.askBelow) {
            return (0, _ratio(v, x.askBelow), v);
        }
        uint256 cum = x.askBelow;
        for (uint256 j = 1; j <= n;) {
            uint256 q = x.asks[j - 1]; // tick lo+(j-1)
            if (cum + q >= v) {
                uint256 need = v - cum;
                return (j, _ratio(need, q), need);
            }
            cum += q;
            unchecked {
                ++j;
            }
        }
        revert BadArrays();
    }

    /// @dev Fill ratio of a level, floored, 1e18 = full. A zero-size level never becomes marginal
    ///      with a positive need (walk skips it), so `q == 0` only occurs with need == 0.
    function _ratio(uint256 need, uint256 q) private pure returns (uint256) {
        if (q == 0) return 0;
        if (need >= q) return ONE;
        return (need * ONE) / q;
    }

    /// @notice Tick of a bid level index (index 0 = ABOVE has no single tick).
    function bidLevelTick(uint256 hi, uint256 j) internal pure returns (uint256) {
        return hi - (j - 1);
    }

    /// @notice Tick of an ask level index (index 0 = BELOW has no single tick).
    function askLevelTick(uint256 lo, uint256 j) internal pure returns (uint256) {
        return lo + (j - 1);
    }
}

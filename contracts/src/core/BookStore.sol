// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Pages} from "../libraries/Pages.sol";

/// @title BookStore — persistent pro-rata book levels with lazy accounting (SPEC §3)
/// @notice One book = (market, side, shard). Each tick level keeps an aggregate `remaining` plus a
///         survival multiplier S and a price-weighted accumulator A, so that every resting order's
///         fills and quote can be computed lazily, in O(1), at claim time — no per-order iteration
///         at clearing. A 3-level total hierarchy (tick → bucket(128) → super(16384)) answers
///         "liquidity above/below tick" with ~3 page reads.
/// @dev    Storage per level (two parallel page-aligned arrays so clearing scans only slot 1):
///           slot1: remaining uint128 | S uint96 | epoch uint32
///           slot2: A uint128
///         Ticks must be < 2^21 (MAX_TICK) so supers fit in one page.
library BookStore {
    uint256 internal constant S_SCALE = 1e27; // survival scale
    uint256 internal constant S_MIN = 1e9; // force-close a level below this survival
    uint256 internal constant RATIO_ONE = 1e18;
    uint256 internal constant MAX_TICK = (1 << 21) - 1;

    bytes32 internal constant NS_LEVEL = keccak256("unison.book.level");
    bytes32 internal constant NS_ACC = keccak256("unison.book.acc");
    bytes32 internal constant NS_BUCKET = keccak256("unison.book.bucket");
    bytes32 internal constant NS_SUPER = keccak256("unison.book.super");
    bytes32 internal constant NS_FINAL = keccak256("unison.book.final");
    bytes32 internal constant NS_TOTAL = keccak256("unison.book.total");

    error TickOutOfRange();
    error Underflow();

    struct Level {
        uint256 remaining; // aggregate resting quantity at this level (base units)
        uint256 survival; // S, scale S_SCALE
        uint256 epoch; // increments every time the level is fully filled
        uint256 acc; // A, scale 1e18 * price
    }

    /// @dev Identifies one shard of one side of one market.
    struct Key {
        uint256 market;
        uint256 side; // 0 = BID, 1 = ASK
        uint256 shard;
    }

    // ------------------------------------------------------------------ slot math

    function _levelSlot(Key memory k, uint256 tick) private pure returns (uint256) {
        return Pages.base5(NS_LEVEL, k.market, k.side, k.shard, tick >> 7, 0) + (tick & 127);
    }

    function _accSlot(Key memory k, uint256 tick) private pure returns (uint256) {
        return Pages.base5(NS_ACC, k.market, k.side, k.shard, tick >> 7, 0) + (tick & 127);
    }

    function _bucketSlot(Key memory k, uint256 bucket) private pure returns (uint256) {
        return Pages.base5(NS_BUCKET, k.market, k.side, k.shard, bucket >> 7, 0) + (bucket & 127);
    }

    function _superSlot(Key memory k, uint256 sup) private pure returns (uint256) {
        return Pages.base4(NS_SUPER, k.market, k.side, k.shard, 0) + (sup & 127);
    }

    function _totalSlot(Key memory k) private pure returns (uint256) {
        return Pages.base4(NS_TOTAL, k.market, k.side, k.shard, 0);
    }

    function _finalSlot(Key memory k, uint256 tick, uint256 epoch) private pure returns (uint256) {
        return uint256(keccak256(abi.encode(NS_FINAL, k.market, k.side, k.shard, tick, epoch)));
    }

    // ------------------------------------------------------------------ level codec

    function readLevel(Key memory k, uint256 tick) internal view returns (Level memory l) {
        uint256 w = Pages.load(_levelSlot(k, tick));
        l.remaining = w & type(uint128).max;
        uint256 s = (w >> 128) & type(uint96).max;
        l.survival = s == 0 ? S_SCALE : s; // fresh level starts at S = 1
        l.epoch = w >> 224;
        l.acc = Pages.load(_accSlot(k, tick));
    }

    /// @notice Cheap read of only the aggregate quantity (used by clearing scans).
    function remainingAt(Key memory k, uint256 tick) internal view returns (uint256) {
        return Pages.load(_levelSlot(k, tick)) & type(uint128).max;
    }

    function _writeLevel(Key memory k, uint256 tick, Level memory l) private {
        uint256 s = l.survival == S_SCALE ? 0 : l.survival; // store 0 for "fresh" to keep slots zeroable
        Pages.store(_levelSlot(k, tick), l.remaining | (s << 128) | (l.epoch << 224));
        Pages.store(_accSlot(k, tick), l.acc);
    }

    function epochFinal(Key memory k, uint256 tick, uint256 epoch) internal view returns (uint256) {
        return Pages.load(_finalSlot(k, tick, epoch));
    }

    // ------------------------------------------------------------------ hierarchy totals

    function total(Key memory k) internal view returns (uint256) {
        return Pages.load(_totalSlot(k));
    }

    function bucketTotal(Key memory k, uint256 bucket) internal view returns (uint256) {
        return Pages.load(_bucketSlot(k, bucket));
    }

    function superTotal(Key memory k, uint256 sup) internal view returns (uint256) {
        return Pages.load(_superSlot(k, sup));
    }

    function _addTotals(Key memory k, uint256 tick, uint256 q) private {
        uint256 b = tick >> 7;
        uint256 s = tick >> 14;
        uint256 bs = _bucketSlot(k, b);
        Pages.store(bs, Pages.load(bs) + q);
        uint256 ss = _superSlot(k, s);
        Pages.store(ss, Pages.load(ss) + q);
        uint256 ts = _totalSlot(k);
        Pages.store(ts, Pages.load(ts) + q);
    }

    function _subTotals(Key memory k, uint256 tick, uint256 q) private {
        uint256 b = tick >> 7;
        uint256 s = tick >> 14;
        uint256 bs = _bucketSlot(k, b);
        uint256 bv = Pages.load(bs);
        uint256 ss = _superSlot(k, s);
        uint256 sv = Pages.load(ss);
        uint256 ts = _totalSlot(k);
        uint256 tv = Pages.load(ts);
        if (bv < q || sv < q || tv < q) revert Underflow();
        Pages.store(bs, bv - q);
        Pages.store(ss, sv - q);
        Pages.store(ts, tv - q);
    }

    /// @notice Sum of `remaining` over all ticks strictly greater than `tick`.
    function sumAbove(Key memory k, uint256 tick) internal view returns (uint256 sum) {
        if (tick >= MAX_TICK) return 0;
        uint256 b = tick >> 7;
        uint256 s = tick >> 14;
        // ticks above `tick` inside its bucket
        uint256 bucketEnd = (b << 7) | 127;
        for (uint256 t = tick + 1; t <= bucketEnd; ++t) {
            sum += remainingAt(k, t);
        }
        // buckets above `b` inside its super
        uint256 superEndBucket = (s << 7) | 127;
        for (uint256 bb = b + 1; bb <= superEndBucket; ++bb) {
            sum += Pages.load(_bucketSlot(k, bb));
        }
        // supers above `s`
        for (uint256 ss = s + 1; ss <= (MAX_TICK >> 14); ++ss) {
            sum += Pages.load(_superSlot(k, ss));
        }
    }

    /// @notice Sum of `remaining` over all ticks strictly less than `tick`.
    function sumBelow(Key memory k, uint256 tick) internal view returns (uint256 sum) {
        if (tick == 0) return 0;
        uint256 b = tick >> 7;
        uint256 s = tick >> 14;
        uint256 bucketStart = b << 7;
        for (uint256 t = bucketStart; t < tick; ++t) {
            sum += remainingAt(k, t);
        }
        uint256 superStartBucket = s << 7;
        for (uint256 bb = superStartBucket; bb < b; ++bb) {
            sum += Pages.load(_bucketSlot(k, bb));
        }
        for (uint256 ss = 0; ss < s; ++ss) {
            sum += Pages.load(_superSlot(k, ss));
        }
    }

    // ------------------------------------------------------------------ mutations

    /// @notice Adds resting quantity at `tick`. Returns the level snapshot the order must store.
    function add(Key memory k, uint256 tick, uint256 q) internal returns (uint256 epoch, uint256 survival, uint256 acc) {
        if (tick > MAX_TICK || tick == 0) revert TickOutOfRange();
        Level memory l = readLevel(k, tick);
        l.remaining += q;
        _writeLevel(k, tick, l);
        _addTotals(k, tick, q);
        return (l.epoch, l.survival, l.acc);
    }

    /// @notice Removes resting quantity (cancel). Clamps to the aggregate to absorb rounding drift.
    function remove(Key memory k, uint256 tick, uint256 q) internal returns (uint256 removed) {
        Level memory l = readLevel(k, tick);
        removed = q > l.remaining ? l.remaining : q;
        if (removed == 0) return 0;
        l.remaining -= removed;
        _writeLevel(k, tick, l);
        _subTotals(k, tick, removed);
    }

    /// @notice Applies a fill of ratio `ratio` (1e18 = full) at quote price `price` to a level.
    /// @return filled aggregate base quantity removed from the level
    function fill(Key memory k, uint256 tick, uint256 ratio, uint256 price) internal returns (uint256 filled) {
        Level memory l = readLevel(k, tick);
        if (l.remaining == 0 || ratio == 0) return 0;
        if (ratio >= RATIO_ONE) {
            filled = l.remaining;
            _closeEpoch(k, tick, l, price);
        } else {
            uint256 newS = (l.survival * (RATIO_ONE - ratio)) / RATIO_ONE;
            if (newS < S_MIN) {
                // Precision guard (SPEC §3.1): the residual is dust; close the level as fully filled.
                filled = l.remaining;
                _closeEpoch(k, tick, l, price);
            } else {
                filled = (l.remaining * ratio) / RATIO_ONE;
                // A(real) += s·ρ·p with A scale 1e18  =>  A += S·ratio·p / S_SCALE
                l.acc += (l.survival * ratio * price) / S_SCALE;
                l.survival = newS;
                l.remaining -= filled;
                _writeLevel(k, tick, l);
            }
        }
        if (filled > 0) _subTotals(k, tick, filled);
    }

    /// @dev Full fill: A_final = A + s·p (scale 1e18) = A + S·1e18·p / S_SCALE.
    function _closeEpoch(Key memory k, uint256 tick, Level memory l, uint256 price) private {
        uint256 accFinal = l.acc + (l.survival * RATIO_ONE * price) / S_SCALE;
        Pages.store(_finalSlot(k, tick, l.epoch), accFinal);
        l.epoch += 1;
        l.survival = S_SCALE;
        l.acc = 0;
        l.remaining = 0;
        _writeLevel(k, tick, l);
    }
}

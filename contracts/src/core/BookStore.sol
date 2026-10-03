// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {Pages} from "../libraries/Pages.sol";

/// @title BookStore — persistent pro-rata price levels with exact, conservative lazy accounting (SPEC §3)
/// @notice One book = (market, side, shard). Each tick level holds the REAL resting quantity plus lazy
///         accounting state, so a fill is O(1) no matter how many orders rest at the level:
///           - survival S (Liquity-style product, 1e38 precision, rescaled by 1e9 so it never underflows)
///           - accumulator A = Σ S·ρ·p per (epoch, scale), giving each order its quote in O(1)
///           - pot: the exact amount the level's owners may RECEIVE (bids: base, asks: quote)
/// @dev    Conservation argument (SPEC §3.3):
///           * S is rounded UP on both sides, so the lazy remainders of the orders at a level always sum
///             to >= the real remaining quantity. Removals are clamped to the real quantity, so the book
///             empties exactly when its last order leaves, and nobody can take out more than exists.
///           * Receipts never come from lazy math alone: buyers draw base and sellers draw quote from the
///             level's pot, which grows by exactly the fills (asks: floor(f·p/B)). Lazy math only decides
///             how the pot is shared.
///           * Payments come from lazy math rounded UP (bids: A rounded up) and therefore cover the pots.
///         A level that is fully filled (or force-closed, for IOC books) is closed IN PLACE: its words keep
///         the final state and are archived to a keccak record only when the tick is reused. That makes a
///         full fill ~3 storage writes, and lets late claimers settle against the archive.
///
///         Level words (page-aligned arrays, 128 ticks per page):
///           LEVEL: remaining u128 | epoch u64 | scale u32 | closed bit 224   (closed: remaining = return pot)
///           STATE: S u128 | pot u128
///           ACC:   A u256 (current scale; A_last once closed)
library BookStore {
    uint256 internal constant S_SCALE = 1e38; // survival "1.0"
    uint256 internal constant S_MIN = 1e29; // rescale threshold
    uint256 internal constant K = 1e9; // rescale factor
    uint256 internal constant MAX_WALK = 4; // scales walked when valuing; deeper scales contribute < 1 unit
    uint256 internal constant MAX_TICK = (1 << 21) - 1;

    uint256 internal constant POT = 0; // receipt pot (bids: base, asks: quote)
    uint256 internal constant RET = 1; // return pot of a force-closed ask level (base)

    uint256 private constant M128 = type(uint128).max;
    uint256 private constant M64 = type(uint64).max;
    uint256 private constant M32 = type(uint32).max;
    uint256 private constant CLOSED_BIT = 1 << 224;

    bytes32 internal constant NS_LEVEL = keccak256("unison.book.level");
    bytes32 internal constant NS_STATE = keccak256("unison.book.state");
    bytes32 internal constant NS_ACC = keccak256("unison.book.acc");
    bytes32 internal constant NS_BUCKET = keccak256("unison.book.bucket");
    bytes32 internal constant NS_SUPER = keccak256("unison.book.super");
    bytes32 internal constant NS_TOTAL = keccak256("unison.book.total");
    bytes32 internal constant NS_FINAL = keccak256("unison.book.final");
    bytes32 internal constant NS_ARCHIVE = keccak256("unison.book.archive");

    error TickOutOfRange();
    error Underflow();
    error Overflow();
    error FillTooLarge();
    error LevelClosed();
    error MissingRecord();

    struct Key {
        uint256 market;
        uint256 side; // 0 = BID, 1 = ASK
        uint256 shard; // 0..7 main books, 8..15 IOC books
    }

    struct Level {
        uint256 remaining; // real resting quantity (closed: return pot)
        uint256 epoch;
        uint256 scale;
        bool closed;
        uint256 survival; // S (closed: S at close, 0 when fully filled)
        uint256 pot;
        uint256 acc; // A of the current scale (closed: A_last)
    }

    /// @notice Level state an order group captured when it joined (SPEC §3.1).
    struct Snap {
        uint256 epoch;
        uint256 scale;
        uint256 survival;
        uint256 acc;
    }

    struct Valuation {
        uint256 remainder; // unfilled quantity, rounded UP (0 iff fully filled)
        uint256 quote; // quote exchanged since the snapshot (bids: rounded up, asks: rounded down)
        bool closed; // the order's epoch is closed: the order is final
    }

    // ------------------------------------------------------------------ slot math

    function _lvl(Key memory k, uint256 tick) private pure returns (uint256) {
        return Pages.base5(NS_LEVEL, k.market, k.side, k.shard, tick >> 7, 0) + (tick & 127);
    }

    function _st(Key memory k, uint256 tick) private pure returns (uint256) {
        return Pages.base5(NS_STATE, k.market, k.side, k.shard, tick >> 7, 0) + (tick & 127);
    }

    function _ac(Key memory k, uint256 tick) private pure returns (uint256) {
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

    function _finalSlot(Key memory k, uint256 tick, uint256 epoch, uint256 scale) private pure returns (uint256) {
        return uint256(keccak256(abi.encode(NS_FINAL, k.market, k.side, k.shard, tick, epoch, scale)));
    }

    /// @dev 4-aligned so the 3 archived words share one storage page.
    function _archive(Key memory k, uint256 tick, uint256 epoch) private pure returns (uint256) {
        return uint256(keccak256(abi.encode(NS_ARCHIVE, k.market, k.side, k.shard, tick, epoch))) & ~uint256(3);
    }

    // ------------------------------------------------------------------ codec

    function _decode(uint256 w, uint256 sw, uint256 aw) private pure returns (Level memory l) {
        l.remaining = w & M128;
        l.epoch = (w >> 128) & M64;
        l.scale = (w >> 192) & M32;
        l.closed = (w & CLOSED_BIT) != 0;
        l.survival = sw & M128;
        l.pot = sw >> 128;
        l.acc = aw;
        if (!l.closed && l.survival == 0) l.survival = S_SCALE; // never used
    }

    function _store(Key memory k, uint256 tick, Level memory l) private {
        if (l.remaining > M128 || l.pot > M128 || l.survival > M128 || l.scale > M32) revert Overflow();
        Pages.store(
            _lvl(k, tick), l.remaining | (l.epoch << 128) | (l.scale << 192) | (l.closed ? CLOSED_BIT : 0)
        );
        Pages.store(_st(k, tick), l.survival | (l.pot << 128));
        Pages.store(_ac(k, tick), l.acc);
    }

    function readLevel(Key memory k, uint256 tick) internal view returns (Level memory) {
        return _decode(Pages.load(_lvl(k, tick)), Pages.load(_st(k, tick)), Pages.load(_ac(k, tick)));
    }

    /// @notice Real resting quantity at `tick` (0 for closed levels). Used by clearing scans.
    function remainingAt(Key memory k, uint256 tick) internal view returns (uint256) {
        uint256 w = Pages.load(_lvl(k, tick));
        return (w & CLOSED_BIT) != 0 ? 0 : w & M128;
    }

    /// @notice A at the end of a scale that was closed by a rescale (0 if never closed).
    function finalAcc(Key memory k, uint256 tick, uint256 epoch, uint256 scale) internal view returns (uint256) {
        return Pages.load(_finalSlot(k, tick, epoch, scale));
    }

    /// @dev The three words describing `epoch` of a level: in place, or the archive once the tick was reused.
    function _record(Key memory k, uint256 tick, uint256 epoch)
        private
        view
        returns (uint256 w, uint256 sw, uint256 aw)
    {
        w = Pages.load(_lvl(k, tick));
        if (((w >> 128) & M64) == epoch) return (w, Pages.load(_st(k, tick)), Pages.load(_ac(k, tick)));
        uint256 h = _archive(k, tick, epoch);
        w = Pages.load(h);
        if (w & CLOSED_BIT == 0) revert MissingRecord();
        return (w, Pages.load(h + 1), Pages.load(h + 2));
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
        uint256 bs = _bucketSlot(k, tick >> 7);
        Pages.store(bs, Pages.load(bs) + q);
        uint256 ss = _superSlot(k, tick >> 14);
        Pages.store(ss, Pages.load(ss) + q);
        uint256 ts = _totalSlot(k);
        Pages.store(ts, Pages.load(ts) + q);
    }

    function _subTotals(Key memory k, uint256 tick, uint256 q) private {
        uint256 bs = _bucketSlot(k, tick >> 7);
        uint256 bv = Pages.load(bs);
        uint256 ss = _superSlot(k, tick >> 14);
        uint256 sv = Pages.load(ss);
        uint256 ts = _totalSlot(k);
        uint256 tv = Pages.load(ts);
        if (bv < q || sv < q || tv < q) revert Underflow();
        Pages.store(bs, bv - q);
        Pages.store(ss, sv - q);
        Pages.store(ts, tv - q);
    }

    /// @notice Sum of resting quantity over all ticks strictly greater than `tick`.
    function sumAbove(Key memory k, uint256 tick) internal view returns (uint256 sum) {
        if (tick >= MAX_TICK) return 0;
        uint256 b = tick >> 7;
        uint256 s = tick >> 14;
        uint256 bucketEnd = (b << 7) | 127;
        for (uint256 t = tick + 1; t <= bucketEnd; ++t) {
            sum += remainingAt(k, t);
        }
        uint256 superEndBucket = (s << 7) | 127;
        for (uint256 bb = b + 1; bb <= superEndBucket; ++bb) {
            sum += Pages.load(_bucketSlot(k, bb));
        }
        for (uint256 ss = s + 1; ss <= (MAX_TICK >> 14); ++ss) {
            sum += Pages.load(_superSlot(k, ss));
        }
    }

    /// @notice Sum of resting quantity over all ticks strictly less than `tick`.
    function sumBelow(Key memory k, uint256 tick) internal view returns (uint256 sum) {
        if (tick == 0) return 0;
        uint256 b = tick >> 7;
        uint256 s = tick >> 14;
        for (uint256 t = b << 7; t < tick; ++t) {
            sum += remainingAt(k, t);
        }
        for (uint256 bb = s << 7; bb < b; ++bb) {
            sum += Pages.load(_bucketSlot(k, bb));
        }
        for (uint256 ss = 0; ss < s; ++ss) {
            sum += Pages.load(_superSlot(k, ss));
        }
    }

    /// @notice First tick in [from, to] (ascending) with resting quantity, or type(uint256).max.
    /// @dev Skips empty supers (16384 ticks) and buckets (128 ticks) via the hierarchy totals.
    function nextNonEmpty(Key memory k, uint256 from, uint256 to) internal view returns (uint256) {
        if (to > MAX_TICK) to = MAX_TICK;
        uint256 t = from;
        while (t <= to) {
            if (Pages.load(_superSlot(k, t >> 14)) == 0) {
                t = ((t >> 14) + 1) << 14;
                continue;
            }
            if (Pages.load(_bucketSlot(k, t >> 7)) == 0) {
                t = ((t >> 7) + 1) << 7;
                continue;
            }
            uint256 end = (t | 127) < to ? (t | 127) : to;
            for (; t <= end; ++t) {
                if (remainingAt(k, t) != 0) return t;
            }
        }
        return type(uint256).max;
    }

    // ------------------------------------------------------------------ mutations

    /// @notice Adds resting quantity. Returns the snapshot the joining order group must keep.
    /// @dev Joining a closed level archives the closed epoch and opens epoch + 1.
    function add(Key memory k, uint256 tick, uint256 q) internal returns (Snap memory s) {
        if (tick == 0 || tick > MAX_TICK) revert TickOutOfRange();
        uint256 ls = _lvl(k, tick);
        uint256 w = Pages.load(ls);
        if ((w & CLOSED_BIT) != 0) {
            uint256 sts = _st(k, tick);
            uint256 acs = _ac(k, tick);
            uint256 epoch = (w >> 128) & M64;
            uint256 h = _archive(k, tick, epoch);
            Pages.store(h, w);
            Pages.store(h + 1, Pages.load(sts));
            Pages.store(h + 2, Pages.load(acs));
            if (epoch + 1 > M64) revert Overflow();
            w = (epoch + 1) << 128; // open, remaining 0, scale 0
            Pages.store(sts, S_SCALE);
            Pages.store(acs, 0);
            s = Snap(epoch + 1, 0, S_SCALE, 0);
        } else {
            uint256 sts = _st(k, tick);
            uint256 sw = Pages.load(sts);
            uint256 sv = sw & M128;
            if (sv == 0) {
                sv = S_SCALE; // first use of this tick
                Pages.store(sts, sw | S_SCALE);
            }
            s = Snap((w >> 128) & M64, (w >> 192) & M32, sv, Pages.load(_ac(k, tick)));
        }
        uint256 rem = (w & M128) + q;
        if (rem > M128) revert Overflow();
        Pages.store(ls, (w & ~M128) | rem);
        _addTotals(k, tick, q);
    }

    /// @notice An order of `epoch` leaves with lazy remainder `r`. Clamped to the real quantity.
    /// @return removed quantity actually taken out of the book (0 if the order's epoch is closed)
    function leave(Key memory k, uint256 tick, uint256 epoch, uint256 r) internal returns (uint256 removed) {
        uint256 ls = _lvl(k, tick);
        uint256 w = Pages.load(ls);
        if ((w & CLOSED_BIT) != 0 || ((w >> 128) & M64) != epoch) return 0;
        uint256 rem = w & M128;
        removed = r < rem ? r : rem;
        if (removed == 0) return 0;
        Pages.store(ls, w - removed);
        _subTotals(k, tick, removed);
    }

    /// @notice Fills exactly `f` base units of the level at `price` (quote units per whole base token).
    /// @return closedNow the level was fully filled and is now closed
    function fill(Key memory k, uint256 tick, uint256 f, uint256 price, uint256 baseUnit, bool isBid)
        internal
        returns (bool closedNow)
    {
        if (f == 0) return false;
        Level memory l = readLevel(k, tick);
        if (l.closed) revert LevelClosed();
        if (f > l.remaining) revert FillTooLarge();
        l.pot += isBid ? f : Math.mulDiv(f, price, baseUnit);
        if (f == l.remaining) {
            l.acc += l.survival * price; // every remaining unit trades at `price`: exact
            l.survival = 0;
            l.remaining = 0;
            l.closed = true;
            closedNow = true;
        } else {
            uint256 rem = l.remaining;
            uint256 rem2 = rem - f;
            // A += S·(f/rem)·p ; bids round up (buyers pay at least the fill), asks round down
            l.acc += Math.mulDiv(l.survival * price, f, rem, isBid ? Math.Rounding.Ceil : Math.Rounding.Floor);
            // S' = S·rem2/rem, rounded up so lazy remainders never undercount the real quantity
            uint256 ns = Math.mulDiv(l.survival, rem2, rem, Math.Rounding.Ceil);
            if (ns < S_MIN) {
                Pages.store(_finalSlot(k, tick, l.epoch, l.scale), l.acc);
                l.acc = 0;
                uint256 j;
                do {
                    unchecked {
                        ++j;
                    }
                    ns = _shrink(l.survival, rem2, rem, j);
                } while (ns < S_MIN);
                l.scale += j;
            }
            l.survival = ns;
            l.remaining = rem2;
        }
        _store(k, tick, l);
        _subTotals(k, tick, f);
    }

    /// @dev S·(rem2/rem)·K^j rounded up, computed without overflow for j <= MAX_WALK + 1.
    function _shrink(uint256 s, uint256 rem2, uint256 rem, uint256 j) private pure returns (uint256) {
        uint256 b = j > MAX_WALK ? MAX_WALK : j;
        return Math.mulDiv(s * (10 ** (9 * (j - b))), rem2 * (10 ** (9 * b)), rem, Math.Rounding.Ceil);
    }

    /// @notice Closes an IOC level after its auction: the unfilled remainder leaves the book.
    /// @return r quantity removed from the book (asks: kept as the level's return pot)
    function forceClose(Key memory k, uint256 tick, bool isBid) internal returns (uint256 r) {
        Level memory l = readLevel(k, tick);
        if (l.closed || l.remaining == 0) return 0;
        r = l.remaining;
        l.closed = true;
        l.remaining = isBid ? 0 : r; // A and S stay: they are the epoch's final state
        _store(k, tick, l);
        _subTotals(k, tick, r);
    }

    /// @notice Draws up to `want` from a level-epoch's pot (`kind` = POT or RET). Never exceeds the pot.
    function draw(Key memory k, uint256 tick, uint256 epoch, uint256 want, uint256 kind)
        internal
        returns (uint256 got)
    {
        if (want == 0) return 0;
        uint256 ls = _lvl(k, tick);
        uint256 w = Pages.load(ls);
        uint256 slot;
        if (((w >> 128) & M64) == epoch) {
            slot = kind == POT ? _st(k, tick) : ls;
        } else {
            uint256 h = _archive(k, tick, epoch);
            slot = kind == POT ? h + 1 : h;
        }
        uint256 x = Pages.load(slot);
        if (kind == POT) {
            uint256 pot = x >> 128;
            got = want < pot ? want : pot;
            Pages.store(slot, x - (got << 128));
        } else {
            if ((x & CLOSED_BIT) == 0) return 0; // only closed levels carry a return pot
            uint256 pot = x & M128;
            got = want < pot ? want : pot;
            Pages.store(slot, x - got);
        }
    }

    // ------------------------------------------------------------------ valuation

    /// @notice Values `qty` that joined with snapshot `s` against the level's state (or its archive).
    /// @dev    remainder = qty·S_end/(S_s·K^Δscale), rounded up.
    ///         quote = qty·Σ_j ΔA_j/K^j / (S_s·baseUnit) over the scales walked, bids rounded up (plus one unit
    ///         if scales beyond MAX_WALK exist, which together are worth < 1 unit), asks rounded down.
    function value(Key memory k, uint256 tick, Snap memory s, uint256 qty, bool isBid, uint256 baseUnit)
        internal
        view
        returns (Valuation memory v)
    {
        (uint256 w, uint256 sw, uint256 aw) = _record(k, tick, s.epoch);
        v.closed = (w & CLOSED_BIT) != 0;
        uint256 endS = sw & M128;
        uint256 lastScale = (w >> 192) & M32;
        if (endS != 0) {
            uint256 d = lastScale - s.scale;
            v.remainder = d <= MAX_WALK
                ? Math.mulDiv(qty, endS, s.survival * (10 ** (9 * d)), Math.Rounding.Ceil)
                : (qty == 0 ? 0 : 1);
        }
        Math.Rounding rnd = isBid ? Math.Rounding.Ceil : Math.Rounding.Floor;
        uint256 x;
        for (uint256 j = 0;; ++j) {
            uint256 sc = s.scale + j;
            uint256 aEnd = sc == lastScale ? aw : Pages.load(_finalSlot(k, tick, s.epoch, sc));
            uint256 dA = j == 0 ? aEnd - s.acc : aEnd;
            if (dA != 0) x += Math.mulDiv(qty, dA, s.survival * (10 ** (9 * j)), rnd);
            if (sc == lastScale) break;
            if (j == MAX_WALK) {
                if (isBid) v.quote = 1;
                break;
            }
        }
        v.quote += Math.mulDiv(x, 1, baseUnit, rnd);
    }
}

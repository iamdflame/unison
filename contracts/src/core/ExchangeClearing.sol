// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {Pages} from "../libraries/Pages.sol";
import {Clearing} from "./Clearing.sol";
import {BookStore} from "./BookStore.sol";
import {OrderMath} from "./OrderMath.sol";
import {ExchangeLayout as L} from "./ExchangeLayout.sol";
import {ExchangeBase} from "./ExchangeBase.sol";
import {IReferenceAdapter} from "../interfaces/IReferenceAdapter.sol";
import {ICurveSource} from "../interfaces/ICurveSource.sol";

/// @title ExchangeClearing — the resumable batch-auction job (SPEC §5)
/// @notice A clear job has four phases, each of which can pause on low gas and resume in the next call:
///           MERGE      pending batches <= upTo join the books (GTC → main books, IOC → IOC books)
///           (auction)  reference published after the newest merged batch closed → band → Clearing.compute
///           APPLY      fills are applied level by level: classes better than the marginal one in full,
///                      the marginal class by exact cumulative apportionment (sums to the auction volume)
///           CLOSE_IOC  every IOC level is closed; its unfilled remainder leaves the book
///         No call ever does unbounded work, so no amount of resting orders can make clearing impossible.
///         While a job runs, cancels that would change a level it may touch are refused (ClearInProgress).
abstract contract ExchangeClearing is ExchangeBase {
    /// @return tick clearing tick (0 if no trade)
    /// @return volume executed base volume
    /// @return done whether the job completed in this call
    /// @param upTo newest batch the job covers (0 = block.number - 1). Ignored while a job is running.
    function _clear(uint256 marketId, uint256 upTo, bytes calldata payload)
        internal
        returns (uint256 tick, uint256 volume, bool done)
    {
        Market storage m = _market(marketId);
        Job memory j = _s().jobs[marketId];
        if (j.phase == PHASE_IDLE) _openJob(marketId, m, j, upTo == 0 ? block.number - 1 : upTo, payload);
        if (j.phase == PHASE_MERGE) {
            if (!_mergeStep(marketId, m, j)) return _pauseJob(marketId, j);
            _startAuction(marketId, m, j);
        }
        if (j.phase == PHASE_APPLY) {
            if (!_applyStep(marketId, m, j)) return _pauseJob(marketId, j);
            j.phase = PHASE_CLOSE_IOC;
            j.side = 0;
            j.keyIdx = 0;
            j.cursor = 0;
        }
        if (j.phase == PHASE_CLOSE_IOC) {
            if (!_closeIocStep(marketId, m, j)) return _pauseJob(marketId, j);
        }
        (tick, volume) = _finalize(marketId, m, j);
        done = true;
    }

    function _pauseJob(uint256 marketId, Job memory j) private returns (uint256, uint256, bool) {
        _s().jobs[marketId] = j;
        emit ClearProgress(marketId, j.upTo, j.phase, j.work);
        return (0, 0, false);
    }

    /// @dev Opens a job: binds the reference (published after the newest covered batch closed, SPEC §7),
    ///      applies the halt override and the DISCOVERY call-auction cadence.
    function _openJob(uint256 marketId, Market storage m, Job memory j, uint256 upTo, bytes calldata payload)
        private
    {
        if (!m.active) revert MarketInactive();
        if (upTo >= block.number) revert InvalidParams(); // the batch of the current block is still open
        if (upTo <= m.lastCleared) revert NothingToClear();
        (uint256 px, uint256 pubMs, IReferenceAdapter.Status st) =
            IReferenceAdapter(m.refAdapter).read(marketId, upTo, payload);
        if (px == 0) revert StaleReference();
        uint256 newestTs = _newestPendingTs(marketId, m, upTo);
        if (newestTs != 0 && pubMs < (newestTs + (m.strictAfterClose ? 1 : 0)) * 1000) revert StaleReference();
        Regime storage g = _s().regimes[marketId];
        if (g.halted) st = IReferenceAdapter.Status.HALTED;
        if (
            st == IReferenceAdapter.Status.CLOSED && g.discCadence > 1 && g.lastDiscoveryBatch != 0
                && upTo < uint256(g.lastDiscoveryBatch) + g.discCadence
        ) revert TooEarly();
        j.phase = PHASE_MERGE;
        j.upTo = uint64(upTo);
        j.refPrice = px;
        j.refTimeMs = uint64(pubMs);
        j.status = uint8(st);
    }

    /// @dev Registration timestamp of the newest pending batch <= upTo (0 if none).
    function _newestPendingTs(uint256 marketId, Market storage m, uint256 upTo) private view returns (uint256) {
        uint256 tail = m.pendingTail;
        uint256 head = m.pendingHead;
        while (tail > head) {
            uint256 b = Pages.load(_plistSlot(marketId, tail - 1));
            if (b <= upTo) return Pages.load(L.groupPage(marketId, b, 0)) >> 96;
            --tail;
        }
        return 0;
    }

    /// @dev Band centred on the reference tick: [ref - hw, ref + hw] ∩ [minTick, maxTick] (SPEC §5.1, §6).
    function _band(uint256 marketId, Market storage m, uint256 px, IReferenceAdapter.Status st)
        internal
        view
        returns (uint256 refTick, uint256 lo, uint256 hi, uint256 bps)
    {
        refTick = (px + m.tickSize / 2) / m.tickSize;
        if (refTick < m.minTick) refTick = m.minTick;
        if (refTick > m.maxTick) refTick = m.maxTick;
        bps = _regimeBandBps(marketId, m, st);
        uint256 hw = (refTick * bps) / BPS;
        if (hw == 0) hw = 1;
        uint256 maxHw = (uint256(m.maxBandTicks) - 1) / 2;
        if (hw > maxHw) hw = maxHw;
        lo = refTick > m.minTick + hw ? refTick - hw : m.minTick;
        hi = refTick + hw < m.maxTick ? refTick + hw : m.maxTick;
    }

    /// @dev Band half-width in bps for the job's regime (SPEC §6).
    function _regimeBandBps(uint256 marketId, Market storage m, IReferenceAdapter.Status st)
        private
        view
        returns (uint256 bps)
    {
        Regime storage g = _s().regimes[marketId];
        if (st == IReferenceAdapter.Status.CLOSED) {
            // DISCOVERY: the band around the last close widens with √(time closed)
            uint256 since = g.closedSince == 0 ? block.timestamp : g.closedSince;
            uint256 e = block.timestamp > since ? block.timestamp - since : 0;
            uint256 h = g.discHorizonSec;
            if (h == 0) {
                bps = g.discCapBps;
            } else {
                if (e > h) e = h;
                bps = (uint256(g.discCapBps) * Math.sqrt((e * 1e18) / h)) / 1e9;
            }
            if (bps < g.discFloorBps) bps = g.discFloorBps;
        } else {
            uint8 last = m.lastStatus;
            bool reopening =
                last == uint8(IReferenceAdapter.Status.CLOSED) || last == uint8(IReferenceAdapter.Status.HALTED);
            if (reopening) bps = g.reopenBandBps;
            else bps = st == IReferenceAdapter.Status.EXTENDED ? g.extBandBps : m.bandBps;
        }
        if (bps == 0) bps = m.bandBps;
    }

    // ------------------------------------------------------------------ MERGE

    function _mergeStep(uint256 marketId, Market storage m, Job memory j) private returns (bool) {
        while (m.pendingHead < m.pendingTail) {
            uint256 head = m.pendingHead;
            uint256 b = Pages.load(_plistSlot(marketId, head));
            if (b > j.upTo) break;
            uint256 h0 = Pages.load(L.groupPage(marketId, b, 0));
            uint256 count = (h0 >> 64) & type(uint32).max;
            for (uint256 g = j.groupCursor; g < count; ++g) {
                if (gasleft() < GAS_RESERVE) {
                    j.groupCursor = uint32(g);
                    return false;
                }
                uint256 grp = Pages.load(L.groupPage(marketId, b, g / 127) + 1 + (g % 127));
                (uint256 side, uint256 shard, uint256 ioc, uint256 tick) = L.unpackGroup(grp);
                uint256 w = Pages.load(L.pendingSlot(marketId, b, side, shard, ioc, tick));
                uint256 qty = (w & type(uint64).max) == b ? (w >> 64) : 0;
                if (qty == 0) continue; // every order of the group was cancelled before merge
                uint256 bs = L.bookShard(shard, ioc);
                BookStore.Snap memory sn = BookStore.add(BookStore.Key(marketId, side, bs), tick, qty);
                L.storeSnap(L.mergeSlot(marketId, b, side, bs, tick), sn.epoch, sn.scale, sn.survival, sn.acc);
                j.work += 1;
            }
            j.groupCursor = 0;
            uint256 ts = h0 >> 96;
            if (ts > j.newestTs) j.newestTs = uint64(ts);
            m.pendingHead = uint64(head + 1);
        }
        return true;
    }

    // ------------------------------------------------------------------ auction

    /// @dev Capped, band-clipped curve of one source for this auction.
    struct CurveSlot {
        address src;
        uint256 bidLo;
        uint256 bidHi;
        uint256 bidQ;
        uint256 askLo;
        uint256 askHi;
        uint256 askQ;
    }

    function _startAuction(uint256 marketId, Market storage m, Job memory j) private {
        j.phase = PHASE_CLOSE_IOC;
        IReferenceAdapter.Status st = IReferenceAdapter.Status(j.status);
        if (st == IReferenceAdapter.Status.HALTED) return; // no auction while the primary market is halted
        (uint256 refTick, uint256 lo, uint256 hi,) = _band(marketId, m, j.refPrice, st);
        j.lo = uint32(lo);
        j.hi = uint32(hi);

        Clearing.Input memory x = _buildInput(marketId, m, lo, hi, refTick);
        CurveSlot[] memory cs = _loadCurves(marketId, m, j, refTick, x);
        Clearing.Result memory r = Clearing.compute(x);
        if (!r.traded) return;

        uint256 n = hi - lo + 1;
        j.traded = true;
        j.tick = uint32(r.tick);
        j.price = r.tick * m.tickSize;
        j.volume = r.volume;
        j.bidMarginal = uint32(r.bidMarginal);
        j.askMarginal = uint32(r.askMarginal);
        j.bidNeed = r.bidMarginalFill;
        j.askNeed = r.askMarginalFill;
        j.bidOutside = x.bidAbove != 0;
        j.askOutside = x.askBelow != 0;
        j.bidClassQ = r.bidMarginal == 0 ? x.bidAbove : x.bids[n - r.bidMarginal];
        j.askClassQ = r.askMarginal == 0 ? x.askBelow : x.asks[r.askMarginal - 1];
        j.phase = PHASE_APPLY;
        j.side = 0;
        j.stage = STAGE_OUTSIDE;
        j.keyIdx = 0;
        j.cursor = 0;
        j.before = 0;
        if (cs.length != 0) _settleCurves(marketId, m, j, cs);
    }

    /// @dev Reads every curve source (gas-capped), clips it to the band, caps it by the source's ledger
    ///      inventory (bids: worst-case cost at the top bid tick) and merges it into the clearing input.
    function _loadCurves(uint256 marketId, Market storage m, Job memory j, uint256 refTick, Clearing.Input memory x)
        private
        view
        returns (CurveSlot[] memory cs)
    {
        address[] storage srcs = _s().sources[marketId];
        cs = new CurveSlot[](srcs.length);
        uint256 lo = x.lo;
        uint256 hi = x.hi;
        for (uint256 i = 0; i < srcs.length; ++i) {
            CurveSlot memory c = cs[i];
            c.src = srcs[i];
            try ICurveSource(c.src).curve{gas: CURVE_GAS}(marketId, j.refPrice, j.status, refTick, lo, hi) returns (
                ICurveSource.Curve memory cv
            ) {
                if (cv.bidTop != 0 && cv.bidTicks != 0 && cv.bidPerTick != 0) {
                    uint256 top = cv.bidTop > hi ? hi : cv.bidTop;
                    uint256 bot = uint256(cv.bidTop) + 1 > cv.bidTicks ? uint256(cv.bidTop) + 1 - cv.bidTicks : 1;
                    if (bot < lo) bot = lo;
                    if (bot <= top) {
                        uint256 ticks = top - bot + 1;
                        uint256 bal = Pages.load(L.balanceSlot(c.src, m.quoteIdx));
                        // cost <= ceil(ticks * q * price(top) / B) must fit the quote balance
                        uint256 cap = bal == 0 ? 0 : Math.mulDiv(bal - 1, m.baseUnit, top * m.tickSize * ticks);
                        uint256 q = cv.bidPerTick < cap ? cv.bidPerTick : cap;
                        if (q != 0) {
                            (c.bidLo, c.bidHi, c.bidQ) = (bot, top, q);
                            for (uint256 t = bot; t <= top; ++t) x.bids[t - lo] += q;
                        }
                    }
                }
                if (cv.askBottom != 0 && cv.askTicks != 0 && cv.askPerTick != 0) {
                    uint256 bot = cv.askBottom < lo ? lo : cv.askBottom;
                    uint256 top = uint256(cv.askBottom) + cv.askTicks - 1;
                    if (top > hi) top = hi;
                    if (bot <= top) {
                        uint256 ticks = top - bot + 1;
                        uint256 cap = Pages.load(L.balanceSlot(c.src, m.baseIdx)) / ticks;
                        uint256 q = cv.askPerTick < cap ? cv.askPerTick : cap;
                        if (q != 0) {
                            (c.askLo, c.askHi, c.askQ) = (bot, top, q);
                            for (uint256 t = bot; t <= top; ++t) x.asks[t - lo] += q;
                        }
                    }
                }
            } catch {}
        }
    }

    /// @dev Settles every curve source atomically at the auction price. Ticks strictly better than the marginal
    ///      tick fill in full; at the marginal tick the sources are apportioned first (cumulative, exact), and the
    ///      books continue the same apportionment from `bidBefore0` / `askBefore0` during APPLY.
    function _settleCurves(uint256 marketId, Market storage m, Job memory j, CurveSlot[] memory cs) private {
        uint256 tmB = j.bidMarginal == 0 ? 0 : Clearing.bidLevelTick(j.hi, j.bidMarginal);
        uint256 tmA = j.askMarginal == 0 ? 0 : Clearing.askLevelTick(j.lo, j.askMarginal);
        for (uint256 i = 0; i < cs.length; ++i) {
            CurveSlot memory c = cs[i];
            uint256 fb;
            uint256 fa;
            if (c.bidQ != 0 && tmB != 0) {
                uint256 from = c.bidLo > tmB ? c.bidLo : tmB + 1;
                if (from <= c.bidHi) fb = (c.bidHi - from + 1) * c.bidQ;
                if (tmB >= c.bidLo && tmB <= c.bidHi) {
                    fb += OrderMath.apportion(j.bidNeed, j.bidBefore0, c.bidQ, j.bidClassQ);
                    j.bidBefore0 += c.bidQ;
                }
            }
            if (c.askQ != 0 && tmA != 0) {
                uint256 to = c.askHi < tmA ? c.askHi : tmA - 1;
                if (c.askLo <= to) fa = (to - c.askLo + 1) * c.askQ;
                if (tmA >= c.askLo && tmA <= c.askHi) {
                    fa += OrderMath.apportion(j.askNeed, j.askBefore0, c.askQ, j.askClassQ);
                    j.askBefore0 += c.askQ;
                }
            }
            if (fb == 0 && fa == 0) continue;
            uint256 pay = fb == 0 ? 0 : Math.mulDiv(fb, j.price, m.baseUnit, Math.Rounding.Ceil);
            uint256 get = fa == 0 ? 0 : Math.mulDiv(fa, j.price, m.baseUnit);
            if (fb != 0) {
                _debit(c.src, m.quoteIdx, pay);
                _credit(c.src, m.baseIdx, fb);
            }
            if (fa != 0) {
                _debit(c.src, m.baseIdx, fa);
                _credit(c.src, m.quoteIdx, get);
            }
            j.filledBid += fb;
            j.filledAsk += fa;
            j.work += 1;
            emit CurveFilled(marketId, c.src, j.upTo, fb, pay, fa, get);
            try ICurveSource(c.src).onAuction{gas: CURVE_GAS}(marketId, j.upTo, j.price, j.refPrice, fb, pay, fa, get) {}
                catch {}
        }
    }

    function _buildInput(uint256 marketId, Market storage m, uint256 lo, uint256 hi, uint256 refTick)
        private
        view
        returns (Clearing.Input memory x)
    {
        uint256 n = hi - lo + 1;
        x.lo = lo;
        x.hi = hi;
        x.refTick = refTick;
        x.bids = new uint256[](n);
        x.asks = new uint256[](n);
        uint256 shards = m.shards;
        for (uint256 i = 0; i < 2 * shards; ++i) {
            BookStore.Key memory kb = _bookKey(marketId, SIDE_BID, i, shards);
            if (BookStore.total(kb) != 0) {
                x.bidAbove += BookStore.sumAbove(kb, hi);
                _accumulateBand(kb, lo, hi, x.bids);
            }
            BookStore.Key memory ka = _bookKey(marketId, SIDE_ASK, i, shards);
            if (BookStore.total(ka) != 0) {
                x.askBelow += BookStore.sumBelow(ka, lo);
                _accumulateBand(ka, lo, hi, x.asks);
            }
        }
    }

    /// @dev Adds a book's per-tick quantities in [lo, hi] to `arr`, skipping empty buckets.
    function _accumulateBand(BookStore.Key memory k, uint256 lo, uint256 hi, uint256[] memory arr) private view {
        uint256 t = lo;
        while (t <= hi) {
            uint256 bucket = t >> 7;
            uint256 bucketEnd = (bucket << 7) | 127;
            uint256 end = bucketEnd < hi ? bucketEnd : hi;
            if (BookStore.bucketTotal(k, bucket) != 0) {
                for (uint256 u = t; u <= end; ++u) {
                    uint256 q = BookStore.remainingAt(k, u);
                    if (q != 0) arr[u - lo] += q;
                }
            }
            t = end + 1;
        }
    }

    // ------------------------------------------------------------------ APPLY

    function _applyStep(uint256 marketId, Market storage m, Job memory j) private returns (bool) {
        uint256 shards = m.shards;
        uint256 baseUnit = m.baseUnit;
        while (j.side < 2) {
            if (j.stage == STAGE_DONE) {
                j.side += 1;
                j.stage = STAGE_OUTSIDE;
                j.keyIdx = 0;
                j.cursor = 0;
                j.before = 0;
                continue;
            }
            bool isBid = j.side == SIDE_BID;
            (uint256 from, uint256 to, bool split) = _stageRange(j, isBid);
            if (from <= to) {
                uint256 need = isBid ? j.bidNeed : j.askNeed;
                uint256 classQ = isBid ? j.bidClassQ : j.askClassQ;
                while (j.keyIdx < 2 * shards) {
                    BookStore.Key memory k = _bookKey(marketId, j.side, j.keyIdx, shards);
                    if (BookStore.total(k) != 0) {
                        uint256 t = j.cursor == 0 ? from : j.cursor;
                        while (t <= to) {
                            t = BookStore.nextNonEmpty(k, t, to);
                            if (t == NONE) break;
                            if (gasleft() < GAS_RESERVE) {
                                j.cursor = uint32(t);
                                return false;
                            }
                            uint256 q = BookStore.remainingAt(k, t);
                            uint256 f = q;
                            if (split) {
                                f = OrderMath.apportion(need, j.before, q, classQ);
                                j.before += q;
                            }
                            BookStore.fill(k, t, f, j.price, baseUnit, isBid);
                            if (isBid) j.filledBid += f;
                            else j.filledAsk += f;
                            j.work += 1;
                            ++t;
                        }
                    }
                    j.keyIdx += 1;
                    j.cursor = 0;
                }
            }
            j.stage += 1;
            j.keyIdx = 0;
            j.cursor = 0;
            j.before = j.stage == STAGE_MARGINAL ? (isBid ? j.bidBefore0 : j.askBefore0) : 0;
        }
        // Self-check: both sides executed exactly the auction volume.
        if (j.filledBid != j.volume || j.filledAsk != j.volume) revert ClearingMismatch();
        return true;
    }

    /// @dev Tick range of the current stage. OUTSIDE = beyond the band edge (bids above hi, asks below lo),
    ///      INBAND = in-band levels strictly better than the marginal tick, MARGINAL = the marginal tick.
    ///      `split` = the range is the marginal class and is apportioned rather than filled in full.
    function _stageRange(Job memory j, bool isBid) private pure returns (uint256 from, uint256 to, bool split) {
        uint256 marg = isBid ? j.bidMarginal : j.askMarginal;
        uint256 lo = j.lo;
        uint256 hi = j.hi;
        if (j.stage == STAGE_OUTSIDE) {
            if (!(isBid ? j.bidOutside : j.askOutside)) return (1, 0, false); // nothing beyond the band
            split = marg == 0;
            if (isBid) return (hi + 1, BookStore.MAX_TICK, split);
            return (1, lo - 1, split); // lo >= minTick >= 1
        }
        if (marg == 0) return (1, 0, false); // nothing in-band trades
        uint256 tm = isBid ? Clearing.bidLevelTick(hi, marg) : Clearing.askLevelTick(lo, marg);
        if (j.stage == STAGE_INBAND) {
            if (marg < 2) return (1, 0, false);
            return isBid ? (tm + 1, hi, false) : (lo, tm - 1, false);
        }
        return (tm, tm, true); // STAGE_MARGINAL
    }

    // ------------------------------------------------------------------ CLOSE_IOC

    function _closeIocStep(uint256 marketId, Market storage m, Job memory j) private returns (bool) {
        uint256 shards = m.shards;
        while (j.side < 2) {
            while (j.keyIdx < shards) {
                BookStore.Key memory k = BookStore.Key(marketId, j.side, IOC_SHARD_OFFSET + j.keyIdx);
                if (BookStore.total(k) != 0) {
                    uint256 t = j.cursor == 0 ? 1 : j.cursor;
                    while (t <= BookStore.MAX_TICK) {
                        t = BookStore.nextNonEmpty(k, t, BookStore.MAX_TICK);
                        if (t == NONE) break;
                        if (gasleft() < GAS_RESERVE) {
                            j.cursor = uint32(t);
                            return false;
                        }
                        BookStore.forceClose(k, t, j.side == SIDE_BID);
                        j.work += 1;
                        ++t;
                    }
                }
                j.keyIdx += 1;
                j.cursor = 0;
            }
            j.side += 1;
            j.keyIdx = 0;
            j.cursor = 0;
        }
        return true;
    }

    // ------------------------------------------------------------------ finalize

    function _finalize(uint256 marketId, Market storage m, Job memory j)
        private
        returns (uint256 tick, uint256 volume)
    {
        tick = j.tick;
        volume = j.volume;
        Regime storage g = _s().regimes[marketId];
        if (j.status == uint8(IReferenceAdapter.Status.CLOSED)) {
            if (g.closedSince == 0) g.closedSince = uint64(j.refTimeMs / 1000);
            g.lastDiscoveryBatch = j.upTo;
        } else if (j.status != uint8(IReferenceAdapter.Status.HALTED)) {
            g.closedSince = 0;
        }
        m.lastCleared = j.upTo;
        m.lastRefPrice = j.refPrice;
        m.lastRefTimeMs = j.refTimeMs;
        m.lastStatus = j.status;
        if (volume > 0) {
            m.auctions += 1;
            m.lastPrintTick = uint64(tick);
        }
        bytes32 r = keccak256(
            abi.encode(m.receiptHash, marketId, j.upTo, tick, volume, j.refPrice, j.refTimeMs, j.status, block.timestamp)
        );
        m.receiptHash = r;
        emit BatchCleared(marketId, j.upTo, tick, j.price, volume, j.refPrice, j.refTimeMs, j.status, j.lo, j.hi, r);
        delete _s().jobs[marketId];
        if (j.work > 0) _payKeeper(marketId, m);
    }

    function _payKeeper(uint256 marketId, Market storage m) private {
        uint256 reward = _s().keeperReward;
        if (reward == 0) return;
        uint256 slot = L.balanceSlot(address(this), m.quoteIdx);
        uint256 bal = Pages.load(slot);
        if (bal < reward) return;
        Pages.store(slot, bal - reward);
        _credit(msg.sender, m.quoteIdx, reward);
        emit KeeperPaid(marketId, msg.sender, reward);
    }
}

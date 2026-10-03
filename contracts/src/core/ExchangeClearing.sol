// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Pages} from "../libraries/Pages.sol";
import {Clearing} from "./Clearing.sol";
import {BookStore} from "./BookStore.sol";
import {OrderMath} from "./OrderMath.sol";
import {ExchangeLayout as L} from "./ExchangeLayout.sol";
import {ExchangeBase} from "./ExchangeBase.sol";
import {IReferenceAdapter} from "../interfaces/IReferenceAdapter.sol";

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
    function _clear(uint256 marketId, bytes calldata payload)
        internal
        returns (uint256 tick, uint256 volume, bool done)
    {
        Market storage m = _market(marketId);
        Job memory j = _s().jobs[marketId];
        if (j.phase == PHASE_IDLE) {
            if (!m.active) revert MarketInactive();
            uint256 upTo = block.number - 1;
            if (upTo <= m.lastCleared) revert NothingToClear();
            j.phase = PHASE_MERGE;
            j.upTo = uint64(upTo);
        }
        if (j.phase == PHASE_MERGE) {
            if (!_mergeStep(marketId, m, j)) return _pauseJob(marketId, j);
            _startAuction(marketId, m, j, payload);
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

    function _startAuction(uint256 marketId, Market storage m, Job memory j, bytes calldata payload) private {
        // Reference must be published after the newest merged batch closed (SPEC §7).
        (uint256 px, uint256 pubMs, IReferenceAdapter.Status st) =
            IReferenceAdapter(m.refAdapter).read(marketId, payload);
        if (px == 0) revert StaleReference();
        if (j.newestTs != 0 && pubMs < (uint256(j.newestTs) + (m.strictAfterClose ? 1 : 0)) * 1000) {
            revert StaleReference();
        }
        j.refPrice = px;
        j.refTimeMs = uint64(pubMs);
        j.status = uint8(st);
        j.phase = PHASE_CLOSE_IOC;
        if (st == IReferenceAdapter.Status.HALTED) return; // no auction while the primary market is halted

        // Band centred on the reference tick: [ref - hw, ref + hw] ∩ [minTick, maxTick] (SPEC §5.1).
        uint256 refTick = (px + m.tickSize / 2) / m.tickSize;
        if (refTick < m.minTick) refTick = m.minTick;
        if (refTick > m.maxTick) refTick = m.maxTick;
        uint256 hw = (refTick * m.bandBps) / BPS;
        if (hw == 0) hw = 1;
        uint256 maxHw = (uint256(m.maxBandTicks) - 1) / 2;
        if (hw > maxHw) hw = maxHw;
        uint256 lo = refTick > m.minTick + hw ? refTick - hw : m.minTick;
        uint256 hi = refTick + hw < m.maxTick ? refTick + hw : m.maxTick;
        j.lo = uint32(lo);
        j.hi = uint32(hi);

        Clearing.Input memory x = _buildInput(marketId, m, lo, hi, refTick);
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
        j.bidClassQ = r.bidMarginal == 0 ? x.bidAbove : x.bids[n - r.bidMarginal];
        j.askClassQ = r.askMarginal == 0 ? x.askBelow : x.asks[r.askMarginal - 1];
        j.phase = PHASE_APPLY;
        j.side = 0;
        j.stage = STAGE_OUTSIDE;
        j.keyIdx = 0;
        j.cursor = 0;
        j.before = 0;
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
            j.before = 0;
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

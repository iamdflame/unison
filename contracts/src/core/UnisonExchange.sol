// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {Pages} from "../libraries/Pages.sol";
import {BookStore} from "./BookStore.sol";
import {OrderMath} from "./OrderMath.sol";
import {ExchangeLayout as L} from "./ExchangeLayout.sol";
import {ExchangeClearing} from "./ExchangeClearing.sol";
import {IReferenceAdapter} from "../interfaces/IReferenceAdapter.sol";

/// @title UnisonExchange — per-block frequent batch auctions for tokenized assets on Monad
/// @notice Orders placed in block b enter a pending ring for batch b. A permissionless, resumable `clear()`
///         merges every pending batch up to block.number-1 into the books, reads a reference price published
///         after those batches closed, runs one uniform-price auction inside a reference-centred band and
///         applies its fills. Orders settle lazily at `claim()`/`cancelOrder()`; receipts are drawn from
///         exact per-level pots, so the venue can never owe more than it holds. See docs/SPEC.md.
contract UnisonExchange is
    Initializable,
    UUPSUpgradeable,
    AccessControlUpgradeable,
    PausableUpgradeable,
    ReentrancyGuardTransient,
    ExchangeClearing
{
    using SafeERC20 for IERC20;

    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    bytes32 public constant GUARDIAN_ROLE = keccak256("GUARDIAN_ROLE");
    /// @notice May force a market into HALTED (guardian, CRE audit receiver, halt-mirroring workflow).
    bytes32 public constant HALT_ROLE = keccak256("HALT_ROLE");

    // ------------------------------------------------------------------ init / admin

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address admin) external initializer {
        __AccessControl_init();
        __Pausable_init();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(OPERATOR_ROLE, admin);
        _grantRole(GUARDIAN_ROLE, admin);
        _grantRole(HALT_ROLE, admin);
    }

    function _authorizeUpgrade(address) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}

    function pause() external onlyRole(GUARDIAN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(GUARDIAN_ROLE) {
        _unpause();
    }

    function listToken(address token, bool restricted_) external onlyRole(OPERATOR_ROLE) returns (uint256 idx) {
        MainStorage storage $ = _s();
        if ($.tokenIdxPlusOne[token] != 0) {
            idx = $.tokenIdxPlusOne[token] - 1;
        } else {
            if ($.tokens.length >= L.MAX_TOKENS) revert TooManyTokens();
            $.tokens.push(token);
            idx = $.tokens.length - 1;
            $.tokenIdxPlusOne[token] = idx + 1;
        }
        $.restricted[token] = restricted_;
        emit TokenListed(token, idx, restricted_);
    }

    struct MarketParams {
        address base;
        address quote;
        address refAdapter;
        uint64 tickSize; // quote units per whole base token per tick
        uint32 minTick;
        uint32 maxTick;
        uint32 maxBandTicks;
        uint16 bandBps;
        uint16 feeBps;
        uint16 maxFeeBps;
        uint8 shards;
        bool permissioned;
        bool strictAfterClose;
    }

    function createMarket(MarketParams calldata p) external onlyRole(OPERATOR_ROLE) returns (uint256 marketId) {
        MainStorage storage $ = _s();
        uint256 bi = $.tokenIdxPlusOne[p.base];
        uint256 qi = $.tokenIdxPlusOne[p.quote];
        if (bi == 0 || qi == 0) revert UnknownToken();
        uint256 baseDecimals = IERC20Metadata(p.base).decimals();
        if (
            p.tickSize == 0 || p.minTick == 0 || p.maxTick > BookStore.MAX_TICK || p.minTick >= p.maxTick
                || p.shards == 0 || p.shards > MAX_SHARDS || p.maxFeeBps > MAX_FEE_BPS || p.feeBps > p.maxFeeBps
                || p.bandBps == 0 || p.maxBandTicks == 0 || p.refAdapter == address(0) || baseDecimals < 6
                || baseDecimals > 18 || $.markets.length >= type(uint24).max
        ) revert InvalidParams();

        Market storage m = $.markets.push();
        m.base = p.base;
        m.quote = p.quote;
        m.refAdapter = p.refAdapter;
        m.baseIdx = uint8(bi - 1);
        m.quoteIdx = uint8(qi - 1);
        m.shards = p.shards;
        m.active = true;
        m.permissioned = p.permissioned;
        m.strictAfterClose = p.strictAfterClose;
        m.bandBps = p.bandBps;
        m.feeBps = p.feeBps;
        m.maxFeeBps = p.maxFeeBps;
        m.minTick = p.minTick;
        m.maxTick = p.maxTick;
        m.maxBandTicks = p.maxBandTicks;
        m.baseUnit = uint64(10 ** baseDecimals);
        m.tickSize = p.tickSize;
        // Batches start at the creation block: orders placed in this very block must be clearable.
        m.lastCleared = uint64(block.number - 1);
        marketId = $.markets.length - 1;
        // Conservative regime defaults; operators calibrate per asset (research/: weekend gap quantiles).
        Regime storage g = $.regimes[marketId];
        g.extBandBps = _capBps(uint256(p.bandBps) * 2);
        g.reopenBandBps = _capBps(uint256(p.bandBps) * 5);
        g.discFloorBps = p.bandBps;
        g.discCapBps = _capBps(uint256(p.bandBps) * 5);
        g.discHorizonSec = 235_800; // Fri 16:00 → Mon 09:30 ET
        g.discCadence = 10; // ~3 s call auctions while the reference market is closed
        emit MarketCreated(marketId, p.base, p.quote, p.tickSize, p.refAdapter);
        emit RegimeSet(marketId, g);
    }

    function _capBps(uint256 bps) private pure returns (uint16) {
        return uint16(bps > 5_000 ? 5_000 : bps);
    }

    /// @notice Sets the regime parameters of a market (state fields are preserved).
    function setRegime(
        uint256 marketId,
        uint16 extBandBps,
        uint16 reopenBandBps,
        uint16 discFloorBps,
        uint16 discCapBps,
        uint32 discHorizonSec,
        uint32 discCadence
    ) external onlyRole(OPERATOR_ROLE) {
        _market(marketId);
        if (
            extBandBps == 0 || reopenBandBps == 0 || discFloorBps == 0 || discCapBps < discFloorBps
                || discCapBps > 5_000 || reopenBandBps > 5_000 || extBandBps > 5_000 || discCadence == 0
        ) revert InvalidParams();
        Regime storage g = _s().regimes[marketId];
        g.extBandBps = extBandBps;
        g.reopenBandBps = reopenBandBps;
        g.discFloorBps = discFloorBps;
        g.discCapBps = discCapBps;
        g.discHorizonSec = discHorizonSec;
        g.discCadence = discCadence;
        emit RegimeSet(marketId, g);
    }

    /// @notice Forces (or lifts) a trading halt on a market — e.g. mirroring a primary-market halt, or an
    ///         automatic halt raised by the CRE reference audit. Orders keep accumulating while halted; the
    ///         first auction after the halt is a reopening auction.
    function setHalt(uint256 marketId, bool halted) external onlyRole(HALT_ROLE) {
        _market(marketId);
        _s().regimes[marketId].halted = halted;
        emit HaltSet(marketId, halted, msg.sender);
    }

    function setMarketParams(uint256 marketId, uint16 bandBps, uint16 feeBps, uint32 maxBandTicks, bool active)
        external
        onlyRole(OPERATOR_ROLE)
    {
        Market storage m = _market(marketId);
        if (bandBps == 0 || maxBandTicks == 0 || feeBps > m.maxFeeBps) revert InvalidParams();
        m.bandBps = bandBps;
        m.feeBps = feeBps;
        m.maxBandTicks = maxBandTicks;
        m.active = active;
        emit MarketParamsSet(marketId, bandBps, feeBps, maxBandTicks, active);
    }

    function setRefAdapter(uint256 marketId, address adapter) external onlyRole(OPERATOR_ROLE) {
        if (adapter == address(0)) revert InvalidParams();
        _market(marketId).refAdapter = adapter;
    }

    function setKeeperReward(uint256 amount) external onlyRole(OPERATOR_ROLE) {
        _s().keeperReward = amount;
    }

    function setEligibility(address registry) external onlyRole(OPERATOR_ROLE) {
        _s().eligibility = registry;
    }

    /// @notice Funds the protocol balance (keeper rewards). Anyone may fund it.
    function fundProtocol(address token, uint256 amount) external nonReentrant {
        uint256 idx = _tokenIdx(token);
        uint256 before = IERC20(token).balanceOf(address(this));
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        _credit(address(this), idx, IERC20(token).balanceOf(address(this)) - before);
    }

    /// @notice Protocol revenue (fees) sits in the ledger account of this contract.
    function withdrawProtocol(address token, uint256 amount, address to) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _debit(address(this), _tokenIdx(token), amount);
        IERC20(token).safeTransfer(to, amount);
        emit Withdrawn(address(this), token, amount, to);
    }

    // ------------------------------------------------------------------ ledger

    function deposit(address token, uint256 amount) external nonReentrant {
        _deposit(msg.sender, token, amount);
    }

    /// @notice Deposit on behalf of `account` (used by intents/any-chain deposit flows).
    function depositFor(address account, address token, uint256 amount) external nonReentrant {
        _deposit(account, token, amount);
    }

    function withdraw(address token, uint256 amount, address to) external nonReentrant {
        uint256 idx = _tokenIdx(token);
        if (_s().restricted[token]) _requireEligible(msg.sender);
        _debit(msg.sender, idx, amount);
        IERC20(token).safeTransfer(to, amount);
        emit Withdrawn(msg.sender, token, amount, to);
    }

    function _deposit(address account, address token, uint256 amount) private {
        uint256 idx = _tokenIdx(token);
        if (_s().restricted[token]) _requireEligible(account);
        uint256 before = IERC20(token).balanceOf(address(this));
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = IERC20(token).balanceOf(address(this)) - before; // fee-on-transfer safe
        _credit(account, idx, received);
        emit Deposited(account, token, received, msg.sender);
    }

    // ------------------------------------------------------------------ orders

    /// @notice Places a limit order into the pending batch of the current block.
    /// @param side   0 = BID (buy base with quote), 1 = ASK (sell base for quote)
    /// @param tick   limit price tick (price = tick * tickSize)
    /// @param qty    base units
    /// @param flags  bit0 = IOC (any remainder is cancelled after its first auction)
    function placeOrder(uint256 marketId, uint256 side, uint256 tick, uint256 qty, uint256 flags)
        external
        whenNotPaused
        nonReentrant
        returns (uint256 slotIdx)
    {
        Market storage m = _market(marketId);
        if (!m.active) revert MarketInactive();
        if (side > 1) revert InvalidParams();
        if (tick < m.minTick || tick > m.maxTick) revert InvalidTick();
        if (qty == 0 || qty > type(uint96).max) revert InvalidQty();
        if (m.permissioned) _requireEligible(msg.sender);

        if (side == SIDE_BID) {
            _debit(msg.sender, m.quoteIdx, OrderMath.buyLock(qty, tick * m.tickSize, m.maxFeeBps, m.baseUnit));
        } else {
            _debit(msg.sender, m.baseIdx, qty);
        }

        uint256 shard = uint256(uint160(msg.sender)) % m.shards;
        uint256 ioc = flags & L.FLAG_IOC;
        uint256 batch = block.number;
        _addPending(marketId, m, batch, side, shard, ioc, tick, qty);

        slotIdx = _allocOrderSlot(msg.sender);
        L.OrderRec memory o;
        o.qty = qty;
        o.tick = tick;
        o.market = marketId;
        o.side = side;
        o.shard = shard;
        o.flags = ioc;
        o.state = L.STATE_OPEN;
        o.batch = batch;
        o.feeBps = m.feeBps;
        o.maxFeeBps = m.maxFeeBps;
        _writeOrder(msg.sender, slotIdx, o);
        emit OrderPlaced(marketId, msg.sender, slotIdx, side, tick, qty, ioc, batch);
    }

    /// @notice Cancels an order. Fills that already happened are settled first.
    function cancelOrder(uint256 slotIdx) external nonReentrant {
        L.OrderRec memory o = _readOrder(msg.sender, slotIdx);
        if (o.state == L.STATE_EMPTY) revert EmptySlot();
        Market storage m = _market(o.market);
        Job storage j = _s().jobs[o.market];

        if (o.batch > m.lastCleared) {
            // Not cleared yet. Batches inside a running job are frozen.
            if (j.phase != PHASE_IDLE && o.batch <= j.upTo) revert ClearInProgress();
            _subPending(o.market, o.batch, o.side, o.shard, o.flags & L.FLAG_IOC, o.tick, o.qty);
            if (o.side == SIDE_BID) {
                _credit(
                    msg.sender, m.quoteIdx, OrderMath.buyLock(o.qty, o.tick * m.tickSize, o.maxFeeBps, m.baseUnit)
                );
            } else {
                _credit(msg.sender, m.baseIdx, o.qty);
            }
            _freeOrderSlot(msg.sender, slotIdx);
            emit OrderCancelled(o.market, msg.sender, slotIdx, o.qty);
            return;
        }
        // Leaving a level the running job may still fill would break the auction's volume.
        if (j.phase == PHASE_APPLY || j.phase == PHASE_CLOSE_IOC) revert ClearInProgress();
        _settle(msg.sender, slotIdx, o, m, true);
    }

    /// @notice Settles fills of `account`'s orders. Permissionless: proceeds always go to `account`.
    function claim(address account, uint256[] calldata slots) external nonReentrant {
        for (uint256 i = 0; i < slots.length; ++i) {
            L.OrderRec memory o = _readOrder(account, slots[i]);
            if (o.state == L.STATE_EMPTY) continue;
            Market storage m = _market(o.market);
            if (o.batch > m.lastCleared) continue;
            _settle(account, slots[i], o, m, false);
        }
    }

    /// @notice Runs (or continues) the clear job of a market. Permissionless; resumable on low gas.
    /// @param payload reference-adapter payload (e.g. an operator-signed price), may be empty
    function clear(uint256 marketId, bytes calldata payload)
        external
        whenNotPaused
        nonReentrant
        returns (uint256 tick, uint256 volume)
    {
        (tick, volume,) = _clear(marketId, payload);
    }

    // ------------------------------------------------------------------ settlement

    /// @dev Settles an order against its level (SPEC §3.4). Bids draw base from the level pot and, when the
    ///      order ends, pay `quote` + fee out of their lock and get the rest back. Asks draw gross quote from
    ///      the pot (fee on the cumulative gross) and, when the order ends, get their unfilled base back.
    function _settle(address account, uint256 slotIdx, L.OrderRec memory o, Market storage m, bool cancel)
        private
        returns (bool done)
    {
        bool isBid = o.side == SIDE_BID;
        uint256 bs = L.bookShard(o.shard, o.flags & L.FLAG_IOC);
        BookStore.Key memory k = BookStore.Key(o.market, o.side, bs);
        BookStore.Snap memory s;
        {
            bool set;
            (set, s.epoch, s.scale, s.survival, s.acc) =
                L.loadSnap(L.mergeSlot(o.market, o.batch, o.side, bs, o.tick));
            if (!set) revert MissingSnapshot();
        }
        BookStore.Valuation memory v = BookStore.value(k, o.tick, s, o.qty, isBid, m.baseUnit);
        done = v.closed || cancel;

        uint256 baseOut;
        uint256 quoteOut;
        uint256 fee;
        if (isBid) {
            uint256 filled = o.qty - v.remainder;
            if (filled > o.credited) {
                baseOut = BookStore.draw(k, o.tick, s.epoch, filled - o.credited, BookStore.POT);
                o.credited += baseOut;
                _credit(account, m.baseIdx, baseOut);
            }
            if (done) {
                if (!v.closed) BookStore.leave(k, o.tick, s.epoch, v.remainder);
                uint256 lock = OrderMath.buyLock(o.qty, o.tick * m.tickSize, o.maxFeeBps, m.baseUnit);
                uint256 pay = v.quote < lock ? v.quote : lock;
                fee = OrderMath.fee(pay, o.feeBps);
                if (fee > lock - pay) fee = lock - pay;
                quoteOut = lock - pay - fee;
                _credit(account, m.quoteIdx, quoteOut);
                _credit(address(this), m.quoteIdx, fee);
            }
        } else {
            if (v.quote > o.credited) {
                uint256 got = BookStore.draw(k, o.tick, s.epoch, v.quote - o.credited, BookStore.POT);
                if (got != 0) {
                    uint256 feeBefore = OrderMath.fee(o.credited, o.feeBps);
                    o.credited += got;
                    fee = OrderMath.fee(o.credited, o.feeBps) - feeBefore;
                    quoteOut = got - fee;
                    _credit(account, m.quoteIdx, quoteOut);
                    _credit(address(this), m.quoteIdx, fee);
                }
            }
            if (done) {
                if (!v.closed) {
                    baseOut = BookStore.leave(k, o.tick, s.epoch, v.remainder);
                } else if (v.remainder != 0) {
                    baseOut = BookStore.draw(k, o.tick, s.epoch, v.remainder, BookStore.RET);
                }
                _credit(account, m.baseIdx, baseOut);
            }
        }
        emit Claimed(o.market, account, slotIdx, o.side, baseOut, quoteOut, fee, done);
        if (done) {
            _freeOrderSlot(account, slotIdx);
            if (cancel) emit OrderCancelled(o.market, account, slotIdx, v.remainder);
        } else {
            _writeOrder(account, slotIdx, o);
        }
    }

    // ------------------------------------------------------------------ pending ring

    function _addPending(
        uint256 marketId,
        Market storage m,
        uint256 batch,
        uint256 side,
        uint256 shard,
        uint256 ioc,
        uint256 tick,
        uint256 qty
    ) private {
        // Register the batch (first order of this block for this market).
        uint256 gp0 = L.groupPage(marketId, batch, 0);
        uint256 head = Pages.load(gp0);
        if ((head & type(uint64).max) != batch) {
            if (uint256(m.pendingTail) - uint256(m.pendingHead) >= L.RING) revert PendingFull();
            Pages.store(_plistSlot(marketId, m.pendingTail), batch);
            m.pendingTail += 1;
            head = batch | (block.timestamp << 96); // count = 0
            Pages.store(gp0, head);
        }
        uint256 count = (head >> 64) & type(uint32).max;

        uint256 ps = L.pendingSlot(marketId, batch, side, shard, ioc, tick);
        uint256 w = Pages.load(ps);
        uint256 cur = (w & type(uint64).max) == batch ? (w >> 64) : 0;
        if ((w & type(uint64).max) != batch) {
            // first pending quantity for this group in this batch: append to the group list
            uint256 pageNo = count / 127;
            if (pageNo >= L.GROUP_PAGES) revert TooManyGroups();
            Pages.store(L.groupPage(marketId, batch, pageNo) + 1 + (count % 127), L.packGroup(side, shard, ioc, tick));
            count += 1;
            head = (head & ~(uint256(type(uint32).max) << 64)) | (count << 64);
            Pages.store(gp0, head);
        }
        Pages.store(ps, batch | ((cur + qty) << 64));
    }

    function _subPending(
        uint256 marketId,
        uint256 batch,
        uint256 side,
        uint256 shard,
        uint256 ioc,
        uint256 tick,
        uint256 qty
    ) private {
        uint256 ps = L.pendingSlot(marketId, batch, side, shard, ioc, tick);
        uint256 w = Pages.load(ps);
        uint256 cur = (w & type(uint64).max) == batch ? (w >> 64) : 0;
        Pages.store(ps, batch | ((cur - qty) << 64));
    }

    // ------------------------------------------------------------------ views

    function tokens() external view returns (address[] memory) {
        return _s().tokens;
    }

    function marketCount() external view returns (uint256) {
        return _s().markets.length;
    }

    function market(uint256 marketId) external view returns (Market memory) {
        return _market(marketId);
    }

    function jobOf(uint256 marketId) external view returns (Job memory) {
        return _s().jobs[marketId];
    }

    function regimeOf(uint256 marketId) external view returns (Regime memory) {
        return _s().regimes[marketId];
    }

    /// @notice The auction band a clear would use right now for `refPrice` under `status` (UI / keepers).
    function previewBand(uint256 marketId, uint256 refPrice, IReferenceAdapter.Status status)
        external
        view
        returns (uint256 refTick, uint256 lo, uint256 hi, uint256 bandBps)
    {
        return _band(marketId, _market(marketId), refPrice, status);
    }

    function balanceOf(address account, address token) external view returns (uint256) {
        return Pages.load(L.balanceSlot(account, _tokenIdx(token)));
    }

    function orderOf(address account, uint256 slotIdx) external view returns (L.OrderRec memory) {
        return _readOrder(account, slotIdx);
    }

    function openOrderBitmap(address account) external view returns (uint256) {
        return Pages.load(L.accountBase(account) + L.BITMAP_SLOT);
    }

    /// @notice Live valuation of an order: what it has filled and exchanged so far (before pot caps).
    function previewOrder(address account, uint256 slotIdx)
        external
        view
        returns (bool merged, uint256 filled, uint256 remainder, uint256 quote, bool closed)
    {
        L.OrderRec memory o = _readOrder(account, slotIdx);
        if (o.state == L.STATE_EMPTY) revert EmptySlot();
        Market storage m = _market(o.market);
        if (o.batch > m.lastCleared) return (false, 0, o.qty, 0, false);
        uint256 bs = L.bookShard(o.shard, o.flags & L.FLAG_IOC);
        BookStore.Snap memory s;
        bool set;
        (set, s.epoch, s.scale, s.survival, s.acc) = L.loadSnap(L.mergeSlot(o.market, o.batch, o.side, bs, o.tick));
        if (!set) revert MissingSnapshot();
        BookStore.Valuation memory v =
            BookStore.value(BookStore.Key(o.market, o.side, bs), o.tick, s, o.qty, o.side == SIDE_BID, m.baseUnit);
        return (true, o.qty - v.remainder, v.remainder, v.quote, v.closed);
    }

    /// @param shard book shard: 0..7 main books, 8..15 IOC books
    function levelOf(uint256 marketId, uint256 side, uint256 shard, uint256 tick)
        external
        view
        returns (BookStore.Level memory)
    {
        return BookStore.readLevel(BookStore.Key(marketId, side, shard), tick);
    }

    /// @notice Total resting quantity of one side across all books (main + IOC).
    function bookTotal(uint256 marketId, uint256 side) external view returns (uint256 sum) {
        uint256 shards = _market(marketId).shards;
        for (uint256 i = 0; i < 2 * shards; ++i) {
            sum += BookStore.total(_bookKey(marketId, side, i, shards));
        }
    }

    function keeperReward() external view returns (uint256) {
        return _s().keeperReward;
    }
}

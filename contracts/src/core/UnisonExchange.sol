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
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {Pages} from "../libraries/Pages.sol";
import {Clearing} from "./Clearing.sol";
import {BookStore} from "./BookStore.sol";
import {OrderMath} from "./OrderMath.sol";
import {ExchangeLayout as L} from "./ExchangeLayout.sol";
import {IReferenceAdapter} from "../interfaces/IReferenceAdapter.sol";
import {IEligibility} from "../interfaces/IEligibility.sol";

/// @title UnisonExchange — per-block frequent batch auctions for tokenized assets on Monad
/// @notice Orders placed in block b enter a pending ring for batch b. A permissionless `clear()`
///         merges all pending batches up to block.number-1 into the persistent books, reads a reference
///         price published after those batches closed, and executes one uniform-price auction inside a
///         reference-centred band. Fills are settled lazily at `claim()` using the book's survival /
///         accumulator accounting. See docs/SPEC.md.
contract UnisonExchange is
    Initializable,
    UUPSUpgradeable,
    AccessControlUpgradeable,
    PausableUpgradeable,
    ReentrancyGuardTransient
{
    using SafeERC20 for IERC20;

    // ------------------------------------------------------------------ roles & constants

    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    bytes32 public constant GUARDIAN_ROLE = keccak256("GUARDIAN_ROLE");

    uint256 public constant BPS = 10_000;
    uint256 public constant MAX_FEE_BPS = 100; // 1% hard cap; buy locks reserve maxFeeBps of the market
    uint256 public constant MAX_SHARDS = 8;
    uint256 public constant MAX_OUTSIDE_LEVELS = 512; // per side per shard per clear
    uint256 internal constant SIDE_BID = 0;
    uint256 internal constant SIDE_ASK = 1;

    bytes32 internal constant NS_PLIST = keccak256("unison.plist");

    // ------------------------------------------------------------------ storage (ERC-7201)

    struct Market {
        address base;
        address quote;
        address refAdapter;
        uint8 baseIdx;
        uint8 quoteIdx;
        uint8 shards;
        bool active;
        bool permissioned;
        bool strictAfterClose;
        uint16 bandBps;
        uint16 feeBps;
        uint16 maxFeeBps;
        uint32 minTick;
        uint32 maxTick;
        uint32 maxBandTicks;
        uint64 baseUnit;
        uint64 tickSize;
        // state
        uint64 lastCleared; // last block whose batch has been merged/cleared
        uint64 pendingHead; // pending-batch list head (inclusive)
        uint64 pendingTail; // pending-batch list tail (exclusive)
        uint64 auctions; // number of auctions executed
        uint64 lastPrintTick;
        uint64 lastRefTimeMs;
        uint8 lastStatus;
        uint256 lastRefPrice;
        bytes32 receiptHash;
    }

    /// @custom:storage-location erc7201:unison.exchange.main
    struct MainStorage {
        address[] tokens;
        mapping(address => uint256) tokenIdxPlusOne;
        mapping(address => bool) restricted;
        Market[] markets;
        uint256 keeperReward; // quote units per successful clear (paid from protocol balance)
        address eligibility;
    }

    // keccak256(abi.encode(uint256(keccak256("unison.exchange.main")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant MAIN_SLOT = 0x069fd12cb2d0a39b3ced70bb8fd71244b65afb92d918026a8826bff4a0f34a00;

    function _s() private pure returns (MainStorage storage $) {
        assembly ("memory-safe") {
            $.slot := MAIN_SLOT
        }
    }

    // ------------------------------------------------------------------ events

    event TokenListed(address indexed token, uint256 index, bool restricted);
    event MarketCreated(uint256 indexed marketId, address base, address quote, uint256 tickSize, address refAdapter);
    event MarketParamsSet(uint256 indexed marketId, uint256 bandBps, uint256 feeBps, uint256 maxBandTicks, bool active);
    event Deposited(address indexed account, address indexed token, uint256 amount, address payer);
    event Withdrawn(address indexed account, address indexed token, uint256 amount, address to);
    event OrderPlaced(
        uint256 indexed marketId,
        address indexed account,
        uint256 slot,
        uint256 side,
        uint256 tick,
        uint256 qty,
        uint256 flags,
        uint256 batch
    );
    event OrderCancelled(uint256 indexed marketId, address indexed account, uint256 slot, uint256 releasedQty);
    event Claimed(
        uint256 indexed marketId,
        address indexed account,
        uint256 slot,
        uint256 side,
        uint256 filledBase,
        uint256 quoteAmount,
        uint256 fee,
        bool done
    );
    event BatchCleared(
        uint256 indexed marketId,
        uint256 indexed upToBlock,
        uint256 tick,
        uint256 price,
        uint256 volume,
        uint256 refPrice,
        uint256 refTimeMs,
        uint8 status,
        uint256 bandLo,
        uint256 bandHi,
        bytes32 receiptHash
    );
    event KeeperPaid(uint256 indexed marketId, address indexed keeper, uint256 amount);

    // ------------------------------------------------------------------ errors

    error UnknownToken();
    error TooManyTokens();
    error InvalidMarket();
    error MarketInactive();
    error InvalidParams();
    error InsufficientBalance();
    error InvalidTick();
    error InvalidQty();
    error NoFreeOrderSlot();
    error PendingFull();
    error TooManyGroups();
    error EmptySlot();
    error NotYourOrder();
    error NothingToClear();
    error StaleReference();
    error TooManyOutsideLevels();
    error NotEligible();
    error MissingSnapshot();

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
        if (
            p.tickSize == 0 || p.minTick == 0 || p.maxTick > BookStore.MAX_TICK || p.minTick >= p.maxTick
                || p.shards == 0 || p.shards > MAX_SHARDS || p.maxFeeBps > MAX_FEE_BPS || p.feeBps > p.maxFeeBps
                || p.bandBps == 0 || p.maxBandTicks == 0 || p.refAdapter == address(0)
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
        m.baseUnit = uint64(10 ** IERC20Metadata(p.base).decimals());
        m.tickSize = p.tickSize;
        // Batches start at the creation block: orders placed in this very block must be clearable.
        m.lastCleared = uint64(block.number - 1);
        marketId = $.markets.length - 1;
        emit MarketCreated(marketId, p.base, p.quote, p.tickSize, p.refAdapter);
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

    /// @notice Seeds the protocol reserve (rounding-dust buffer + keeper rewards). Anyone may fund it.
    function fundProtocol(address token, uint256 amount) external nonReentrant {
        uint256 idx = _tokenIdx(token);
        uint256 before = IERC20(token).balanceOf(address(this));
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        _credit(address(this), idx, IERC20(token).balanceOf(address(this)) - before);
    }

    /// @notice Protocol revenue (fees + rounding dust) sits in the ledger account of this contract.
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
    /// @param flags  bit0 = IOC (cancel any remainder after its first auction)
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

        uint256 price = tick * m.tickSize;
        if (side == SIDE_BID) {
            _debit(msg.sender, m.quoteIdx, _buyLock(qty, price, m.maxFeeBps, m.baseUnit));
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
        o.state = L.STATE_PENDING;
        o.batch = batch;
        _writeOrder(msg.sender, slotIdx, o);
        emit OrderPlaced(marketId, msg.sender, slotIdx, side, tick, qty, ioc, batch);
    }

    /// @notice Cancels an order. Any fills that already happened are settled first.
    function cancelOrder(uint256 slotIdx) external nonReentrant {
        L.OrderRec memory o = _readOrder(msg.sender, slotIdx);
        if (o.state == L.STATE_EMPTY) revert EmptySlot();
        Market storage m = _market(o.market);

        if (o.state == L.STATE_PENDING && o.batch > m.lastCleared) {
            // not merged yet: pull it out of the pending aggregate
            _subPending(o.market, o.batch, o.side, o.shard, o.flags & L.FLAG_IOC, o.tick, o.qty);
            _releaseLock(msg.sender, m, o, o.qty);
            _freeOrderSlot(msg.sender, slotIdx);
            emit OrderCancelled(o.market, msg.sender, slotIdx, o.qty);
            return;
        }

        (bool done, L.OrderRec memory rest) = _settle(msg.sender, slotIdx, o, m);
        if (done) return;
        BookStore.Key memory k = BookStore.Key(rest.market, rest.side, rest.shard);
        BookStore.remove(k, rest.tick, rest.qty);
        _releaseLock(msg.sender, m, rest, rest.qty);
        _freeOrderSlot(msg.sender, slotIdx);
        emit OrderCancelled(rest.market, msg.sender, slotIdx, rest.qty);
    }

    /// @notice Settles fills of `account`'s orders. Permissionless: proceeds always go to `account`.
    function claim(address account, uint256[] calldata slots) external nonReentrant {
        for (uint256 i = 0; i < slots.length; ++i) {
            L.OrderRec memory o = _readOrder(account, slots[i]);
            if (o.state == L.STATE_EMPTY) continue;
            Market storage m = _market(o.market);
            if (o.state == L.STATE_PENDING && o.batch > m.lastCleared) continue;
            _settle(account, slots[i], o, m);
        }
    }

    // ------------------------------------------------------------------ clearing

    struct ClearCtx {
        uint256 marketId;
        uint256 upTo;
        uint256 refPrice;
        uint256 refTimeMs;
        uint8 status;
        uint256 refTick;
        uint256 lo;
        uint256 hi;
        uint256 iocCount;
    }

    /// @notice Runs the batch auction for every pending batch up to block.number - 1. Permissionless.
    /// @param payload reference-adapter payload (e.g. operator-signed price), may be empty
    function clear(uint256 marketId, bytes calldata payload)
        external
        whenNotPaused
        nonReentrant
        returns (uint256 tick, uint256 volume)
    {
        Market storage m = _market(marketId);
        if (!m.active) revert MarketInactive();
        ClearCtx memory c;
        c.marketId = marketId;
        c.upTo = block.number - 1;
        if (c.upTo <= m.lastCleared) revert NothingToClear();

        // 1. Reference, published after the newest pending batch closed (SPEC §7).
        (uint256 px, uint256 pubMs, IReferenceAdapter.Status st) =
            IReferenceAdapter(m.refAdapter).read(marketId, payload);
        uint256 newestTs = _newestPendingTs(marketId, m, c.upTo);
        if (newestTs != 0) {
            uint256 minPub = (newestTs + (m.strictAfterClose ? 1 : 0)) * 1000;
            if (pubMs < minPub) revert StaleReference();
        }
        if (px == 0) revert StaleReference();
        c.refPrice = px;
        c.refTimeMs = pubMs;
        c.status = uint8(st);

        // 2. Merge pending batches into the books (records merge snapshots; collects IOC groups).
        uint256[] memory iocGroups = _mergePending(marketId, m, c.upTo);

        // 3. Auction (skipped while the primary market is halted).
        if (st != IReferenceAdapter.Status.HALTED) {
            (tick, volume) = _auction(m, c);
        }

        // 4. IOC remainders are cancelled out of the books; post-auction snapshots recorded.
        _finalizeIoc(marketId, iocGroups, c.upTo);

        // 5. Bookkeeping, receipt chain, keeper reward.
        m.lastCleared = uint64(c.upTo);
        m.lastRefPrice = px;
        m.lastRefTimeMs = uint64(pubMs);
        m.lastStatus = uint8(st);
        if (volume > 0) {
            m.auctions += 1;
            m.lastPrintTick = uint64(tick);
        }
        bytes32 r = keccak256(
            abi.encode(m.receiptHash, marketId, c.upTo, tick, volume, px, pubMs, uint8(st), block.timestamp)
        );
        m.receiptHash = r;
        emit BatchCleared(
            marketId, c.upTo, tick, tick * m.tickSize, volume, px, pubMs, uint8(st), c.lo, c.hi, r
        );
        _payKeeper(marketId, m);
    }

    function _auction(Market storage m, ClearCtx memory c) private returns (uint256, uint256) {
        // Band centred on the reference tick (SPEC §5): [ref - hw, ref + hw] ∩ [minTick, maxTick].
        uint256 refTick = (c.refPrice + m.tickSize / 2) / m.tickSize;
        if (refTick < m.minTick) refTick = m.minTick;
        if (refTick > m.maxTick) refTick = m.maxTick;
        uint256 hw = (refTick * m.bandBps) / BPS;
        if (hw == 0) hw = 1;
        uint256 maxHw = (uint256(m.maxBandTicks) - 1) / 2;
        if (hw > maxHw) hw = maxHw;
        c.refTick = refTick;
        c.lo = refTick > m.minTick + hw ? refTick - hw : m.minTick;
        c.hi = refTick + hw < m.maxTick ? refTick + hw : m.maxTick;

        Clearing.Input memory x = _buildInput(m, c);
        Clearing.Result memory r = Clearing.compute(x);
        if (!r.traded) return (0, 0);

        uint256 price = r.tick * m.tickSize;
        _applyBids(m, c, x, r, price);
        _applyAsks(m, c, x, r, price);
        return (r.tick, r.volume);
    }

    function _buildInput(Market storage m, ClearCtx memory c) private view returns (Clearing.Input memory x) {
        uint256 n = c.hi - c.lo + 1;
        x.lo = c.lo;
        x.hi = c.hi;
        x.refTick = c.refTick;
        x.bids = new uint256[](n);
        x.asks = new uint256[](n);
        uint256 shards = m.shards;
        for (uint256 s = 0; s < shards; ++s) {
            BookStore.Key memory kb = BookStore.Key(c.marketId, SIDE_BID, s);
            BookStore.Key memory ka = BookStore.Key(c.marketId, SIDE_ASK, s);
            if (BookStore.total(kb) != 0) {
                x.bidAbove += BookStore.sumAbove(kb, c.hi);
                _accumulateBand(kb, c.lo, c.hi, x.bids);
            }
            if (BookStore.total(ka) != 0) {
                x.askBelow += BookStore.sumBelow(ka, c.lo);
                _accumulateBand(ka, c.lo, c.hi, x.asks);
            }
        }
    }

    /// @dev Adds a shard's per-tick quantities in [lo, hi] to `arr`, skipping empty buckets (1 page read each).
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

    function _applyBids(
        Market storage m,
        ClearCtx memory c,
        Clearing.Input memory x,
        Clearing.Result memory r,
        uint256 price
    ) private {
        uint256 shards = m.shards;
        // ABOVE class (index 0)
        if (x.bidAbove != 0) {
            uint256 ratioAbove = r.bidMarginal == 0 ? r.bidRatio : Clearing.ONE;
            for (uint256 s = 0; s < shards; ++s) {
                _fillOutside(BookStore.Key(c.marketId, SIDE_BID, s), c.hi, true, ratioAbove, price);
            }
        }
        if (r.bidMarginal == 0) return;
        // levels hi .. marginal tick
        uint256 n = c.hi - c.lo + 1;
        for (uint256 j = 1; j <= r.bidMarginal; ++j) {
            uint256 tick = Clearing.bidLevelTick(c.hi, j);
            if (x.bids[n - j] == 0) continue;
            uint256 ratio = j == r.bidMarginal ? r.bidRatio : Clearing.ONE;
            for (uint256 s = 0; s < shards; ++s) {
                BookStore.fill(BookStore.Key(c.marketId, SIDE_BID, s), tick, ratio, price);
            }
        }
    }

    function _applyAsks(
        Market storage m,
        ClearCtx memory c,
        Clearing.Input memory x,
        Clearing.Result memory r,
        uint256 price
    ) private {
        uint256 shards = m.shards;
        if (x.askBelow != 0) {
            uint256 ratioBelow = r.askMarginal == 0 ? r.askRatio : Clearing.ONE;
            for (uint256 s = 0; s < shards; ++s) {
                _fillOutside(BookStore.Key(c.marketId, SIDE_ASK, s), c.lo, false, ratioBelow, price);
            }
        }
        if (r.askMarginal == 0) return;
        for (uint256 j = 1; j <= r.askMarginal; ++j) {
            uint256 tick = Clearing.askLevelTick(c.lo, j);
            if (x.asks[j - 1] == 0) continue;
            uint256 ratio = j == r.askMarginal ? r.askRatio : Clearing.ONE;
            for (uint256 s = 0; s < shards; ++s) {
                BookStore.fill(BookStore.Key(c.marketId, SIDE_ASK, s), tick, ratio, price);
            }
        }
    }

    /// @dev Applies `ratio` to every non-empty level strictly above (or below) `edge` in one shard.
    function _fillOutside(BookStore.Key memory k, uint256 edge, bool above, uint256 ratio, uint256 price) private {
        if (ratio == 0 || BookStore.total(k) == 0) return;
        uint256 ops;
        if (above) {
            if (edge >= BookStore.MAX_TICK) return;
            uint256 start = edge + 1;
            uint256 maxSuper = BookStore.MAX_TICK >> 14;
            for (uint256 sup = start >> 14; sup <= maxSuper; ++sup) {
                if (BookStore.superTotal(k, sup) == 0) continue;
                uint256 b0 = sup << 7;
                uint256 b1 = b0 | 127;
                if (b0 < (start >> 7)) b0 = start >> 7;
                for (uint256 b = b0; b <= b1; ++b) {
                    if (BookStore.bucketTotal(k, b) == 0) continue;
                    uint256 t0 = b << 7;
                    if (t0 < start) t0 = start;
                    uint256 t1 = (b << 7) | 127;
                    for (uint256 t = t0; t <= t1; ++t) {
                        if (BookStore.remainingAt(k, t) == 0) continue;
                        BookStore.fill(k, t, ratio, price);
                        if (++ops > MAX_OUTSIDE_LEVELS) revert TooManyOutsideLevels();
                    }
                }
            }
        } else {
            if (edge == 0) return;
            uint256 endT = edge - 1; // inclusive
            for (uint256 sup = 0; sup <= (endT >> 14); ++sup) {
                if (BookStore.superTotal(k, sup) == 0) continue;
                uint256 b0 = sup << 7;
                uint256 b1 = b0 | 127;
                if (b1 > (endT >> 7)) b1 = endT >> 7;
                for (uint256 b = b0; b <= b1; ++b) {
                    if (BookStore.bucketTotal(k, b) == 0) continue;
                    uint256 t0 = b << 7;
                    uint256 t1 = (b << 7) | 127;
                    if (t1 > endT) t1 = endT;
                    for (uint256 t = t0; t <= t1; ++t) {
                        if (BookStore.remainingAt(k, t) == 0) continue;
                        BookStore.fill(k, t, ratio, price);
                        if (++ops > MAX_OUTSIDE_LEVELS) revert TooManyOutsideLevels();
                    }
                }
            }
        }
    }

    // ------------------------------------------------------------------ pending ring

    function _plistSlot(uint256 marketId, uint256 idx) private pure returns (uint256) {
        uint256 r = idx % L.RING;
        return Pages.base2(NS_PLIST, marketId, r >> 7) + (r & 127);
    }

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
        uint256 count;
        if ((head & type(uint64).max) != batch) {
            if (uint256(m.pendingTail) - uint256(m.pendingHead) >= L.RING) revert PendingFull();
            Pages.store(_plistSlot(marketId, m.pendingTail), batch);
            m.pendingTail += 1;
            head = batch | (block.timestamp << 96); // count = 0
            Pages.store(gp0, head);
        }
        count = (head >> 64) & type(uint32).max;

        uint256 ps = L.pendingSlot(marketId, batch, side, shard, ioc, tick);
        uint256 w = Pages.load(ps);
        uint256 cur = (w & type(uint64).max) == batch ? (w >> 64) : 0;
        if ((w & type(uint64).max) != batch) {
            // first pending quantity for this group in this batch: append to group list
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

    function _newestPendingTs(uint256 marketId, Market storage m, uint256 upTo) private view returns (uint256 ts) {
        // newest registered batch <= upTo
        uint256 tail = m.pendingTail;
        uint256 headIdx = m.pendingHead;
        while (tail > headIdx) {
            uint256 b = Pages.load(_plistSlot(marketId, tail - 1));
            if (b <= upTo) {
                return Pages.load(L.groupPage(marketId, b, 0)) >> 96;
            }
            tail -= 1;
        }
        return 0;
    }

    /// @dev Merges every pending batch <= upTo. Returns packed IOC groups (batch << 64 | group).
    function _mergePending(uint256 marketId, Market storage m, uint256 upTo)
        private
        returns (uint256[] memory iocGroups)
    {
        // First pass: count IOC groups to size the array.
        uint256 iocN;
        uint256 h = m.pendingHead;
        while (h < m.pendingTail) {
            uint256 b = Pages.load(_plistSlot(marketId, h));
            if (b > upTo) break;
            uint256 count = (Pages.load(L.groupPage(marketId, b, 0)) >> 64) & type(uint32).max;
            for (uint256 g = 0; g < count; ++g) {
                uint256 grp = Pages.load(L.groupPage(marketId, b, g / 127) + 1 + (g % 127));
                (,, uint256 ioc,) = L.unpackGroup(grp);
                if (ioc != 0) ++iocN;
            }
            ++h;
        }
        iocGroups = new uint256[](iocN);
        uint256 k;

        while (m.pendingHead < m.pendingTail) {
            uint256 b = Pages.load(_plistSlot(marketId, m.pendingHead));
            if (b > upTo) break;
            uint256 count = (Pages.load(L.groupPage(marketId, b, 0)) >> 64) & type(uint32).max;
            for (uint256 g = 0; g < count; ++g) {
                uint256 grp = Pages.load(L.groupPage(marketId, b, g / 127) + 1 + (g % 127));
                (uint256 side, uint256 shard, uint256 ioc, uint256 tick) = L.unpackGroup(grp);
                uint256 ps = L.pendingSlot(marketId, b, side, shard, ioc, tick);
                uint256 w = Pages.load(ps);
                uint256 qty = (w & type(uint64).max) == b ? (w >> 64) : 0;
                if (qty == 0) continue;
                BookStore.Key memory key = BookStore.Key(marketId, side, shard);
                (uint256 e, uint256 sv, uint256 a) = BookStore.add(key, tick, qty);
                Pages.store(L.mergeSnapSlot(marketId, b, side, shard, tick), L.packSnap(e, sv, a));
                if (ioc != 0) iocGroups[k++] = (b << 64) | grp;
            }
            m.pendingHead += 1;
        }
        // shrink in case some IOC groups were fully cancelled before merge
        assembly ("memory-safe") {
            mstore(iocGroups, k)
        }
    }

    /// @dev Cancels the unfilled remainder of IOC groups and stores post-auction snapshots.
    function _finalizeIoc(uint256 marketId, uint256[] memory iocGroups, uint256) private {
        for (uint256 i = 0; i < iocGroups.length; ++i) {
            uint256 b = iocGroups[i] >> 64;
            uint256 grp = iocGroups[i] & type(uint64).max;
            (uint256 side, uint256 shard,, uint256 tick) = L.unpackGroup(grp);
            BookStore.Key memory key = BookStore.Key(marketId, side, shard);
            BookStore.Level memory lvl = BookStore.readLevel(key, tick);
            (uint256 e0, uint256 s0,) =
                L.unpackSnap(Pages.load(L.mergeSnapSlot(marketId, b, side, shard, tick)));
            uint256 ps = L.pendingSlot(marketId, b, side, shard, 1, tick);
            uint256 qty = Pages.load(ps) >> 64;
            uint256 remainder = lvl.epoch == e0 ? Math.mulDiv(qty, lvl.survival, s0) : 0;
            if (remainder > 0) BookStore.remove(key, tick, remainder);
            Pages.store(
                L.iocPostSlot(marketId, b, side, shard, tick), L.packSnap(lvl.epoch, lvl.survival, lvl.acc)
            );
        }
    }

    // ------------------------------------------------------------------ settlement

    /// @dev Settles fills since the order's snapshot. Returns (done, order-after) — when not done, the
    ///      order has been rebased to the current level state and written back.
    function _settle(address account, uint256 slotIdx, L.OrderRec memory o, Market storage m)
        private
        returns (bool done, L.OrderRec memory)
    {
        BookStore.Key memory key = BookStore.Key(o.market, o.side, o.shard);
        bool ioc = (o.flags & L.FLAG_IOC) != 0;

        // Resolve the entry snapshot of a pending order that has since been merged.
        if (o.state == L.STATE_PENDING) {
            (o.epoch, o.survival, o.acc) =
                L.unpackSnap(Pages.load(L.mergeSnapSlot(o.market, o.batch, o.side, o.shard, o.tick)));
            if (o.survival == 0) revert MissingSnapshot();
            o.state = L.STATE_LIVE;
        }

        // Current level state — for IOC orders, the frozen post-auction snapshot.
        uint256 curEpoch;
        uint256 curS;
        uint256 curA;
        if (ioc) {
            (curEpoch, curS, curA) =
                L.unpackSnap(Pages.load(L.iocPostSlot(o.market, o.batch, o.side, o.shard, o.tick)));
        } else {
            BookStore.Level memory lvl = BookStore.readLevel(key, o.tick);
            (curEpoch, curS, curA) = (lvl.epoch, lvl.survival, lvl.acc);
        }
        uint256 finalA = curEpoch != o.epoch ? BookStore.epochFinal(key, o.tick, o.epoch) : 0;

        OrderMath.Valuation memory v = OrderMath.value(
            OrderMath.Snapshot(o.qty, o.epoch, o.survival, o.acc), curEpoch, curS, curA, finalA, m.baseUnit
        );

        uint256 newQty = (v.closed || ioc) ? 0 : v.newQty;
        uint256 fee;
        uint256 quoteAmt;
        if (o.side == SIDE_BID) {
            uint256 price = o.tick * m.tickSize;
            uint256 lockOld = _buyLock(o.qty, price, m.maxFeeBps, m.baseUnit);
            uint256 lockNew = newQty == 0 ? 0 : _buyLock(newQty, price, m.maxFeeBps, m.baseUnit);
            quoteAmt = v.quoteCeil;
            fee = Math.mulDiv(quoteAmt, m.feeBps, BPS, Math.Rounding.Ceil);
            uint256 released = lockOld - lockNew;
            uint256 spend = quoteAmt + fee;
            if (released >= spend) {
                _credit(account, m.quoteIdx, released - spend);
            } else {
                // rounding shortfall (≤ a few units): covered by protocol dust
                _debitProtocolDust(m.quoteIdx, spend - released);
            }
            _credit(account, m.baseIdx, v.filledFloor);
        } else {
            quoteAmt = v.quoteFloor;
            fee = Math.mulDiv(quoteAmt, m.feeBps, BPS, Math.Rounding.Ceil);
            if (fee > quoteAmt) fee = quoteAmt;
            _credit(account, m.quoteIdx, quoteAmt - fee);
            // base delivered = filledCeil (already locked); return any unfilled remainder that leaves the book
            uint256 delivered = v.filledCeil > o.qty ? o.qty : v.filledCeil;
            uint256 keep = newQty;
            uint256 back = o.qty - delivered - keep;
            if (back > 0) _credit(account, m.baseIdx, back);
        }
        if (fee > 0) _credit(address(this), m.quoteIdx, fee);

        done = newQty == 0;
        emit Claimed(o.market, account, slotIdx, o.side, o.side == SIDE_BID ? v.filledFloor : v.filledCeil, quoteAmt, fee, done);

        if (done) {
            _freeOrderSlot(account, slotIdx);
        } else {
            BookStore.Level memory lvl2 = BookStore.readLevel(key, o.tick);
            o.qty = newQty;
            o.epoch = lvl2.epoch;
            o.survival = lvl2.survival;
            o.acc = lvl2.acc;
            _writeOrder(account, slotIdx, o);
        }
        return (done, o);
    }

    function _releaseLock(address account, Market storage m, L.OrderRec memory o, uint256 qty) private {
        if (qty == 0) return;
        if (o.side == SIDE_BID) {
            _credit(account, m.quoteIdx, _buyLock(qty, o.tick * m.tickSize, m.maxFeeBps, m.baseUnit));
        } else {
            _credit(account, m.baseIdx, qty);
        }
    }

    /// @dev Quote locked for a buy of `qty` at `price`: notional (ceil) + max fee (ceil) + 1 unit of dust buffer.
    function _buyLock(uint256 qty, uint256 price, uint256 maxFeeBps, uint256 baseUnit)
        private
        pure
        returns (uint256)
    {
        uint256 notional = OrderMath.notionalCeil(qty, price, baseUnit);
        return notional + Math.mulDiv(notional, maxFeeBps, BPS, Math.Rounding.Ceil) + 1;
    }

    // ------------------------------------------------------------------ keeper

    function _payKeeper(uint256 marketId, Market storage m) private {
        uint256 reward = _s().keeperReward;
        if (reward == 0 || msg.sender == address(this)) return;
        uint256 slot = L.balanceSlot(address(this), m.quoteIdx);
        uint256 bal = Pages.load(slot);
        if (bal < reward) return;
        Pages.store(slot, bal - reward);
        _credit(msg.sender, m.quoteIdx, reward);
        emit KeeperPaid(marketId, msg.sender, reward);
    }

    // ------------------------------------------------------------------ account page primitives

    function _credit(address account, uint256 tokenIdx, uint256 amount) private {
        if (amount == 0) return;
        uint256 s = L.balanceSlot(account, tokenIdx);
        Pages.store(s, Pages.load(s) + amount);
    }

    function _debit(address account, uint256 tokenIdx, uint256 amount) private {
        uint256 s = L.balanceSlot(account, tokenIdx);
        uint256 bal = Pages.load(s);
        if (bal < amount) revert InsufficientBalance();
        Pages.store(s, bal - amount);
    }

    function _debitProtocolDust(uint256 tokenIdx, uint256 amount) private {
        uint256 s = L.balanceSlot(address(this), tokenIdx);
        uint256 bal = Pages.load(s);
        // Dust reserve is seeded by fees; if empty, the shortfall is absorbed by the user's refund side.
        Pages.store(s, bal >= amount ? bal - amount : 0);
    }

    function _allocOrderSlot(address account) private returns (uint256) {
        uint256 bs = L.accountBase(account) + L.BITMAP_SLOT;
        uint256 bm = Pages.load(bs);
        for (uint256 i = 0; i < L.MAX_ORDERS; ++i) {
            if (bm & (1 << i) == 0) {
                Pages.store(bs, bm | (1 << i));
                return i;
            }
        }
        revert NoFreeOrderSlot();
    }

    function _freeOrderSlot(address account, uint256 i) private {
        uint256 bs = L.accountBase(account) + L.BITMAP_SLOT;
        Pages.store(bs, Pages.load(bs) & ~(uint256(1) << i));
        (uint256 a, uint256 b) = L.orderSlots(account, i);
        Pages.store(a, 0);
        Pages.store(b, 0);
    }

    function _readOrder(address account, uint256 i) private view returns (L.OrderRec memory) {
        if (i >= L.MAX_ORDERS) revert EmptySlot();
        (uint256 a, uint256 b) = L.orderSlots(account, i);
        return L.decodeOrder(Pages.load(a), Pages.load(b));
    }

    function _writeOrder(address account, uint256 i, L.OrderRec memory o) private {
        (uint256 a, uint256 b) = L.orderSlots(account, i);
        (uint256 wa, uint256 wb) = L.encodeOrder(o);
        Pages.store(a, wa);
        Pages.store(b, wb);
    }

    // ------------------------------------------------------------------ helpers

    function _market(uint256 marketId) private view returns (Market storage) {
        MainStorage storage $ = _s();
        if (marketId >= $.markets.length) revert InvalidMarket();
        return $.markets[marketId];
    }

    function _tokenIdx(address token) private view returns (uint256) {
        uint256 p = _s().tokenIdxPlusOne[token];
        if (p == 0) revert UnknownToken();
        return p - 1;
    }

    function _requireEligible(address account) private view {
        address reg = _s().eligibility;
        if (reg != address(0) && !IEligibility(reg).isEligible(account)) revert NotEligible();
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

    function balanceOf(address account, address token) external view returns (uint256) {
        return Pages.load(L.balanceSlot(account, _tokenIdx(token)));
    }

    function orderOf(address account, uint256 slotIdx) external view returns (L.OrderRec memory) {
        return _readOrder(account, slotIdx);
    }

    function openOrderBitmap(address account) external view returns (uint256) {
        return Pages.load(L.accountBase(account) + L.BITMAP_SLOT);
    }

    function levelOf(uint256 marketId, uint256 side, uint256 shard, uint256 tick)
        external
        view
        returns (BookStore.Level memory)
    {
        return BookStore.readLevel(BookStore.Key(marketId, side, shard), tick);
    }

    function bookTotal(uint256 marketId, uint256 side) external view returns (uint256 sum) {
        uint256 shards = _market(marketId).shards;
        for (uint256 s = 0; s < shards; ++s) sum += BookStore.total(BookStore.Key(marketId, side, s));
    }

    function keeperReward() external view returns (uint256) {
        return _s().keeperReward;
    }
}

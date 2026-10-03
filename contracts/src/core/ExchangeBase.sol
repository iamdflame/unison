// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Pages} from "../libraries/Pages.sol";
import {BookStore} from "./BookStore.sol";
import {ExchangeLayout as L} from "./ExchangeLayout.sol";
import {IEligibility} from "../interfaces/IEligibility.sol";

/// @title ExchangeBase — storage, events and ledger primitives shared by the exchange modules
abstract contract ExchangeBase {
    // ------------------------------------------------------------------ constants

    uint256 public constant BPS = 10_000;
    uint256 public constant MAX_FEE_BPS = 100; // 1% hard cap
    uint256 public constant MAX_SHARDS = 8;
    uint256 internal constant SIDE_BID = 0;
    uint256 internal constant SIDE_ASK = 1;
    uint256 internal constant IOC_SHARD_OFFSET = 8;
    uint256 internal constant NONE = type(uint256).max;

    /// @dev A clear call stops starting new work once gas left falls below this (resumable job, SPEC §5.6).
    uint256 internal constant GAS_RESERVE = 300_000;
    /// @dev Gas cap for calls into curve sources (a misbehaving source can never block clearing).
    uint256 internal constant CURVE_GAS = 150_000;
    uint256 internal constant MAX_SOURCES = 4;
    uint256 internal constant TIER1_SYMBOL_LIMIT = 75;
    uint256 internal constant TIER2_SYMBOL_LIMIT = 250;

    uint8 internal constant PHASE_IDLE = 0;
    uint8 internal constant PHASE_MERGE = 1;
    uint8 internal constant PHASE_APPLY = 2;
    uint8 internal constant PHASE_CLOSE_IOC = 3;

    uint8 internal constant STAGE_OUTSIDE = 0;
    uint8 internal constant STAGE_INBAND = 1;
    uint8 internal constant STAGE_MARGINAL = 2;
    uint8 internal constant STAGE_DONE = 3;

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
        uint64 lastCleared; // last block whose batch has been fully cleared
        uint64 pendingHead; // pending-batch list head (inclusive)
        uint64 pendingTail; // pending-batch list tail (exclusive)
        uint64 auctions; // number of auctions that traded
        uint64 lastPrintTick;
        uint64 lastRefTimeMs;
        uint8 lastStatus;
        uint256 lastRefPrice;
        bytes32 receiptHash;
    }

    /// @notice State of the resumable clear job of a market (SPEC §5.6). One job = merge every pending
    ///         batch <= upTo, run one auction, apply its fills level by level, then close the IOC books.
    struct Job {
        uint8 phase;
        uint8 side; // cursor: 0 bid, 1 ask
        uint8 stage; // cursor: OUTSIDE / INBAND / MARGINAL / DONE
        uint8 keyIdx; // cursor: book index (main 0..S-1, IOC S..2S-1)
        uint8 status; // reference status of this job's auction
        bool traded;
        bool bidOutside; // the auction saw bid liquidity above the band (else the OUTSIDE stage is skipped)
        bool askOutside; // ... ask liquidity below the band
        uint32 cursor; // cursor: next tick to examine (0 = start of range)
        uint32 groupCursor; // merge: next group of the head batch
        uint32 tick;
        uint32 lo;
        uint32 hi;
        uint32 bidMarginal;
        uint32 askMarginal;
        uint32 work; // groups merged + levels filled + levels closed
        uint64 upTo;
        uint64 newestTs;
        uint64 refTimeMs;
        uint256 refPrice;
        uint256 price;
        uint256 volume;
        uint256 bidNeed;
        uint256 askNeed;
        uint256 bidClassQ;
        uint256 askClassQ;
        uint256 before; // apportionment: class quantity visited so far
        uint256 filledBid;
        uint256 filledAsk;
        uint256 bidBefore0; // curve-source quantity apportioned ahead of the books at the marginal bid tick
        uint256 askBefore0;
    }

    /// @notice Regime configuration and state of a market (SPEC §6). The reference status selects the regime:
    ///         OPEN → LIVE (bandBps), EXTENDED (extBandBps), CLOSED → DISCOVERY (call auctions every
    ///         `discCadence` blocks, band widening with √(time closed) from `discFloorBps` to `discCapBps`
    ///         over `discHorizonSec`), first OPEN/EXTENDED auction after CLOSED/HALTED → REOPENING
    ///         (`reopenBandBps`, the opening cross), HALTED → no auction.
    struct Regime {
        uint16 extBandBps;
        uint16 reopenBandBps;
        uint16 discFloorBps;
        uint16 discCapBps;
        uint32 discHorizonSec;
        uint32 discCadence;
        bool halted; // guardian / CRE halt override: forces HALTED whatever the adapter says
        uint64 closedSince; // unix seconds the current CLOSED period started (0 = not closed)
        uint64 lastDiscoveryBatch; // newest batch of the last DISCOVERY auction (cadence)
    }

    /// @notice Tokenized-Securities-Venue caps (SEC Release 34-106402 conditions; SPEC §8.2): symbols are
    ///         assigned a LULD tier with a symbol limit, and each symbol trades at most `dailyCap` base units per
    ///         UTC day (a percentage of ADV per tier, written daily by the CRE workflow / operator).
    struct Caps {
        uint8 tier; // 1 or 2 (0 = untiered)
        uint64 day; // UTC day `traded` refers to
        uint128 traded; // base units executed on `day`
        uint128 dailyCap; // base units per UTC day (0 = no cap)
    }

    /// @custom:storage-location erc7201:unison.exchange.main
    struct MainStorage {
        address[] tokens;
        mapping(address => uint256) tokenIdxPlusOne;
        mapping(address => bool) restricted;
        Market[] markets;
        uint256 keeperReward; // quote units per completed clear job (paid from the protocol balance)
        address eligibility;
        mapping(uint256 => Job) jobs;
        mapping(uint256 => Regime) regimes;
        mapping(uint256 => address[]) sources; // curve sources per market (ICurveSource)
        mapping(uint256 => Caps) caps;
        uint16[3] tierCounts; // symbols per LULD tier (index 1, 2)
    }

    // keccak256(abi.encode(uint256(keccak256("unison.exchange.main")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant MAIN_SLOT = 0x069fd12cb2d0a39b3ced70bb8fd71244b65afb92d918026a8826bff4a0f34a00;

    function _s() internal pure returns (MainStorage storage $) {
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
        uint256 baseAmount,
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
    event ClearProgress(uint256 indexed marketId, uint256 indexed upToBlock, uint8 phase, uint256 work);
    event KeeperPaid(uint256 indexed marketId, address indexed keeper, uint256 amount);
    event RegimeSet(uint256 indexed marketId, Regime regime);
    event SourceSet(uint256 indexed marketId, address indexed source, bool added);
    event DailyCapSet(uint256 indexed marketId, uint256 dailyCap, address by);
    event TierSet(uint256 indexed marketId, uint8 tier);
    event NoticePosted(uint256 indexed marketId, bytes32 indexed docHash, string uri);
    event CurveFilled(
        uint256 indexed marketId,
        address indexed source,
        uint256 indexed upToBlock,
        uint256 boughtBase,
        uint256 paidQuote,
        uint256 soldBase,
        uint256 receivedQuote
    );
    event HaltSet(uint256 indexed marketId, bool halted, address by);

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
    error NothingToClear();
    error StaleReference();
    error NotEligible();
    error MissingSnapshot();
    error ClearInProgress();
    error ClearingMismatch();
    error TooEarly();
    error TooManySources();
    error TierFull();

    // ------------------------------------------------------------------ ledger primitives

    function _credit(address account, uint256 tokenIdx, uint256 amount) internal {
        if (amount == 0) return;
        uint256 s = L.balanceSlot(account, tokenIdx);
        Pages.store(s, Pages.load(s) + amount);
    }

    function _debit(address account, uint256 tokenIdx, uint256 amount) internal {
        uint256 s = L.balanceSlot(account, tokenIdx);
        uint256 bal = Pages.load(s);
        if (bal < amount) revert InsufficientBalance();
        Pages.store(s, bal - amount);
    }

    // ------------------------------------------------------------------ order slots

    function _allocOrderSlot(address account) internal returns (uint256) {
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

    function _freeOrderSlot(address account, uint256 i) internal {
        uint256 bs = L.accountBase(account) + L.BITMAP_SLOT;
        Pages.store(bs, Pages.load(bs) & ~(uint256(1) << i));
        (uint256 a, uint256 b) = L.orderSlots(account, i);
        Pages.store(a, 0);
        Pages.store(b, 0);
    }

    function _readOrder(address account, uint256 i) internal view returns (L.OrderRec memory) {
        if (i >= L.MAX_ORDERS) revert EmptySlot();
        (uint256 a, uint256 b) = L.orderSlots(account, i);
        return L.decodeOrder(Pages.load(a), Pages.load(b));
    }

    function _writeOrder(address account, uint256 i, L.OrderRec memory o) internal {
        (uint256 a, uint256 b) = L.orderSlots(account, i);
        (uint256 wa, uint256 wb) = L.encodeOrder(o);
        Pages.store(a, wa);
        Pages.store(b, wb);
    }

    // ------------------------------------------------------------------ helpers

    function _market(uint256 marketId) internal view returns (Market storage) {
        MainStorage storage $ = _s();
        if (marketId >= $.markets.length) revert InvalidMarket();
        return $.markets[marketId];
    }

    function _tokenIdx(address token) internal view returns (uint256) {
        uint256 p = _s().tokenIdxPlusOne[token];
        if (p == 0) revert UnknownToken();
        return p - 1;
    }

    function _requireEligible(address account) internal view {
        address reg = _s().eligibility;
        if (reg != address(0) && !IEligibility(reg).isEligible(account)) revert NotEligible();
    }

    /// @dev Book key for book index `idx` of a side: main books 0..S-1, IOC books S..2S-1.
    function _bookKey(uint256 marketId, uint256 side, uint256 idx, uint256 shards)
        internal
        pure
        returns (BookStore.Key memory)
    {
        return BookStore.Key(marketId, side, idx < shards ? idx : IOC_SHARD_OFFSET + (idx - shards));
    }

    function _plistSlot(uint256 marketId, uint256 idx) internal pure returns (uint256) {
        uint256 r = idx % L.RING;
        return Pages.base2(NS_PLIST, marketId, r >> 7) + (r & 127);
    }
}

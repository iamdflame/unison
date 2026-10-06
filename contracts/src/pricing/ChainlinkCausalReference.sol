// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ICausalReference} from "../interfaces/ICausalReference.sol";
import {AggregatorV3Interface} from "../interfaces/external/AggregatorV3Interface.sol";
import {Session} from "./Session.sol";

/// @title ChainlinkCausalReference — Chainlink feeds read by the oracle's own observation time (SPEC §7.4)
/// @notice Chainlink's OCR2 feeds report `startedAt` = the observations timestamp inside the report the oracle quorum
///         signed; `updatedAt` is only when that report landed on chain (about 13 s later on Monad). An auction is
///         priced at the FIRST observation made after its orders were sealed, proved from the feed's own history:
///         round r was observed after the seal and round r-1 was not. So the price did not exist when the orders
///         were placed, and a keeper cannot pick another one. Nothing here writes the chain's clock into a
///         reference time; a round whose observation time is not strictly before its arrival is refused.
///
///         The quote feed (e.g. AUSD/USD) divides the base feed; the quote round used is the one in force at the base
///         observation, so it is fixed by the same history. A quote asset off its peg halts the market.
contract ChainlinkCausalReference is ICausalReference, Ownable2Step {
    struct Feed {
        AggregatorV3Interface base; // base/USD
        AggregatorV3Interface quote; // quote/USD (zero = the quote token is USD)
        uint8 baseDecimals;
        uint8 quoteFeedDecimals;
        uint8 quoteTokenDecimals;
        uint32 maxAgeSec; // base feed silent for longer than this (since its last report landed) counts as closed
        uint32 quoteMaxAgeSec; // the quote observation in force may be at most this much older than the base one
        uint32 openSec; // weekly session (Session); open == close = always open
        uint32 closeSec;
        uint16 depegBps; // quote asset more than this off $1 = HALTED (0 = no check)
        bool set;
    }

    mapping(uint256 => Feed) public feeds;

    event FeedSet(
        uint256 indexed marketId,
        address base,
        address quote,
        uint8 quoteTokenDecimals,
        uint32 maxAgeSec,
        uint32 quoteMaxAgeSec,
        uint32 openSec,
        uint32 closeSec,
        uint16 depegBps
    );

    error UnknownFeed();
    error BadAnswer();
    error NotAfterSeal(); // the named observation was made at or before the seal
    error NotFirstObservation(); // an earlier observation made after the seal exists
    error ObservationExists(uint80 round); // empty payload while an observation after the seal exists
    error NotYet(); // the market is open and no observation after the seal exists yet: wait for it
    error BadQuoteRound(); // the named quote round is not the one in force at the base observation

    constructor(address owner_) Ownable(owner_) {}

    function setFeed(
        uint256 marketId,
        AggregatorV3Interface base,
        AggregatorV3Interface quote,
        uint8 quoteTokenDecimals,
        uint32 maxAgeSec,
        uint32 quoteMaxAgeSec,
        uint32 openSec,
        uint32 closeSec,
        uint16 depegBps
    ) external onlyOwner {
        Feed storage f = feeds[marketId];
        f.base = base;
        f.quote = quote;
        f.baseDecimals = base.decimals();
        f.quoteFeedDecimals = address(quote) == address(0) ? 0 : quote.decimals();
        f.quoteTokenDecimals = quoteTokenDecimals;
        f.maxAgeSec = maxAgeSec;
        f.quoteMaxAgeSec = quoteMaxAgeSec;
        f.openSec = openSec;
        f.closeSec = closeSec;
        f.depegBps = depegBps;
        f.set = true;
        emit FeedSet(
            marketId,
            address(base),
            address(quote),
            quoteTokenDecimals,
            maxAgeSec,
            quoteMaxAgeSec,
            openSec,
            closeSec,
            depegBps
        );
    }

    // ------------------------------------------------------------------ the exchange's reads

    /// @inheritdoc ICausalReference
    function readAfter(uint256 marketId, uint256 afterSec, bytes calldata payload)
        external
        view
        returns (uint256 price, uint256 observedAt, Status status, uint80 round)
    {
        Feed memory f = _feed(marketId);
        if (payload.length == 0) {
            // No observation after the seal yet. Only a market that is closed (session over, or feed silent) may
            // clear now: a DISCOVERY call auction, anchored at the last observation, with its true old time.
            uint256 b;
            uint256 arrivedAt;
            (round, b, observedAt, arrivedAt) = _latest(f.base);
            if (observedAt > afterSec) revert ObservationExists(round);
            if (Session.isOpen(f.openSec, f.closeSec, block.timestamp) && block.timestamp - arrivedAt <= f.maxAgeSec) {
                revert NotYet();
            }
            (price, status) = _price(f, b, _latestQuote(f));
            if (status != Status.HALTED) status = Status.CLOSED;
            return (price, observedAt, status, round);
        }
        (uint80 r, uint80 q) = abi.decode(payload, (uint80, uint80));
        uint256 answer;
        (answer, observedAt) = _observation(f.base, r);
        if (observedAt <= afterSec) revert NotAfterSeal();
        // The round before it must have been observed at or before the seal, or r is not the first. (Round 1 of a
        // proxy phase has no predecessor in its phase; that only happens when Chainlink replaces the aggregator.)
        if (uint64(r) > 1 && _observedAt(f.base, r - 1) > afterSec) revert NotFirstObservation();
        (price, status) = _price(f, answer, _quoteInForce(f, q, observedAt));
        if (status != Status.HALTED && !Session.isOpen(f.openSec, f.closeSec, observedAt)) status = Status.CLOSED;
        round = r;
    }

    /// @inheritdoc ICausalReference
    function latest(uint256 marketId)
        public
        view
        returns (uint256 price, uint256 observedAt, Status status, uint80 round)
    {
        Feed memory f = _feed(marketId);
        uint256 b;
        uint256 arrivedAt;
        (round, b, observedAt, arrivedAt) = _latest(f.base);
        (price, status) = _price(f, b, _latestQuote(f));
        if (
            status != Status.HALTED
                && (!Session.isOpen(f.openSec, f.closeSec, block.timestamp)
                    || block.timestamp - arrivedAt > f.maxAgeSec)
        ) status = Status.CLOSED;
    }

    /// @notice The latest observation in IReferenceAdapter form, for interfaces (the exchange calls `readAfter`).
    ///         `publishTimeMs` is the oracle's observation time.
    function read(uint256 marketId, uint256, bytes calldata)
        external
        view
        returns (uint256 price, uint256 publishTimeMs, Status status)
    {
        uint256 observedAt;
        (price, observedAt, status,) = latest(marketId);
        publishTimeMs = observedAt * 1000;
    }

    // ------------------------------------------------------------------ internals

    struct Quote {
        uint256 answer; // 0 = the quote token is USD
        bool usable; // fresh enough relative to the base observation
    }

    function _feed(uint256 marketId) private view returns (Feed memory f) {
        f = feeds[marketId];
        if (!f.set) revert UnknownFeed();
    }

    /// @dev price = base/USD ÷ quote/USD in quote token units per whole base token; HALTED when the quote is stale
    ///      or off its peg (the market cannot be priced in it), OPEN otherwise (callers apply the session).
    function _price(Feed memory f, uint256 b, Quote memory q) private pure returns (uint256 price, Status status) {
        status = Status.OPEN;
        if (address(f.quote) == address(0)) {
            price = Math.mulDiv(b, 10 ** f.quoteTokenDecimals, 10 ** f.baseDecimals);
        } else {
            price =
                Math.mulDiv(b * 10 ** f.quoteTokenDecimals, 10 ** f.quoteFeedDecimals, q.answer * 10 ** f.baseDecimals);
            if (!q.usable) status = Status.HALTED;
            if (f.depegBps != 0) {
                uint256 one = 10 ** f.quoteFeedDecimals;
                uint256 off = q.answer > one ? q.answer - one : one - q.answer;
                if (off * 10_000 > uint256(f.depegBps) * one) status = Status.HALTED;
            }
        }
        if (price == 0) revert BadAnswer();
    }

    /// @dev The quote round in force at `baseObservedAt`: observed at or before it, its successor (if any) after it.
    function _quoteInForce(Feed memory f, uint80 q, uint256 baseObservedAt) private view returns (Quote memory out) {
        if (address(f.quote) == address(0)) return out;
        (uint256 a, uint256 qAt) = _observation(f.quote, q);
        if (qAt > baseObservedAt) revert BadQuoteRound();
        (bool exists, uint256 nextAt) = _tryObservedAt(f.quote, q + 1);
        if (exists && nextAt <= baseObservedAt) revert BadQuoteRound();
        out.answer = a;
        out.usable = baseObservedAt - qAt <= f.quoteMaxAgeSec;
    }

    function _latestQuote(Feed memory f) private view returns (Quote memory out) {
        if (address(f.quote) == address(0)) return out;
        (, uint256 a,, uint256 arrivedAt) = _latest(f.quote);
        out.answer = a;
        out.usable = block.timestamp - arrivedAt <= f.quoteMaxAgeSec;
    }

    function _latest(AggregatorV3Interface agg)
        private
        view
        returns (uint80 round, uint256 answer, uint256 observedAt, uint256 arrivedAt)
    {
        (uint80 r, int256 ans, uint256 startedAt, uint256 updatedAt,) = agg.latestRoundData();
        _check(ans, startedAt, updatedAt);
        return (r, uint256(ans), startedAt, updatedAt);
    }

    function _observation(AggregatorV3Interface agg, uint80 round)
        private
        view
        returns (uint256 answer, uint256 observedAt)
    {
        (, int256 ans, uint256 startedAt, uint256 updatedAt,) = agg.getRoundData(round);
        _check(ans, startedAt, updatedAt);
        return (uint256(ans), startedAt);
    }

    /// @dev Observation time of a round that must exist (any answer; only its time matters).
    function _observedAt(AggregatorV3Interface agg, uint80 round) private view returns (uint256 startedAt) {
        uint256 updatedAt;
        (,, startedAt, updatedAt,) = agg.getRoundData(round);
        if (updatedAt == 0) revert BadAnswer();
    }

    function _tryObservedAt(AggregatorV3Interface agg, uint80 round) private view returns (bool exists, uint256 at) {
        try agg.getRoundData(round) returns (uint80, int256, uint256 startedAt, uint256 updatedAt, uint80) {
            return (updatedAt != 0, startedAt);
        } catch {
            return (false, 0);
        }
    }

    /// @dev A usable round: positive answer, and an observation time strictly before its arrival on chain — the time
    ///      of a signed observation, not the chain's clock.
    function _check(int256 ans, uint256 startedAt, uint256 updatedAt) private view {
        if (ans <= 0 || startedAt == 0 || startedAt >= updatedAt || updatedAt > block.timestamp) revert BadAnswer();
    }
}

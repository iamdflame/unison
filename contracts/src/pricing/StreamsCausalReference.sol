// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ICausalReference} from "../interfaces/ICausalReference.sol";
import {AggregatorV3Interface} from "../interfaces/external/AggregatorV3Interface.sol";
import {IVerifierProxy} from "../interfaces/external/IVerifierProxy.sol";

/// @title StreamsCausalReference — Chainlink Data Streams reports, verified, stored, then read by observation time
/// @notice Data Streams is a pull oracle: anyone fetches a signed report from Chainlink and brings it on chain, where
///         `submit` checks the DON's signatures with Chainlink's verifier and stores the report under its observation
///         time. The exchange reads it through `readAfter`, a view, exactly as it reads the push adapter (SPEC §7.4).
///
///         Each report covers a window of oracle time, [validFromTimestamp, observationsTimestamp], and Chainlink builds
///         the windows contiguous: each starts the second after the previous one ended, at most one report per second,
///         and a gap widens the next window ("How report timestamps work", docs.chain.link). So exactly one report's
///         window holds the second after `afterSec`, and that report is the first observation made after `afterSec`:
///         its own observation is after it, its predecessor's is not. This is the push adapter's rule ("round r after
///         the seal, round r-1 not") with the predecessor read from the window, so whoever submits it chooses nothing.
///
///         The session comes from the report itself (`marketStatus`), not from a calendar: Chainlink marks regular
///         hours, the extended sessions of 24/5 US equities, closures and holidays. A report whose market status is
///         unknown, whose mid price is older than `maxMidAgeSec` while the market is open, or whose quote asset is off
///         its peg reads HALTED, and the exchange returns orders rather than trade on it.
///
///         There is no empty-payload path. A pull oracle cannot prove that no report exists, so a market whose reports
///         stop simply waits (the guardian can halt it, which returns every order). Reports keep coming while a market
///         is closed, so weekends are priced by the same rule, at a CLOSED status: call auctions bounded by their
///         observation, which the exchange clears without waiting for its call-auction cadence.
///
///         Verification is free on Monad today: its VerifierProxy has no fee manager. If Chainlink ever adds one,
///         `submit` reverts until a funded adapter replaces this one.
///
///         payload (readAfter): abi.encode(uint32 observationsTimestamp, uint80 quoteRound), naming the stored report
///         and the quote-feed round in force at its observation.
contract StreamsCausalReference is ICausalReference, Ownable2Step {
    struct Stream {
        bytes32 feedId; // Data Streams feed ID; its first two bytes are the report schema (3, 8 or 11)
        AggregatorV3Interface quote; // quote/USD push feed (zero = the quote token is USD)
        uint8 quoteFeedDecimals;
        uint8 quoteTokenDecimals;
        uint32 quoteMaxAgeSec; // the quote observation in force may be at most this much older than the report
        uint32 maxMidAgeSec; // open market, mid last updated longer ago than this before the report: HALTED (0 = off)
        uint32 maxLatestAgeSec; // `latest` serves only a report observed this recently
        uint16 depegBps; // quote asset more than this off $1 = HALTED (0 = no check)
        bool set;
    }

    struct Report {
        uint128 price; // USD per whole base token, 18 decimals (Data Streams' convention)
        uint32 validFrom; // first second of the report's window
        uint32 midAt; // when the mid was last updated, seconds (0 = the schema does not say)
        uint8 status; // IReferenceAdapter.Status
        bool set;
    }

    struct Quote {
        uint256 answer; // 0 = the quote token is USD
        bool usable; // fresh enough relative to the observation
    }

    IVerifierProxy public immutable verifier;

    mapping(uint256 => Stream) public streams; // marketId => stream
    mapping(bytes32 => bool) public known; // feedId => some market reads it
    mapping(bytes32 => mapping(uint32 => Report)) internal _reports; // feedId => observationsTimestamp => report
    mapping(bytes32 => uint32) public newestObservation; // feedId => newest stored observationsTimestamp

    event StreamSet(
        uint256 indexed marketId,
        bytes32 indexed feedId,
        address quote,
        uint8 quoteTokenDecimals,
        uint32 quoteMaxAgeSec,
        uint32 maxMidAgeSec,
        uint32 maxLatestAgeSec,
        uint16 depegBps
    );
    event ReportStored(
        bytes32 indexed feedId, uint32 indexed observedAt, uint32 validFrom, uint256 price, uint8 status, address by
    );

    error UnknownFeed();
    error UnsupportedSchema(uint16 schema);
    error BadReport();
    error NotSubmitted(); // the named report is not on chain yet: submit it first
    error NotAfterSeal(); // the named report was observed at or before the seal
    error NotFirstObservation(); // its window starts after the second following the seal: an earlier report exists
    error NeedsReport(); // empty payload: a pull oracle cannot prove that no report exists
    error StaleLatest(); // no report observed within maxLatestAgeSec is on chain
    error BadQuoteRound(); // the named quote round is not the one in force at the observation

    constructor(address owner_, IVerifierProxy verifier_) Ownable(owner_) {
        verifier = verifier_;
    }

    function setStream(
        uint256 marketId,
        bytes32 feedId,
        AggregatorV3Interface quote,
        uint8 quoteTokenDecimals,
        uint32 quoteMaxAgeSec,
        uint32 maxMidAgeSec,
        uint32 maxLatestAgeSec,
        uint16 depegBps
    ) external onlyOwner {
        uint16 schema = _schema(feedId);
        if (schema != 3 && schema != 8 && schema != 11) revert UnsupportedSchema(schema);
        if (maxLatestAgeSec == 0) revert BadReport();
        Stream storage s = streams[marketId];
        s.feedId = feedId;
        s.quote = quote;
        s.quoteFeedDecimals = address(quote) == address(0) ? 0 : quote.decimals();
        s.quoteTokenDecimals = quoteTokenDecimals;
        s.quoteMaxAgeSec = quoteMaxAgeSec;
        s.maxMidAgeSec = maxMidAgeSec;
        s.maxLatestAgeSec = maxLatestAgeSec;
        s.depegBps = depegBps;
        s.set = true;
        known[feedId] = true;
        emit StreamSet(
            marketId, feedId, address(quote), quoteTokenDecimals, quoteMaxAgeSec, maxMidAgeSec, maxLatestAgeSec, depegBps
        );
    }

    // ------------------------------------------------------------------ submit (permissionless)

    /// @notice Verifies a signed report with Chainlink's verifier and stores it under its observation time. Anyone may
    ///         submit; a report already stored is skipped without calling the verifier.
    /// @param signed the full report as the Data Streams API serves it (`fullReport`)
    function submit(bytes calldata signed) external returns (bytes32 feedId, uint32 observedAt) {
        (, bytes memory unverified,,,) = abi.decode(signed, (bytes32[3], bytes, bytes32[], bytes32[], bytes32));
        if (unverified.length < 3 * 32) revert BadReport();
        if (_reports[bytes32(_word(unverified, 0))][uint32(_word(unverified, 2))].set) {
            return (bytes32(_word(unverified, 0)), uint32(_word(unverified, 2)));
        }
        bytes memory report = verifier.verify(signed, abi.encode(address(0)));
        return _store(report);
    }

    function _store(bytes memory report) private returns (bytes32 feedId, uint32 observedAt) {
        if (report.length < 9 * 32) revert BadReport();
        feedId = bytes32(_word(report, 0));
        if (!known[feedId]) revert UnknownFeed();
        uint256 validFrom = _word(report, 1);
        uint256 obs = _word(report, 2);
        if (validFrom == 0 || validFrom > obs || obs > type(uint32).max) revert BadReport();
        observedAt = uint32(obs);
        (int256 px, Status st, uint256 midAtNs) = _decode(_schema(feedId), report);
        if (px <= 0 || uint256(px) > type(uint128).max) revert BadReport();
        Report storage r = _reports[feedId][observedAt];
        if (r.set) return (feedId, observedAt);
        r.price = uint128(uint256(px));
        r.validFrom = uint32(validFrom);
        r.midAt = uint32(Math.min(midAtNs / 1e9, type(uint32).max));
        r.status = uint8(st);
        r.set = true;
        if (observedAt > newestObservation[feedId]) newestObservation[feedId] = observedAt;
        emit ReportStored(feedId, observedAt, uint32(validFrom), uint256(px), uint8(st), msg.sender);
    }

    /// @dev Price, status and the mid's last update (ns) by schema. Words are read by position, so fields this adapter
    ///      does not use cannot make a report undecodable.
    function _decode(uint16 schema, bytes memory r) private pure returns (int256 px, Status st, uint256 midAtNs) {
        if (schema == 3) {
            // Crypto Advanced: ..., price, bid, ask. Crypto trades around the clock.
            px = int256(_word(r, 6));
            st = Status.OPEN;
        } else if (schema == 8) {
            // RWA Standard: ..., lastUpdateTimestamp (ns), midPrice, marketStatus (0 unknown, 1 closed, 2 open)
            midAtNs = _word(r, 6);
            px = int256(_word(r, 7));
            uint256 ms = _word(r, 8);
            st = ms == 2 ? Status.OPEN : ms == 1 ? Status.CLOSED : Status.HALTED;
        } else if (schema == 11) {
            // RWA Advanced: ..., mid, lastSeenTimestampNs, bid, bidVolume, ask, askVolume, lastTradedPrice, marketStatus.
            // 24/5 US equities: 1 pre-market, 2 regular, 3 post-market, 4 overnight, 5 closed; standard-hours feeds
            // use 2 and 5; 0 is unknown.
            if (r.length < 14 * 32) revert BadReport();
            px = int256(_word(r, 6));
            midAtNs = _word(r, 7);
            uint256 ms = _word(r, 13);
            st = ms == 2
                ? Status.OPEN
                : (ms == 1 || ms == 3 || ms == 4) ? Status.EXTENDED : ms == 5 ? Status.CLOSED : Status.HALTED;
        } else {
            revert UnsupportedSchema(schema);
        }
    }

    // ------------------------------------------------------------------ the exchange's reads

    /// @inheritdoc ICausalReference
    function readAfter(uint256 marketId, uint256 afterSec, bytes calldata payload)
        external
        view
        returns (uint256 price, uint256 observedAt, Status status, uint80 round)
    {
        Stream memory s = _stream(marketId);
        if (payload.length == 0) revert NeedsReport();
        (uint32 obs, uint80 q) = abi.decode(payload, (uint32, uint80));
        Report memory r = _reports[s.feedId][obs];
        if (!r.set) revert NotSubmitted();
        if (obs <= afterSec) revert NotAfterSeal();
        // the window holds the second after the seal, so the previous report was observed at or before the seal
        if (r.validFrom > afterSec + 1) revert NotFirstObservation();
        (price, status) = _price(s, r, obs, _quoteInForce(s, q, obs));
        return (price, obs, status, uint80(obs));
    }

    /// @inheritdoc ICausalReference
    /// @dev Reverts unless a report observed within `maxLatestAgeSec` is on chain, so an empty auction (a vault queue's)
    ///      cannot be run at a stale price somebody chose to bring.
    function latest(uint256 marketId)
        public
        view
        returns (uint256 price, uint256 observedAt, Status status, uint80 round)
    {
        Stream memory s = _stream(marketId);
        uint32 obs = newestObservation[s.feedId];
        Report memory r = _reports[s.feedId][obs];
        if (!r.set || block.timestamp > uint256(obs) + s.maxLatestAgeSec) revert StaleLatest();
        (price, status) = _price(s, r, obs, _latestQuote(s));
        return (price, obs, status, uint80(obs));
    }

    /// @notice The newest stored report in IReferenceAdapter form, for interfaces (the exchange calls `readAfter` and
    ///         `latest`); unlike `latest`, it does not require the report to be recent.
    function read(uint256 marketId, uint256, bytes calldata)
        external
        view
        returns (uint256 price, uint256 publishTimeMs, Status status)
    {
        Stream memory s = _stream(marketId);
        uint32 obs = newestObservation[s.feedId];
        Report memory r = _reports[s.feedId][obs];
        if (!r.set) revert NotSubmitted();
        (price, status) = _price(s, r, obs, _latestQuote(s));
        publishTimeMs = uint256(obs) * 1000;
    }

    /// @notice A stored report: price (18 decimals, USD), the first second of its window, when its mid was last
    ///         updated, and its status.
    function report(bytes32 feedId, uint32 observedAt) external view returns (Report memory) {
        return _reports[feedId][observedAt];
    }

    // ------------------------------------------------------------------ internals

    function _stream(uint256 marketId) private view returns (Stream memory s) {
        s = streams[marketId];
        if (!s.set) revert UnknownFeed();
    }

    /// @dev quote units per whole base token = USD price ÷ quote/USD; HALTED when the quote is stale or off its peg,
    ///      or when an open market's mid had stopped updating.
    function _price(Stream memory s, Report memory r, uint256 observedAt, Quote memory q)
        private
        pure
        returns (uint256 price, Status status)
    {
        status = Status(r.status);
        if (
            (status == Status.OPEN || status == Status.EXTENDED) && s.maxMidAgeSec != 0 && r.midAt != 0
                && observedAt > uint256(r.midAt) + s.maxMidAgeSec
        ) status = Status.HALTED;
        if (address(s.quote) == address(0)) {
            price = Math.mulDiv(r.price, 10 ** s.quoteTokenDecimals, 1e18);
        } else {
            price = Math.mulDiv(uint256(r.price) * 10 ** s.quoteTokenDecimals, 10 ** s.quoteFeedDecimals, q.answer * 1e18);
            if (!q.usable) status = Status.HALTED;
            if (s.depegBps != 0) {
                uint256 one = 10 ** s.quoteFeedDecimals;
                uint256 off = q.answer > one ? q.answer - one : one - q.answer;
                if (off * 10_000 > uint256(s.depegBps) * one) status = Status.HALTED;
            }
        }
        if (price == 0) revert BadReport();
    }

    /// @dev The quote round in force at `observedAt`: observed at or before it, its successor (if any) after it. The
    ///      same rule as ChainlinkCausalReference.
    function _quoteInForce(Stream memory s, uint80 q, uint256 observedAt) private view returns (Quote memory out) {
        if (address(s.quote) == address(0)) return out;
        (, int256 ans, uint256 qAt, uint256 arrivedAt,) = s.quote.getRoundData(q);
        if (ans <= 0 || qAt == 0 || qAt >= arrivedAt || qAt > observedAt) revert BadQuoteRound();
        try s.quote.getRoundData(q + 1) returns (uint80, int256, uint256 nextAt, uint256 nextArrived, uint80) {
            if (nextArrived != 0 && nextAt <= observedAt) revert BadQuoteRound();
        } catch {}
        out.answer = uint256(ans);
        out.usable = observedAt - qAt <= s.quoteMaxAgeSec;
    }

    function _latestQuote(Stream memory s) private view returns (Quote memory out) {
        if (address(s.quote) == address(0)) return out;
        (, int256 ans,, uint256 arrivedAt,) = s.quote.latestRoundData();
        if (ans <= 0 || arrivedAt > block.timestamp) revert BadQuoteRound();
        out.answer = uint256(ans);
        out.usable = block.timestamp - arrivedAt <= s.quoteMaxAgeSec;
    }

    function _schema(bytes32 feedId) private pure returns (uint16) {
        return uint16(uint256(feedId) >> 240);
    }

    /// @dev The i-th 32-byte word of `b`; callers check the length first.
    function _word(bytes memory b, uint256 i) private pure returns (uint256 w) {
        assembly ("memory-safe") {
            w := mload(add(add(b, 32), mul(i, 32)))
        }
    }
}

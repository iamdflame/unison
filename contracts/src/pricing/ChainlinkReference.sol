// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IReferenceAdapter} from "../interfaces/IReferenceAdapter.sol";
import {AggregatorV3Interface} from "../interfaces/external/AggregatorV3Interface.sol";
import {Session} from "./Session.sol";

/// @title ChainlinkReference — push-feed references for FX, metals and crypto markets (SPEC §7.3)
/// @notice price = base/USD feed, optionally divided by a quote/USD feed (e.g. AUSD/USD), in quote units per
///         whole base token. Status is OPEN inside the market's weekly session while the feed is fresh,
///         CLOSED otherwise — a stale weekend feed puts the market into DISCOVERY instead of trading on it.
///         Push feeds are public, so the reference time is the time of the clear itself.
contract ChainlinkReference is IReferenceAdapter, Ownable2Step {
    struct Feed {
        AggregatorV3Interface base; // base/USD
        AggregatorV3Interface quote; // quote/USD (optional; zero = quote is USD)
        uint8 baseDecimals;
        uint8 quoteFeedDecimals;
        uint8 quoteTokenDecimals;
        uint32 maxAgeSec;
        uint32 openSec;
        uint32 closeSec;
        bool set;
    }

    mapping(uint256 => Feed) public feeds;

    event FeedSet(
        uint256 indexed marketId, address base, address quote, uint8 quoteTokenDecimals, uint32 maxAgeSec, uint32 openSec, uint32 closeSec
    );

    error UnknownFeed();
    error BadAnswer();

    constructor(address owner_) Ownable(owner_) {}

    function setFeed(
        uint256 marketId,
        AggregatorV3Interface base,
        AggregatorV3Interface quote,
        uint8 quoteTokenDecimals,
        uint32 maxAgeSec,
        uint32 openSec,
        uint32 closeSec
    ) external onlyOwner {
        Feed storage f = feeds[marketId];
        f.base = base;
        f.quote = quote;
        f.baseDecimals = base.decimals();
        f.quoteFeedDecimals = address(quote) == address(0) ? 0 : quote.decimals();
        f.quoteTokenDecimals = quoteTokenDecimals;
        f.maxAgeSec = maxAgeSec;
        f.openSec = openSec;
        f.closeSec = closeSec;
        f.set = true;
        emit FeedSet(marketId, address(base), address(quote), quoteTokenDecimals, maxAgeSec, openSec, closeSec);
    }

    function read(uint256 marketId, uint256, bytes calldata)
        external
        view
        returns (uint256 price, uint256 publishTimeMs, Status status)
    {
        Feed memory f = feeds[marketId];
        if (!f.set) revert UnknownFeed();
        (uint256 b, uint256 bAt) = _answer(f.base);
        bool fresh = block.timestamp - bAt <= f.maxAgeSec;
        if (address(f.quote) == address(0)) {
            // base/USD with `baseDecimals` → quote units: b · 10^qd / 10^bd
            price = Math.mulDiv(b, 10 ** f.quoteTokenDecimals, 10 ** f.baseDecimals);
        } else {
            (uint256 q, uint256 qAt) = _answer(f.quote);
            fresh = fresh && block.timestamp - qAt <= f.maxAgeSec;
            // (b / 10^bd) / (q / 10^qfd) · 10^qd
            price = Math.mulDiv(b * 10 ** f.quoteTokenDecimals, 10 ** f.quoteFeedDecimals, q * 10 ** f.baseDecimals);
        }
        if (price == 0) revert BadAnswer();
        status = fresh && Session.isOpen(f.openSec, f.closeSec, block.timestamp) ? Status.OPEN : Status.CLOSED;
        publishTimeMs = block.timestamp * 1000;
    }

    function _answer(AggregatorV3Interface agg) private view returns (uint256, uint256) {
        (, int256 answer,, uint256 updatedAt,) = agg.latestRoundData();
        if (answer <= 0 || updatedAt == 0 || updatedAt > block.timestamp) revert BadAnswer();
        return (uint256(answer), updatedAt);
    }
}

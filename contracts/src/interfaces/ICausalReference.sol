// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IReferenceAdapter} from "./IReferenceAdapter.sol";

/// @title ICausalReference — a reference observed after the orders it prices (SPEC §7.4)
/// @notice An auction prices at the first oracle observation made strictly after its oldest order was sealed. The
///         observation time is the oracle's own signed time, never the chain's, and the feed's history proves which
///         observation is the first, so no keeper can choose the price.
interface ICausalReference is IReferenceAdapter {
    /// @notice The first observation of the market's feed made strictly after `afterSec` (unix seconds).
    /// @param payload abi.encode(uint80 baseRound, uint80 quoteRound) naming that observation and the quote-feed
    ///        round in force at it. Empty when no observation after `afterSec` exists yet and the market may clear
    ///        without one, because its session is closed or its feed is silent (a DISCOVERY call auction).
    /// @return price      quote units per whole base token
    /// @return observedAt the oracle's observation time, unix seconds
    /// @return status     session status at the observation; CLOSED on the empty-payload path; HALTED when the quote
    ///                    asset is off its peg
    /// @return round      the base-feed round used
    function readAfter(uint256 marketId, uint256 afterSec, bytes calldata payload)
        external
        view
        returns (uint256 price, uint256 observedAt, Status status, uint80 round);

    /// @notice The latest observation, for auctions with no orders waiting (vault queues) and for interfaces.
    function latest(uint256 marketId)
        external
        view
        returns (uint256 price, uint256 observedAt, Status status, uint80 round);
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @title IReferenceAdapter — source of the clearing reference price (SPEC §7)
interface IReferenceAdapter {
    /// @notice Primary-market session status for the asset.
    enum Status {
        OPEN, // regular session, reference is live
        EXTENDED, // pre/post-market session
        CLOSED, // reference market closed (nights, weekends, holidays)
        HALTED // primary-market trading halt (must be mirrored)
    }

    /// @notice Reads (and, for pull/signed adapters, verifies) the reference for `marketId`.
    /// @param marketId  Unison market id
    /// @param batch     newest batch (block number) the clear job covers; signed adapters bind to it so a
    ///                  keeper can never choose among several valid prices for the same auction
    /// @param payload   adapter-specific data (e.g. an operator signature); may be empty for push feeds
    /// @return price        quote units per one whole base token (10^baseDecimals base units)
    /// @return publishTimeMs publication time of the price, unix milliseconds
    /// @return status       session status of the reference market
    function read(uint256 marketId, uint256 batch, bytes calldata payload)
        external
        returns (uint256 price, uint256 publishTimeMs, Status status);
}

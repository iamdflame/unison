// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @title ICurveSource — programmatic liquidity merged into every auction (SPEC §4.3)
/// @notice A curve source (the LiquidityVault, a Designated Maker) quotes a parametric curve around the
///         reference: `perTick` base units at each of `ticks` consecutive ticks. Its inventory is its own
///         ledger balance on the venue; the venue caps the curve by that balance, merges it into the clearing
///         input and settles the source's fills atomically at the auction price (no fee).
interface ICurveSource {
    struct Curve {
        uint32 bidTop; // highest tick the source buys at (0 = no bids)
        uint32 bidTicks; // consecutive ticks downward from bidTop
        uint128 bidPerTick; // base units bid at each tick
        uint32 askBottom; // lowest tick the source sells at (0 = no asks)
        uint32 askTicks; // consecutive ticks upward from askBottom
        uint128 askPerTick; // base units offered at each tick
    }

    /// @notice The curve for one auction. Called with a gas cap; a revert means "no liquidity this auction".
    /// @param status reference status (IReferenceAdapter.Status) — sources widen/shrink by regime
    function curve(uint256 marketId, uint256 refPrice, uint8 status, uint256 refTick, uint256 lo, uint256 hi)
        external
        view
        returns (Curve memory);

    /// @notice Accounting hook after the source's fills were settled (gas-capped; failures are ignored).
    function onAuction(
        uint256 marketId,
        uint256 batch,
        uint256 price,
        uint256 refPrice,
        uint256 boughtBase,
        uint256 paidQuote,
        uint256 soldBase,
        uint256 receivedQuote
    ) external;
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @title OrderMath — lazy valuation of resting orders (SPEC §3.1–3.2)
/// @notice Given an order's entry snapshot (qty, epoch, S, A) and the level's current state, returns
///         how much base was filled and how much quote was exchanged since the snapshot. Receipts
///         round down, payments round up (protocol keeps the dust), so the venue is always solvent.
library OrderMath {
    uint256 internal constant S_SCALE = 1e27;
    uint256 internal constant A_TO_QUOTE = 1e9; // S_SCALE / 1e18

    struct Snapshot {
        uint256 qty; // remaining quantity at snapshot time (base units)
        uint256 epoch; // level epoch at snapshot
        uint256 survival; // level S at snapshot (scale 1e27)
        uint256 acc; // level A at snapshot (scale 1e18·price)
    }

    struct Valuation {
        uint256 filledFloor; // base units filled, rounded down (what a buyer receives)
        uint256 filledCeil; // base units filled, rounded up (what a seller delivers)
        uint256 quoteFloor; // quote exchanged, rounded down (what a seller receives)
        uint256 quoteCeil; // quote exchanged, rounded up (what a buyer pays)
        uint256 newQty; // remaining quantity after the valuation (= qty - filledCeil)
        bool closed; // the level's epoch advanced: order fully filled
    }

    /// @param o           order snapshot
    /// @param curEpoch    level epoch now
    /// @param curS        level survival now (only used if same epoch)
    /// @param curA        level accumulator now (only used if same epoch)
    /// @param finalA      level accumulator at the close of `o.epoch` (only used if epoch advanced)
    /// @param baseUnit    10^baseDecimals
    function value(
        Snapshot memory o,
        uint256 curEpoch,
        uint256 curS,
        uint256 curA,
        uint256 finalA,
        uint256 baseUnit
    ) internal pure returns (Valuation memory v) {
        if (o.qty == 0) return v;
        uint256 aEnd;
        if (curEpoch != o.epoch) {
            v.closed = true;
            v.filledFloor = o.qty;
            v.filledCeil = o.qty;
            v.newQty = 0;
            aEnd = finalA;
        } else {
            uint256 dS = o.survival - curS; // S only decreases within an epoch
            v.filledFloor = Math.mulDiv(o.qty, dS, o.survival, Math.Rounding.Floor);
            v.filledCeil = Math.mulDiv(o.qty, dS, o.survival, Math.Rounding.Ceil);
            v.newQty = o.qty - v.filledCeil;
            aEnd = curA;
        }
        uint256 dA = aEnd - o.acc; // A only increases within an epoch
        if (dA != 0) {
            // quote = qty · ΔA · 1e9 / (S_e · B)
            uint256 num = Math.mulDiv(o.qty, dA, o.survival, Math.Rounding.Floor);
            v.quoteFloor = Math.mulDiv(num, A_TO_QUOTE, baseUnit, Math.Rounding.Floor);
            uint256 numC = Math.mulDiv(o.qty, dA, o.survival, Math.Rounding.Ceil);
            v.quoteCeil = Math.mulDiv(numC, A_TO_QUOTE, baseUnit, Math.Rounding.Ceil);
        }
    }

    /// @notice Quote notional of `qty` base units at `price` (quote units per baseUnit), rounded up.
    function notionalCeil(uint256 qty, uint256 price, uint256 baseUnit) internal pure returns (uint256) {
        return Math.mulDiv(qty, price, baseUnit, Math.Rounding.Ceil);
    }

    /// @notice Quote notional of `qty` base units at `price`, rounded down.
    function notionalFloor(uint256 qty, uint256 price, uint256 baseUnit) internal pure returns (uint256) {
        return Math.mulDiv(qty, price, baseUnit, Math.Rounding.Floor);
    }
}

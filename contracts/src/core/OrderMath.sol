// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @title OrderMath — locks, fees and exact apportionment (SPEC §4, §5.4)
library OrderMath {
    uint256 internal constant BPS = 10_000;
    /// @dev Quote units of slack in every buy lock. Covers the per-order ceil roundings of the valuation
    ///      (≤ 3 units), so a buyer's total spend can never exceed its lock.
    uint256 internal constant LOCK_SLACK = 4;

    /// @notice Quote notional of `qty` base units at `price` (quote units per whole token), rounded up.
    function notionalCeil(uint256 qty, uint256 price, uint256 baseUnit) internal pure returns (uint256) {
        return Math.mulDiv(qty, price, baseUnit, Math.Rounding.Ceil);
    }

    /// @notice Fee on `amount` at `bps`, rounded up (protocol keeps the dust).
    function fee(uint256 amount, uint256 bps) internal pure returns (uint256) {
        return Math.mulDiv(amount, bps, BPS, Math.Rounding.Ceil);
    }

    /// @notice Quote locked by a buy: notional at the limit (ceil) + max fee on it (ceil) + slack.
    function buyLock(uint256 qty, uint256 limitPrice, uint256 maxFeeBps, uint256 baseUnit)
        internal
        pure
        returns (uint256)
    {
        uint256 n = notionalCeil(qty, limitPrice, baseUnit);
        return n + fee(n, maxFeeBps) + LOCK_SLACK;
    }

    /// @notice Exact cumulative apportionment: the share of a source with quantity `q`, visited after
    ///         sources totalling `before`, of `need` spread over a class totalling `classQ`.
    /// @dev    share = ⌊need·(before+q)/classQ⌋ − ⌊need·before/classQ⌋. Shares sum to exactly `need`
    ///         over the class, each share ≤ q (need ≤ classQ), and each is within one unit of pro-rata.
    function apportion(uint256 need, uint256 before, uint256 q, uint256 classQ) internal pure returns (uint256) {
        if (need == classQ) return q;
        return Math.mulDiv(need, before + q, classQ) - Math.mulDiv(need, before, classQ);
    }
}

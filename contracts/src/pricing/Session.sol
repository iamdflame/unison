// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @title Session — weekly trading windows in UTC (SPEC §6)
/// @notice A window is [openSec, closeSec) in seconds since Monday 00:00 UTC; it may wrap the week
///         (e.g. FX: Sun 22:00 → Fri 22:00 = [597_600, 424_800)). open == close means always open.
library Session {
    uint256 internal constant WEEK = 7 days;
    // Common windows (DST-agnostic; operators retune for summer time)
    uint32 internal constant FX_OPEN = 6 days + 22 hours; // Sun 22:00 UTC
    uint32 internal constant FX_CLOSE = 4 days + 22 hours; // Fri 22:00 UTC

    /// @notice Seconds since Monday 00:00 UTC (1970-01-01 was a Thursday).
    function weekSecond(uint256 ts) internal pure returns (uint256) {
        return ((ts / 1 days + 3) % 7) * 1 days + (ts % 1 days);
    }

    function isOpen(uint32 openSec, uint32 closeSec, uint256 ts) internal pure returns (bool) {
        if (openSec == closeSec) return true;
        uint256 w = weekSecond(ts);
        if (openSec < closeSec) return w >= openSec && w < closeSec;
        return w >= openSec || w < closeSec; // window wraps the week boundary
    }
}

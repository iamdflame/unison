// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @title IEligibility — participant standards for permissioned (TSV) markets (SPEC §8)
interface IEligibility {
    /// @notice True if `account` currently meets the venue's participant standards.
    function isEligible(address account) external view returns (bool);
}

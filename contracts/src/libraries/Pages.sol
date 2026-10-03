// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @title Pages — MIP-8 page-aligned raw storage helpers (SPEC §9)
/// @notice Monad warms storage per 128-slot page (slot >> 7). Laying related data out inside one
///         page makes the first access cost 8,100 gas and every other slot in the page 100 gas.
///         Keys are hashed into page-aligned bases so unrelated accounts/books never share a page,
///         which also keeps Monad's optimistic parallel executor free of write conflicts.
library Pages {
    uint256 internal constant PAGE_MASK = ~uint256(127);

    /// @notice Page-aligned base slot for an arbitrary key inside a namespace.
    function base(bytes32 ns, bytes32 key) internal pure returns (uint256) {
        return uint256(keccak256(abi.encode(ns, key))) & PAGE_MASK;
    }

    function base2(bytes32 ns, uint256 a, uint256 b) internal pure returns (uint256) {
        return uint256(keccak256(abi.encode(ns, a, b))) & PAGE_MASK;
    }

    function base4(bytes32 ns, uint256 a, uint256 b, uint256 c, uint256 d) internal pure returns (uint256) {
        return uint256(keccak256(abi.encode(ns, a, b, c, d))) & PAGE_MASK;
    }

    function base5(bytes32 ns, uint256 a, uint256 b, uint256 c, uint256 d, uint256 e)
        internal
        pure
        returns (uint256)
    {
        return uint256(keccak256(abi.encode(ns, a, b, c, d, e))) & PAGE_MASK;
    }

    /// @notice Non-paged unique slot (used for rarely-touched records such as epoch finals).
    function slot(bytes32 ns, bytes32 key) internal pure returns (uint256) {
        return uint256(keccak256(abi.encode(ns, key)));
    }

    function load(uint256 s) internal view returns (uint256 v) {
        assembly ("memory-safe") {
            v := sload(s)
        }
    }

    function store(uint256 s, uint256 v) internal {
        assembly ("memory-safe") {
            sstore(s, v)
        }
    }
}

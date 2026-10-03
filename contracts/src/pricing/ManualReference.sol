// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IReferenceAdapter} from "../interfaces/IReferenceAdapter.sol";

/// @title ManualReference — owner-posted reference prices (tests, demo replays, emergency fallback)
/// @notice Not for production pricing of real assets: use OperatorSignedReference / Chainlink / Pyth.
contract ManualReference is IReferenceAdapter, Ownable2Step {
    struct Ref {
        uint256 price;
        uint256 publishTimeMs;
        Status status;
    }

    mapping(uint256 => Ref) public refs;

    event ReferencePosted(uint256 indexed marketId, uint256 price, uint256 publishTimeMs, Status status);

    constructor(address owner_) Ownable(owner_) {}

    function post(uint256 marketId, uint256 price, uint256 publishTimeMs, Status status) external onlyOwner {
        refs[marketId] = Ref(price, publishTimeMs, status);
        emit ReferencePosted(marketId, price, publishTimeMs, status);
    }

    function read(uint256 marketId, bytes calldata) external view returns (uint256, uint256, Status) {
        Ref memory r = refs[marketId];
        return (r.price, r.publishTimeMs, r.status);
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IEligibility} from "../interfaces/IEligibility.sol";

/// @title EligibilityRouter — every eligibility rule must pass (SPEC §8.1)
/// @notice The venue's single eligibility oracle: an account is eligible only if EVERY source agrees —
///         e.g. a KYC attestation (AttestationEligibility) AND no issuer denylist hit (IssuerDenylistEligibility).
///         Contract accounts the venue itself relies on (liquidity vaults, the venue) can be exempted.
contract EligibilityRouter is IEligibility, Ownable2Step {
    IEligibility[] public sources;
    mapping(address => bool) public exempt;

    event SourceAdded(address source);
    event SourceRemoved(address source);
    event ExemptSet(address account, bool exempt);

    error TooManySources();

    constructor(address owner_) Ownable(owner_) {}

    function addSource(IEligibility s) external onlyOwner {
        if (sources.length >= 8) revert TooManySources();
        sources.push(s);
        emit SourceAdded(address(s));
    }

    function removeSource(uint256 i) external onlyOwner {
        emit SourceRemoved(address(sources[i]));
        sources[i] = sources[sources.length - 1];
        sources.pop();
    }

    function setExempt(address account, bool e) external onlyOwner {
        exempt[account] = e;
        emit ExemptSet(account, e);
    }

    function isEligible(address account) external view returns (bool) {
        if (exempt[account]) return true;
        for (uint256 i = 0; i < sources.length; ++i) {
            if (!sources[i].isEligible(account)) return false;
        }
        return true;
    }
}

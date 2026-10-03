// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IEligibility} from "../interfaces/IEligibility.sol";

/// @notice Issuer compliance contract exposing a denylist (e.g. Anchored aStocks' COMPLIANCE()).
interface IIssuerCompliance {
    function isDenylisted(address account) external view returns (bool);
}

/// @title IssuerDenylistEligibility — mirrors token issuers' denylists at every value movement (SPEC §8)
/// @notice Anchored aStocks transfer freely between non-denylisted addresses: issuer compliance is a denylist
///         enforced inside the token. Once assets sit in the venue ledger, the token can no longer see who trades
///         them — so the venue mirrors every issuer's denylist: an account denylisted by ANY listed issuer cannot
///         deposit/withdraw restricted tokens or trade on permissioned markets. Composable with attestation-based
///         eligibility (Cleanverse) via an EligibilityRouter.
contract IssuerDenylistEligibility is IEligibility, Ownable2Step {
    IIssuerCompliance[] public sources;

    event SourceAdded(address compliance);
    event SourceRemoved(address compliance);

    error TooManySources();

    constructor(address owner_) Ownable(owner_) {}

    function addSource(IIssuerCompliance c) external onlyOwner {
        if (sources.length >= 16) revert TooManySources();
        sources.push(c);
        emit SourceAdded(address(c));
    }

    function removeSource(uint256 i) external onlyOwner {
        emit SourceRemoved(address(sources[i]));
        sources[i] = sources[sources.length - 1];
        sources.pop();
    }

    function sourceCount() external view returns (uint256) {
        return sources.length;
    }

    function isEligible(address account) external view returns (bool) {
        for (uint256 i = 0; i < sources.length; ++i) {
            if (sources[i].isDenylisted(account)) return false;
        }
        return true;
    }
}

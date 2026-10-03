// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IEligibility} from "../interfaces/IEligibility.sol";

/// @title AttestationEligibility — KYC / investor-status attestations (Cleanverse A-Pass, SPEC §8.1)
/// @notice An attester (e.g. the Cleanverse attester service, after `verify_apass`) records that an account
///         passed identity checks: jurisdiction (ISO-3166 alpha-2), investor class and an expiry. The venue
///         admits an account while its attestation is unexpired, its jurisdiction is not blocked and its
///         class meets the minimum — e.g. Anchored aStocks: non-US professional investors only.
///         Only the outcome is stored on-chain; no personal data.
contract AttestationEligibility is IEligibility, AccessControl {
    bytes32 public constant ATTESTER_ROLE = keccak256("ATTESTER_ROLE");

    uint8 public constant CLASS_RETAIL = 1;
    uint8 public constant CLASS_PROFESSIONAL = 2;
    uint8 public constant CLASS_INSTITUTIONAL = 3;

    struct Attestation {
        uint64 expiry;
        bytes2 country;
        uint8 investorClass;
        bytes32 ref; // attester's reference (e.g. hash of the A-Pass id), for books & records
    }

    mapping(address => Attestation) public attestations;
    mapping(bytes2 => bool) public blockedCountry;
    uint8 public minClass;

    event Attested(address indexed account, uint64 expiry, bytes2 country, uint8 investorClass, bytes32 ref, address by);
    event Revoked(address indexed account, address by);
    event CountryBlocked(bytes2 country, bool blocked);
    event MinClassSet(uint8 minClass);

    error BadAttestation();

    constructor(address admin, uint8 minClass_) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ATTESTER_ROLE, admin);
        minClass = minClass_;
    }

    function attest(address account, uint64 expiry, bytes2 country, uint8 investorClass, bytes32 ref)
        public
        onlyRole(ATTESTER_ROLE)
    {
        if (account == address(0) || expiry <= block.timestamp || investorClass == 0) revert BadAttestation();
        attestations[account] = Attestation(expiry, country, investorClass, ref);
        emit Attested(account, expiry, country, investorClass, ref, msg.sender);
    }

    function revoke(address account) external onlyRole(ATTESTER_ROLE) {
        delete attestations[account];
        emit Revoked(account, msg.sender);
    }

    function setBlockedCountry(bytes2 country, bool blocked) external onlyRole(DEFAULT_ADMIN_ROLE) {
        blockedCountry[country] = blocked;
        emit CountryBlocked(country, blocked);
    }

    function setMinClass(uint8 c) external onlyRole(DEFAULT_ADMIN_ROLE) {
        minClass = c;
        emit MinClassSet(c);
    }

    function isEligible(address account) external view returns (bool) {
        Attestation memory a = attestations[account];
        return a.expiry > block.timestamp && !blockedCountry[a.country] && a.investorClass >= minClass;
    }
}

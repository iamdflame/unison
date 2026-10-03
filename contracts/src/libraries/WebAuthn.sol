// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {P256} from "@openzeppelin/contracts/utils/cryptography/P256.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";

/// @title WebAuthn — passkey assertion verification (after Daimo / Coinbase Smart Wallet's WebAuthnSol)
/// @notice Verifies a WebAuthn "get" assertion over `challenge` with a P-256 public key. P-256 verification uses
///         Monad's 0x0100 precompile through OpenZeppelin's P256 (with a Solidity fallback elsewhere).
///         Checks: clientDataJSON has `"type":"webauthn.get"` at `typeIndex` and `"challenge":"<b64url(challenge)>"`
///         at `challengeIndex`; authenticatorData has User Present (and User Verified if required);
///         signature is valid over sha256(authenticatorData ‖ sha256(clientDataJSON)), low-s.
library WebAuthn {
    struct Assertion {
        bytes authenticatorData;
        string clientDataJSON;
        uint256 challengeIndex;
        uint256 typeIndex;
        bytes32 r;
        bytes32 s;
    }

    bytes1 private constant FLAG_UP = 0x01;
    bytes1 private constant FLAG_UV = 0x04;
    bytes32 private constant TYPE_GET = keccak256('"type":"webauthn.get"');

    function verify(bytes memory challenge, bool requireUV, Assertion memory a, bytes32 qx, bytes32 qy)
        internal
        view
        returns (bool)
    {
        bytes memory cd = bytes(a.clientDataJSON);
        // "type":"webauthn.get"
        if (a.typeIndex + 21 > cd.length) return false;
        if (keccak256(_slice(cd, a.typeIndex, 21)) != TYPE_GET) return false;
        // "challenge":"<base64url>"
        bytes memory expected = abi.encodePacked('"challenge":"', Base64.encodeURL(challenge), '"');
        if (a.challengeIndex + expected.length > cd.length) return false;
        if (keccak256(_slice(cd, a.challengeIndex, expected.length)) != keccak256(expected)) return false;
        // authenticator flags (byte 32)
        if (a.authenticatorData.length < 37) return false;
        bytes1 flags = a.authenticatorData[32];
        if (flags & FLAG_UP != FLAG_UP) return false;
        if (requireUV && flags & FLAG_UV != FLAG_UV) return false;
        bytes32 message = sha256(abi.encodePacked(a.authenticatorData, sha256(cd)));
        return P256.verify(message, a.r, a.s, qx, qy);
    }

    function _slice(bytes memory b, uint256 start, uint256 len) private pure returns (bytes memory out) {
        out = new bytes(len);
        for (uint256 i = 0; i < len; ++i) out[i] = b[start + i];
    }
}

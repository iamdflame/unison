// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {OrderGateway, IGatewayVenue} from "../../src/access/OrderGateway.sol";
import {WebAuthn} from "../../src/libraries/WebAuthn.sol";

contract WebAuthnHarness {
    function verify(bytes32 digest, WebAuthn.Assertion memory a, bytes32 qx, bytes32 qy) external view returns (bool) {
        return WebAuthn.verify(abi.encodePacked(digest), true, a, qx, qy);
    }
}

/// @notice Known vectors shared with the TypeScript SDK (packages/sdk/test/passkey.test.ts): the SDK derives the same
///         passkey account as the gateway, and the assertion bytes it encodes (`encodePasskeyAssertion`, here for a
///         deterministic RFC 6979 signature by the passkey 0xBEEF) verify on-chain.
contract PasskeyVectorTest is Test {
    uint256 internal constant PASSKEY_PK = 0xBEEF;
    bytes32 internal constant QX = 0xf7631cc34b56c24b1758ae6867b23811c129c035fa67cc2a40c617bedb3c4b51;
    bytes32 internal constant QY = 0xdb6bdf29e488c62b18e938e5fb42eed65fa74ea4f3d53ebd35cf9b385374d042;
    address internal constant ACCOUNT = 0xD897a1ef65F292eA356dee820C7A4B419331Fd02;
    bytes32 internal constant DIGEST = keccak256("unison.sdk.passkey-vector");

    /// `encodePasskeyAssertion(...)` from the SDK: abi.encode(uint8 SIG_PASSKEY, abi.encode(WebAuthn.Assertion)).
    bytes internal constant SDK_SIG = hex"0000000000000000000000000000000000000000000000000000000000000002"
        hex"0000000000000000000000000000000000000000000000000000000000000040"
        hex"0000000000000000000000000000000000000000000000000000000000000200"
        hex"0000000000000000000000000000000000000000000000000000000000000020"
        hex"00000000000000000000000000000000000000000000000000000000000000c0"
        hex"0000000000000000000000000000000000000000000000000000000000000120"
        hex"0000000000000000000000000000000000000000000000000000000000000017"
        hex"0000000000000000000000000000000000000000000000000000000000000001"
        hex"cbe3967c8b999c0950cc6997e969a09139f61748f2c037b776eb8466793e9d15"
        hex"0a5d6763e5554fe91de52334cca052a95c0b0140878b3c0247ea9a74258a989e"
        hex"0000000000000000000000000000000000000000000000000000000000000025"
        hex"48627082047d5a725f5f8d7866d7ecb9ad098f0d6d3ad46919bb964855e38c58"
        hex"0500000001000000000000000000000000000000000000000000000000000000"
        hex"0000000000000000000000000000000000000000000000000000000000000085"
        hex"7b2274797065223a22776562617574686e2e676574222c226368616c6c656e67"
        hex"65223a2262583336686f555f554e36494d5569354c565662665f376e69456e34"
        hex"46546b4672746b3063682d724e4e51222c226f726967696e223a226874747073"
        hex"3a2f2f756e69736f6e2e7472616465222c2263726f73734f726967696e223a66"
        hex"616c73657d000000000000000000000000000000000000000000000000000000";

    function test_passkeyAccount_matchesSdk() public {
        (uint256 qx, uint256 qy) = vm.publicKeyP256(PASSKEY_PK);
        assertEq(bytes32(qx), QX, "qx");
        assertEq(bytes32(qy), QY, "qy");
        OrderGateway gw = new OrderGateway(IGatewayVenue(address(0)));
        assertEq(gw.passkeyAccount(QX, QY), ACCOUNT, "OrderGateway.passkeyAccount == SDK passkeyAccount");
    }

    function test_sdkEncodedAssertion_verifiesOnChain() public {
        (uint8 kind, bytes memory data) = abi.decode(SDK_SIG, (uint8, bytes));
        assertEq(kind, 2, "SIG_PASSKEY");
        WebAuthn.Assertion memory a = abi.decode(data, (WebAuthn.Assertion));
        assertEq(a.typeIndex, 1);
        assertEq(a.challengeIndex, 23);
        WebAuthnHarness h = new WebAuthnHarness();
        assertTrue(h.verify(DIGEST, a, QX, QY), "the gateway accepts the SDK's passkey assertion");
        assertFalse(h.verify(keccak256("another action"), a, QX, QY), "bound to its digest");
        (uint256 ox, uint256 oy) = vm.publicKeyP256(0xDEAD);
        assertFalse(h.verify(DIGEST, a, bytes32(ox), bytes32(oy)), "bound to its key");
    }
}

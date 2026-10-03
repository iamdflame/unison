// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {P256} from "@openzeppelin/contracts/utils/cryptography/P256.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {WebAuthn} from "../libraries/WebAuthn.sol";

interface IGatewayVenue {
    function placeOrderFor(address account, uint256 marketId, uint256 side, uint256 tick, uint256 qty, uint256 flags)
        external
        returns (uint256);
    function cancelOrderFor(address account, uint256 slotIdx) external;
    function withdrawFor(address account, address token, uint256 amount, address to) external;
    function marketPricing(uint256 marketId) external view returns (uint256 tickSize, uint256 baseUnit);
}

/// @title OrderGateway — signed, relayed order flow for humans, agents and passkeys (SPEC §8.3)
/// @notice Anyone may relay EIP-712-signed actions; the gateway verifies who authorized them:
///           SIG_ACCOUNT  the account itself — ECDSA for EOAs (incl. Mera passkey-derived keys) or ERC-1271
///           SIG_SESSION  a session key the account granted: may place and cancel within caps (markets, max
///                        qty, max notional, expiry), never withdraw — the safe way to hand an AI agent a budget
///           SIG_PASSKEY  a WebAuthn assertion from the account's registered P-256 passkey (Monad precompile):
///                        passkey-native accounts that never hold a seed phrase
///         Unordered nonces (Permit2-style bitmaps) and deadlines make every signature single-use.
contract OrderGateway is EIP712 {
    uint8 public constant SIG_ACCOUNT = 0;
    uint8 public constant SIG_SESSION = 1;
    uint8 public constant SIG_PASSKEY = 2;

    bytes32 public constant ORDER_TYPEHASH = keccak256(
        "Order(address account,uint256 marketId,uint8 side,uint32 tick,uint96 qty,uint8 flags,uint256 nonce,uint64 deadline)"
    );
    bytes32 public constant CANCEL_TYPEHASH =
        keccak256("Cancel(address account,uint256 slot,uint256 nonce,uint64 deadline)");
    bytes32 public constant WITHDRAW_TYPEHASH = keccak256(
        "Withdraw(address account,address token,uint256 amount,address to,uint256 nonce,uint64 deadline)"
    );
    bytes32 public constant SESSION_TYPEHASH = keccak256(
        "Session(address account,address key,uint64 expiry,uint96 maxQty,uint128 maxNotional,uint256 marketMask,uint256 nonce)"
    );

    struct Order {
        address account;
        uint256 marketId;
        uint8 side;
        uint32 tick;
        uint96 qty;
        uint8 flags;
        uint256 nonce;
        uint64 deadline;
    }

    struct Cancel {
        address account;
        uint256 slot;
        uint256 nonce;
        uint64 deadline;
    }

    struct Withdraw {
        address account;
        address token;
        uint256 amount;
        address to;
        uint256 nonce;
        uint64 deadline;
    }

    struct Session {
        address account;
        address key;
        uint64 expiry; // 0 = revoke
        uint96 maxQty;
        uint128 maxNotional; // quote units per order
        uint256 marketMask; // bit i = market i allowed (markets 0..255)
        uint256 nonce;
    }

    struct Grant {
        uint64 expiry;
        uint96 maxQty;
        uint128 maxNotional;
        uint256 marketMask;
    }

    struct Passkey {
        bytes32 qx;
        bytes32 qy;
    }

    IGatewayVenue public immutable venue;
    mapping(address => mapping(uint256 => uint256)) public nonceBitmap;
    mapping(address => mapping(address => Grant)) public sessions;
    mapping(address => Passkey) public passkeys;

    event Relayed(address indexed account, address indexed authorizedBy, uint8 kind, bytes32 action, uint256 ref);
    event RelayFailed(address indexed account, uint256 index, bytes reason);
    event SessionSet(address indexed account, address indexed key, Grant grant);
    event PasskeyRegistered(address indexed account, bytes32 qx, bytes32 qy);
    event NonceInvalidated(address indexed account, uint256 nonce);

    error Expired();
    error NonceUsed();
    error BadSignature();
    error SessionNotAllowed();
    error SessionExpired();
    error SessionCap();
    error UnknownPasskey();
    error LengthMismatch();

    constructor(IGatewayVenue venue_) EIP712("Unison Gateway", "1") {
        venue = venue_;
    }

    // ------------------------------------------------------------------ passkey accounts

    /// @notice Deterministic account address of a P-256 passkey.
    function passkeyAccount(bytes32 qx, bytes32 qy) public pure returns (address) {
        return address(uint160(uint256(keccak256(abi.encode("unison.passkey", qx, qy)))));
    }

    /// @notice Registers a passkey account (idempotent, permissionless: the address commits to the key).
    function registerPasskey(bytes32 qx, bytes32 qy) external returns (address account) {
        if (!P256.isValidPublicKey(qx, qy)) revert BadSignature();
        account = passkeyAccount(qx, qy);
        if (passkeys[account].qx == bytes32(0)) {
            passkeys[account] = Passkey(qx, qy);
            emit PasskeyRegistered(account, qx, qy);
        }
    }

    // ------------------------------------------------------------------ session keys

    function grantSession(address key, uint64 expiry, uint96 maxQty, uint128 maxNotional, uint256 marketMask) external {
        _setSession(msg.sender, key, Grant(expiry, maxQty, maxNotional, marketMask));
    }

    /// @notice Grants (or revokes, expiry = 0) a session key with a signature from the account (EOA, ERC-1271
    ///         or passkey — never another session key).
    function grantSessionSigned(Session calldata s, bytes calldata sig) external {
        bytes32 digest = _hashTypedDataV4(
            keccak256(
                abi.encode(
                    SESSION_TYPEHASH, s.account, s.key, s.expiry, s.maxQty, s.maxNotional, s.marketMask, s.nonce
                )
            )
        );
        _useNonce(s.account, s.nonce);
        _authorize(s.account, digest, sig, false);
        _setSession(s.account, s.key, Grant(s.expiry, s.maxQty, s.maxNotional, s.marketMask));
    }

    function _setSession(address account, address key, Grant memory g) private {
        sessions[account][key] = g;
        emit SessionSet(account, key, g);
    }

    // ------------------------------------------------------------------ actions

    function place(Order calldata o, bytes calldata sig) public returns (uint256 slot) {
        if (block.timestamp > o.deadline) revert Expired();
        bytes32 digest = orderDigest(o);
        _useNonce(o.account, o.nonce);
        (address by, uint8 kind) = _authorize(o.account, digest, sig, true);
        if (kind == SIG_SESSION) _checkSessionCaps(o, by);
        slot = venue.placeOrderFor(o.account, o.marketId, o.side, o.tick, o.qty, o.flags);
        emit Relayed(o.account, by, kind, "place", slot);
    }

    /// @notice Relays many orders; a failing order is skipped (event) instead of reverting the batch.
    function placeBatch(Order[] calldata os, bytes[] calldata sigs) external returns (uint256[] memory slots) {
        if (os.length != sigs.length) revert LengthMismatch();
        slots = new uint256[](os.length);
        for (uint256 i = 0; i < os.length; ++i) {
            try this.place(os[i], sigs[i]) returns (uint256 s) {
                slots[i] = s;
            } catch (bytes memory reason) {
                slots[i] = type(uint256).max;
                emit RelayFailed(os[i].account, i, reason);
            }
        }
    }

    function cancel(Cancel calldata c, bytes calldata sig) external {
        if (block.timestamp > c.deadline) revert Expired();
        bytes32 digest =
            _hashTypedDataV4(keccak256(abi.encode(CANCEL_TYPEHASH, c.account, c.slot, c.nonce, c.deadline)));
        _useNonce(c.account, c.nonce);
        (address by, uint8 kind) = _authorize(c.account, digest, sig, true);
        if (kind == SIG_SESSION && sessions[c.account][by].expiry < block.timestamp) revert SessionExpired();
        venue.cancelOrderFor(c.account, c.slot);
        emit Relayed(c.account, by, kind, "cancel", c.slot);
    }

    /// @notice Withdrawals require the account itself (EOA / ERC-1271 / passkey) — session keys cannot move funds.
    function withdraw(Withdraw calldata w, bytes calldata sig) external {
        if (block.timestamp > w.deadline) revert Expired();
        bytes32 digest = _hashTypedDataV4(
            keccak256(abi.encode(WITHDRAW_TYPEHASH, w.account, w.token, w.amount, w.to, w.nonce, w.deadline))
        );
        _useNonce(w.account, w.nonce);
        (address by, uint8 kind) = _authorize(w.account, digest, sig, false);
        venue.withdrawFor(w.account, w.token, w.amount, w.to);
        emit Relayed(w.account, by, kind, "withdraw", w.amount);
    }

    function invalidateNonce(uint256 nonce) external {
        _useNonce(msg.sender, nonce);
        emit NonceInvalidated(msg.sender, nonce);
    }

    // ------------------------------------------------------------------ verification

    function orderDigest(Order calldata o) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(ORDER_TYPEHASH, o.account, o.marketId, o.side, o.tick, o.qty, o.flags, o.nonce, o.deadline)
            )
        );
    }

    function nonceUsed(address account, uint256 nonce) external view returns (bool) {
        return nonceBitmap[account][nonce >> 8] & (1 << (nonce & 0xff)) != 0;
    }

    function _useNonce(address account, uint256 nonce) private {
        uint256 word = nonce >> 8;
        uint256 bit = 1 << (nonce & 0xff);
        uint256 w = nonceBitmap[account][word];
        if (w & bit != 0) revert NonceUsed();
        nonceBitmap[account][word] = w | bit;
    }

    /// @dev sig = abi.encode(uint8 kind, bytes data). Returns the authorizing key and the kind.
    function _authorize(address account, bytes32 digest, bytes calldata sig, bool sessionOk)
        private
        view
        returns (address by, uint8 kind)
    {
        bytes memory data;
        (kind, data) = abi.decode(sig, (uint8, bytes));
        if (kind == SIG_ACCOUNT) {
            if (!SignatureChecker.isValidSignatureNow(account, digest, data)) revert BadSignature();
            return (account, kind);
        }
        if (kind == SIG_SESSION) {
            if (!sessionOk) revert SessionNotAllowed();
            (address key, bytes memory ks) = abi.decode(data, (address, bytes));
            (address rec, ECDSA.RecoverError err,) = ECDSA.tryRecover(digest, ks);
            if (err != ECDSA.RecoverError.NoError || rec != key || key == address(0)) revert BadSignature();
            return (key, kind);
        }
        if (kind == SIG_PASSKEY) {
            Passkey memory p = passkeys[account];
            if (p.qx == bytes32(0)) revert UnknownPasskey();
            WebAuthn.Assertion memory a = abi.decode(data, (WebAuthn.Assertion));
            if (!WebAuthn.verify(abi.encodePacked(digest), true, a, p.qx, p.qy)) revert BadSignature();
            return (account, kind);
        }
        revert BadSignature();
    }

    function _checkSessionCaps(Order calldata o, address key) private view {
        Grant memory g = sessions[o.account][key];
        if (g.expiry < block.timestamp) revert SessionExpired();
        if (o.marketId > 255 || (g.marketMask >> o.marketId) & 1 == 0) revert SessionCap();
        if (o.qty > g.maxQty) revert SessionCap();
        (uint256 tickSize, uint256 baseUnit) = venue.marketPricing(o.marketId);
        if (Math.mulDiv(o.qty, uint256(o.tick) * tickSize, baseUnit) > g.maxNotional) revert SessionCap();
    }
}

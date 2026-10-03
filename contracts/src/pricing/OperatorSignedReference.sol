// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {P256} from "@openzeppelin/contracts/utils/cryptography/P256.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IReferenceAdapter} from "../interfaces/IReferenceAdapter.sol";

/// @title OperatorSignedReference — bonded, quorum-signed reference prices bound to one batch (SPEC §7.2)
/// @notice The equity reference for markets whose primary data is licensed off-chain. Relays sign
///         EIP-712 `Reference(venue, marketId, batch, price, publishTimeMs, status)`:
///           * bound to the venue and to the exact batch being cleared → no keeper can choose among prices
///           * freshness window + monotonic publish time per market → no replay of older prices
///           * k-of-n quorum over secp256k1 and/or P-256 keys (P-256 via Monad's 0x0100 precompile, so
///             relay keys can live in cloud HSMs / secure enclaves)
///           * every signer posts a bond; the CRE reference audit (SLASHER_ROLE) slashes provable deviations
contract OperatorSignedReference is IReferenceAdapter, AccessControl, EIP712 {
    using SafeERC20 for IERC20;

    bytes32 public constant SIGNER_ADMIN_ROLE = keccak256("SIGNER_ADMIN_ROLE");
    bytes32 public constant SLASHER_ROLE = keccak256("SLASHER_ROLE");
    bytes32 public constant REFERENCE_TYPEHASH = keccak256(
        "Reference(address venue,uint256 marketId,uint256 batch,uint256 price,uint64 publishTimeMs,uint8 status)"
    );

    uint8 public constant KIND_ECDSA = 0;
    uint8 public constant KIND_P256 = 1;
    uint256 public constant MAX_SIGNERS = 32;
    uint256 public constant MAX_FUTURE_MS = 2_000;
    uint256 public constant UNBOND_DELAY = 7 days;

    struct Signer {
        uint8 kind;
        bool active;
        address addr; // ECDSA
        bytes32 qx; // P-256 public key
        bytes32 qy;
        uint256 bond;
        uint256 unbondAmount;
        uint64 unbondAt;
    }

    struct Sig {
        uint8 signerId;
        uint8 v; // ECDSA only
        bytes32 r;
        bytes32 s;
    }

    /// @notice Payload format of `read`: abi.encode(Report).
    struct Report {
        uint256 price;
        uint64 publishTimeMs;
        uint8 status;
        Sig[] sigs;
    }

    struct Last {
        uint256 price;
        uint64 publishTimeMs;
        uint64 batch;
        uint8 status;
    }

    address public immutable venue;
    IERC20 public immutable bondToken;
    uint8 public quorum;
    uint32 public maxAgeMs;
    Signer[] internal _signers;
    mapping(uint256 => Last) public last;

    event SignerAdded(uint256 indexed id, uint8 kind, address addr, bytes32 qx, bytes32 qy);
    event SignerActive(uint256 indexed id, bool active);
    event ConfigSet(uint8 quorum, uint32 maxAgeMs);
    event Bonded(uint256 indexed id, address indexed from, uint256 amount);
    event UnbondRequested(uint256 indexed id, uint256 amount, uint64 at);
    event Unbonded(uint256 indexed id, address indexed to, uint256 amount);
    event Slashed(uint256 indexed id, uint256 amount, address indexed to, bytes32 reason);
    event ReferenceAccepted(
        uint256 indexed marketId, uint256 indexed batch, uint256 price, uint64 publishTimeMs, uint8 status, uint256 signers
    );

    error NotVenue();
    error BadConfig();
    error TooManySigners();
    error UnknownSigner();
    error InactiveSigner();
    error DuplicateSigner();
    error BadSignature();
    error QuorumNotMet();
    error StaleReport();
    error FutureReport();
    error NonMonotonic();
    error BadStatus();
    error ZeroPrice();
    error UnbondNotReady();

    constructor(address admin, address venue_, IERC20 bondToken_, uint8 quorum_, uint32 maxAgeMs_)
        EIP712("Unison Reference", "1")
    {
        if (venue_ == address(0) || quorum_ == 0 || maxAgeMs_ == 0) revert BadConfig();
        venue = venue_;
        bondToken = bondToken_;
        quorum = quorum_;
        maxAgeMs = maxAgeMs_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(SIGNER_ADMIN_ROLE, admin);
        emit ConfigSet(quorum_, maxAgeMs_);
    }

    // ------------------------------------------------------------------ IReferenceAdapter

    function read(uint256 marketId, uint256 batch, bytes calldata payload)
        external
        returns (uint256, uint256, Status)
    {
        if (msg.sender != venue) revert NotVenue();
        Report memory rep = abi.decode(payload, (Report));
        if (rep.status > uint8(Status.HALTED)) revert BadStatus();
        if (rep.price == 0) revert ZeroPrice();
        uint256 nowMs = block.timestamp * 1000;
        if (rep.publishTimeMs > nowMs + MAX_FUTURE_MS) revert FutureReport();
        if (uint256(rep.publishTimeMs) + maxAgeMs < nowMs) revert StaleReport();
        Last storage l = last[marketId];
        if (rep.publishTimeMs < l.publishTimeMs) revert NonMonotonic();

        uint256 seen = _verify(digestOf(marketId, batch, rep.price, rep.publishTimeMs, rep.status), rep.sigs);

        l.price = rep.price;
        l.publishTimeMs = rep.publishTimeMs;
        l.batch = uint64(batch);
        l.status = rep.status;
        emit ReferenceAccepted(marketId, batch, rep.price, rep.publishTimeMs, rep.status, seen);
        return (rep.price, rep.publishTimeMs, Status(rep.status));
    }

    /// @notice EIP-712 digest a relay signs for one batch of one market.
    function digestOf(uint256 marketId, uint256 batch, uint256 price, uint64 publishTimeMs, uint8 status)
        public
        view
        returns (bytes32)
    {
        return _hashTypedDataV4(
            keccak256(abi.encode(REFERENCE_TYPEHASH, venue, marketId, batch, price, publishTimeMs, status))
        );
    }

    function _verify(bytes32 digest, Sig[] memory sigs) internal view returns (uint256 seen) {
        uint256 ok;
        uint256 n = _signers.length;
        for (uint256 i = 0; i < sigs.length; ++i) {
            Sig memory sg = sigs[i];
            if (sg.signerId >= n) revert UnknownSigner();
            uint256 bit = 1 << sg.signerId;
            if (seen & bit != 0) revert DuplicateSigner();
            seen |= bit;
            Signer storage s = _signers[sg.signerId];
            if (!s.active) revert InactiveSigner();
            bool valid;
            if (s.kind == KIND_ECDSA) {
                (address rec, ECDSA.RecoverError err,) = ECDSA.tryRecover(digest, sg.v, sg.r, sg.s);
                valid = err == ECDSA.RecoverError.NoError && rec == s.addr;
            } else {
                valid = P256.verify(digest, sg.r, sg.s, s.qx, s.qy);
            }
            if (!valid) revert BadSignature();
            ++ok;
        }
        if (ok < quorum) revert QuorumNotMet();
    }

    // ------------------------------------------------------------------ signers & config

    function addEcdsaSigner(address addr) external onlyRole(SIGNER_ADMIN_ROLE) returns (uint256 id) {
        if (addr == address(0)) revert BadConfig();
        id = _push(Signer(KIND_ECDSA, true, addr, 0, 0, 0, 0, 0));
        emit SignerAdded(id, KIND_ECDSA, addr, 0, 0);
    }

    function addP256Signer(bytes32 qx, bytes32 qy) external onlyRole(SIGNER_ADMIN_ROLE) returns (uint256 id) {
        if (!P256.isValidPublicKey(qx, qy)) revert BadConfig();
        id = _push(Signer(KIND_P256, true, address(0), qx, qy, 0, 0, 0));
        emit SignerAdded(id, KIND_P256, address(0), qx, qy);
    }

    function _push(Signer memory s) private returns (uint256 id) {
        if (_signers.length >= MAX_SIGNERS) revert TooManySigners();
        _signers.push(s);
        return _signers.length - 1;
    }

    function setSignerActive(uint256 id, bool active) external onlyRole(SIGNER_ADMIN_ROLE) {
        _signer(id).active = active;
        emit SignerActive(id, active);
    }

    function setConfig(uint8 quorum_, uint32 maxAgeMs_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (quorum_ == 0 || maxAgeMs_ == 0) revert BadConfig();
        quorum = quorum_;
        maxAgeMs = maxAgeMs_;
        emit ConfigSet(quorum_, maxAgeMs_);
    }

    function signer(uint256 id) external view returns (Signer memory) {
        return _signer(id);
    }

    function signerCount() external view returns (uint256) {
        return _signers.length;
    }

    function _signer(uint256 id) private view returns (Signer storage) {
        if (id >= _signers.length) revert UnknownSigner();
        return _signers[id];
    }

    // ------------------------------------------------------------------ bonds

    /// @notice Anyone may top up a signer's bond.
    function bond(uint256 id, uint256 amount) external {
        Signer storage s = _signer(id);
        bondToken.safeTransferFrom(msg.sender, address(this), amount);
        s.bond += amount;
        emit Bonded(id, msg.sender, amount);
    }

    /// @notice Starts the unbonding delay; slashing stays possible until the bond actually leaves.
    function requestUnbond(uint256 id, uint256 amount) external onlyRole(SIGNER_ADMIN_ROLE) {
        Signer storage s = _signer(id);
        if (amount > s.bond) revert BadConfig();
        s.unbondAmount = amount;
        s.unbondAt = uint64(block.timestamp + UNBOND_DELAY);
        emit UnbondRequested(id, amount, s.unbondAt);
    }

    function unbond(uint256 id, address to) external onlyRole(SIGNER_ADMIN_ROLE) {
        Signer storage s = _signer(id);
        if (s.unbondAt == 0 || block.timestamp < s.unbondAt) revert UnbondNotReady();
        uint256 amt = s.unbondAmount < s.bond ? s.unbondAmount : s.bond;
        s.bond -= amt;
        s.unbondAmount = 0;
        s.unbondAt = 0;
        bondToken.safeTransfer(to, amt);
        emit Unbonded(id, to, amt);
    }

    /// @notice Slashes a signer (called by the CRE reference-audit receiver on a proven deviation).
    function slash(uint256 id, uint256 amount, address to, bytes32 reason)
        external
        onlyRole(SLASHER_ROLE)
        returns (uint256 amt)
    {
        Signer storage s = _signer(id);
        amt = amount < s.bond ? amount : s.bond;
        s.bond -= amt;
        bondToken.safeTransfer(to, amt);
        emit Slashed(id, amt, to, reason);
    }
}

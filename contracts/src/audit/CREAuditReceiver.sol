// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

/// @notice Chainlink CRE receiver interface (KeystoneForwarder calls onReport).
interface IReceiver is IERC165 {
    function onReport(bytes calldata metadata, bytes calldata report) external;
}

interface IUnisonOps {
    function setHalt(uint256 marketId, bool halted) external;
    function setDailyCap(uint256 marketId, uint128 dailyCap) external;
}

interface IOperatorReference {
    function last(uint256 marketId)
        external
        view
        returns (uint256 price, uint64 publishTimeMs, uint64 batch, uint8 status);
    function slash(uint256 id, uint256 amount, address to, bytes32 reason) external returns (uint256);
}

/// @title CREAuditReceiver — Chainlink CRE workflows as Unison's independent control plane (SPEC §7, §8)
/// @notice Consensus reports from a Chainlink DON (via the KeystoneForwarder) drive three controls:
///           AUDIT  the DON's median of independent sources vs the operator-signed reference the venue used;
///                  beyond `maxDeviationBps` the market halts and the signer's bond is slashed
///           CAPS   daily TSV volume caps written from ADV (percent of ADV per LULD tier)
///           HALT   mirrored primary-market halts (and their lifting)
///         Only the forwarder may call, and only for reports from the allowed workflow owner.
contract CREAuditReceiver is IReceiver, AccessControl {
    uint8 public constant KIND_AUDIT = 1;
    uint8 public constant KIND_CAPS = 2;
    uint8 public constant KIND_HALT = 3;

    IUnisonOps public immutable venue;
    IOperatorReference public immutable operatorRef;
    address public forwarder;
    address public workflowOwner;
    uint16 public maxDeviationBps;
    uint256 public slashAmount;
    address public insurance;

    event Audited(
        uint256 indexed marketId, uint256 auditedPrice, uint256 operatorPrice, uint64 operatorPublishMs, uint256 deviationBps
    );
    event DeviationHalt(uint256 indexed marketId, uint8 signerId, uint256 deviationBps, uint256 slashed);
    event CapsWritten(uint256 count);
    event HaltMirrored(uint256 indexed marketId, bool halted, bytes32 reason);
    event ConfigSet(address forwarder, address workflowOwner, uint16 maxDeviationBps, uint256 slashAmount, address insurance);

    error NotForwarder();
    error WrongWorkflow();
    error UnknownKind(uint8 kind);
    error StaleAudit();
    error LengthMismatch();

    constructor(
        address admin,
        IUnisonOps venue_,
        IOperatorReference reference_,
        address forwarder_,
        address workflowOwner_,
        uint16 maxDeviationBps_,
        uint256 slashAmount_,
        address insurance_
    ) {
        venue = venue_;
        operatorRef = reference_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _setConfig(forwarder_, workflowOwner_, maxDeviationBps_, slashAmount_, insurance_);
    }

    function setConfig(address f, address owner, uint16 dev, uint256 slash, address ins)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        _setConfig(f, owner, dev, slash, ins);
    }

    function _setConfig(address f, address owner, uint16 dev, uint256 slash, address ins) private {
        forwarder = f;
        workflowOwner = owner;
        maxDeviationBps = dev;
        slashAmount = slash;
        insurance = ins;
        emit ConfigSet(f, owner, dev, slash, ins);
    }

    /// @inheritdoc IReceiver
    function onReport(bytes calldata metadata, bytes calldata report) external {
        if (msg.sender != forwarder) revert NotForwarder();
        if (_owner(metadata) != workflowOwner) revert WrongWorkflow();
        (uint8 kind, bytes memory data) = abi.decode(report, (uint8, bytes));
        if (kind == KIND_AUDIT) _audit(data);
        else if (kind == KIND_CAPS) _caps(data);
        else if (kind == KIND_HALT) _halt(data);
        else revert UnknownKind(kind);
    }

    /// @dev data = abi.encode(marketId, auditedPrice, operatorPublishMs, signerId)
    function _audit(bytes memory data) private {
        (uint256 marketId, uint256 audited, uint64 operatorPublishMs, uint8 signerId) =
            abi.decode(data, (uint256, uint256, uint64, uint8));
        (uint256 opPrice, uint64 opMs,,) = operatorRef.last(marketId);
        // the DON audited the reference the venue is using right now (not an older one)
        if (opMs != operatorPublishMs) revert StaleAudit();
        uint256 diff = opPrice > audited ? opPrice - audited : audited - opPrice;
        uint256 devBps = audited == 0 ? type(uint256).max : (diff * 10_000) / audited;
        emit Audited(marketId, audited, opPrice, opMs, devBps);
        if (devBps > maxDeviationBps) {
            venue.setHalt(marketId, true);
            uint256 slashed = slashAmount == 0
                ? 0
                : operatorRef.slash(signerId, slashAmount, insurance, keccak256(abi.encode("deviation", marketId, opMs)));
            emit DeviationHalt(marketId, signerId, devBps, slashed);
        }
    }

    /// @dev data = abi.encode(uint256[] marketIds, uint128[] caps)
    function _caps(bytes memory data) private {
        (uint256[] memory ids, uint128[] memory caps) = abi.decode(data, (uint256[], uint128[]));
        if (ids.length != caps.length) revert LengthMismatch();
        for (uint256 i = 0; i < ids.length; ++i) venue.setDailyCap(ids[i], caps[i]);
        emit CapsWritten(ids.length);
    }

    /// @dev data = abi.encode(marketId, halted, reason)
    function _halt(bytes memory data) private {
        (uint256 marketId, bool halted, bytes32 reason) = abi.decode(data, (uint256, bool, bytes32));
        venue.setHalt(marketId, halted);
        emit HaltMirrored(marketId, halted, reason);
    }

    /// @dev CRE metadata = workflowId (32) ‖ workflowName (10) ‖ workflowOwner (20).
    function _owner(bytes calldata metadata) private pure returns (address o) {
        if (metadata.length < 62) return address(0);
        o = address(bytes20(metadata[42:62]));
    }

    function supportsInterface(bytes4 id) public view override(AccessControl, IERC165) returns (bool) {
        return id == type(IReceiver).interfaceId || super.supportsInterface(id);
    }
}

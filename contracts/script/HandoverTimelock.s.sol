// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script, console} from "forge-std/Script.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {UnisonExchange} from "../src/core/UnisonExchange.sol";
import {LiquidityVault} from "../src/liquidity/LiquidityVault.sol";

/// @notice Puts every power over prices and balances behind a public delay. After this script:
///   - a TimelockController holds the exchange's admin and operator roles (upgrades, markets, adapters, the causal
///     switch), every vault's admin and risk roles, the unused operator reference's roles, and (48 h later) the
///     reference adapters and the issuer-denylist mirror;
///   - proposals come from TIMELOCK_PROPOSER (the owner's wallet), anyone may execute a ready one, and the guardian
///     may cancel one;
///   - the guardian keeps pause, halt and daily caps: none of them can move a balance or set a price;
///   - the deployer key holds nothing.
/// The delay starts at 48 h. One operation is scheduled here, executable by anyone once 48 h have passed: the timelock
/// accepts the adapters' and the mirror's ownership (Ownable2Step) and raises its own delay to 7 days.
///
///   DEPLOYER_PRIVATE_KEY=0x… DEPLOYMENT=../deployments/monad-mainnet.json TIMELOCK_PROPOSER=0x… \
///   forge script script/HandoverTimelock.s.sol --rpc-url https://rpc.monad.xyz --broadcast --slow
///
/// Output: ../deployments/<label>-timelock.json (or <TIMELOCK_OUT>.json): the timelock, the scheduled operation and when
///         it becomes executable, with its calls, so anyone can execute it.
contract HandoverTimelock is Script {
    uint256 internal constant DELAY = 48 hours;
    uint256 internal constant FINAL_DELAY = 7 days;
    bytes32 internal constant SALT = keccak256("unison.timelock.handover");

    string internal dep;

    function run() external {
        dep = vm.readFile(vm.envOr("DEPLOYMENT", string("../deployments/monad-mainnet.json")));
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address me = vm.addr(pk);
        address proposer = vm.envAddress("TIMELOCK_PROPOSER");
        address guardian = vm.parseJsonAddress(dep, ".guardian");
        UnisonExchange ex = UnisonExchange(vm.parseJsonAddress(dep, ".exchange"));
        require(ex.hasRole(ex.DEFAULT_ADMIN_ROLE(), me), "the deployer is not the exchange's admin");
        require(proposer != me && proposer != address(0), "the proposer must be the owner's own wallet");
        address[] memory vaults = _vaults();
        address[] memory owned = _ownable();

        vm.startBroadcast(pk);
        address[] memory proposers = new address[](2);
        proposers[0] = proposer;
        proposers[1] = me; // for the one operation below; revoked before the end of this script
        address[] memory executors = new address[](1); // address(0): anyone executes a ready operation
        TimelockController tl = new TimelockController(DELAY, proposers, executors, me);
        tl.grantRole(tl.CANCELLER_ROLE(), guardian);

        // the exchange: upgrades and every market and adapter setting behind the delay; pause, halt, caps with the guardian
        ex.grantRole(ex.DEFAULT_ADMIN_ROLE(), address(tl));
        ex.grantRole(ex.OPERATOR_ROLE(), address(tl));
        if (!ex.hasRole(ex.GUARDIAN_ROLE(), guardian)) ex.grantRole(ex.GUARDIAN_ROLE(), guardian);
        if (!ex.hasRole(ex.HALT_ROLE(), guardian)) ex.grantRole(ex.HALT_ROLE(), guardian);
        if (!ex.hasRole(ex.CAP_ROLE(), guardian)) ex.grantRole(ex.CAP_ROLE(), guardian);
        _renounceAll(IAccessControl(address(ex)), me, _exchangeRoles(ex));

        // the vaults' parameters (spread, depth, pause) and the unused operator reference's signer set
        for (uint256 i = 0; i < vaults.length; ++i) {
            LiquidityVault v = LiquidityVault(vaults[i]);
            v.grantRole(v.DEFAULT_ADMIN_ROLE(), address(tl));
            v.grantRole(v.RISK_ROLE(), address(tl));
            bytes32[] memory r = new bytes32[](2);
            r[0] = v.RISK_ROLE();
            r[1] = v.DEFAULT_ADMIN_ROLE();
            _renounceAll(IAccessControl(address(v)), me, r);
        }
        address osr = vm.parseJsonAddress(dep, ".operatorReference");
        {
            bytes32 signerAdmin = keccak256("SIGNER_ADMIN_ROLE");
            IAccessControl(osr).grantRole(bytes32(0), address(tl));
            IAccessControl(osr).grantRole(signerAdmin, address(tl));
            bytes32[] memory r = new bytes32[](2);
            r[0] = signerAdmin;
            r[1] = bytes32(0);
            _renounceAll(IAccessControl(osr), me, r);
        }

        // Ownable2Step: hand over now, accepted by the timelock in its first operation, with the 7-day delay
        address[] memory targets = new address[](owned.length + 1);
        uint256[] memory values = new uint256[](owned.length + 1);
        bytes[] memory payloads = new bytes[](owned.length + 1);
        for (uint256 i = 0; i < owned.length; ++i) {
            Ownable2Step(owned[i]).transferOwnership(address(tl));
            targets[i] = owned[i];
            payloads[i] = abi.encodeCall(Ownable2Step.acceptOwnership, ());
        }
        targets[owned.length] = address(tl);
        payloads[owned.length] = abi.encodeCall(TimelockController.updateDelay, (FINAL_DELAY));
        tl.scheduleBatch(targets, values, payloads, bytes32(0), SALT, DELAY);

        // the deployer leaves the timelock too
        tl.revokeRole(tl.PROPOSER_ROLE(), me);
        tl.revokeRole(tl.CANCELLER_ROLE(), me);
        tl.renounceRole(tl.DEFAULT_ADMIN_ROLE(), me);
        vm.stopBroadcast();

        bytes32 op = tl.hashOperationBatch(targets, values, payloads, bytes32(0), SALT);
        string memory o = "timelock";
        vm.serializeAddress(o, "timelock", address(tl));
        vm.serializeAddress(o, "proposer", proposer);
        vm.serializeAddress(o, "canceller", guardian);
        vm.serializeUint(o, "delaySec", DELAY);
        vm.serializeUint(o, "finalDelaySec", FINAL_DELAY);
        vm.serializeBytes32(o, "operation", op);
        vm.serializeBytes32(o, "salt", SALT);
        vm.serializeUint(o, "executableAfter", block.timestamp + DELAY);
        vm.serializeAddress(o, "targets", targets);
        string memory out = vm.serializeBytes(o, "payloads", payloads);
        string memory path = string.concat(
            "../deployments/",
            vm.envOr("TIMELOCK_OUT", string.concat(vm.parseJsonString(dep, ".label"), "-timelock")),
            ".json"
        );
        vm.writeJson(out, path);
        console.log("timelock", address(tl));
        console.log("operation (accept ownerships, delay to 7 days)", vm.toString(op));
        console.log("executable after", block.timestamp + DELAY);
        console.log("written", path);
    }

    function _exchangeRoles(UnisonExchange ex) internal view returns (bytes32[] memory r) {
        r = new bytes32[](5);
        r[0] = ex.CAP_ROLE();
        r[1] = ex.HALT_ROLE();
        r[2] = ex.GUARDIAN_ROLE();
        r[3] = ex.OPERATOR_ROLE();
        r[4] = ex.DEFAULT_ADMIN_ROLE(); // last: renouncing it first would leave nothing able to renounce the rest
    }

    function _renounceAll(IAccessControl c, address me, bytes32[] memory roles) internal {
        for (uint256 i = 0; i < roles.length; ++i) {
            if (c.hasRole(roles[i], me)) c.renounceRole(roles[i], me);
        }
    }

    /// @dev Every vault the deployment names (one per market that has one, the control's included).
    function _vaults() internal view returns (address[] memory out) {
        string[] memory keys = vm.parseJsonKeys(dep, ".markets");
        address[] memory tmp = new address[](keys.length);
        uint256 n;
        for (uint256 i = 0; i < keys.length; ++i) {
            string memory k = string.concat(".markets[\"", keys[i], "\"].vault");
            if (vm.keyExistsJson(dep, k)) tmp[n++] = vm.parseJsonAddress(dep, k);
        }
        out = new address[](n);
        for (uint256 i = 0; i < n; ++i) {
            out[i] = tmp[i];
        }
    }

    /// @dev The Ownable2Step contracts: the reference adapters and the issuer-denylist mirror.
    function _ownable() internal view returns (address[] memory out) {
        string[3] memory keys = [".causalReference", ".chainlinkReference", ".eligibility"];
        address[] memory tmp = new address[](3);
        uint256 n;
        for (uint256 i = 0; i < keys.length; ++i) {
            if (vm.keyExistsJson(dep, keys[i])) tmp[n++] = vm.parseJsonAddress(dep, keys[i]);
        }
        out = new address[](n);
        for (uint256 i = 0; i < n; ++i) {
            out[i] = tmp[i];
        }
    }
}

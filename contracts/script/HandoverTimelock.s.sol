// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script, console} from "forge-std/Script.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {UnisonExchange} from "../src/core/UnisonExchange.sol";
import {LiquidityVault} from "../src/liquidity/LiquidityVault.sol";

interface ISafe {
    function getThreshold() external view returns (uint256);
    function getOwners() external view returns (address[] memory);
}

/// @notice Every power over prices, balances and code behind a public 7-day delay, in one run, with no window in which
///         the deployer still holds any of it (docs/ROADMAP.md, A). After this script:
///   - a TimelockController holds the exchange's admin and operator roles (upgrades, markets, sources, eligibility,
///     the causal switch), every vault's admin and risk roles, the operator reference's roles, and the ownership of
///     the price adapters and the eligibility mirror;
///   - its delay is 7 days from the first block; proposals come from the admin Safe (outside signers), anyone may
///     execute a ready one, and either Safe may cancel one;
///   - the guardian Safe holds pause, halt and caps, which on exchange v3 stop a market and return its orders but can't
///     move a balance or set a price; the old guardian key holds nothing;
///   - the deployer holds nothing.
///
/// How the ownerships move at once: the timelock starts with no delay and the deployer as its only proposer, accepts
/// every Ownable2Step transfer and raises its own delay to 7 days in one executed batch (updateDelay only answers the
/// timelock itself), then the deployer hands proposing to the admin Safe and leaves. The deployer holds every power
/// already while the delay is 0, so that moment adds none.
///
///   DEPLOYER_PRIVATE_KEY=0x… DEPLOYMENT=../deployments/monad-mainnet.json ADMIN_SAFE=0x… GUARDIAN_SAFE=0x… \
///   forge script script/HandoverTimelock.s.sol --rpc-url https://rpc.monad.xyz --broadcast --slow
///
/// It refuses an exchange before v3: the gateway role must be locked first (script/UpgradePhaseA.s.sol), or the
/// timelock would inherit an admin that can make itself a gateway without an upgrade.
/// Output: ../deployments/<label>-timelock.json (or <TIMELOCK_OUT>.json).
contract HandoverTimelock is Script {
    uint256 internal constant FINAL_DELAY = 7 days;
    bytes32 internal constant SALT = keccak256("unison.timelock.handover.v2");

    string internal dep;

    function run() external {
        dep = vm.readFile(vm.envOr("DEPLOYMENT", string("../deployments/monad-mainnet.json")));
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address me = vm.rememberKey(pk);
        TimelockController tl = handover(me, vm.envAddress("ADMIN_SAFE"), vm.envAddress("GUARDIAN_SAFE"));
        _record(tl, vm.envAddress("ADMIN_SAFE"), vm.envAddress("GUARDIAN_SAFE"));
    }

    /// @notice The whole handover, as `me` (the deployer). Public so a fork test can run it on mainnet state.
    function handover(address me, address adminSafe, address guardianSafe) public returns (TimelockController tl) {
        if (bytes(dep).length == 0) dep = vm.readFile(vm.envOr("DEPLOYMENT", string("../deployments/monad-mainnet.json")));
        UnisonExchange ex = UnisonExchange(vm.parseJsonAddress(dep, ".exchange"));
        require(adminSafe.code.length > 0 && guardianSafe.code.length > 0, "both Safes must already be deployed");
        require(adminSafe != guardianSafe, "two Safes: one proposes, one guards");
        require(ex.hasRole(ex.DEFAULT_ADMIN_ROLE(), me), "the deployer is not the exchange's admin");
        // an implementation before v3 has no version(): the gateway role must be locked before the keys leave
        try ex.version() returns (uint256 v) {
            require(v >= 3, "upgrade the exchange to v3 first (script/UpgradePhaseA.s.sol)");
        } catch {
            revert("upgrade the exchange to v3 first (script/UpgradePhaseA.s.sol)");
        }
        address oldGuardian = vm.parseJsonAddress(dep, ".guardian");
        address[] memory vaults = _vaults();
        address[] memory owned = _ownable();

        vm.startBroadcast(me);
        address[] memory proposers = new address[](1);
        proposers[0] = me; // for the one batch below; gone before the end of this run
        address[] memory executors = new address[](1); // address(0): anyone executes a ready operation
        tl = new TimelockController(0, proposers, executors, me);

        // the exchange: upgrades and every market, source and eligibility setting behind the delay
        ex.grantRole(ex.DEFAULT_ADMIN_ROLE(), address(tl));
        ex.grantRole(ex.OPERATOR_ROLE(), address(tl));
        // stopping a market stays fast, with the guardian Safe; the old guardian key steps down
        bytes32[3] memory guard = [ex.GUARDIAN_ROLE(), ex.HALT_ROLE(), ex.CAP_ROLE()];
        for (uint256 i = 0; i < guard.length; ++i) {
            if (!ex.hasRole(guard[i], guardianSafe)) ex.grantRole(guard[i], guardianSafe);
            if (oldGuardian != guardianSafe && ex.hasRole(guard[i], oldGuardian)) ex.revokeRole(guard[i], oldGuardian);
        }

        // the vaults' parameters and the operator reference's signer set
        for (uint256 i = 0; i < vaults.length; ++i) {
            LiquidityVault v = LiquidityVault(vaults[i]);
            v.grantRole(v.DEFAULT_ADMIN_ROLE(), address(tl));
            v.grantRole(v.RISK_ROLE(), address(tl));
            bytes32[] memory r = new bytes32[](2);
            r[0] = v.RISK_ROLE();
            r[1] = v.DEFAULT_ADMIN_ROLE();
            _renounceAll(IAccessControl(address(v)), me, r);
        }
        if (vm.keyExistsJson(dep, ".operatorReference")) {
            address osr = vm.parseJsonAddress(dep, ".operatorReference");
            bytes32 signerAdmin = keccak256("SIGNER_ADMIN_ROLE");
            IAccessControl(osr).grantRole(bytes32(0), address(tl));
            IAccessControl(osr).grantRole(signerAdmin, address(tl));
            bytes32[] memory r = new bytes32[](2);
            r[0] = signerAdmin;
            r[1] = bytes32(0);
            _renounceAll(IAccessControl(osr), me, r);
        }

        // the adapters and the eligibility mirror: offered now, accepted by the timelock in the same run, with the delay
        // raised to 7 days in that one batch
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
        tl.scheduleBatch(targets, values, payloads, bytes32(0), SALT, 0);
        tl.executeBatch(targets, values, payloads, bytes32(0), SALT);

        // proposing to the admin Safe, cancelling to both Safes; the deployer leaves the timelock and the exchange
        tl.grantRole(tl.PROPOSER_ROLE(), adminSafe);
        tl.grantRole(tl.CANCELLER_ROLE(), adminSafe);
        tl.grantRole(tl.CANCELLER_ROLE(), guardianSafe);
        tl.revokeRole(tl.PROPOSER_ROLE(), me);
        tl.revokeRole(tl.CANCELLER_ROLE(), me);
        _renounceAll(IAccessControl(address(ex)), me, _exchangeRoles(ex));
        tl.renounceRole(tl.DEFAULT_ADMIN_ROLE(), me);
        vm.stopBroadcast();

        _check(tl, ex, me, adminSafe, guardianSafe, oldGuardian, vaults, owned);
    }

    /// @dev Every promise above, read back: the run reverts rather than leave a key behind.
    function _check(
        TimelockController tl,
        UnisonExchange ex,
        address me,
        address adminSafe,
        address guardianSafe,
        address oldGuardian,
        address[] memory vaults,
        address[] memory owned
    ) internal view {
        require(tl.getMinDelay() == FINAL_DELAY, "the delay is not 7 days");
        require(tl.hasRole(tl.PROPOSER_ROLE(), adminSafe), "the admin Safe can't propose");
        require(tl.hasRole(tl.CANCELLER_ROLE(), adminSafe) && tl.hasRole(tl.CANCELLER_ROLE(), guardianSafe), "cancellers");
        require(tl.hasRole(tl.EXECUTOR_ROLE(), address(0)), "execution is not open to anyone");
        require(
            !tl.hasRole(tl.PROPOSER_ROLE(), me) && !tl.hasRole(tl.CANCELLER_ROLE(), me)
                && !tl.hasRole(tl.DEFAULT_ADMIN_ROLE(), me),
            "the deployer kept a timelock role"
        );
        bytes32[] memory roles = _exchangeRoles(ex);
        for (uint256 i = 0; i < roles.length; ++i) {
            require(!ex.hasRole(roles[i], me), "the deployer kept an exchange role");
            if (oldGuardian != guardianSafe) require(!ex.hasRole(roles[i], oldGuardian), "the old guardian kept a role");
        }
        require(ex.hasRole(ex.DEFAULT_ADMIN_ROLE(), address(tl)) && ex.hasRole(ex.OPERATOR_ROLE(), address(tl)), "exchange");
        require(
            ex.hasRole(ex.GUARDIAN_ROLE(), guardianSafe) && ex.hasRole(ex.HALT_ROLE(), guardianSafe)
                && ex.hasRole(ex.CAP_ROLE(), guardianSafe),
            "the guardian Safe can't stop a market"
        );
        for (uint256 i = 0; i < vaults.length; ++i) {
            LiquidityVault v = LiquidityVault(vaults[i]);
            require(!v.hasRole(v.DEFAULT_ADMIN_ROLE(), me) && !v.hasRole(v.RISK_ROLE(), me), "the deployer kept a vault role");
            require(v.hasRole(v.DEFAULT_ADMIN_ROLE(), address(tl)), "a vault has no admin");
        }
        for (uint256 i = 0; i < owned.length; ++i) {
            require(Ownable2Step(owned[i]).owner() == address(tl), "an ownership did not move");
            require(Ownable2Step(owned[i]).pendingOwner() == address(0), "an ownership is still pending");
        }
    }

    function _record(TimelockController tl, address adminSafe, address guardianSafe) internal {
        string memory o = "timelock";
        vm.serializeAddress(o, "timelock", address(tl));
        vm.serializeUint(o, "delaySec", FINAL_DELAY);
        vm.serializeAddress(o, "adminSafe", adminSafe);
        vm.serializeUint(o, "adminSafeThreshold", ISafe(adminSafe).getThreshold());
        vm.serializeAddress(o, "adminSafeOwners", ISafe(adminSafe).getOwners());
        vm.serializeAddress(o, "guardianSafe", guardianSafe);
        vm.serializeUint(o, "guardianSafeThreshold", ISafe(guardianSafe).getThreshold());
        string memory out = vm.serializeAddress(o, "guardianSafeOwners", ISafe(guardianSafe).getOwners());
        string memory path = string.concat(
            "../deployments/",
            vm.envOr("TIMELOCK_OUT", string.concat(vm.parseJsonString(dep, ".label"), "-timelock")),
            ".json"
        );
        vm.writeJson(out, path);
        console.log("timelock", address(tl));
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

    /// @dev The Ownable2Step contracts: the reference adapters and the eligibility mirror.
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

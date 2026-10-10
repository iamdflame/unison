// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script, console} from "forge-std/Script.sol";
import {UnisonExchange} from "../src/core/UnisonExchange.sol";

/// @notice Phase A on a live deployment (docs/ROADMAP.md): the exchange upgraded in place to v3 and, in the same
///         transaction, GATEWAY_ROLE locked (initializeV3). No market state moves, so nothing has to be drained first:
///         orders, books and vault queues carry over, and a job already running finishes as it was bound. From the
///         next job on, a stopped market returns its orders, no curve source quotes a closed market, and a malformed
///         source is skipped.
///
///   DEPLOYER_PRIVATE_KEY=0x… DEPLOYMENT=../deployments/monad-mainnet.json \
///   forge script script/UpgradePhaseA.s.sol --rpc-url https://rpc.monad.xyz --broadcast --slow
///
/// Output: ../deployments/<label>-phase-a.json, or <PHASE_A_OUT>.json for a rehearsal.
contract UpgradePhaseA is Script {
    function run() external {
        string memory dep = vm.readFile(vm.envOr("DEPLOYMENT", string("../deployments/monad-mainnet.json")));
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address me = vm.addr(pk);
        UnisonExchange ex = UnisonExchange(vm.parseJsonAddress(dep, ".exchange"));
        address gateway = vm.parseJsonAddress(dep, ".gateway");
        require(ex.hasRole(ex.DEFAULT_ADMIN_ROLE(), me), "the deployer is not the exchange's admin");
        // the deployment's own gateway keeps its role; locking it first would strand every passkey account
        require(ex.hasRole(ex.GATEWAY_ROLE(), gateway), "the deployment's gateway must hold GATEWAY_ROLE");
        uint256 startBlock = vm.getBlockNumber();

        vm.startBroadcast(pk);
        UnisonExchange impl = new UnisonExchange();
        ex.upgradeToAndCall(address(impl), abi.encodeCall(UnisonExchange.initializeV3, ()));
        vm.stopBroadcast();

        require(ex.version() == 3, "not upgraded");
        require(ex.getRoleAdmin(ex.GATEWAY_ROLE()) == ex.LOCKED_ROLE(), "gateway role not locked");
        require(ex.getRoleAdmin(ex.LOCKED_ROLE()) == ex.LOCKED_ROLE(), "the lock does not administer itself");
        require(ex.hasRole(ex.GATEWAY_ROLE(), gateway), "the gateway lost its role");

        string memory o = "phaseA";
        vm.serializeUint(o, "startBlock", startBlock);
        vm.serializeUint(o, "version", 3);
        string memory out = vm.serializeAddress(o, "exchangeImplementation", address(impl));
        string memory path = string.concat(
            "../deployments/", vm.envOr("PHASE_A_OUT", string.concat(vm.parseJsonString(dep, ".label"), "-phase-a")), ".json"
        );
        vm.writeJson(out, path);
        console.log("implementation", address(impl));
        console.log("written", path);
    }
}

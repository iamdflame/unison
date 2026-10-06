// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ICausalReference} from "../src/interfaces/ICausalReference.sol";
import {LatencyChallenge} from "../src/challenge/LatencyChallenge.sol";

/// @notice Deploys the standing challenge on a causal deployment: one LatencyChallenge on Unison's causal market and
///         one, with the same terms, on the old-rule control market. Pots are funded afterwards by transfer.
///
///   DEPLOYER_PRIVATE_KEY=0x… DEPLOYMENT=../deployments/monad-mainnet.json CHALLENGE_CONFIG=../deploy/monad-mainnet-challenge.json \
///   forge script script/DeployChallenge.s.sol --rpc-url https://rpc.monad.xyz --broadcast --slow
///
/// Output: ../deployments/<label>-challenge.json (or <CHALLENGE_OUT>.json), folded into the deployment record by
///         scripts/merge-challenge.mjs.
contract DeployChallenge is Script {
    string internal dep;
    string internal cfg;

    function run() external {
        dep = vm.readFile(vm.envOr("DEPLOYMENT", string("../deployments/monad-mainnet.json")));
        cfg = vm.readFile(vm.envOr("CHALLENGE_CONFIG", string("../deploy/monad-mainnet-challenge.json")));
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address causal = vm.parseJsonAddress(dep, ".causalReference");
        uint256 controlId = _controlId();
        uint64 start = uint64(block.timestamp);

        vm.startBroadcast(pk);
        LatencyChallenge unison = new LatencyChallenge(_terms(vm.parseJsonUint(cfg, ".unisonMarketId"), causal, start));
        LatencyChallenge control = new LatencyChallenge(_terms(controlId, causal, start));
        vm.stopBroadcast();

        string memory o = "challenge";
        vm.serializeAddress(o, "unison", address(unison));
        vm.serializeAddress(o, "control", address(control));
        vm.serializeUint(o, "start", start);
        string memory out = vm.serializeUint(o, "end", vm.parseJsonUint(cfg, ".end"));
        string memory path = string.concat(
            "../deployments/", vm.envOr("CHALLENGE_OUT", string.concat(vm.parseJsonString(cfg, ".label"), "-challenge")), ".json"
        );
        vm.writeJson(out, path);
        console.log("challenge on Unison", address(unison));
        console.log("challenge on the control", address(control));
        console.log("written", path);
    }

    /// @dev The control market is the deployment's market marked `control`.
    function _controlId() internal view returns (uint256) {
        string[] memory keys = vm.parseJsonKeys(dep, ".markets");
        for (uint256 i = 0; i < keys.length; ++i) {
            string memory k = string.concat(".markets[\"", keys[i], "\"]");
            if (vm.keyExistsJson(dep, string.concat(k, ".control")) && vm.parseJsonBool(dep, string.concat(k, ".control"))) {
                return vm.parseJsonUint(dep, string.concat(k, ".id"));
            }
        }
        revert("the deployment has no control market");
    }

    function _terms(uint256 marketId, address causal, uint64 start) internal view returns (LatencyChallenge.Terms memory) {
        string memory wmon = ".markets[\"WMON/AUSD\"]";
        return LatencyChallenge.Terms({
            pot: IERC20(vm.parseJsonAddress(dep, string.concat(wmon, ".quote"))),
            venue: vm.parseJsonAddress(dep, ".exchange"),
            marketId: marketId,
            base: vm.parseJsonAddress(dep, string.concat(wmon, ".base")),
            quote: vm.parseJsonAddress(dep, string.concat(wmon, ".quote")),
            markout: ICausalReference(causal),
            markoutMarketId: vm.parseJsonUint(cfg, ".markoutMarketId"),
            start: start,
            end: uint64(vm.parseJsonUint(cfg, ".end")),
            horizonSec: uint32(vm.parseJsonUint(cfg, ".horizonSec")),
            epsilonBps: uint16(vm.parseJsonUint(cfg, ".epsilonBps")),
            minFills: uint32(vm.parseJsonUint(cfg, ".minFills")),
            sponsor: vm.parseJsonAddress(cfg, ".sponsor"),
            team: vm.parseJsonAddressArray(cfg, ".team")
        });
    }
}

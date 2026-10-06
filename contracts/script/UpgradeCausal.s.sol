// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script, console} from "forge-std/Script.sol";
import {UnisonExchange} from "../src/core/UnisonExchange.sol";
import {ChainlinkReference} from "../src/pricing/ChainlinkReference.sol";
import {ChainlinkCausalReference} from "../src/pricing/ChainlinkCausalReference.sol";
import {AggregatorV3Interface} from "../src/interfaces/external/AggregatorV3Interface.sol";
import {LiquidityVault, IUnisonVenue} from "../src/liquidity/LiquidityVault.sol";

/// @notice The causal cutover (SPEC §7.4) on a live deployment: upgrades the exchange in place, deploys the
///         ChainlinkCausalReference, switches the listed markets to it, stops their vaults quoting while a reference is
///         closed, and adds the old-rule control market the standing challenge measures against.
///
///   DEPLOYER_PRIVATE_KEY=0x… DEPLOYMENT=../deployments/monad-mainnet.json CAUSAL_CONFIG=../deploy/monad-mainnet-causal.json \
///   forge script script/UpgradeCausal.s.sol --rpc-url https://rpc.monad.xyz --broadcast --slow --verify --verifier sourcify
///
/// Every precondition is read before anything is sent: no clear job running, no order waiting, no order resting.
/// Output: ../deployments/<label>-causal.json, or <CAUSAL_OUT>.json for a rehearsal (merged into the deployment
///         record by scripts/merge-causal.mjs).
contract UpgradeCausal is Script {
    string internal dep;
    string internal cfg;

    function run() external {
        dep = vm.readFile(vm.envOr("DEPLOYMENT", string("../deployments/monad-mainnet.json")));
        cfg = vm.readFile(vm.envOr("CAUSAL_CONFIG", string("../deploy/monad-mainnet-causal.json")));
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address me = vm.addr(pk);
        UnisonExchange ex = UnisonExchange(vm.parseJsonAddress(dep, ".exchange"));
        uint8 skew = uint8(vm.parseJsonUint(cfg, ".skewSec"));

        for (uint256 i = 0; _has(i); ++i) {
            uint256 id = vm.parseJsonUint(cfg, _k(i, "id"));
            UnisonExchange.Market memory m = ex.market(id);
            require(ex.jobPhase(id) == 0, "a clear job is running");
            require(m.pendingHead == m.pendingTail, "orders are waiting: clear them first");
            require(ex.bookTotal(id, 0) == 0 && ex.bookTotal(id, 1) == 0, "orders are resting: owners cancel first");
        }
        uint256 startBlock = vm.getBlockNumber();

        vm.startBroadcast(pk);
        UnisonExchange impl = new UnisonExchange();
        ex.upgradeToAndCall(address(impl), "");
        ChainlinkCausalReference cref = new ChainlinkCausalReference(me);
        for (uint256 i = 0; _has(i); ++i) {
            uint256 id = vm.parseJsonUint(cfg, _k(i, "id"));
            uint256[] memory session = vm.parseJsonUintArray(cfg, _k(i, "session"));
            cref.setFeed(
                id,
                AggregatorV3Interface(vm.parseJsonAddress(cfg, _k(i, "feed"))),
                AggregatorV3Interface(vm.parseJsonAddress(cfg, _k(i, "quoteFeed"))),
                uint8(vm.parseJsonUint(cfg, _k(i, "quoteDecimals"))),
                uint32(vm.parseJsonUint(cfg, _k(i, "feedMaxAgeSec"))),
                uint32(vm.parseJsonUint(cfg, _k(i, "quoteFeedMaxAgeSec"))),
                uint32(session[0]),
                uint32(session[1]),
                uint16(vm.parseJsonUint(cfg, _k(i, "depegBps")))
            );
            ex.setCausal(id, address(cref), true, skew);
            _closedMult(
                LiquidityVault(vm.parseJsonAddress(cfg, _k(i, "vault"))),
                uint8(vm.parseJsonUint(cfg, _k(i, "closedMult")))
            );
        }
        (uint256 controlId, address controlVault) =
            _control(ex, ChainlinkReference(vm.parseJsonAddress(dep, ".chainlinkReference")), me);
        vm.stopBroadcast();

        string memory o = "causal";
        vm.serializeUint(o, "startBlock", startBlock);
        vm.serializeAddress(o, "exchangeImplementation", address(impl));
        vm.serializeAddress(o, "causalReference", address(cref));
        vm.serializeUint(o, "skewSec", skew);
        vm.serializeUint(o, "controlId", controlId);
        vm.serializeAddress(o, "controlVault", controlVault);
        string memory out = vm.serializeString(o, "controlSymbol", vm.parseJsonString(cfg, ".control.symbol"));
        string memory path = string.concat(
            "../deployments/",
            vm.envOr("CAUSAL_OUT", string.concat(vm.parseJsonString(cfg, ".label"), "-causal")),
            ".json"
        );
        vm.writeJson(out, path);
        console.log("implementation", address(impl));
        console.log("causal reference", address(cref));
        console.log("control market", controlId, controlVault);
        console.log("written", path);
    }

    function _has(uint256 i) internal view returns (bool) {
        return vm.keyExistsJson(cfg, string.concat(".causal[", vm.toString(i), "]"));
    }

    function _k(uint256 i, string memory field) internal pure returns (string memory) {
        return string.concat(".causal[", vm.toString(i), "].", field);
    }

    /// @dev Keeps every vault parameter and changes only the CLOSED spread multiplier.
    function _closedMult(LiquidityVault v, uint8 mult) internal {
        (uint16 s, uint16 d, uint16 w, uint16 k, uint16 a, uint16 sw, uint8 e,, bool p) = v.params();
        v.setParams(
            LiquidityVault.Params({
                spreadBps: s,
                depthBps: d,
                widthTicks: w,
                maxSkewTicks: k,
                maxAuctionBps: a,
                swingBps: sw,
                extMult: e,
                closedMult: mult,
                paused: p
            })
        );
    }

    /// @dev The old-rule control: a WMON/AUSD market on ChainlinkReference (the latest round at clear time) with its
    ///      own vault, set like the causal WMON market so the rule is the only difference.
    function _control(UnisonExchange ex, ChainlinkReference cl, address me) internal returns (uint256 id, address v) {
        string memory c = ".control";
        id = ex.createMarket(
            UnisonExchange.MarketParams({
                base: vm.parseJsonAddress(cfg, string.concat(c, ".base")),
                quote: vm.parseJsonAddress(cfg, string.concat(c, ".quote")),
                refAdapter: address(cl),
                tickSize: uint64(vm.parseJsonUint(cfg, string.concat(c, ".tickSize"))),
                minTick: 1,
                maxTick: uint32((1 << 21) - 1),
                maxBandTicks: uint32(vm.parseJsonUint(cfg, string.concat(c, ".maxBandTicks"))),
                bandBps: uint16(vm.parseJsonUint(cfg, string.concat(c, ".bandBps"))),
                feeBps: uint16(vm.parseJsonUint(cfg, string.concat(c, ".feeBps"))),
                maxFeeBps: uint16(vm.parseJsonUint(cfg, string.concat(c, ".maxFeeBps"))),
                shards: uint8(vm.parseJsonUint(cfg, string.concat(c, ".shards"))),
                permissioned: false,
                strictAfterClose: false
            })
        );
        uint256[] memory g = vm.parseJsonUintArray(cfg, string.concat(c, ".regime"));
        ex.setRegime(id, uint16(g[0]), uint16(g[1]), uint16(g[2]), uint16(g[3]), uint32(g[4]), uint32(g[5]));
        ex.setDailyCap(id, uint128(vm.parseJsonUint(cfg, string.concat(c, ".dailyCap"))));
        uint256[] memory session = vm.parseJsonUintArray(cfg, string.concat(c, ".session"));
        cl.setFeed(
            id,
            AggregatorV3Interface(vm.parseJsonAddress(cfg, string.concat(c, ".feed"))),
            AggregatorV3Interface(vm.parseJsonAddress(cfg, string.concat(c, ".quoteFeed"))),
            uint8(vm.parseJsonUint(cfg, string.concat(c, ".quoteDecimals"))),
            uint32(vm.parseJsonUint(cfg, string.concat(c, ".feedMaxAgeSec"))),
            uint32(vm.parseJsonUint(cfg, string.concat(c, ".quoteFeedMaxAgeSec"))),
            uint32(session[0]),
            uint32(session[1])
        );
        uint256[] memory p = vm.parseJsonUintArray(cfg, string.concat(c, ".vault"));
        string memory sym = vm.parseJsonString(cfg, string.concat(c, ".symbol"));
        v = address(
            new LiquidityVault(
                me,
                IUnisonVenue(address(ex)),
                id,
                string.concat("Unison ", sym, " Liquidity"),
                vm.parseJsonString(cfg, string.concat(c, ".lpSymbol")),
                LiquidityVault.Params({
                    spreadBps: uint16(p[0]),
                    depthBps: uint16(p[1]),
                    widthTicks: uint16(p[2]),
                    maxSkewTicks: uint16(p[3]),
                    maxAuctionBps: uint16(p[4]),
                    swingBps: uint16(p[5]),
                    extMult: uint8(p[6]),
                    closedMult: uint8(p[7]),
                    paused: false
                })
            )
        );
        ex.addSource(id, v);
    }
}

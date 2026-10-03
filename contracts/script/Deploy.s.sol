// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script, console} from "forge-std/Script.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {UnisonExchange} from "../src/core/UnisonExchange.sol";
import {OperatorSignedReference} from "../src/pricing/OperatorSignedReference.sol";
import {ChainlinkReference} from "../src/pricing/ChainlinkReference.sol";
import {PythReference} from "../src/pricing/PythReference.sol";
import {IPyth} from "../src/interfaces/external/IPyth.sol";
import {AggregatorV3Interface} from "../src/interfaces/external/AggregatorV3Interface.sol";
import {LiquidityVault, IUnisonVenue} from "../src/liquidity/LiquidityVault.sol";
import {OrderGateway, IGatewayVenue} from "../src/access/OrderGateway.sol";

/// @notice Config-driven production deployment (deploy/<network>.json → deployments/<label>.json).
///
///   DEPLOYER_PRIVATE_KEY=0x… DEPLOY_CONFIG=../deploy/monad-mainnet.json \
///   forge script script/Deploy.s.sol --rpc-url monad --broadcast --verify --verifier sourcify
///
/// Roles: the deployer configures everything, then (if `admin` differs) hands every role to `admin`,
/// GUARDIAN/HALT to `guardian`, and renounces its own. Ownable2Step adapters must be accepted by `admin`.
contract Deploy is Script {
    struct Core {
        UnisonExchange ex;
        OperatorSignedReference osr;
        ChainlinkReference cl;
        PythReference py;
        OrderGateway gateway;
        address deployer;
        address admin;
        address guardian;
    }

    string internal json;
    string internal outMarkets = "markets";
    string internal lastMarketsJson;

    function run() external {
        json = vm.readFile(vm.envOr("DEPLOY_CONFIG", string("../deploy/monad-mainnet.json")));
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        Core memory c;
        c.deployer = vm.addr(pk);
        c.admin = _addrOr(".admin", c.deployer);
        c.guardian = _addrOr(".guardian", c.admin);

        vm.startBroadcast(pk);
        _core(c);
        _tokens(c);
        for (uint256 i = 0; vm.keyExistsJson(json, string.concat(".markets[", vm.toString(i), "]")); ++i) {
            _market(c, i);
        }
        _handoff(c);
        vm.stopBroadcast();
        _write(c);
    }

    function _addrOr(string memory key, address d) internal view returns (address a) {
        a = vm.keyExistsJson(json, key) ? vm.parseJsonAddress(json, key) : address(0);
        if (a == address(0)) a = d;
    }

    function _core(Core memory c) internal {
        UnisonExchange impl = new UnisonExchange();
        c.ex = UnisonExchange(
            address(new ERC1967Proxy(address(impl), abi.encodeCall(UnisonExchange.initialize, (c.deployer))))
        );
        c.osr = new OperatorSignedReference(
            c.deployer,
            address(c.ex),
            IERC20(vm.parseJsonAddress(json, ".bondToken")),
            uint8(vm.parseJsonUint(json, ".referenceQuorum")),
            uint32(vm.parseJsonUint(json, ".referenceMaxAgeMs"))
        );
        address[] memory signers = vm.parseJsonAddressArray(json, ".relaySigners");
        for (uint256 i = 0; i < signers.length; ++i) c.osr.addEcdsaSigner(signers[i]);
        c.cl = new ChainlinkReference(c.deployer);
        c.gateway = new OrderGateway(IGatewayVenue(address(c.ex)));
        c.ex.grantRole(c.ex.GATEWAY_ROLE(), address(c.gateway));
        address pyth = _addrOr(".pyth", address(0));
        if (pyth != address(0)) c.py = new PythReference(c.deployer, IPyth(pyth), address(c.ex));
        uint256 reward = vm.parseJsonUint(json, ".keeperReward");
        if (reward != 0) c.ex.setKeeperReward(reward);
    }

    function _tokens(Core memory c) internal {
        address[] memory toks = vm.parseJsonAddressArray(json, ".tokens");
        bool[] memory restricted = vm.parseJsonBoolArray(json, ".restricted");
        require(toks.length == restricted.length, "tokens/restricted length");
        for (uint256 i = 0; i < toks.length; ++i) c.ex.listToken(toks[i], restricted[i]);
    }

    function _key(uint256 i, string memory field) internal pure returns (string memory) {
        return string.concat(".markets[", vm.toString(i), "].", field);
    }

    function _market(Core memory c, uint256 i) internal {
        string memory refKind = vm.parseJsonString(json, _key(i, "reference"));
        address adapter = _adapterFor(c, refKind);
        uint256 mkt = c.ex.createMarket(
            UnisonExchange.MarketParams({
                base: vm.parseJsonAddress(json, _key(i, "base")),
                quote: vm.parseJsonAddress(json, _key(i, "quote")),
                refAdapter: adapter,
                tickSize: uint64(vm.parseJsonUint(json, _key(i, "tickSize"))),
                minTick: 1,
                maxTick: uint32((1 << 21) - 1),
                maxBandTicks: uint32(vm.parseJsonUint(json, _key(i, "maxBandTicks"))),
                bandBps: uint16(vm.parseJsonUint(json, _key(i, "bandBps"))),
                feeBps: uint16(vm.parseJsonUint(json, _key(i, "feeBps"))),
                maxFeeBps: uint16(vm.parseJsonUint(json, _key(i, "maxFeeBps"))),
                shards: uint8(vm.parseJsonUint(json, _key(i, "shards"))),
                permissioned: vm.parseJsonBool(json, _key(i, "permissioned")),
                strictAfterClose: false
            })
        );
        uint256[] memory g = vm.parseJsonUintArray(json, _key(i, "regime"));
        c.ex.setRegime(mkt, uint16(g[0]), uint16(g[1]), uint16(g[2]), uint16(g[3]), uint32(g[4]), uint32(g[5]));
        if (keccak256(bytes(refKind)) == keccak256("chainlink")) _chainlinkFeed(c, i, mkt);

        address vault;
        uint256[] memory v = vm.parseJsonUintArray(json, _key(i, "vault"));
        if (v.length == 8) {
            string memory sym = vm.parseJsonString(json, _key(i, "symbol"));
            vault = address(
                new LiquidityVault(
                    c.deployer,
                    IUnisonVenue(address(c.ex)),
                    mkt,
                    string.concat("Unison ", sym, " Liquidity"),
                    string.concat("u", sym, "-LP"),
                    LiquidityVault.Params({
                        spreadBps: uint16(v[0]),
                        depthBps: uint16(v[1]),
                        widthTicks: uint16(v[2]),
                        maxSkewTicks: uint16(v[3]),
                        maxAuctionBps: uint16(v[4]),
                        swingBps: uint16(v[5]),
                        extMult: uint8(v[6]),
                        closedMult: uint8(v[7]),
                        paused: false
                    })
                )
            );
            c.ex.addSource(mkt, vault);
            if (c.admin != c.deployer) {
                LiquidityVault(vault).grantRole(0x00, c.admin);
                LiquidityVault(vault).grantRole(LiquidityVault(vault).RISK_ROLE(), c.admin);
                LiquidityVault(vault).renounceRole(LiquidityVault(vault).RISK_ROLE(), c.deployer);
                LiquidityVault(vault).renounceRole(0x00, c.deployer);
            }
        }
        _recordMarket(i, mkt, refKind, vault);
    }

    function _adapterFor(Core memory c, string memory kind) internal pure returns (address) {
        bytes32 h = keccak256(bytes(kind));
        if (h == keccak256("operator")) return address(c.osr);
        if (h == keccak256("chainlink")) return address(c.cl);
        if (h == keccak256("pyth")) return address(c.py);
        revert("unknown reference kind");
    }

    function _chainlinkFeed(Core memory c, uint256 i, uint256 mkt) internal {
        uint256[] memory session = vm.parseJsonUintArray(json, _key(i, "session"));
        c.cl.setFeed(
            mkt,
            AggregatorV3Interface(vm.parseJsonAddress(json, _key(i, "feed"))),
            AggregatorV3Interface(vm.parseJsonAddress(json, _key(i, "quoteFeed"))),
            uint8(vm.parseJsonUint(json, _key(i, "quoteDecimals"))),
            uint32(vm.parseJsonUint(json, _key(i, "feedMaxAgeSec"))),
            uint32(vm.parseJsonUint(json, _key(i, "quoteFeedMaxAgeSec"))),
            uint32(session[0]),
            uint32(session[1])
        );
    }

    function _recordMarket(uint256 i, uint256 mkt, string memory refKind, address vault) internal {
        string memory sym = vm.parseJsonString(json, _key(i, "symbol"));
        string memory o = string.concat("m", vm.toString(i));
        vm.serializeString(o, "symbol", sym);
        vm.serializeUint(o, "id", mkt);
        vm.serializeAddress(o, "base", vm.parseJsonAddress(json, _key(i, "base")));
        vm.serializeAddress(o, "quote", vm.parseJsonAddress(json, _key(i, "quote")));
        vm.serializeString(o, "reference", refKind);
        if (vault != address(0)) vm.serializeAddress(o, "vault", vault);
        string memory mj = vm.serializeUint(o, "seedPrice", vm.parseJsonUint(json, _key(i, "seedPrice")));
        lastMarketsJson = vm.serializeString(outMarkets, sym, mj);
    }

    function _handoff(Core memory c) internal {
        if (c.admin == c.deployer) return;
        UnisonExchange ex = c.ex;
        ex.grantRole(ex.DEFAULT_ADMIN_ROLE(), c.admin);
        ex.grantRole(ex.OPERATOR_ROLE(), c.admin);
        ex.grantRole(ex.GUARDIAN_ROLE(), c.guardian);
        ex.grantRole(ex.HALT_ROLE(), c.guardian);
        ex.renounceRole(ex.HALT_ROLE(), c.deployer);
        ex.renounceRole(ex.GUARDIAN_ROLE(), c.deployer);
        ex.renounceRole(ex.OPERATOR_ROLE(), c.deployer);
        ex.renounceRole(ex.DEFAULT_ADMIN_ROLE(), c.deployer);
        c.osr.grantRole(c.osr.DEFAULT_ADMIN_ROLE(), c.admin);
        c.osr.grantRole(c.osr.SIGNER_ADMIN_ROLE(), c.admin);
        c.osr.renounceRole(c.osr.SIGNER_ADMIN_ROLE(), c.deployer);
        c.osr.renounceRole(c.osr.DEFAULT_ADMIN_ROLE(), c.deployer);
        c.cl.transferOwnership(c.admin);
        if (address(c.py) != address(0)) c.py.transferOwnership(c.admin);
    }

    function _write(Core memory c) internal {
        string memory root = "root";
        vm.serializeUint(root, "chainId", block.chainid);
        vm.serializeString(root, "label", vm.parseJsonString(json, ".label"));
        vm.serializeAddress(root, "exchange", address(c.ex));
        vm.serializeAddress(root, "operatorReference", address(c.osr));
        vm.serializeAddress(root, "chainlinkReference", address(c.cl));
        vm.serializeAddress(root, "gateway", address(c.gateway));
        if (address(c.py) != address(0)) vm.serializeAddress(root, "pythReference", address(c.py));
        vm.serializeAddress(root, "admin", c.admin);
        vm.serializeAddress(root, "guardian", c.guardian);
        string memory out = vm.serializeString(root, "markets", lastMarketsJson);
        string memory path = string.concat(
            "../deployments/", vm.envOr("DEPLOY_OUT", vm.parseJsonString(json, ".label")), ".json"
        );
        vm.writeJson(out, path);
        console.log("UnisonExchange", address(c.ex));
        console.log("written", path);
    }
}

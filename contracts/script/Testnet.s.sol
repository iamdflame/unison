// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script, console} from "forge-std/Script.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {UnisonExchange} from "../src/core/UnisonExchange.sol";
import {OperatorSignedReference} from "../src/pricing/OperatorSignedReference.sol";
import {LiquidityVault, IUnisonVenue} from "../src/liquidity/LiquidityVault.sol";
import {OrderGateway, IGatewayVenue} from "../src/access/OrderGateway.sol";
import {MockERC20} from "../test/mocks/MockERC20.sol";

/// @notice A fresh public Monad testnet stack (chain 10143):
///           * mock AUSD (6 decimals) and eight aStock mocks (18 decimals) whose `mint` is open — the relayer's
///             faucet mints them and credits accounts with `depositFor`
///           * UnisonExchange behind a UUPS (ERC-1967) proxy, the operator-signed reference with RELAY_SIGNER as
///             signer 0, the OrderGateway (GATEWAY_ROLE), keeper reward 0
///           * the eight equity markets of deploy/monad-mainnet.json in its order (market ids match the CRE staging
///             configs), with its ticks, bands, regimes, fees and vault parameters
///           * a LiquidityVault per market, seeded by the deployer with AUSD worth VAULT_SEED_TOKENS whole tokens at
///             the market's seed price. The seed is an ordinary queued deposit (the vault takes quote only, and a
///             direct base credit before the first deposit executes would leave the share supply near the virtual
///             offset and misprice every later LP), so it executes at the first reference — the keeper's first clear
///             and `process()`; the vault then buys its base side through its skew.
///         Writes ../deployments/<DEPLOY_OUT>.json (default monad-testnet). The deployer keeps every role.
///
///   DEPLOYER_PRIVATE_KEY=0x… KEEPER=0x… RELAY_SIGNER=0x… RELAYER=0x… \
///   forge script script/Testnet.s.sol --rpc-url monad_testnet --broadcast --slow
///
/// Optional env: MARKETS (how many of the eight to list, in order; default 8), DEPLOY_CONFIG (market parameters;
/// default ../deploy/monad-mainnet.json), DEPLOY_OUT (output file label; default monad-testnet), VAULT_SEED_TOKENS
/// (default 5000), GAS_TOPUP_WEI (MON sent to the keeper and the relayer; default 0).
contract Testnet is Script {
    uint256 internal constant MONAD_TESTNET = 10_143;

    struct Stock {
        string symbol; // token symbol, e.g. aNVDA
        string ticker; // e.g. NVDA
        string name; // issuer, e.g. NVIDIA
    }

    struct Ctx {
        address deployer;
        address keeper;
        address relaySigner;
        address relayer;
        uint256 startBlock;
        uint256 seedTokens;
        MockERC20 ausd;
        UnisonExchange ex;
        OperatorSignedReference osr;
        OrderGateway gateway;
    }

    string internal json;
    string internal marketsJson;
    string internal tokensJson;

    function _stocks() internal pure returns (Stock[8] memory s) {
        s[0] = Stock("aNVDA", "NVDA", "NVIDIA");
        s[1] = Stock("aSPY", "SPY", "SPDR S&P 500 ETF");
        s[2] = Stock("aQQQ", "QQQ", "Invesco QQQ");
        s[3] = Stock("aAAPL", "AAPL", "Apple");
        s[4] = Stock("aTSLA", "TSLA", "Tesla");
        s[5] = Stock("aCOIN", "COIN", "Coinbase");
        s[6] = Stock("aMSTR", "MSTR", "Strategy");
        s[7] = Stock("aGLD", "GLD", "SPDR Gold Shares");
    }

    function run() external {
        require(block.chainid == MONAD_TESTNET, "Testnet.s.sol deploys to Monad testnet (chain 10143) only");
        json = vm.readFile(vm.envOr("DEPLOY_CONFIG", string("../deploy/monad-mainnet.json")));
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        Ctx memory c;
        c.deployer = vm.addr(pk);
        c.keeper = vm.envAddress("KEEPER");
        c.relaySigner = vm.envAddress("RELAY_SIGNER");
        c.relayer = vm.envAddress("RELAYER");
        c.seedTokens = vm.envOr("VAULT_SEED_TOKENS", uint256(5000));
        c.startBlock = vm.getBlockNumber(); // indexers start here

        vm.startBroadcast(pk);
        _core(c);
        Stock[8] memory stocks = _stocks();
        // the first MARKETS stocks, in order (ids 0..MARKETS-1): Monad charges the gas limit, so a lean testnet lists fewer
        uint256 n = vm.envOr("MARKETS", uint256(stocks.length));
        require(n > 0 && n <= stocks.length, "MARKETS must be 1..8");
        for (uint256 i = 0; i < n; ++i) {
            _market(c, stocks[i]);
        }
        _topUp(c);
        vm.stopBroadcast();
        _write(c);
    }

    function _core(Ctx memory c) internal {
        c.ausd = new MockERC20("Agora USD (testnet mock)", "AUSD", 6);
        UnisonExchange impl = new UnisonExchange();
        c.ex = UnisonExchange(
            address(new ERC1967Proxy(address(impl), abi.encodeCall(UnisonExchange.initialize, (c.deployer))))
        );
        c.osr = new OperatorSignedReference(
            c.deployer,
            address(c.ex),
            IERC20(address(c.ausd)),
            uint8(vm.parseJsonUint(json, ".referenceQuorum")),
            uint32(vm.parseJsonUint(json, ".referenceMaxAgeMs"))
        );
        c.osr.addEcdsaSigner(c.relaySigner); // signer id 0 (the relay's RELAY_SIGNER_ID default)
        c.gateway = new OrderGateway(IGatewayVenue(address(c.ex)));
        c.ex.grantRole(c.ex.GATEWAY_ROLE(), address(c.gateway));
        // the gateway is granted: from now on only an upgrade can add one
        c.ex.initializeV3();
        c.ex.listToken(address(c.ausd), false);
        _recordToken(c.ausd);
    }

    function _key(uint256 i, string memory field) internal pure returns (string memory) {
        return string.concat(".markets[", vm.toString(i), "].", field);
    }

    /// Index of `symbol` among the config's markets (operator-referenced equities only).
    function _configIndex(string memory symbol) internal view returns (uint256 i) {
        for (; vm.keyExistsJson(json, string.concat(".markets[", vm.toString(i), "]")); ++i) {
            if (keccak256(bytes(vm.parseJsonString(json, _key(i, "symbol")))) != keccak256(bytes(symbol))) continue;
            require(
                keccak256(bytes(vm.parseJsonString(json, _key(i, "reference")))) == keccak256("operator"),
                "testnet markets use the operator-signed reference"
            );
            return i;
        }
        revert(string.concat("market missing from the config: ", symbol));
    }

    function _market(Ctx memory c, Stock memory s) internal {
        uint256 i = _configIndex(string.concat(s.symbol, "/AUSD"));
        MockERC20 base = new MockERC20(string.concat("Anchored ", s.name, " (testnet mock)"), s.symbol, 18);
        c.ex.listToken(address(base), false);
        _recordToken(base);
        uint256 mkt = c.ex
            .createMarket(
                UnisonExchange.MarketParams({
                    base: address(base),
                    quote: address(c.ausd),
                    refAdapter: address(c.osr),
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

        LiquidityVault vault = _vault(c, i, mkt, s);
        c.ex.addSource(mkt, address(vault));
        uint256 seedPrice = vm.parseJsonUint(json, _key(i, "seedPrice"));
        uint256 seed = c.seedTokens * seedPrice; // AUSD worth `seedTokens` whole tokens at the seed price
        c.ausd.mint(c.deployer, seed);
        c.ausd.approve(address(vault), seed);
        vault.requestDeposit(seed);
        _recordMarket(c, i, mkt, address(base), address(vault), seedPrice);
    }

    function _vault(Ctx memory c, uint256 i, uint256 mkt, Stock memory s) internal returns (LiquidityVault) {
        uint256[] memory v = vm.parseJsonUintArray(json, _key(i, "vault"));
        require(v.length == 8, "vault parameters");
        return new LiquidityVault(
            c.deployer,
            IUnisonVenue(address(c.ex)),
            mkt,
            string.concat("Unison ", s.symbol, " Liquidity"),
            string.concat("u", s.ticker, "-LP"),
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
        );
    }

    function _topUp(Ctx memory c) internal {
        uint256 amount = vm.envOr("GAS_TOPUP_WEI", uint256(0));
        if (amount == 0) return;
        (bool ok,) = c.keeper.call{value: amount}("");
        require(ok, "keeper top-up");
        (ok,) = c.relayer.call{value: amount}("");
        require(ok, "relayer top-up");
    }

    function _recordToken(MockERC20 t) internal {
        string memory sym = t.symbol();
        string memory k = string.concat("token.", sym);
        vm.serializeAddress(k, "address", address(t));
        vm.serializeString(k, "symbol", sym);
        vm.serializeString(k, "name", t.name());
        tokensJson = vm.serializeString("tokens", sym, vm.serializeUint(k, "decimals", t.decimals()));
    }

    /// The Deploy.s.sol market record (plus seedPrice).
    function _recordMarket(Ctx memory c, uint256 i, uint256 mkt, address base, address vault, uint256 seedPrice)
        internal
    {
        string memory sym = vm.parseJsonString(json, _key(i, "symbol"));
        string memory o = string.concat("market.", sym);
        vm.serializeString(o, "symbol", sym);
        vm.serializeUint(o, "id", mkt);
        vm.serializeAddress(o, "base", base);
        vm.serializeAddress(o, "quote", address(c.ausd));
        vm.serializeString(o, "reference", "operator");
        vm.serializeAddress(o, "vault", vault);
        marketsJson = vm.serializeString("markets", sym, vm.serializeUint(o, "seedPrice", seedPrice));
    }

    function _write(Ctx memory c) internal {
        string memory ac = "accounts";
        vm.serializeAddress(ac, "deployer", c.deployer);
        vm.serializeAddress(ac, "keeper", c.keeper);
        vm.serializeAddress(ac, "relay", c.relaySigner);
        string memory accounts = vm.serializeAddress(ac, "relayer", c.relayer);

        string memory root = "root";
        vm.serializeUint(root, "chainId", block.chainid);
        vm.serializeString(root, "label", "monad-testnet");
        vm.serializeUint(root, "startBlock", c.startBlock);
        vm.serializeAddress(root, "exchange", address(c.ex));
        vm.serializeAddress(root, "operatorReference", address(c.osr));
        vm.serializeAddress(root, "gateway", address(c.gateway));
        vm.serializeAddress(root, "admin", c.deployer);
        vm.serializeString(root, "accounts", accounts);
        vm.serializeString(root, "tokens", tokensJson);
        string memory out = vm.serializeString(root, "markets", marketsJson);
        string memory path = string.concat("../deployments/", vm.envOr("DEPLOY_OUT", string("monad-testnet")), ".json");
        vm.writeJson(out, path);
        console.log("UnisonExchange", address(c.ex));
        console.log("written", path);
    }
}

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

/// @notice Full local devnet: mock tokens, exchange, operator-signed reference (relay = anvil account 1),
///         aNVDA/AUSD and aSPY/AUSD markets calibrated from research/, a seeded LiquidityVault per market and
///         three funded traders. Writes ../deployments/<DEVNET_OUT>.json for the services, SDK and mock server:
///         by default <chainId>.json, except on an anvil with Monad testnet's chain id (the CRE simulation),
///         which writes cre-local.json so it is never mistaken for the public testnet's monad-testnet.json.
///
///   anvil --code-size-limit 131072 --block-time 1
///   forge script script/DevNet.s.sol --rpc-url http://127.0.0.1:8545 --broadcast
contract DevNet is Script {
    // anvil's well-known dev keys (never use outside a local chain)
    uint256 internal constant PK_DEPLOYER = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
    uint256 internal constant PK_RELAY = 0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d;
    uint256 internal constant PK_KEEPER = 0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a;
    uint256[3] internal PK_TRADERS = [
        0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6,
        0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a,
        0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba
    ];

    struct Deployed {
        MockERC20 ausd;
        MockERC20 nvda;
        MockERC20 spy;
        UnisonExchange ex;
        OperatorSignedReference osr;
        uint256 nvdaMkt;
        uint256 spyMkt;
        LiquidityVault nvdaVault;
        LiquidityVault spyVault;
        OrderGateway gateway;
        uint256 startBlock;
    }

    function run() external {
        Deployed memory d;
        d.startBlock = vm.getBlockNumber(); // indexers start here
        address deployer = vm.addr(PK_DEPLOYER);
        vm.startBroadcast(PK_DEPLOYER);
        d.ausd = new MockERC20("Agora USD (dev)", "AUSD", 6);
        d.nvda = new MockERC20("Anchored NVIDIA (dev)", "aNVDA", 18);
        d.spy = new MockERC20("Anchored SPDR S&P 500 (dev)", "aSPY", 18);

        UnisonExchange impl = new UnisonExchange();
        d.ex = UnisonExchange(
            address(new ERC1967Proxy(address(impl), abi.encodeCall(UnisonExchange.initialize, (deployer))))
        );
        d.osr = new OperatorSignedReference(deployer, address(d.ex), IERC20(address(d.ausd)), 1, 30_000);
        d.osr.addEcdsaSigner(vm.addr(PK_RELAY));
        d.gateway = new OrderGateway(IGatewayVenue(address(d.ex)));
        d.ex.grantRole(d.ex.GATEWAY_ROLE(), address(d.gateway));
        // the gateway is granted: from now on only an upgrade can add one
        d.ex.initializeV2();

        d.ex.listToken(address(d.ausd), false);
        d.ex.listToken(address(d.nvda), false);
        d.ex.listToken(address(d.spy), false);

        // aNVDA: $0.01 ticks, ±1% live band, weekend p99 gap 7.26% (research/weekend_gaps)
        d.nvdaMkt = d.ex.createMarket(_params(address(d.nvda), address(d.ausd), address(d.osr), 100, 2801));
        d.ex.setRegime(d.nvdaMkt, 200, 726, 100, 726, 235_800, 10);
        // aSPY: ±0.5% live band, weekend p99 gap 2.55%
        d.spyMkt = d.ex.createMarket(_params(address(d.spy), address(d.ausd), address(d.osr), 50, 3401));
        d.ex.setRegime(d.spyMkt, 100, 255, 50, 255, 235_800, 10);

        d.nvdaVault = _vault(d.ex, d.nvdaMkt, "Unison aNVDA Liquidity", "uNVDA-LP");
        d.spyVault = _vault(d.ex, d.spyMkt, "Unison aSPY Liquidity", "uSPY-LP");
        d.ex.addSource(d.nvdaMkt, address(d.nvdaVault));
        d.ex.addSource(d.spyMkt, address(d.spyVault));

        // LP seed: queued deposits execute at the first reference the relay publishes (keeper calls process())
        d.ausd.mint(deployer, 2_000_000e6);
        d.ausd.approve(address(d.nvdaVault), type(uint256).max);
        d.ausd.approve(address(d.spyVault), type(uint256).max);
        d.nvdaVault.requestDeposit(1_000_000e6);
        d.spyVault.requestDeposit(1_000_000e6);

        for (uint256 i = 0; i < 3; ++i) {
            address t = vm.addr(PK_TRADERS[i]);
            d.ausd.mint(t, 1_000_000e6);
            d.nvda.mint(t, 1000e18);
            d.spy.mint(t, 500e18);
        }
        vm.stopBroadcast();

        for (uint256 i = 0; i < 3; ++i) {
            vm.startBroadcast(PK_TRADERS[i]);
            d.ausd.approve(address(d.ex), type(uint256).max);
            d.nvda.approve(address(d.ex), type(uint256).max);
            d.spy.approve(address(d.ex), type(uint256).max);
            d.ex.deposit(address(d.ausd), 500_000e6);
            d.ex.deposit(address(d.nvda), 500e18);
            d.ex.deposit(address(d.spy), 250e18);
            vm.stopBroadcast();
        }
        _write(d);
    }

    function _params(address base, address quote, address adapter, uint16 bandBps, uint32 maxBandTicks)
        internal
        pure
        returns (UnisonExchange.MarketParams memory)
    {
        return UnisonExchange.MarketParams({
            base: base,
            quote: quote,
            refAdapter: adapter,
            tickSize: 10_000,
            minTick: 1,
            maxTick: uint32((1 << 21) - 1),
            maxBandTicks: maxBandTicks,
            bandBps: bandBps,
            feeBps: 3,
            maxFeeBps: 10,
            shards: 4,
            permissioned: false,
            strictAfterClose: false
        });
    }

    function _vault(UnisonExchange ex, uint256 mkt, string memory name, string memory sym)
        internal
        returns (LiquidityVault)
    {
        return new LiquidityVault(
            vm.addr(PK_DEPLOYER),
            IUnisonVenue(address(ex)),
            mkt,
            name,
            sym,
            LiquidityVault.Params({
                spreadBps: 10,
                depthBps: 40,
                widthTicks: 10,
                maxSkewTicks: 15,
                maxAuctionBps: 1000,
                swingBps: 30,
                extMult: 2,
                closedMult: 4,
                paused: false
            })
        );
    }

    /// Token metadata for deployments/*.json `tokens`.
    function _token(MockERC20 t) internal returns (string memory) {
        string memory k = string.concat("token.", t.symbol());
        vm.serializeAddress(k, "address", address(t));
        vm.serializeString(k, "symbol", t.symbol());
        vm.serializeString(k, "name", t.name());
        return vm.serializeUint(k, "decimals", t.decimals());
    }

    function _write(Deployed memory d) internal {
        string memory m1 = "nvda";
        vm.serializeString(m1, "symbol", "aNVDA/AUSD");
        vm.serializeUint(m1, "id", d.nvdaMkt);
        vm.serializeAddress(m1, "base", address(d.nvda));
        vm.serializeAddress(m1, "quote", address(d.ausd));
        vm.serializeAddress(m1, "vault", address(d.nvdaVault));
        vm.serializeString(m1, "reference", "operator");
        string memory j1 = vm.serializeUint(m1, "seedPrice", 180e6);
        string memory m2 = "spy";
        vm.serializeString(m2, "symbol", "aSPY/AUSD");
        vm.serializeUint(m2, "id", d.spyMkt);
        vm.serializeAddress(m2, "base", address(d.spy));
        vm.serializeAddress(m2, "quote", address(d.ausd));
        vm.serializeAddress(m2, "vault", address(d.spyVault));
        vm.serializeString(m2, "reference", "operator");
        string memory j2 = vm.serializeUint(m2, "seedPrice", 660e6);

        string memory mk = "markets";
        vm.serializeString(mk, "aNVDA/AUSD", j1);
        string memory markets = vm.serializeString(mk, "aSPY/AUSD", j2);

        string memory ac = "accounts";
        vm.serializeAddress(ac, "deployer", vm.addr(PK_DEPLOYER));
        vm.serializeAddress(ac, "relay", vm.addr(PK_RELAY));
        vm.serializeAddress(ac, "keeper", vm.addr(PK_KEEPER));
        vm.serializeAddress(ac, "trader1", vm.addr(PK_TRADERS[0]));
        vm.serializeAddress(ac, "trader2", vm.addr(PK_TRADERS[1]));
        string memory accounts = vm.serializeAddress(ac, "trader3", vm.addr(PK_TRADERS[2]));

        string memory tk = "tokens";
        vm.serializeString(tk, "AUSD", _token(d.ausd));
        vm.serializeString(tk, "aNVDA", _token(d.nvda));
        string memory tokens = vm.serializeString(tk, "aSPY", _token(d.spy));

        string memory root = "root";
        vm.serializeUint(root, "chainId", block.chainid);
        vm.serializeUint(root, "startBlock", d.startBlock);
        vm.serializeAddress(root, "exchange", address(d.ex));
        vm.serializeAddress(root, "operatorReference", address(d.osr));
        vm.serializeAddress(root, "gateway", address(d.gateway));
        vm.serializeAddress(root, "AUSD", address(d.ausd));
        vm.serializeAddress(root, "aNVDA", address(d.nvda));
        vm.serializeAddress(root, "aSPY", address(d.spy));
        vm.serializeString(root, "tokens", tokens);
        vm.serializeString(root, "accounts", accounts);
        string memory out = vm.serializeString(root, "markets", markets);
        string memory label =
            vm.envOr("DEVNET_OUT", block.chainid == 10_143 ? string("cre-local") : vm.toString(block.chainid));
        string memory path = string.concat("../deployments/", label, ".json");
        vm.writeJson(out, path);
        console.log("UnisonExchange", address(d.ex));
        console.log("written", path);
    }
}

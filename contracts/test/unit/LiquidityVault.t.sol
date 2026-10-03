// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {UnisonExchange} from "../../src/core/UnisonExchange.sol";
import {ManualReference} from "../../src/pricing/ManualReference.sol";
import {IReferenceAdapter} from "../../src/interfaces/IReferenceAdapter.sol";
import {ICurveSource} from "../../src/interfaces/ICurveSource.sol";
import {LiquidityVault, IUnisonVenue} from "../../src/liquidity/LiquidityVault.sol";
import {MockERC20} from "../mocks/MockERC20.sol";

contract LiquidityVaultTest is Test {
    UnisonExchange internal ex;
    ManualReference internal ref;
    MockERC20 internal nvda;
    MockERC20 internal ausd;
    LiquidityVault internal vault;
    uint256 internal mkt;

    address internal lp = makeAddr("lp");
    address internal lp2 = makeAddr("lp2");
    address internal bob = makeAddr("bob"); // seller
    address internal alice = makeAddr("alice"); // buyer

    IReferenceAdapter.Status internal constant OPEN = IReferenceAdapter.Status.OPEN;
    IReferenceAdapter.Status internal constant CLOSED = IReferenceAdapter.Status.CLOSED;

    function setUp() public {
        vm.warp(1_760_000_000);
        nvda = new MockERC20("Anchored NVDA", "aNVDA", 18);
        ausd = new MockERC20("Agora USD", "AUSD", 6);
        ref = new ManualReference(address(this));
        UnisonExchange impl = new UnisonExchange();
        ex = UnisonExchange(
            address(new ERC1967Proxy(address(impl), abi.encodeCall(UnisonExchange.initialize, (address(this)))))
        );
        ex.listToken(address(nvda), false);
        ex.listToken(address(ausd), false);
        mkt = ex.createMarket(
            UnisonExchange.MarketParams({
                base: address(nvda),
                quote: address(ausd),
                refAdapter: address(ref),
                tickSize: 10_000,
                minTick: 1,
                maxTick: uint32((1 << 21) - 1),
                maxBandTicks: 2001,
                bandBps: 100,
                feeBps: 2,
                maxFeeBps: 10,
                shards: 4,
                permissioned: false,
                strictAfterClose: false
            })
        );
        vault = new LiquidityVault(
            address(this),
            IUnisonVenue(address(ex)),
            mkt,
            "Unison aNVDA Liquidity",
            "uNVDA-LP",
            LiquidityVault.Params({
                spreadBps: 20,
                depthBps: 100,
                widthTicks: 5,
                maxSkewTicks: 10,
                maxAuctionBps: 2_000,
                swingBps: 30,
                extMult: 2,
                closedMult: 4,
                paused: false
            })
        );
        ex.addSource(mkt, address(vault));

        _fundUser(bob, 100e18, 0);
        _fundUser(alice, 0, 100_000e6);
        ausd.mint(lp, 100_000e6);
        ausd.mint(lp2, 50_000e6);
    }

    function _fundUser(address a, uint256 n, uint256 q) internal {
        nvda.mint(a, n);
        ausd.mint(a, q);
        vm.startPrank(a);
        nvda.approve(address(ex), type(uint256).max);
        ausd.approve(address(ex), type(uint256).max);
        if (n > 0) ex.deposit(address(nvda), n);
        if (q > 0) ex.deposit(address(ausd), q);
        vm.stopPrank();
    }

    function _clearAt(uint256 px, IReferenceAdapter.Status st) internal returns (uint256 tick, uint256 vol) {
        vm.roll(block.number + 1);
        vm.warp(block.timestamp + 1);
        ref.post(mkt, px, block.timestamp * 1000, st);
        return ex.clear(mkt, "");
    }

    function _lpDeposit(address who, uint256 amt) internal {
        vm.startPrank(who);
        ausd.approve(address(vault), amt);
        vault.requestDeposit(amt);
        vm.stopPrank();
    }

    function _seed() internal {
        _lpDeposit(lp, 100_000e6);
        _clearAt(180e6, OPEN);
        assertEq(vault.process(), 1);
        (uint256 b, uint256 q) = vault.balances();
        assertEq(b, 0);
        assertEq(q, 100_000e6);
    }

    function test_vaultBuysFromSeller_atUniformPrice() public {
        _seed();
        vm.prank(bob);
        uint256 s = ex.placeOrder(mkt, 1, 17_900, 10e18, 0); // sells 10 at >= $179.00
        (uint256 tick, uint256 vol) = _clearAt(180e6, OPEN);
        assertEq(vol, 10e18);
        assertEq(tick, 17_973, "min-imbalance tick inside the vault's bid curve");
        (uint256 b, uint256 q) = vault.balances();
        assertEq(b, 10e18);
        assertEq(q, 100_000e6 - 1_797_300_000);
        assertEq(vault.spreadPnl(), 2_700_000, "bought $0.27 under the reference x 10");

        uint256[] memory sl = new uint256[](1);
        sl[0] = s;
        ex.claim(bob, sl);
        // seller gets the same uniform price (minus 2 bps fee)
        assertEq(ex.balanceOf(bob, address(ausd)), 1_797_300_000 - 359_460);
    }

    function test_attribution_reconcilesNav() public {
        _seed();
        vm.prank(bob);
        ex.placeOrder(mkt, 1, 17_900, 10e18, 0);
        _clearAt(180e6, OPEN);
        vm.prank(alice);
        ex.placeOrder(mkt, 0, 18_100, 5e18, 0);
        (uint256 tick, uint256 vol) = _clearAt(180e6, OPEN);
        assertEq(vol, 5e18);
        assertEq(tick, 18_047);
        assertEq(vault.spreadPnl(), 2_700_000 + 2_350_000);

        _clearAt(181e6, OPEN); // reference moves, no trade
        vault.process(); // marks inventory
        assertEq(vault.inventoryPnl(), 5_000_000, "5 NVDA x $1");
        int256 navChange = int256(vault.navAt(181e6)) - int256(100_000e6);
        assertEq(navChange, vault.spreadPnl() + vault.inventoryPnl(), "NAV change fully attributed");
    }

    function test_curve_widensByRegime_andSkewsWithInventory() public {
        _seed();
        ICurveSource.Curve memory o = vault.curve(mkt, 180e6, uint8(OPEN), 18_000, 17_820, 18_180);
        ICurveSource.Curve memory c = vault.curve(mkt, 180e6, uint8(CLOSED), 18_000, 17_820, 18_180);
        assertEq(o.bidTop, 18_000 - 36 + 10, "flat-quote vault skews bids up to buy inventory");
        assertEq(c.bidTop, 18_000 - 144 + 10, "4x half-spread while the reference market is closed");
        ICurveSource.Curve memory h =
            vault.curve(mkt, 180e6, uint8(IReferenceAdapter.Status.HALTED), 18_000, 17_820, 18_180);
        assertEq(h.bidTicks + h.askTicks, 0, "never trades while halted");
    }

    function test_asyncFlows_executeOnlyAtLaterReference_withSwingWhenClosed() public {
        _seed();
        // request made now: the latest reference was published BEFORE it → must not execute yet
        _lpDeposit(lp2, 50_000e6);
        assertEq(vault.process(), 0);
        // weekend: reference CLOSED → swing fee 30 bps stays with existing LPs
        _clearAt(180e6, CLOSED);
        assertEq(vault.process(), 1);
        uint256 s2 = vault.balanceOf(lp2);
        uint256 s1 = vault.balanceOf(lp);
        // lp2 contributed 50k but owns slightly less than half of lp's stake (swing fee)
        assertLt(s2 * 2, s1);
        assertApproxEqRel(s2 * 2, s1 * 997 / 1000, 1e14);

        // redeem in kind at the next reference
        vm.prank(lp);
        vault.requestRedeem(s1);
        assertEq(vault.process(), 0);
        _clearAt(180e6, OPEN);
        vault.process();
        assertEq(vault.balanceOf(lp), 0);
        // lp1 owns 2/3 of the pool after lp2's deposit, so it earns 2/3 of lp2's 150 AUSD swing fee
        assertApproxEqAbs(ausd.balanceOf(lp), 100_100.1e6, 1e3, "lp1 earns the swing fee paid by lp2");
    }

    function test_venueSolvency_withVaultTrading() public {
        _seed();
        vm.prank(bob);
        uint256 s = ex.placeOrder(mkt, 1, 17_900, 10e18, 0);
        _clearAt(180e6, OPEN);
        vm.prank(alice);
        uint256 a = ex.placeOrder(mkt, 0, 18_100, 5e18, 0);
        _clearAt(180e6, OPEN);
        uint256[] memory sl = new uint256[](1);
        sl[0] = s;
        vm.prank(bob);
        ex.cancelOrder(s);
        sl[0] = a;
        vm.prank(alice);
        ex.cancelOrder(a);
        uint256 ledgerN = ex.balanceOf(bob, address(nvda)) + ex.balanceOf(alice, address(nvda))
            + ex.balanceOf(address(vault), address(nvda)) + ex.balanceOf(address(ex), address(nvda));
        uint256 ledgerQ = ex.balanceOf(bob, address(ausd)) + ex.balanceOf(alice, address(ausd))
            + ex.balanceOf(address(vault), address(ausd)) + ex.balanceOf(address(ex), address(ausd));
        assertGe(nvda.balanceOf(address(ex)), ledgerN);
        assertGe(ausd.balanceOf(address(ex)), ledgerQ);
        assertLe(ausd.balanceOf(address(ex)) - ledgerQ, 10, "only rounding dust unallocated");
        assertEq(nvda.balanceOf(address(ex)), ledgerN, "base exactly conserved");
    }
}

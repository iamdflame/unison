// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {UnisonExchange} from "../../src/core/UnisonExchange.sol";
import {ManualReference} from "../../src/pricing/ManualReference.sol";
import {IReferenceAdapter} from "../../src/interfaces/IReferenceAdapter.sol";
import {LiquidityVault, IUnisonVenue} from "../../src/liquidity/LiquidityVault.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {MockFreezableERC20} from "../mocks/MockFreezableERC20.sol";

/// @notice The vault's queue against an issuer freeze (docs/evidence/static-analysis.md): in v1 a redemption the token
///         refused reverted process(), and every request behind it waited forever. v2 holds the refused amount for its
///         owner and moves on.
contract LiquidityVaultQueueTest is Test {
    UnisonExchange internal ex;
    ManualReference internal ref;
    MockERC20 internal nvda;
    MockFreezableERC20 internal ausd;
    LiquidityVault internal vault;
    uint256 internal mkt;

    address internal lp = makeAddr("lp");
    address internal lp2 = makeAddr("lp2");
    address internal lp3 = makeAddr("lp3");

    function setUp() public {
        vm.warp(1_760_000_000);
        nvda = new MockERC20("Anchored NVDA", "aNVDA", 18);
        ausd = new MockFreezableERC20("Agora USD", "AUSD", 6);
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
        // three LPs of 30k, 20k and 10k AUSD
        _deposit(lp, 30_000e6);
        _deposit(lp2, 20_000e6);
        _deposit(lp3, 10_000e6);
        _reference();
        assertEq(vault.process(), 3);
    }

    function _deposit(address who, uint256 amt) internal {
        ausd.mint(who, amt);
        vm.startPrank(who);
        ausd.approve(address(vault), amt);
        vault.requestDeposit(amt);
        vm.stopPrank();
    }

    function _redeemAll(address who) internal {
        uint256 shares = vault.balanceOf(who);
        vm.prank(who);
        vault.requestRedeem(shares);
    }

    /// a reference published after every request so far
    function _reference() internal {
        vm.roll(block.number + 1);
        vm.warp(block.timestamp + 1);
        ref.post(mkt, 180e6, block.timestamp * 1000, IReferenceAdapter.Status.OPEN);
        ex.clear(mkt, "");
    }

    function test_frozenRedeemer_doesNotStopTheQueue() public {
        _redeemAll(lp);
        _redeemAll(lp2);
        ausd.freeze(lp, true); // the issuer freezes the first redeemer after the request
        _reference();
        assertEq(vault.process(), 2, "both redemptions settle: v1 reverted here, and forever");
        assertEq(ausd.balanceOf(lp2), 20_000e6, "the LP behind the frozen one is paid");
        assertEq(vault.held(lp, address(ausd)), 30_000e6, "the frozen LP's redemption is held for them");
        assertEq(ausd.balanceOf(address(vault)), 30_000e6, "outside the vault's ledger balance");
        (uint256 b, uint256 q) = vault.balances();
        assertEq(b, 0);
        assertEq(q, 10_000e6, "only lp3's money is still quoted and counted");
        assertEq(vault.navAt(180e6), 10_000e6);
        assertEq(vault.totalSupply(), vault.balanceOf(lp3));
    }

    function test_heldRedemption_claimedOnceUnfrozen() public {
        _redeemAll(lp);
        ausd.freeze(lp, true);
        _reference();
        vault.process();
        vm.prank(lp);
        vm.expectRevert(abi.encodeWithSelector(MockFreezableERC20.Frozen.selector, lp));
        vault.claim(address(ausd)); // still frozen: nothing changes
        assertEq(vault.held(lp, address(ausd)), 30_000e6);

        ausd.freeze(lp, false);
        vm.prank(lp);
        vault.claim(address(ausd));
        assertEq(ausd.balanceOf(lp), 30_000e6, "paid through the exchange once the issuer allows it");
        assertEq(vault.held(lp, address(ausd)), 0);
        assertEq(ausd.balanceOf(address(vault)), 0);
        (, uint256 q) = vault.balances();
        assertEq(q, 30_000e6, "lp2 and lp3 untouched");
    }

    function test_claim_onlyTheOwner_onlyWhatIsHeld() public {
        _redeemAll(lp);
        ausd.freeze(lp, true);
        _reference();
        vault.process();
        vm.prank(lp2);
        vm.expectRevert(LiquidityVault.ZeroAmount.selector);
        vault.claim(address(ausd)); // nothing is held for lp2
        vm.prank(lp);
        vm.expectRevert(LiquidityVault.ZeroAmount.selector);
        vault.claim(address(nvda)); // nothing in aNVDA either
    }

    function test_heldAmount_isNeitherQuotedNorTraded() public {
        _redeemAll(lp);
        ausd.freeze(lp, true);
        _reference();
        vault.process();
        // the curve sizes from what is left: lp2 + lp3 = 30k, not 60k
        (, uint256 q) = vault.balances();
        assertEq(q, 30_000e6);
        assertEq(vault.version(), 2);
    }
}

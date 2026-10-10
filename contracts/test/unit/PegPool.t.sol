// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {UnisonExchange} from "../../src/core/UnisonExchange.sol";
import {ManualReference} from "../../src/pricing/ManualReference.sol";
import {IReferenceAdapter} from "../../src/interfaces/IReferenceAdapter.sol";
import {ICurveSource} from "../../src/interfaces/ICurveSource.sol";
import {IUnisonVenue} from "../../src/liquidity/LiquidityVault.sol";
import {PegPool} from "../../src/liquidity/PegPool.sol";
import {MockERC20} from "../mocks/MockERC20.sol";

/// @notice Pegged orders as a curve source (docs/ROADMAP.md, B): one level at a fixed offset from each reference,
///         shared pro rata, joined and left asynchronously.
contract PegPoolTest is Test {
    UnisonExchange internal ex;
    ManualReference internal ref;
    MockERC20 internal nvda;
    MockERC20 internal ausd;
    PegPool internal bidPool; // buys aNVDA 5 bp under the reference
    PegPool internal askPool; // sells aNVDA 5 bp over it
    uint256 internal mkt;

    address internal alice = makeAddr("alice");
    address internal carol = makeAddr("carol");
    address internal bob = makeAddr("bob"); // trades against the pools

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
        bidPool = new PegPool(IUnisonVenue(address(ex)), mkt, true, 5, "aNVDA bid -5bp", "uNVDA-B5");
        askPool = new PegPool(IUnisonVenue(address(ex)), mkt, false, 5, "aNVDA ask +5bp", "uNVDA-A5");
        ex.addSource(mkt, address(bidPool));
        ex.addSource(mkt, address(askPool));

        // bob trades on the exchange; the pools' depositors hold tokens in their wallets
        nvda.mint(bob, 100e18);
        ausd.mint(bob, 100_000e6);
        vm.startPrank(bob);
        nvda.approve(address(ex), type(uint256).max);
        ausd.approve(address(ex), type(uint256).max);
        ex.deposit(address(nvda), 100e18);
        ex.deposit(address(ausd), 100_000e6);
        vm.stopPrank();
        ausd.mint(alice, 100_000e6);
        ausd.mint(carol, 100_000e6);
        nvda.mint(alice, 100e18);
    }

    /// a reference published after everything so far
    function _clearAt(uint256 px, IReferenceAdapter.Status st) internal returns (uint256 tick, uint256 vol) {
        vm.roll(vm.getBlockNumber() + 1);
        vm.warp(vm.getBlockTimestamp() + 1);
        ref.post(mkt, px, vm.getBlockTimestamp() * 1000, st);
        return ex.clear(mkt, "");
    }

    function _join(PegPool p, address who, uint256 amt) internal {
        vm.startPrank(who);
        p.asset().approve(address(p), amt);
        p.requestDeposit(amt);
        vm.stopPrank();
    }

    function _exit(PegPool p, address who) internal {
        uint256 shares = p.balanceOf(who);
        vm.prank(who);
        p.requestRedeem(shares);
    }

    function test_bidPool_quotesOneLevelUnderTheReference_onlyWhileItTrades() public {
        _join(bidPool, alice, 18_000e6);
        _clearAt(180e6, OPEN);
        assertEq(bidPool.process(), 1);
        ICurveSource.Curve memory c = bidPool.curve(mkt, 180e6, uint8(OPEN), 18_000, 17_820, 18_180);
        assertEq(c.bidTop, 18_000 - 9, "5 bp of 18,000 ticks, rounded up to 9");
        assertEq(c.bidTicks, 1);
        assertEq(c.bidPerTick, uint256(18_000e6) * 1e18 / (17_991 * 10_000), "every AUSD it holds, at that level's price");
        assertEq(c.askTicks, 0, "a bid pool offers nothing");
        ICurveSource.Curve memory closed = bidPool.curve(mkt, 180e6, uint8(CLOSED), 18_000, 17_820, 18_180);
        assertEq(closed.bidTicks + closed.askTicks, 0, "no peg while the reference market is closed");
    }

    function test_bidPool_buysAtItsPegOrBetter() public {
        _join(bidPool, alice, 18_000e6);
        _clearAt(180e6, OPEN);
        bidPool.process();
        vm.prank(bob);
        ex.placeOrder(mkt, 1, 17_900, 10e18, 0); // sells 10 at $179.00 or more
        (uint256 tick, uint256 vol) = _clearAt(180e6, OPEN);
        assertEq(vol, 10e18);
        assertEq(tick, 17_991, "the pool's peg sets the price");
        (uint256 b, uint256 q) = bidPool.balances();
        assertEq(b, 10e18, "the pool bought the base");
        assertEq(q, 18_000e6 - 1_799_100_000, "and paid the auction's price, with no fee");
    }

    function test_twoDepositors_shareEveryFillProRata() public {
        _join(bidPool, alice, 6_000e6);
        _join(bidPool, carol, 18_000e6);
        _clearAt(180e6, OPEN);
        assertEq(bidPool.process(), 2);
        vm.prank(bob);
        ex.placeOrder(mkt, 1, 17_900, 20e18, 0);
        _clearAt(180e6, OPEN);
        _exit(bidPool, alice);
        _exit(bidPool, carol);
        _clearAt(180e6, OPEN);
        assertEq(bidPool.process(), 2);
        // alice owned a quarter: a quarter of the 20 aNVDA bought and of the AUSD left
        assertApproxEqAbs(nvda.balanceOf(alice), 100e18 + 5e18, 1e6);
        assertApproxEqAbs(ausd.balanceOf(alice), 100_000e6 - 6_000e6 + (24_000e6 - 3_598_200_000) / 4, 10);
        assertApproxEqAbs(nvda.balanceOf(carol), 15e18, 1e6);
        assertApproxEqAbs(ausd.balanceOf(carol), 100_000e6 - 18_000e6 + (24_000e6 - 3_598_200_000) * 3 / 4, 10);
        assertEq(bidPool.totalSupply(), 0);
    }

    function test_askPool_sellsAtItsPegOrBetter() public {
        _join(askPool, alice, 10e18);
        _clearAt(180e6, OPEN);
        askPool.process();
        ICurveSource.Curve memory c = askPool.curve(mkt, 180e6, uint8(OPEN), 18_000, 17_820, 18_180);
        assertEq(c.askBottom, 18_009);
        assertEq(c.askPerTick, 10e18);
        vm.prank(bob);
        ex.placeOrder(mkt, 0, 18_100, 4e18, 0); // buys 4 at $181.00 or less
        (uint256 tick, uint256 vol) = _clearAt(180e6, OPEN);
        assertEq(vol, 4e18);
        assertEq(tick, 18_009);
        (uint256 b, uint256 q) = askPool.balances();
        assertEq(b, 6e18);
        assertEq(q, 720_360_000, "4 x $180.09");
    }

    function test_deposits_waitForALiveReference_redemptionsDoNot() public {
        _join(bidPool, alice, 6_000e6);
        _clearAt(180e6, OPEN);
        bidPool.process();
        _join(bidPool, carol, 18_000e6);
        _exit(bidPool, alice);
        _clearAt(180e6, CLOSED); // the weekend: a reference after both requests, but a stale one
        assertEq(bidPool.process(), 1, "the redemption, in kind, needs no price");
        assertEq(ausd.balanceOf(alice), 100_000e6, "alice is out");
        (uint256 d,) = bidPool.pending();
        assertEq(d, 1, "carol's deposit waits for the market to trade");
        _clearAt(181e6, OPEN);
        assertEq(bidPool.process(), 1);
        assertGt(bidPool.balanceOf(carol), 0);
    }

    function test_onAuction_onlyFromTheVenue_andParamsAreChecked() public {
        vm.expectRevert(PegPool.NotVenue.selector);
        bidPool.onAuction(mkt, 1, 1, 1, 1, 1, 0, 0);
        vm.expectRevert(PegPool.BadParams.selector);
        new PegPool(IUnisonVenue(address(ex)), mkt, true, 0, "x", "x");
        vm.expectRevert(PegPool.BadParams.selector);
        new PegPool(IUnisonVenue(address(ex)), mkt, true, 1_001, "x", "x");
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {UnisonExchange} from "../../src/core/UnisonExchange.sol";
import {IReferenceAdapter} from "../../src/interfaces/IReferenceAdapter.sol";
import {ICausalReference} from "../../src/interfaces/ICausalReference.sol";
import {AggregatorV3Interface} from "../../src/interfaces/external/AggregatorV3Interface.sol";
import {ChainlinkCausalReference} from "../../src/pricing/ChainlinkCausalReference.sol";
import {ManualReference} from "../../src/pricing/ManualReference.sol";
import {LiquidityVault, IUnisonVenue} from "../../src/liquidity/LiquidityVault.sol";
import {ChallengeAccount} from "../../src/challenge/ChallengeAccount.sol";
import {LatencyChallenge} from "../../src/challenge/LatencyChallenge.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {MockOCR} from "./CausalReference.t.sol";

/// @notice The challenge on two markets that differ only in their rule. A sniper who sees each price move before the
///         oracle's report lands buys just ahead of it. On the market priced at the clear's own time (the older rule)
///         that edge is real and the pot pays. On the causal market the same orders price at the observation the
///         sniper saw coming, and the pot stays put.
contract LatencyChallengeTest is Test {
    uint256 internal constant T0 = 1_759_924_800; // a Wednesday
    uint8 internal constant SKEW = 2;
    uint32 internal constant HORIZON = 60;
    uint256 internal constant CYCLES = 6;

    UnisonExchange internal ex;
    MockOCR internal feed;
    ChainlinkCausalReference internal cref;
    ManualReference internal oldRef;
    MockERC20 internal nvda;
    MockERC20 internal ausd;
    uint256 internal causalMkt;
    uint256 internal oldMkt;
    LatencyChallenge internal onCausal;
    LatencyChallenge internal onOld;

    address internal sponsor = makeAddr("sponsor");
    address internal sniper = makeAddr("sniper");
    address internal team = makeAddr("team");
    address internal lp = makeAddr("lp");

    uint80 internal firstRound;
    // per cycle: the price the sniper sees coming, and the markout round of its fill
    uint80[] internal causalMarkouts;
    uint80[] internal oldMarkouts;

    function setUp() public {
        vm.warp(T0 - 600);
        nvda = new MockERC20("Anchored NVDA", "aNVDA", 18);
        ausd = new MockERC20("Agora USD", "AUSD", 6);
        feed = new MockOCR(8);
        firstRound = feed.report(180e8, vm.getBlockTimestamp() - 13);
        UnisonExchange impl = new UnisonExchange();
        ex = UnisonExchange(
            address(new ERC1967Proxy(address(impl), abi.encodeCall(UnisonExchange.initialize, (address(this)))))
        );
        ex.listToken(address(nvda), false);
        ex.listToken(address(ausd), false);
        cref = new ChainlinkCausalReference(address(this));
        oldRef = new ManualReference(address(this));
        causalMkt = ex.createMarket(_params(address(cref)));
        oldMkt = ex.createMarket(_params(address(oldRef)));
        cref.setFeed(
            causalMkt, AggregatorV3Interface(address(feed)), AggregatorV3Interface(address(0)), 6, 3900, 0, 0, 0, 0
        );
        ex.setCausal(causalMkt, address(cref), true, SKEW);
        _vault(causalMkt);
        _vault(oldMkt);

        address[] memory teamList = new address[](1);
        teamList[0] = team;
        onCausal = new LatencyChallenge(_terms(causalMkt, teamList));
        onOld = new LatencyChallenge(_terms(oldMkt, teamList));
        ausd.mint(address(onCausal), 25e6); // the pot
        ausd.mint(address(onOld), 1e6);

        ausd.mint(sniper, 100_000e6);
        vm.warp(T0);
    }

    // ------------------------------------------------------------------ helpers

    function _params(address adapter) internal view returns (UnisonExchange.MarketParams memory) {
        return UnisonExchange.MarketParams({
            base: address(nvda),
            quote: address(ausd),
            refAdapter: adapter,
            tickSize: 10_000,
            minTick: 1,
            maxTick: uint32((1 << 21) - 1),
            maxBandTicks: 4001,
            bandBps: 200,
            feeBps: 3,
            maxFeeBps: 10,
            shards: 1,
            permissioned: false,
            strictAfterClose: false
        });
    }

    function _terms(uint256 mkt, address[] memory teamList) internal view returns (LatencyChallenge.Terms memory) {
        return LatencyChallenge.Terms({
            pot: IERC20(address(ausd)),
            venue: address(ex),
            marketId: mkt,
            base: address(nvda),
            quote: address(ausd),
            markout: ICausalReference(address(cref)),
            markoutMarketId: causalMkt,
            start: uint64(T0),
            end: uint64(T0 + 30 days),
            horizonSec: HORIZON,
            epsilonBps: 2,
            minFills: uint32(CYCLES),
            sponsor: sponsor,
            team: teamList
        });
    }

    /// A vault holding AUSD and aNVDA, quoting 20 bp either side of its market's reference.
    function _vault(uint256 mkt) internal {
        LiquidityVault v = new LiquidityVault(
            address(this),
            IUnisonVenue(address(ex)),
            mkt,
            "LP",
            "LP",
            LiquidityVault.Params({
                spreadBps: 20,
                depthBps: 100,
                widthTicks: 5,
                maxSkewTicks: 0,
                maxAuctionBps: 2000,
                swingBps: 0,
                extMult: 2,
                closedMult: 255,
                paused: false
            })
        );
        ex.addSource(mkt, address(v));
        nvda.mint(address(this), 100e18);
        ausd.mint(address(this), 20_000e6);
        nvda.approve(address(ex), type(uint256).max);
        ausd.approve(address(ex), type(uint256).max);
        ex.depositFor(address(v), address(nvda), 100e18);
        ex.depositFor(address(v), address(ausd), 20_000e6);
    }

    function _next(uint256 dt) internal {
        vm.roll(vm.getBlockNumber() + 1);
        vm.warp(vm.getBlockTimestamp() + dt);
    }

    /// One cycle. The sniper sees the price about to rise 1% and buys 1 aNVDA on both markets just before the oracle
    /// observes it. The old-rule market clears at once, at the reference it already had; the causal market clears at
    /// the first observation after the order: the one the sniper saw coming.
    function _cycle(ChallengeAccount onC, ChallengeAccount onO, int256 from, int256 to) internal {
        _next(5);
        uint256 t = vm.getBlockTimestamp();
        uint256 limit = (uint256(to) * 1010 / 1000) / 1e6; // up to 1% above the new price, in $0.01 ticks
        vm.startPrank(sniper);
        onC.order(0, limit, 1e18);
        onO.order(0, limit, 1e18);
        vm.stopPrank();
        // the old rule: the next block clears at the reference already published
        _next(1);
        oldRef.post(oldMkt, uint256(from) / 100, vm.getBlockTimestamp() * 1000, IReferenceAdapter.Status.OPEN);
        ex.clear(oldMkt, "");
        // the oracle observes the new price 4 s after the order and the report lands 13 s later
        vm.warp(t + 4 + 13);
        vm.roll(vm.getBlockNumber() + 1);
        uint80 jump = feed.report(to, t + 4);
        _next(1);
        ex.clear(causalMkt, abi.encode(jump, uint80(0)));
        onC.settle();
        onO.settle();
        // the price holds; the next observation, a minute later, is both fills' markout
        vm.warp(t + 65 + 13);
        vm.roll(vm.getBlockNumber() + 1);
        uint80 hold = feed.report(to, t + 65);
        causalMarkouts.push(hold);
        oldMarkouts.push(hold);
        _next(1);
        ex.clear(causalMkt, ""); // nothing waits: the reference moves on
    }

    function _run() internal returns (ChallengeAccount onC, ChallengeAccount onO) {
        vm.startPrank(sniper);
        onC = ChallengeAccount(onCausal.open());
        onO = ChallengeAccount(onOld.open());
        ausd.approve(address(onC), type(uint256).max);
        ausd.approve(address(onO), type(uint256).max);
        onC.deposit(address(ausd), 10_000e6);
        onO.deposit(address(ausd), 10_000e6);
        vm.stopPrank();
        int256 p = 180e8;
        for (uint256 i = 0; i < CYCLES; ++i) {
            int256 next = p * 101 / 100;
            _cycle(onC, onO, p, next);
            p = next;
        }
    }

    function _zeros(uint256 n) internal pure returns (uint80[] memory z) {
        z = new uint80[](n);
    }

    // ------------------------------------------------------------------ the result

    function test_theOldRulePaysTheSniper_theCausalRuleDoesNot() public {
        (ChallengeAccount onC, ChallengeAccount onO) = _run();
        assertEq(onO.fillCount(), CYCLES, "the old-rule market filled every snipe");
        assertEq(onC.fillCount(), CYCLES, "so did the causal market");

        (int256 oldEdge, uint256 oldNotional, uint256 oldFills) =
            onOld.edgeOf(address(onO), oldMarkouts, _zeros(CYCLES));
        (int256 newEdge,,) = onCausal.edgeOf(address(onC), causalMarkouts, _zeros(CYCLES));
        emit log_named_int("old rule: edge (AUSD units)", oldEdge);
        emit log_named_int("causal:   edge (AUSD units)", newEdge);
        assertEq(oldFills, CYCLES);
        assertGt(oldEdge * 10_000, int256(oldNotional) * 50, "about 1% a trade under the old rule");
        assertLt(newEdge, 0, "the causal rule leaves the sniper the spread and the fee to pay");

        // the causal pot stays
        vm.expectRevert(abi.encodeWithSelector(LatencyChallenge.NoEdge.selector, newEdge, _notional(onC)));
        onCausal.claim(address(onC), causalMarkouts, _zeros(CYCLES));
        // the old-rule pot pays its owner, at once
        onOld.claim(address(onO), oldMarkouts, _zeros(CYCLES));
        assertEq(ausd.balanceOf(sniper), 100_000e6 - 20_000e6 + 1e6, "the control's pot paid");
        assertTrue(onOld.paid());
        vm.expectRevert(LatencyChallenge.Closed.selector);
        onOld.claim(address(onO), oldMarkouts, _zeros(CYCLES));
    }

    function _notional(ChallengeAccount a) internal view returns (uint256 n) {
        for (uint256 i = 0; i < a.fillCount(); ++i) {
            n += a.fillAt(i).quote;
        }
    }

    // ------------------------------------------------------------------ the rules of the challenge

    function test_markoutRoundsAreProvenFirst() public {
        (, ChallengeAccount onO) = _run();
        uint80[] memory wrong = new uint80[](CYCLES);
        for (uint256 i = 0; i < CYCLES; ++i) {
            wrong[i] = oldMarkouts[i] - 1; // the jump, observed before the horizon
        }
        vm.expectRevert(ChainlinkCausalReference.NotAfterSeal.selector);
        onOld.edgeOf(address(onO), wrong, _zeros(CYCLES));
    }

    function test_everyFillCounts() public {
        (, ChallengeAccount onO) = _run();
        uint80[] memory some = new uint80[](CYCLES - 1);
        vm.expectRevert(LatencyChallenge.Rounds.selector);
        onOld.edgeOf(address(onO), some, _zeros(CYCLES));
    }

    function test_theTeamCannotEnter_andOneAccountEach() public {
        vm.prank(team);
        vm.expectRevert(LatencyChallenge.Team.selector);
        onCausal.open();
        vm.startPrank(sniper);
        onCausal.open();
        vm.expectRevert(LatencyChallenge.AlreadyOpen.selector);
        onCausal.open();
        vm.stopPrank();
    }

    function test_oneOrderAtATime_fundsMoveOnlyBetweenOrders() public {
        vm.startPrank(sniper);
        ChallengeAccount a = ChallengeAccount(onCausal.open());
        ausd.approve(address(a), type(uint256).max);
        a.deposit(address(ausd), 1000e6);
        a.order(0, 18_100, 1e18);
        vm.expectRevert(ChallengeAccount.OrderOpen.selector);
        a.order(0, 18_100, 1e18);
        vm.expectRevert(ChallengeAccount.OrderOpen.selector);
        a.withdraw(address(ausd), 1e6);
        vm.stopPrank();
        vm.expectRevert(ChallengeAccount.AuctionNotRun.selector);
        a.settle(); // its auction hasn't run: nothing to record yet
        vm.prank(makeAddr("stranger"));
        vm.expectRevert(ChallengeAccount.NotOwner.selector);
        a.withdraw(address(ausd), 1e6);
    }

    function test_theSponsorTakesBackAPotNobodyWon() public {
        vm.expectRevert(LatencyChallenge.StillOpen.selector);
        vm.prank(sponsor);
        onCausal.reclaim();
        vm.warp(T0 + 30 days + 3 days + 1);
        vm.prank(sniper);
        vm.expectRevert(LatencyChallenge.NotSponsor.selector);
        onCausal.reclaim();
        vm.prank(sponsor);
        onCausal.reclaim();
        assertEq(ausd.balanceOf(sponsor), 25e6);
    }
}

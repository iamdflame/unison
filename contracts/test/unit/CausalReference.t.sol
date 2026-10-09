// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {UnisonExchange} from "../../src/core/UnisonExchange.sol";
import {ExchangeBase} from "../../src/core/ExchangeBase.sol";
import {IReferenceAdapter} from "../../src/interfaces/IReferenceAdapter.sol";
import {AggregatorV3Interface} from "../../src/interfaces/external/AggregatorV3Interface.sol";
import {ChainlinkCausalReference} from "../../src/pricing/ChainlinkCausalReference.sol";
import {LiquidityVault, IUnisonVenue} from "../../src/liquidity/LiquidityVault.sol";
import {MockERC20} from "../mocks/MockERC20.sol";

/// @notice An OCR2 aggregator behind a proxy: every round keeps the time its observation was made (`startedAt`, signed
///         by the oracle quorum) and the time its report landed on chain (`updatedAt`). Round ids carry the proxy phase
///         in their top bits, like Chainlink's. Unknown rounds read as zeros, as OCR2 does.
contract MockOCR is AggregatorV3Interface {
    struct Round {
        int256 answer;
        uint256 observedAt;
        uint256 arrivedAt;
    }

    uint80 public constant PHASE = uint80(1) << 64;
    uint8 public immutable decimals;
    uint80 public latestId = PHASE;
    mapping(uint80 => Round) public rounds;

    constructor(uint8 d) {
        decimals = d;
    }

    /// @notice Lands a report now, observed at `observedAt`.
    function report(int256 answer, uint256 observedAt) external returns (uint80 id) {
        id = ++latestId;
        rounds[id] = Round(answer, observedAt, block.timestamp);
    }

    /// @notice Lands a report whose observation time is the arrival time (what a chain-clock feed would look like).
    function reportChainTime(int256 answer) external returns (uint80 id) {
        id = ++latestId;
        rounds[id] = Round(answer, block.timestamp, block.timestamp);
    }

    function description() external pure returns (string memory) {
        return "ocr2";
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        Round memory r = rounds[latestId];
        return (latestId, r.answer, r.observedAt, r.arrivedAt, latestId);
    }

    function getRoundData(uint80 id) external view returns (uint80, int256, uint256, uint256, uint80) {
        Round memory r = rounds[id];
        return (id, r.answer, r.observedAt, r.arrivedAt, id);
    }
}

contract CausalReferenceTest is Test {
    // Wed 2025-10-08 12:00 UTC
    uint256 internal constant T0 = 1_759_924_800;
    uint256 internal constant LAG = 13; // observation → on chain, as measured on Monad
    uint8 internal constant SKEW = 2;

    UnisonExchange internal ex;
    ChainlinkCausalReference internal cref;
    MockOCR internal nvdaUsd;
    MockOCR internal ausdUsd;
    MockERC20 internal nvda;
    MockERC20 internal ausd;
    LiquidityVault internal vault;
    uint256 internal mkt;

    address internal lp = makeAddr("lp");
    address internal bob = makeAddr("bob"); // seller
    address internal alice = makeAddr("alice"); // buyer
    address internal keeper = makeAddr("keeper");

    uint80 internal q0; // the AUSD round in force throughout

    function setUp() public {
        vm.warp(T0 - 600);
        nvda = new MockERC20("Anchored NVDA", "aNVDA", 18);
        ausd = new MockERC20("Agora USD", "AUSD", 6);
        nvdaUsd = new MockOCR(8);
        ausdUsd = new MockOCR(8);
        q0 = ausdUsd.report(1e8, vm.getBlockTimestamp() - LAG);
        vm.warp(T0 - 100);
        nvdaUsd.report(180e8, vm.getBlockTimestamp() - LAG);

        UnisonExchange impl = new UnisonExchange();
        ex = UnisonExchange(
            address(new ERC1967Proxy(address(impl), abi.encodeCall(UnisonExchange.initialize, (address(this)))))
        );
        ex.listToken(address(nvda), false);
        ex.listToken(address(ausd), false);
        cref = new ChainlinkCausalReference(address(this));
        mkt = ex.createMarket(
            UnisonExchange.MarketParams({
                base: address(nvda),
                quote: address(ausd),
                refAdapter: address(cref),
                tickSize: 10_000,
                minTick: 1,
                maxTick: uint32((1 << 21) - 1),
                maxBandTicks: 2001,
                bandBps: 100,
                feeBps: 0,
                maxFeeBps: 10,
                shards: 2,
                permissioned: false,
                strictAfterClose: true
            })
        );
        cref.setFeed(
            mkt,
            AggregatorV3Interface(address(nvdaUsd)),
            AggregatorV3Interface(address(ausdUsd)),
            6,
            3900,
            90_000,
            0,
            0,
            50
        );
        ex.setCausal(mkt, address(cref), true, SKEW);

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
                maxAuctionBps: 2000,
                swingBps: 30,
                extMult: 2,
                closedMult: 250,
                paused: false
            })
        );
        ex.addSource(mkt, address(vault));
        _fund(bob, 100e18, 0);
        _fund(alice, 0, 100_000e6);
        ausd.mint(lp, 100_000e6);
        vm.warp(T0);
    }

    // ------------------------------------------------------------------ helpers

    function _fund(address a, uint256 n, uint256 q) internal {
        nvda.mint(a, n);
        ausd.mint(a, q);
        vm.startPrank(a);
        nvda.approve(address(ex), type(uint256).max);
        ausd.approve(address(ex), type(uint256).max);
        if (n > 0) ex.deposit(address(nvda), n);
        if (q > 0) ex.deposit(address(ausd), q);
        vm.stopPrank();
    }

    function _next(uint256 dt) internal {
        vm.roll(vm.getBlockNumber() + 1);
        vm.warp(vm.getBlockTimestamp() + dt);
    }

    /// @dev The oracle observes `px` (8 decimals) `ago` seconds before the report lands in the next block.
    function _observe(int256 px, uint256 observedAt) internal returns (uint80 r) {
        if (vm.getBlockTimestamp() < observedAt + LAG) vm.warp(observedAt + LAG);
        vm.roll(vm.getBlockNumber() + 1);
        r = nvdaUsd.report(px, observedAt);
    }

    function _payload(uint80 r) internal view returns (bytes memory) {
        return abi.encode(r, q0);
    }

    function _seedVault() internal {
        vm.startPrank(lp);
        ausd.approve(address(vault), 50_000e6);
        vault.requestDeposit(50_000e6);
        vm.stopPrank();
        _observe(180e8, vm.getBlockTimestamp() + 1);
        _next(1);
        ex.clear(mkt, ""); // nothing waits: the job runs at the latest observation
        assertEq(vault.process(), 1, "the deposit settles at an observation made after it was requested");
    }

    function _sell(address who, uint256 tick, uint256 qty) internal returns (uint256) {
        vm.prank(who);
        return ex.placeOrder(mkt, 1, tick, qty, 0);
    }

    function _buy(address who, uint256 tick, uint256 qty) internal returns (uint256) {
        vm.prank(who);
        return ex.placeOrder(mkt, 0, tick, qty, 0);
    }

    // ------------------------------------------------------------------ the rule

    function test_pricesAtTheFirstObservationAfterTheSeal() public {
        _seedVault();
        _next(5);
        uint256 sealedAt = vm.getBlockTimestamp();
        uint256 batch = vm.getBlockNumber();
        _sell(bob, 17_900, 1e18); // sells 1 at $179 or better
        uint80 r = _observe(181e8, sealedAt + 9); // the oracle sees $181 nine seconds after the order
        _next(1);
        vm.expectEmit(true, true, false, true, address(ex));
        emit ExchangeBase.CausalReference(mkt, batch, r, sealedAt, sealedAt + 9);
        vm.prank(keeper);
        (uint256 tick, uint256 vol) = ex.clear(mkt, _payload(r));
        assertEq(vol, 1e18, "the vault bought it");
        assertGt(tick, 17_900);
        assertLt(tick, 18_100, "below the observation: the vault's bid");
        UnisonExchange.Market memory m = ex.market(mkt);
        assertEq(m.lastRefPrice, 181e6, "priced at the observation");
        assertEq(m.lastRefTimeMs, (sealedAt + 9) * 1000, "the receipt carries the oracle's time");
        assertTrue(m.lastRefTimeMs != vm.getBlockTimestamp() * 1000, "never the chain's clock");
        assertGt(m.lastRefTimeMs, sealedAt * 1000, "observed after the order was sealed");
    }

    function test_observationBeforeTheSeal_reverts() public {
        _seedVault();
        uint80 before = _observe(181e8, vm.getBlockTimestamp() + 1);
        _next(20);
        _buy(alice, 18_200, 1e18);
        _next(1);
        vm.expectRevert(ChainlinkCausalReference.NotAfterSeal.selector);
        ex.clear(mkt, _payload(before));
    }

    function test_onlyTheFirstObservationAfterTheSeal() public {
        _seedVault();
        _next(5);
        uint256 sealedAt = vm.getBlockTimestamp();
        _sell(bob, 17_900, 1e18);
        uint80 first = _observe(181e8, sealedAt + 5);
        uint80 second = _observe(179e8, sealedAt + 40);
        _next(1);
        vm.expectRevert(ChainlinkCausalReference.NotFirstObservation.selector);
        ex.clear(mkt, _payload(second)); // a keeper who prefers $179 cannot have it
        (, uint256 vol) = ex.clear(mkt, _payload(first));
        assertEq(vol, 1e18);
        assertEq(ex.market(mkt).lastRefPrice, 181e6);
    }

    function test_openMarketWaitsForItsObservation() public {
        _seedVault();
        _next(5);
        _buy(alice, 18_200, 1e18);
        _next(1);
        vm.expectRevert(ChainlinkCausalReference.NotYet.selector);
        ex.clear(mkt, "");
        // a round that does not exist yet is no reference
        uint80 future = nvdaUsd.latestId() + 1;
        vm.expectRevert(ChainlinkCausalReference.BadAnswer.selector);
        ex.clear(mkt, _payload(future));
    }

    function test_emptyPayloadWhileAnObservationExists_reverts() public {
        _seedVault();
        _next(5);
        uint256 sealedAt = vm.getBlockTimestamp();
        _buy(alice, 18_200, 1e18);
        uint80 r = _observe(181e8, sealedAt + 5);
        _next(1);
        vm.expectRevert(abi.encodeWithSelector(ChainlinkCausalReference.ObservationExists.selector, r));
        ex.clear(mkt, "");
    }

    /// The batch is every order sealed more than SKEW seconds before the observation, and nothing after.
    function test_batchIsExactlyTheOrdersSealedBeforeTheObservation() public {
        _seedVault();
        _next(5);
        uint256 t = vm.getBlockTimestamp();
        uint256 s1 = _buy(alice, 18_200, 1e18); // t
        _next(5);
        uint256 s2 = _buy(alice, 18_200, 1e18); // t + 5
        _next(5);
        uint256 s3 = _buy(alice, 18_200, 1e18); // t + 10: within SKEW of the observation
        uint80 r = _observe(181e8, t + 11);
        _next(1);
        // the keeper asks for a narrower batch; the observation decides, not the keeper
        ex.clearUpTo(mkt, vm.getBlockNumber() - 1, _payload(r));
        (bool m1,,,,) = ex.previewOrder(alice, s1);
        (bool m2,,,,) = ex.previewOrder(alice, s2);
        (bool m3,,,,) = ex.previewOrder(alice, s3);
        assertTrue(m1 && m2, "sealed before the observation: in the auction");
        assertFalse(m3, "sealed within the skew of it: waits for the next observation");
        // the next observation prices the third
        uint80 r2 = _observe(182e8, t + 30);
        _next(1);
        ex.clear(mkt, _payload(r2));
        (m3,,,,) = ex.previewOrder(alice, s3);
        assertTrue(m3);
        assertEq(ex.market(mkt).lastRefPrice, 182e6);
    }

    function test_waitingOrdersAreSealed() public {
        _seedVault();
        _next(5);
        uint256 s = _sell(bob, 17_900, 1e18);
        _next(1);
        vm.prank(bob);
        vm.expectRevert(ExchangeBase.Sealed.selector);
        ex.cancelOrder(s);
        // once its auction ran, the order settles
        uint80 r = _observe(181e8, vm.getBlockTimestamp() + SKEW + 3);
        _next(1);
        ex.clear(mkt, _payload(r));
        vm.prank(bob);
        ex.cancelOrder(s);
        assertEq(ex.balanceOf(bob, address(nvda)), 99e18, "sold one to the vault");
        assertGt(ex.balanceOf(bob, address(ausd)), 179e6);
    }

    function test_ordersAreAuctionOrders_remainderReturns() public {
        _seedVault();
        _next(5);
        uint256 s = _sell(bob, 17_900, 50e18); // far more than the vault buys in one auction
        uint80 r = _observe(181e8, vm.getBlockTimestamp() + SKEW + 3);
        _next(1);
        (, uint256 vol) = ex.clear(mkt, _payload(r));
        assertGt(vol, 0);
        assertLt(vol, 50e18);
        uint256[] memory slots = new uint256[](1);
        slots[0] = s;
        ex.claim(bob, slots);
        assertEq(ex.openOrderBitmap(bob), 0, "nothing rests after its auction");
        assertEq(ex.balanceOf(bob, address(nvda)), 100e18 - vol, "the unfilled remainder came back");
        assertEq(ex.bookTotal(mkt, 1), 0);
    }

    function test_oracleTimeNeverRunsBackwards() public {
        _seedVault();
        uint256 last = ex.market(mkt).lastRefTimeMs;
        // a feed whose newest round claims an earlier observation is refused
        vm.warp(vm.getBlockTimestamp() + 30);
        vm.roll(vm.getBlockNumber() + 1);
        nvdaUsd.report(181e8, last / 1000 - 1);
        _next(1);
        vm.expectRevert(ExchangeBase.StaleReference.selector);
        ex.clear(mkt, "");
    }

    function test_aRoundStampedWithTheChainClockIsRefused() public {
        _seedVault();
        _next(5);
        _buy(alice, 18_200, 1e18);
        _next(3);
        uint80 r = nvdaUsd.reportChainTime(181e8);
        _next(1);
        vm.expectRevert(ChainlinkCausalReference.BadAnswer.selector);
        ex.clear(mkt, _payload(r));
    }

    // ------------------------------------------------------------------ quote feed

    function test_quoteRoundMustBeTheOneInForce() public {
        _seedVault();
        _next(5);
        uint256 t = vm.getBlockTimestamp();
        _buy(alice, 18_200, 1e18);
        vm.roll(vm.getBlockNumber() + 1);
        uint80 q1 = ausdUsd.report(0.9999e8, t - 5); // observed before the base observation: now in force
        uint80 r = _observe(181e8, t + 5);
        _next(1);
        vm.expectRevert(ChainlinkCausalReference.BadQuoteRound.selector);
        ex.clear(mkt, abi.encode(r, q0)); // stale quote round
        ex.clear(mkt, abi.encode(r, q1));
        assertEq(ex.market(mkt).lastRefPrice, 181_018_101); // 181 / 0.9999, floor
    }

    function test_quoteObservedAfterTheBase_reverts() public {
        _seedVault();
        _next(5);
        uint256 t = vm.getBlockTimestamp();
        _buy(alice, 18_200, 1e18);
        uint80 r = _observe(181e8, t + 5);
        vm.roll(vm.getBlockNumber() + 1);
        uint80 q1 = ausdUsd.report(1e8, t + 8);
        _next(1);
        vm.expectRevert(ChainlinkCausalReference.BadQuoteRound.selector);
        ex.clear(mkt, abi.encode(r, q1));
    }

    function test_quoteOffPeg_halts() public {
        _seedVault();
        _next(5);
        uint256 t = vm.getBlockTimestamp();
        uint256 s = _buy(alice, 18_200, 1e18);
        vm.roll(vm.getBlockNumber() + 1);
        uint80 q1 = ausdUsd.report(0.99e8, t - 5); // 100 bp off: more than the 50 bp allowed
        uint80 r = _observe(181e8, t + 5);
        _next(1);
        (, uint256 vol) = ex.clear(mkt, abi.encode(r, q1));
        assertEq(vol, 0, "no auction while the quote asset is off its peg");
        assertEq(ex.market(mkt).lastStatus, uint8(IReferenceAdapter.Status.HALTED));
        vm.prank(alice);
        ex.cancelOrder(s); // its auction ran (halted): it settles and the lock returns
        assertEq(ex.balanceOf(alice, address(ausd)), 100_000e6);
    }

    // ------------------------------------------------------------------ closed and silent

    function test_closedSession_callAuctionAtTheLastObservation() public {
        // a weekday market (Mon 00:00 → Fri 00:00 UTC); the feed goes quiet for the weekend
        uint256 m2 = _weekdayMarket();
        uint256 sat = T0 + 3 days; // Saturday noon
        vm.warp(sat);
        vm.roll(vm.getBlockNumber() + 1);
        vm.prank(bob);
        ex.placeOrder(m2, 1, 18_000, 1e18, 0);
        vm.prank(alice);
        ex.placeOrder(m2, 0, 18_100, 1e18, 0);
        _next(1);
        (uint256 tick, uint256 vol) = ex.clear(m2, "");
        assertEq(vol, 1e18, "a call auction between the two");
        assertGt(tick, 0);
        UnisonExchange.Market memory m = ex.market(m2);
        assertEq(m.lastStatus, uint8(IReferenceAdapter.Status.CLOSED));
        assertLt(m.lastRefTimeMs, (sat - 2 days) * 1000, "recorded with the last observation's real (old) time");
    }

    function test_silentFeed_closesAnOpenMarket() public {
        _seedVault();
        vm.warp(vm.getBlockTimestamp() + 2 hours); // nothing from the oracle for two hours
        vm.roll(vm.getBlockNumber() + 1);
        _sell(bob, 17_900, 1e18);
        _buy(alice, 18_100, 1e18);
        _next(1);
        (, uint256 vol) = ex.clear(mkt, "");
        assertEq(vol, 1e18, "the orders trade with each other");
        assertEq(ex.market(mkt).lastStatus, uint8(IReferenceAdapter.Status.CLOSED));
        (uint256 b,) = vault.balances();
        assertEq(b, 0, "the vault does not quote a silent feed's price");
    }

    function test_closedObservation_boundAuctionIgnoresTheCadence() public {
        // A weekday market whose feed keeps publishing at the weekend, so its observations land CLOSED. The cadence
        // lets call auctions gather orders, but once the first observation after an order fixes the auction's
        // boundary, waiting can never move it: the cadence would hold those orders forever.
        uint256 m2 = _weekdayMarket();
        vm.warp(T0 + 3 days); // Saturday noon
        vm.roll(vm.getBlockNumber() + 1);
        vm.prank(bob);
        ex.placeOrder(m2, 1, 18_000, 1e18, 0);
        vm.prank(alice);
        ex.placeOrder(m2, 0, 18_100, 1e18, 0);
        _next(1);
        ex.clear(m2, ""); // the feed is quiet and the session closed: a DISCOVERY call auction
        uint256 last = ex.regimeOf(m2).lastDiscoveryBatch;
        assertEq(last, vm.getBlockNumber() - 1);

        // the next block's orders, then a weekend observation lands after them
        uint256 batch = vm.getBlockNumber();
        vm.prank(bob);
        ex.placeOrder(m2, 1, 18_000, 1e18, 0);
        vm.prank(alice);
        ex.placeOrder(m2, 0, 18_100, 1e18, 0);
        uint80 r = _observe(181e8, vm.getBlockTimestamp() + SKEW + 1);
        assertLt(batch, last + ex.regimeOf(m2).discCadence, "inside the cadence");

        vm.expectRevert(abi.encodeWithSelector(ChainlinkCausalReference.ObservationExists.selector, r));
        ex.clear(m2, ""); // an observation exists after the orders: only it may price them

        (, uint256 vol) = ex.clear(m2, _payload(r));
        assertEq(vol, 1e18, "the call auction the observation bound clears now");
        UnisonExchange.Market memory m = ex.market(m2);
        assertEq(m.lastStatus, uint8(IReferenceAdapter.Status.CLOSED));
        assertEq(m.lastCleared, batch, "exactly the orders sealed before the observation");
        assertEq(ex.regimeOf(m2).lastDiscoveryBatch, batch);
    }

    function _weekdayMarket() internal returns (uint256 m2) {
        m2 = ex.createMarket(
            UnisonExchange.MarketParams({
                base: address(nvda),
                quote: address(ausd),
                refAdapter: address(cref),
                tickSize: 10_000,
                minTick: 1,
                maxTick: uint32((1 << 21) - 1),
                maxBandTicks: 2001,
                bandBps: 100,
                feeBps: 0,
                maxFeeBps: 10,
                shards: 1,
                permissioned: false,
                strictAfterClose: true
            })
        );
        cref.setFeed(
            m2,
            AggregatorV3Interface(address(nvdaUsd)),
            AggregatorV3Interface(address(0)),
            6,
            3900,
            0,
            0,
            uint32(4 days),
            0
        );
        ex.setCausal(m2, address(cref), true, SKEW);
    }

    // ------------------------------------------------------------------ vault

    function test_vaultFlowsSettleAtAnObservationAfterTheRequest() public {
        _seedVault();
        vm.startPrank(lp);
        ausd.approve(address(vault), 1000e6);
        vault.requestDeposit(1000e6);
        vm.stopPrank();
        _next(1);
        ex.clear(mkt, ""); // the latest observation predates the request
        assertEq(vault.process(), 0, "not at a price that existed before the request");
        _observe(180e8, vm.getBlockTimestamp() + 1);
        _next(1);
        ex.clear(mkt, "");
        assertEq(vault.process(), 1);
    }

    // ------------------------------------------------------------------ admin

    function test_setCausal_onlyAdmin_onlyWhenIdle() public {
        vm.prank(keeper);
        vm.expectRevert();
        ex.setCausal(mkt, address(cref), true, SKEW);

        _seedVault();
        _next(1);
        _buy(alice, 18_200, 1e18);
        vm.expectRevert(ExchangeBase.ClearInProgress.selector);
        ex.setCausal(mkt, address(cref), false, 0); // an order waits: it keeps the rule it was placed under

        vm.expectRevert(ExchangeBase.InvalidParams.selector);
        ex.setRefAdapter(mkt, address(0xBEEF)); // a causal market changes adapter only through setCausal

        vm.expectRevert(ExchangeBase.InvalidParams.selector);
        ex.setCausal(mkt, address(cref), true, 31);
    }

    /// A market becomes causal only with an empty book: no resting order lives under two rules.
    function test_setCausal_needsAnEmptyBook() public {
        uint256 m3 = ex.createMarket(
            UnisonExchange.MarketParams({
                base: address(nvda),
                quote: address(ausd),
                refAdapter: address(cref),
                tickSize: 10_000,
                minTick: 1,
                maxTick: uint32((1 << 21) - 1),
                maxBandTicks: 2001,
                bandBps: 100,
                feeBps: 0,
                maxFeeBps: 10,
                shards: 1,
                permissioned: false,
                strictAfterClose: true
            })
        );
        cref.setFeed(
            m3, AggregatorV3Interface(address(nvdaUsd)), AggregatorV3Interface(address(0)), 6, 3900, 0, 0, 0, 0
        );
        _next(1);
        vm.prank(bob);
        uint256 s = ex.placeOrder(m3, 1, 19_000, 1e18, 0); // rests: nobody buys at $190
        _observe(180e8, vm.getBlockTimestamp() + 5); // the legacy rule also needs a reference published after it
        _next(1);
        ex.clear(m3, "");
        assertEq(ex.bookTotal(m3, 1), 1e18, "resting");
        vm.expectRevert(ExchangeBase.ClearInProgress.selector);
        ex.setCausal(m3, address(cref), true, SKEW);
        vm.prank(bob);
        ex.cancelOrder(s);
        ex.setCausal(m3, address(cref), true, SKEW);
        assertTrue(ex.causalOf(m3).on);
    }

    function test_pendingTimes_showsWhatWaits() public {
        _seedVault();
        _next(5);
        _buy(alice, 18_200, 1e18);
        uint256 b1 = vm.getBlockNumber();
        uint256 t1 = vm.getBlockTimestamp();
        _next(3);
        _buy(alice, 18_200, 1e18);
        (uint256[] memory bs, uint256[] memory ts) = ex.pendingTimes(mkt, 10);
        assertEq(bs.length, 2);
        assertEq(bs[0], b1);
        assertEq(ts[0], t1);
        assertEq(ts[1], t1 + 3);
    }

    // ------------------------------------------------------------------ resumable job

    function test_chunkedClearEqualsSingleShot() public {
        _seedVault();
        _next(5);
        for (uint256 i = 0; i < 12; ++i) {
            address a = makeAddr(string(abi.encodePacked("buyer", i)));
            _fund(a, 0, 10_000e6);
            _buy(a, uint256(18_100 + i * 3), 1e17);
            address s = makeAddr(string(abi.encodePacked("seller", i)));
            _fund(s, 1e18, 0);
            _sell(s, uint256(17_950 + i * 4), 1e17);
        }
        uint80 r = _observe(180e8, vm.getBlockTimestamp() + SKEW + 3);
        _next(1);
        uint256 snap = vm.snapshotState();
        (uint256 t1, uint256 v1) = ex.clear(mkt, _payload(r));
        assertGt(v1, 0);
        uint256 single = ex.balanceOf(address(vault), address(nvda));

        vm.revertToState(snap);
        uint256 g = 1_200_000;
        uint256 calls;
        uint256 paused;
        while (true) {
            try ex.clear{gas: g}(mkt, _payload(r)) returns (uint256 t, uint256 v) {
                ++calls;
                if (ex.jobOf(mkt).phase == 0) {
                    assertEq(t, t1, "same clearing tick");
                    assertEq(v, v1, "same volume");
                    break;
                }
                ++paused;
            } catch {
                g += 500_000;
            }
            require(calls < 400, "job does not terminate");
        }
        assertGt(paused, 0, "the job ran in pieces");
        assertEq(ex.balanceOf(address(vault), address(nvda)), single, "identical outcome");
    }

    // ------------------------------------------------------------------ regression

    /// The adapter must never take its reference time from the chain's clock.
    function test_noBlockTimestampInTheReferenceTime() public view {
        string memory src = vm.readFile("src/pricing/ChainlinkCausalReference.sol");
        assertFalse(_contains(src, "vm.getBlockTimestamp() * 1000"), "no chain clock in a reference time");
        assertFalse(_contains(src, "publishTimeMs = vm.getBlockTimestamp()"), "no chain clock in a reference time");
    }

    function _contains(string memory hay, string memory needle) internal pure returns (bool) {
        bytes memory h = bytes(hay);
        bytes memory n = bytes(needle);
        if (n.length > h.length) return false;
        for (uint256 i = 0; i + n.length <= h.length; ++i) {
            bool ok = true;
            for (uint256 k = 0; k < n.length; ++k) {
                if (h[i + k] != n[k]) {
                    ok = false;
                    break;
                }
            }
            if (ok) return true;
        }
        return false;
    }
}

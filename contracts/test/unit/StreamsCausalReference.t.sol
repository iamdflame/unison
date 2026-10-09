// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {UnisonExchange} from "../../src/core/UnisonExchange.sol";
import {IReferenceAdapter} from "../../src/interfaces/IReferenceAdapter.sol";
import {AggregatorV3Interface} from "../../src/interfaces/external/AggregatorV3Interface.sol";
import {IVerifierProxy} from "../../src/interfaces/external/IVerifierProxy.sol";
import {StreamsCausalReference} from "../../src/pricing/StreamsCausalReference.sol";
import {ClearRouter} from "../../src/pricing/ClearRouter.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {MockOCR} from "./CausalReference.t.sol";

/// @notice Chainlink's verifier without the cryptography: it returns the report inside the signed payload, or refuses
///         every payload when told the signatures are bad. The real verifier is exercised on a Monad fork
///         (test/fork/StreamsFork.t.sol) with reports Chainlink's DON signed.
contract MockVerifierProxy is IVerifierProxy {
    bool public reject;
    uint256 public calls;

    function setReject(bool r) external {
        reject = r;
    }

    function verify(bytes calldata payload, bytes calldata) external payable returns (bytes memory report) {
        if (reject) revert("bad signatures");
        ++calls;
        (, report,,,) = abi.decode(payload, (bytes32[3], bytes, bytes32[], bytes32[], bytes32));
    }

    function s_feeManager() external pure returns (address) {
        return address(0);
    }
}

contract StreamsCausalReferenceTest is Test {
    // Wed 2025-10-08 12:00 UTC
    uint256 internal constant T0 = 1_759_924_800;
    uint8 internal constant SKEW = 2;
    bytes32 internal constant NVDA = bytes32((uint256(11) << 240) | 0xa1); // a schema-11 (RWA Advanced) stream
    bytes32 internal constant ETH = bytes32((uint256(3) << 240) | 0xe7); // a schema-3 (crypto) stream
    bytes32 internal constant RWA8 = bytes32((uint256(8) << 240) | 0x88); // a schema-8 (RWA Standard) stream

    uint32 internal constant REGULAR = 2;
    uint32 internal constant PRE = 1;
    uint32 internal constant POST = 3;
    uint32 internal constant OVERNIGHT = 4;
    uint32 internal constant CLOSED = 5;

    MockVerifierProxy internal verifier;
    StreamsCausalReference internal sref;
    MockOCR internal ausdUsd;
    uint80 internal q0;

    UnisonExchange internal ex;
    MockERC20 internal nvda;
    MockERC20 internal ausd;
    uint256 internal mkt;

    address internal bob = makeAddr("bob"); // seller
    address internal alice = makeAddr("alice"); // buyer
    address internal keeper = makeAddr("keeper");

    function setUp() public {
        vm.warp(T0 - 600);
        verifier = new MockVerifierProxy();
        sref = new StreamsCausalReference(address(this), verifier);
        ausdUsd = new MockOCR(8);
        q0 = ausdUsd.report(1e8, vm.getBlockTimestamp() - 13);

        nvda = new MockERC20("Anchored NVDA", "aNVDA", 18);
        ausd = new MockERC20("Agora USD", "AUSD", 6);
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
                refAdapter: address(sref),
                tickSize: 10_000,
                minTick: 1,
                maxTick: uint32((1 << 21) - 1),
                maxBandTicks: 2001,
                bandBps: 100,
                feeBps: 10,
                maxFeeBps: 10,
                shards: 2,
                permissioned: false,
                strictAfterClose: true
            })
        );
        sref.setStream(mkt, NVDA, AggregatorV3Interface(address(ausdUsd)), 6, 90_000, 60, 30, 50);
        ex.setCausal(mkt, address(sref), true, SKEW);
        _fund(bob, 100e18, 0);
        _fund(alice, 0, 100_000e6);
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

    /// A schema-11 report, as the Data Streams API serves it (`fullReport`): mid in USD with 18 decimals.
    function _v11(uint256 validFrom, uint256 obs, int256 mid, uint256 midAt, uint32 status)
        internal
        pure
        returns (bytes memory)
    {
        bytes memory report = abi.encode(
            NVDA,
            uint32(validFrom),
            uint32(obs),
            uint192(0),
            uint192(0),
            uint32(obs + 30 days),
            int192(mid),
            uint64(midAt * 1e9),
            int192(mid - 1e16),
            int192(int256(500)),
            int192(mid + 1e16),
            int192(int256(700)),
            int192(mid),
            status
        );
        return _signed(report);
    }

    function _v3(uint256 validFrom, uint256 obs, int256 price) internal pure returns (bytes memory) {
        return _signed(
            abi.encode(
                ETH,
                uint32(validFrom),
                uint32(obs),
                uint192(0),
                uint192(0),
                uint32(obs + 30 days),
                int192(price),
                int192(price - 1e15),
                int192(price + 1e15)
            )
        );
    }

    function _v8(uint256 validFrom, uint256 obs, int256 mid, uint32 status) internal pure returns (bytes memory) {
        return _signed(
            abi.encode(
                RWA8,
                uint32(validFrom),
                uint32(obs),
                uint192(0),
                uint192(0),
                uint32(obs + 30 days),
                uint64(obs * 1e9),
                int192(mid),
                status
            )
        );
    }

    function _signed(bytes memory report) internal pure returns (bytes memory) {
        bytes32[3] memory ctx;
        return abi.encode(ctx, report, new bytes32[](0), new bytes32[](0), bytes32(0));
    }

    /// Submits an open-market NVDA report observed at `obs`, covering only that second.
    function _report(uint256 obs, int256 mid) internal returns (bytes memory payload) {
        sref.submit(_v11(obs, obs, mid, obs, REGULAR));
        return abi.encode(uint32(obs), q0);
    }

    function _sell(uint256 tick) internal returns (uint256) {
        vm.prank(bob);
        return ex.placeOrder(mkt, 1, tick, 1e18, 0);
    }

    function _buy(uint256 tick) internal returns (uint256) {
        vm.prank(alice);
        return ex.placeOrder(mkt, 0, tick, 1e18, 0);
    }

    function _one(uint256 slot) internal pure returns (uint256[] memory a) {
        a = new uint256[](1);
        a[0] = slot;
    }

    // ------------------------------------------------------------------ submit

    function test_submit_verifiesAndStores() public {
        (bytes32 feed, uint32 at) = sref.submit(_v11(T0 + 1, T0 + 3, 180e18, T0 + 2, REGULAR));
        assertEq(feed, NVDA);
        assertEq(at, T0 + 3);
        assertEq(verifier.calls(), 1);
        StreamsCausalReference.Report memory r = sref.report(NVDA, uint32(T0 + 3));
        assertTrue(r.set);
        assertEq(r.price, 180e18);
        assertEq(r.validFrom, T0 + 1);
        assertEq(r.midAt, T0 + 2);
        assertEq(r.status, uint8(IReferenceAdapter.Status.OPEN));
        assertEq(sref.newestObservation(NVDA), T0 + 3);
    }

    function test_submit_refusedSignatures_reverts() public {
        verifier.setReject(true);
        vm.expectRevert(bytes("bad signatures"));
        sref.submit(_v11(T0, T0, 180e18, T0, REGULAR));
    }

    function test_submit_storedReport_skipsTheVerifier() public {
        sref.submit(_v11(T0, T0, 180e18, T0, REGULAR));
        verifier.setReject(true); // would revert if called
        vm.prank(keeper);
        (, uint32 at) = sref.submit(_v11(T0, T0, 999e18, T0, REGULAR)); // same second, other content: ignored
        assertEq(at, T0);
        assertEq(sref.report(NVDA, uint32(T0)).price, 180e18, "the verified report stands");
    }

    function test_submit_unknownFeed_reverts() public {
        vm.expectRevert(StreamsCausalReference.UnknownFeed.selector);
        sref.submit(_v3(T0, T0, 2400e18)); // no market reads ETH/USD
    }

    function test_submit_malformedWindowOrPrice_reverts() public {
        vm.expectRevert(StreamsCausalReference.BadReport.selector);
        sref.submit(_v11(0, T0, 180e18, T0, REGULAR)); // no window start
        vm.expectRevert(StreamsCausalReference.BadReport.selector);
        sref.submit(_v11(T0 + 1, T0, 180e18, T0, REGULAR)); // window ends before it starts
        vm.expectRevert(StreamsCausalReference.BadReport.selector);
        sref.submit(_v11(T0, T0, -1, T0, REGULAR)); // negative price
        vm.expectRevert(StreamsCausalReference.BadReport.selector);
        sref.submit(_v11(T0, T0, 0, T0, REGULAR)); // zero price
    }

    function test_setStream_onlyKnownSchemas_onlyOwner() public {
        vm.expectRevert(abi.encodeWithSelector(StreamsCausalReference.UnsupportedSchema.selector, uint16(9)));
        sref.setStream(7, bytes32(uint256(9) << 240), AggregatorV3Interface(address(0)), 6, 0, 0, 30, 0);
        vm.prank(keeper);
        vm.expectRevert();
        sref.setStream(7, ETH, AggregatorV3Interface(address(0)), 6, 0, 0, 30, 0);
    }

    // ------------------------------------------------------------------ the rule

    function test_readAfter_theReportWhoseWindowHoldsTheSecondAfterTheSeal() public {
        bytes memory p = _report(T0 + 3, 180e18);
        (uint256 px, uint256 at, IReferenceAdapter.Status st, uint80 round) = sref.readAfter(mkt, T0 + 2, p);
        assertEq(px, 180e6, "AUSD units per aNVDA");
        assertEq(at, T0 + 3);
        assertEq(uint8(st), uint8(IReferenceAdapter.Status.OPEN));
        assertEq(round, T0 + 3, "the round names the report by its observation time");
    }

    function test_readAfter_aGapWidensTheWindow() public {
        // Chainlink skipped two seconds: the next report's window starts right after the last one and absorbs them
        sref.submit(_v11(T0 + 1, T0 + 4, 181e18, T0 + 4, REGULAR));
        (uint256 px, uint256 at,,) = sref.readAfter(mkt, T0 + 2, abi.encode(uint32(T0 + 4), q0));
        assertEq(px, 181e6);
        assertEq(at, T0 + 4);
    }

    function test_readAfter_observedAtOrBeforeTheSeal_reverts() public {
        bytes memory p = _report(T0 + 2, 180e18);
        vm.expectRevert(StreamsCausalReference.NotAfterSeal.selector);
        sref.readAfter(mkt, T0 + 2, p);
    }

    function test_readAfter_notTheFirstReport_reverts() public {
        _report(T0 + 3, 180e18);
        bytes memory later = _report(T0 + 4, 185e18); // window [T0+4, T0+4]: the T0+3 report came first
        vm.expectRevert(StreamsCausalReference.NotFirstObservation.selector);
        sref.readAfter(mkt, T0 + 2, later);
    }

    function test_readAfter_unsubmittedOrEmpty_reverts() public {
        vm.expectRevert(StreamsCausalReference.NotSubmitted.selector);
        sref.readAfter(mkt, T0 + 2, abi.encode(uint32(T0 + 3), q0));
        vm.expectRevert(StreamsCausalReference.NeedsReport.selector);
        sref.readAfter(mkt, T0 + 2, "");
    }

    function test_readAfter_unknownMarket_reverts() public {
        vm.expectRevert(StreamsCausalReference.UnknownFeed.selector);
        sref.readAfter(mkt + 1, T0, abi.encode(uint32(T0 + 3), q0));
    }

    // ------------------------------------------------------------------ status from the report

    function test_status_v11_24x5Equities() public {
        uint32[6] memory codes = [uint32(0), PRE, REGULAR, POST, OVERNIGHT, CLOSED];
        IReferenceAdapter.Status[6] memory want = [
            IReferenceAdapter.Status.HALTED, // unknown: never trade on it
            IReferenceAdapter.Status.EXTENDED,
            IReferenceAdapter.Status.OPEN,
            IReferenceAdapter.Status.EXTENDED,
            IReferenceAdapter.Status.EXTENDED,
            IReferenceAdapter.Status.CLOSED
        ];
        for (uint256 i = 0; i < codes.length; ++i) {
            uint256 obs = T0 + 10 * (i + 1);
            sref.submit(_v11(obs, obs, 180e18, obs, codes[i]));
            (,, IReferenceAdapter.Status st,) = sref.readAfter(mkt, obs - 1, abi.encode(uint32(obs), q0));
            assertEq(uint8(st), uint8(want[i]));
        }
    }

    function test_status_cryptoIsAlwaysOpen_rwaStandardMapsItsCodes() public {
        sref.setStream(7, ETH, AggregatorV3Interface(address(0)), 6, 0, 0, 30, 0);
        sref.setStream(8, RWA8, AggregatorV3Interface(address(0)), 6, 0, 0, 30, 0);
        sref.submit(_v3(T0, T0, 2400e18));
        (uint256 px,, IReferenceAdapter.Status st,) = sref.readAfter(7, T0 - 1, abi.encode(uint32(T0), uint80(0)));
        assertEq(px, 2400e6, "no quote feed: the quote token is USD");
        assertEq(uint8(st), uint8(IReferenceAdapter.Status.OPEN));
        uint32[3] memory codes = [uint32(0), 1, 2];
        IReferenceAdapter.Status[3] memory want =
            [IReferenceAdapter.Status.HALTED, IReferenceAdapter.Status.CLOSED, IReferenceAdapter.Status.OPEN];
        for (uint256 i = 0; i < 3; ++i) {
            uint256 obs = T0 + 10 * (i + 1);
            sref.submit(_v8(obs, obs, 100e18, codes[i]));
            (,, st,) = sref.readAfter(8, obs - 1, abi.encode(uint32(obs), uint80(0)));
            assertEq(uint8(st), uint8(want[i]));
        }
    }

    function test_staleMidWhileOpen_halts_whileClosed_isExpected() public {
        // the market says open, but the mid has not moved for longer than maxMidAgeSec (60 s): do not trade on it
        sref.submit(_v11(T0 + 3, T0 + 3, 180e18, T0 - 61, REGULAR));
        (,, IReferenceAdapter.Status st,) = sref.readAfter(mkt, T0 + 2, abi.encode(uint32(T0 + 3), q0));
        assertEq(uint8(st), uint8(IReferenceAdapter.Status.HALTED));
        // closed: the mid is Friday's by design
        sref.submit(_v11(T0 + 13, T0 + 13, 180e18, T0 - 2 days, CLOSED));
        (,, st,) = sref.readAfter(mkt, T0 + 12, abi.encode(uint32(T0 + 13), q0));
        assertEq(uint8(st), uint8(IReferenceAdapter.Status.CLOSED));
    }

    // ------------------------------------------------------------------ the quote leg

    function test_quote_theRoundInForce_dividesThePrice() public {
        vm.warp(T0 + 100);
        uint80 q1 = ausdUsd.report(0.98e8, T0 + 20); // AUSD at $0.98 from T0+20
        bytes memory p = _report(T0 + 30, 196e18);
        vm.expectRevert(StreamsCausalReference.BadQuoteRound.selector);
        sref.readAfter(mkt, T0 + 29, p); // q0 was superseded before the observation
        (uint256 px,, IReferenceAdapter.Status st,) = sref.readAfter(mkt, T0 + 29, abi.encode(uint32(T0 + 30), q1));
        assertEq(px, 200e6, "$196 / $0.98");
        assertEq(uint8(st), uint8(IReferenceAdapter.Status.HALTED), "2% off its peg (limit 0.5%)");
        sref.submit(_v11(T0 + 10, T0 + 10, 180e18, T0 + 10, REGULAR));
        vm.expectRevert(StreamsCausalReference.BadQuoteRound.selector);
        sref.readAfter(mkt, T0 + 9, abi.encode(uint32(T0 + 10), q1)); // q1 was observed after it
    }

    // ------------------------------------------------------------------ latest (empty auctions)

    function test_latest_needsARecentReport() public {
        vm.expectRevert(StreamsCausalReference.StaleLatest.selector);
        sref.latest(mkt);
        _report(T0, 180e18);
        (uint256 px, uint256 at,,) = sref.latest(mkt);
        assertEq(px, 180e6);
        assertEq(at, T0);
        vm.warp(T0 + 31); // maxLatestAgeSec = 30
        vm.expectRevert(StreamsCausalReference.StaleLatest.selector);
        sref.latest(mkt);
        (uint256 rpx, uint256 ms,) = sref.read(mkt, 0, ""); // interfaces still see the newest report
        assertEq(rpx, 180e6);
        assertEq(ms, T0 * 1000);
    }

    // ------------------------------------------------------------------ the exchange, unchanged, reading it

    function test_exchange_clearsAtTheFirstReport_exactlyTheOrdersSealedBefore() public {
        vm.roll(vm.getBlockNumber() + 1);
        uint256 first = vm.getBlockNumber();
        _sell(17_900);
        _buy(18_100);
        _next(1); // a second batch, one second later
        _sell(17_900);
        _buy(18_100);
        _next(3); // the report observed at T0 + 3 is out
        // the first report after the first batch's seal + skew: observed at T0 + 3, so the cut is T0 + 1
        bytes memory p = _report(T0 + 3, 180e18);
        (uint256 tick, uint256 vol) = ex.clear(mkt, p);
        assertEq(vol, 1e18, "only the first batch: the second was sealed at the cut, not before it");
        assertEq(tick, 18_000);
        UnisonExchange.Market memory m = ex.market(mkt);
        assertEq(m.lastCleared, first);
        assertEq(m.lastRefTimeMs, (T0 + 3) * 1000, "the reference time is the report's observation");
        assertEq(m.lastStatus, uint8(IReferenceAdapter.Status.OPEN));
        // the second batch prices at the first report after ITS seal (T0 + 1 + 2): the next second
        _next(1);
        (, vol) = ex.clear(mkt, _report(T0 + 4, 181e18));
        assertEq(vol, 1e18);
    }

    function test_exchange_refusesALaterReport() public {
        vm.roll(vm.getBlockNumber() + 1);
        _sell(17_900);
        _buy(18_100);
        _next(10);
        _report(T0 + 3, 180e18);
        bytes memory later = _report(T0 + 9, 190e18);
        vm.expectRevert(StreamsCausalReference.NotFirstObservation.selector);
        ex.clear(mkt, later);
    }

    function test_exchange_weekendReports_callAuctionsThatNeverWaitForTheCadence() public {
        // Reports keep coming at the weekend with a closed status: each auction is a call auction bounded by its
        // report, and two of them inside discCadence blocks both clear.
        vm.roll(vm.getBlockNumber() + 1);
        _sell(18_000);
        _buy(18_100);
        _next(3);
        sref.submit(_v11(T0 + 3, T0 + 3, 180e18, T0 - 2 days, CLOSED));
        (, uint256 vol) = ex.clear(mkt, abi.encode(uint32(T0 + 3), q0));
        assertEq(vol, 1e18);
        assertEq(ex.market(mkt).lastStatus, uint8(IReferenceAdapter.Status.CLOSED));
        uint256 last = ex.regimeOf(mkt).lastDiscoveryBatch;

        uint256 batch = vm.getBlockNumber();
        _sell(18_000);
        _buy(18_100);
        uint256 sealedAt = vm.getBlockTimestamp();
        _next(3);
        assertLt(batch, last + ex.regimeOf(mkt).discCadence, "inside the cadence");
        sref.submit(_v11(sealedAt + 3, sealedAt + 3, 180e18, T0 - 2 days, CLOSED));
        (, vol) = ex.clear(mkt, abi.encode(uint32(sealedAt + 3), q0));
        assertEq(vol, 1e18, "bounded by its report: clears at once");
        assertEq(ex.regimeOf(mkt).lastDiscoveryBatch, batch);
    }

    function test_exchange_haltedReport_returnsTheOrders() public {
        vm.roll(vm.getBlockNumber() + 1);
        uint256 s = _sell(17_900);
        uint256 b = _buy(18_100);
        _next(3);
        sref.submit(_v11(T0 + 3, T0 + 3, 180e18, T0 + 3, 0)); // market status unknown
        (, uint256 vol) = ex.clear(mkt, abi.encode(uint32(T0 + 3), q0));
        assertEq(vol, 0, "nothing trades on an unknown status");
        assertEq(ex.market(mkt).lastStatus, uint8(IReferenceAdapter.Status.HALTED));
        ex.claim(alice, _one(b));
        ex.claim(bob, _one(s));
        assertEq(ex.balanceOf(alice, address(ausd)), 100_000e6, "the buyer's lock came back");
        assertEq(ex.balanceOf(bob, address(nvda)), 100e18, "and the seller's");
    }

    // ------------------------------------------------------------------ the router

    function test_router_submitsClearsAndPaysTheCaller() public {
        ClearRouter router = new ClearRouter();
        // a first auction; its fee, booked as the orders settle, funds the keeper reward
        vm.roll(vm.getBlockNumber() + 1);
        uint256 s = _sell(17_900);
        uint256 b = _buy(18_100);
        _next(3);
        ex.clear(mkt, _report(T0 + 3, 180e18));
        ex.claim(bob, _one(s));
        ex.claim(alice, _one(b));
        assertGt(ex.balanceOf(address(ex), address(ausd)), 1_000, "the protocol earned its fee");
        ex.setKeeperReward(1_000);

        _sell(17_900);
        _buy(18_100);
        uint256 sealedAt = vm.getBlockTimestamp();
        _next(3);
        bytes[] memory reports = new bytes[](1);
        reports[0] = _v11(sealedAt + 3, sealedAt + 3, 180e18, sealedAt + 3, REGULAR);
        vm.prank(keeper);
        (, uint256 vol) = router.submitAndClear(sref, reports, address(ex), mkt, abi.encode(uint32(sealedAt + 3), q0));
        assertEq(vol, 1e18, "submitted and cleared in one transaction");
        assertEq(ausd.balanceOf(keeper), 1_000, "the keeper reward reached the caller");
        assertEq(ex.balanceOf(address(router), address(ausd)), 0, "nothing stays in the router");
    }
}

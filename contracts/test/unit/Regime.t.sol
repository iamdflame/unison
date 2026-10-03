// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {UnisonExchange} from "../../src/core/UnisonExchange.sol";
import {ExchangeBase} from "../../src/core/ExchangeBase.sol";
import {ManualReference} from "../../src/pricing/ManualReference.sol";
import {IReferenceAdapter} from "../../src/interfaces/IReferenceAdapter.sol";
import {MockERC20} from "../mocks/MockERC20.sol";

/// @notice Regimes (SPEC §6): LIVE / EXTENDED / DISCOVERY (√t band, call-auction cadence) / REOPENING / HALTED.
contract RegimeTest is Test {
    UnisonExchange internal ex;
    ManualReference internal ref;
    MockERC20 internal nvda;
    MockERC20 internal ausd;
    uint256 internal mkt;
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    IReferenceAdapter.Status internal constant OPEN = IReferenceAdapter.Status.OPEN;
    IReferenceAdapter.Status internal constant EXT = IReferenceAdapter.Status.EXTENDED;
    IReferenceAdapter.Status internal constant CLOSED = IReferenceAdapter.Status.CLOSED;
    IReferenceAdapter.Status internal constant HALTED = IReferenceAdapter.Status.HALTED;

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
                maxBandTicks: 4001,
                bandBps: 100,
                feeBps: 2,
                maxFeeBps: 10,
                shards: 4,
                permissioned: false,
                strictAfterClose: false
            })
        );
        // NVDA calibration: weekend p99 gap 7.26% → discovery cap 726 bps, floor 100, 3-second call auctions
        ex.setRegime(mkt, 200, 726, 100, 726, 235_800, 10);
        for (uint256 i = 0; i < 2; ++i) {
            address a = i == 0 ? alice : bob;
            nvda.mint(a, 1_000e18);
            ausd.mint(a, 1_000_000e6);
            vm.startPrank(a);
            nvda.approve(address(ex), type(uint256).max);
            ausd.approve(address(ex), type(uint256).max);
            ex.deposit(address(nvda), 1_000e18);
            ex.deposit(address(ausd), 1_000_000e6);
            vm.stopPrank();
        }
    }

    function _step(uint256 blocks, uint256 secs, uint256 px, IReferenceAdapter.Status st) internal {
        vm.roll(block.number + blocks);
        vm.warp(block.timestamp + secs);
        ref.post(mkt, px, block.timestamp * 1000, st);
    }

    function _clear() internal returns (uint256 tick, uint256 vol) {
        return ex.clear(mkt, "");
    }

    function test_bandPerRegime() public view {
        (, uint256 lo, uint256 hi, uint256 bps) = ex.previewBand(mkt, 180e6, OPEN);
        assertEq(bps, 100);
        assertEq(hi - lo, 360); // ±1% of 18_000 ticks
        (,,, bps) = ex.previewBand(mkt, 180e6, EXT);
        assertEq(bps, 200);
    }

    function test_discovery_bandWidensWithSqrtTime_andCadence() public {
        _step(1, 1, 180e6, CLOSED);
        _clear(); // first CLOSED clear starts the discovery clock
        uint256 since = ex.regimeOf(mkt).closedSince;
        assertEq(since, block.timestamp);
        (,,, uint256 b0) = ex.previewBand(mkt, 180e6, CLOSED);
        assertEq(b0, 100, "floor right after the close");

        // cadence: the next call auction may only run 10 blocks later
        _step(3, 1, 180e6, CLOSED);
        vm.expectRevert(ExchangeBase.TooEarly.selector);
        ex.clear(mkt, "");

        // a quarter of the horizon later the band is cap * sqrt(1/4) = 363 bps
        vm.warp(since + 235_800 / 4);
        (,,, uint256 bq) = ex.previewBand(mkt, 180e6, CLOSED);
        assertEq(bq, 363);
        // past the horizon it is capped
        vm.warp(since + 400_000);
        (,,, uint256 bc) = ex.previewBand(mkt, 180e6, CLOSED);
        assertEq(bc, 726);
    }

    function test_discoveryAuction_tradesAwayFromStaleClose() public {
        _step(1, 1, 180e6, CLOSED);
        _clear();
        // weekend news: buyers bid 4% above Friday's close; a 4% move is outside the live band (1%)
        vm.prank(alice);
        ex.placeOrder(mkt, 0, 18_720, 5e18, 0);
        vm.prank(bob);
        ex.placeOrder(mkt, 1, 18_700, 5e18, 0);
        // 40h into the weekend the discovery band is 726*sqrt(40/65.5) ≈ 567 bps → the 4% cross is allowed
        _step(10, 40 hours, 180e6, CLOSED);
        (uint256 tick, uint256 vol) = _clear();
        assertEq(vol, 5e18, "discovery auction prints the weekend price");
        assertTrue(tick >= 18_700 && tick <= 18_720);
    }

    function test_reopening_usesOpeningCrossBand_once() public {
        _step(1, 1, 180e6, CLOSED);
        _clear();
        // Monday open: the reference gapped 6%. Resting orders cross at the opening price.
        vm.prank(alice);
        ex.placeOrder(mkt, 0, 19_150, 3e18, 0);
        vm.prank(bob);
        ex.placeOrder(mkt, 1, 19_000, 3e18, 0);
        _step(10, 60 hours, 190.8e6, OPEN);
        (, , , uint256 bps) = ex.previewBand(mkt, 190.8e6, OPEN);
        assertEq(bps, 726, "opening cross band");
        (, uint256 vol) = _clear();
        assertEq(vol, 3e18);
        assertEq(ex.regimeOf(mkt).closedSince, 0, "closed period over");
        (,,, bps) = ex.previewBand(mkt, 190.8e6, OPEN);
        assertEq(bps, 100, "back to the live band");
    }

    function test_haltOverride_blocksAuction_thenReopens() public {
        vm.prank(alice);
        ex.placeOrder(mkt, 0, 18_010, 2e18, 0);
        vm.prank(bob);
        ex.placeOrder(mkt, 1, 17_990, 2e18, 0);
        ex.setHalt(mkt, true);
        _step(1, 1, 180e6, OPEN);
        (, uint256 vol) = _clear();
        assertEq(vol, 0, "halted: no auction");
        assertEq(ex.market(mkt).lastStatus, uint8(HALTED));

        address stranger = makeAddr("stranger");
        vm.prank(stranger);
        vm.expectRevert();
        ex.setHalt(mkt, false);

        ex.setHalt(mkt, false);
        _step(1, 1, 180e6, OPEN);
        (,,, uint256 bps) = ex.previewBand(mkt, 180e6, OPEN);
        assertEq(bps, 726, "first auction after a halt is a reopening auction");
        (, vol) = _clear();
        assertEq(vol, 2e18);
    }
}

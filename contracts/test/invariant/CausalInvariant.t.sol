// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {UnisonExchange} from "../../src/core/UnisonExchange.sol";
import {AggregatorV3Interface} from "../../src/interfaces/external/AggregatorV3Interface.sol";
import {ChainlinkCausalReference} from "../../src/pricing/ChainlinkCausalReference.sol";
import {LiquidityVault, IUnisonVenue} from "../../src/liquidity/LiquidityVault.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {MockOCR} from "../unit/CausalReference.t.sol";

/// @dev Random sequences on a causal market (SPEC §7.4): orders arrive over blocks and seconds, the oracle observes
///      at random times, and clears name the first observation after the oldest waiting order. Ghosts record every
///      violation of the rules the contract is meant to enforce; the invariants require them to stay at zero.
contract CausalHandler is Test {
    uint8 internal constant SKEW = 2;
    uint256 internal constant LAG = 13;

    UnisonExchange public ex;
    MockOCR public feed;
    MockERC20 public nvda;
    MockERC20 public ausd;
    LiquidityVault public vault;
    uint256 public mkt;
    address[] public actors;

    // ghosts
    uint256 public trades;
    uint256 public clears;
    uint256 public clearAttempts;
    uint256 public sealedCancels; // a waiting order left before its auction: must stay 0
    uint256 public partitionErrors; // an order sealed before the observation left out, or one after it let in
    uint256 public timeReversals; // the recorded oracle time went backwards
    uint256 public chainClockStamps; // a recorded reference time equal to the clear's own block time
    uint256 public lastObs;

    constructor(
        UnisonExchange ex_,
        MockOCR feed_,
        MockERC20 nvda_,
        MockERC20 ausd_,
        LiquidityVault vault_,
        uint256 mkt_
    ) {
        ex = ex_;
        feed = feed_;
        nvda = nvda_;
        ausd = ausd_;
        vault = vault_;
        mkt = mkt_;
        for (uint256 i = 0; i < 4; i++) {
            address a = address(uint160(0xC000 + i));
            actors.push(a);
            nvda.mint(a, 10_000e18);
            ausd.mint(a, 5_000_000e6);
            vm.startPrank(a);
            nvda.approve(address(ex), type(uint256).max);
            ausd.approve(address(ex), type(uint256).max);
            ex.deposit(address(nvda), 10_000e18);
            ex.deposit(address(ausd), 5_000_000e6);
            vm.stopPrank();
        }
    }

    function _actor(uint256 seed) internal view returns (address) {
        return actors[seed % actors.length];
    }

    function place(uint256 actorSeed, uint256 sideSeed, uint256 tickSeed, uint256 qtySeed, uint256 dtSeed) external {
        vm.roll(vm.getBlockNumber() + 1);
        vm.warp(vm.getBlockTimestamp() + (dtSeed % 4));
        uint256 side = sideSeed % 2;
        uint256 tick = side == 0 ? 17_850 + (tickSeed % 400) : 17_750 + (tickSeed % 400);
        vm.prank(_actor(actorSeed));
        try ex.placeOrder(mkt, side, tick, 1e17 + (qtySeed % 20e18), 0) {} catch {}
    }

    /// Tries to cancel an open order. A waiting one must refuse; a cleared one settles.
    function cancel(uint256 actorSeed, uint256 slotSeed) external {
        address a = _actor(actorSeed);
        uint256 bm = ex.openOrderBitmap(a);
        if (bm == 0) return;
        for (uint256 i = 0; i < 55; i++) {
            uint256 j = (slotSeed + i) % 55;
            if (bm & (1 << j) == 0) continue;
            bool waiting = ex.orderOf(a, j).batch > ex.market(mkt).lastCleared;
            vm.prank(a);
            try ex.cancelOrder(j) {
                if (waiting) sealedCancels++;
            } catch {}
            return;
        }
    }

    /// The oracle observes now-ish; the report lands LAG seconds after its observation.
    function observe(uint256 priceSeed, uint256 dtSeed) external {
        vm.roll(vm.getBlockNumber() + 1);
        vm.warp(vm.getBlockTimestamp() + 1 + (dtSeed % 40));
        uint256 at = vm.getBlockTimestamp() - LAG;
        (,, uint256 prevObs,,) = feed.latestRoundData();
        if (at <= prevObs) at = prevObs + 1;
        if (at >= vm.getBlockTimestamp()) return;
        feed.report(int256(178e8 + (priceSeed % 4e8)), at);
    }

    function clear(uint256 gasSeed) external {
        _finishJob();
        vm.roll(vm.getBlockNumber() + 1);
        (uint256[] memory bs, uint256[] memory ts) = ex.pendingTimes(mkt, 512);
        bytes memory payload;
        uint256 obs;
        clearAttempts++;
        if (bs.length != 0) {
            uint80 r = _firstAfter(ts[0] + SKEW);
            if (r == 0) {
                // nothing observed after the oldest order yet: let the oracle observe after it, as it would, then clear
                vm.roll(vm.getBlockNumber() + 1);
                vm.warp(vm.getBlockTimestamp() + LAG + SKEW + 2);
                (,, uint256 prevObs,,) = feed.latestRoundData();
                uint256 at = vm.getBlockTimestamp() - LAG;
                if (at <= prevObs) at = prevObs + 1;
                if (at >= vm.getBlockTimestamp()) return;
                feed.report(int256(178e8 + (gasSeed % 4e8)), at);
                r = _firstAfter(ts[0] + SKEW);
                if (r == 0) return;
            }
            payload = abi.encode(r, uint80(0));
            (,, obs,,) = feed.getRoundData(r);
        }
        bool chunked = gasSeed % 3 == 0;
        try ex.clear{gas: chunked ? 900_000 + (gasSeed % 1_500_000) : 30_000_000}(mkt, payload) returns (
            uint256, uint256 vol
        ) {
            _finishJob();
            if (vol > 0) trades++;
            clears++;
            UnisonExchange.Market memory m = ex.market(mkt);
            if (m.lastRefTimeMs / 1000 < lastObs) timeReversals++;
            lastObs = m.lastRefTimeMs / 1000;
            if (m.lastRefTimeMs == vm.getBlockTimestamp() * 1000) chainClockStamps++;
            for (uint256 i = 0; i < bs.length && obs != 0; ++i) {
                bool inAuction = bs[i] <= m.lastCleared;
                bool sealedBefore = ts[i] + SKEW < obs;
                if (inAuction != sealedBefore) partitionErrors++;
            }
        } catch {}
    }

    function _firstAfter(uint256 afterSec) internal view returns (uint80) {
        uint80 id = feed.latestId();
        (,, uint256 o,,) = feed.getRoundData(id);
        if (o <= afterSec) return 0;
        while (id > feed.PHASE() + 1) {
            (,, uint256 prev,,) = feed.getRoundData(id - 1);
            if (prev <= afterSec) break;
            --id;
        }
        return id;
    }

    function _finishJob() internal {
        while (ex.jobOf(mkt).phase != 0) ex.clear(mkt, "");
    }

    /// Clears everything still waiting (observing as needed), settles every order, and checks solvency.
    function settleAndCheck(uint256 seed) external {
        if (seed % 4 != 0) return;
        _finishJob();
        for (uint256 k = 0; k < 64; ++k) {
            (uint256[] memory bs, uint256[] memory ts) = ex.pendingTimes(mkt, 512);
            if (bs.length == 0) break;
            vm.roll(vm.getBlockNumber() + 1);
            vm.warp(vm.getBlockTimestamp() + LAG + SKEW + 2);
            uint80 r = _firstAfter(ts[0] + SKEW);
            if (r == 0) {
                (,, uint256 prevObs,,) = feed.latestRoundData();
                uint256 at = ts[bs.length - 1] + SKEW + 1;
                if (at <= prevObs) at = prevObs + 1;
                feed.report(180e8, at);
                r = _firstAfter(ts[0] + SKEW);
            }
            vm.roll(vm.getBlockNumber() + 1);
            ex.clear(mkt, abi.encode(r, uint80(0)));
            _finishJob();
        }
        for (uint256 u = 0; u < actors.length; u++) {
            address a = actors[u];
            uint256 bm = ex.openOrderBitmap(a);
            for (uint256 i = 0; i < 55; i++) {
                if (bm & (1 << i) != 0) {
                    vm.prank(a);
                    ex.cancelOrder(i); // every order has had its auction: settling must not revert
                }
            }
            assertEq(ex.openOrderBitmap(a), 0, "all orders closed");
        }
        assertEq(ex.bookTotal(mkt, 0), 0, "bid book empty");
        assertEq(ex.bookTotal(mkt, 1), 0, "ask book empty");
        _checkToken(address(nvda));
        _checkToken(address(ausd));
    }

    function _checkToken(address token) internal view {
        uint256 ledger = ex.balanceOf(address(ex), token) + ex.balanceOf(address(vault), token);
        for (uint256 u = 0; u < actors.length; u++) {
            ledger += ex.balanceOf(actors[u], token);
        }
        assertGe(MockERC20(token).balanceOf(address(ex)), ledger, "solvency: tokens cover every ledger balance");
    }
}

contract CausalInvariantTest is StdInvariant, Test {
    CausalHandler internal handler;

    function setUp() public {
        vm.warp(1_760_000_000);
        MockERC20 nvda = new MockERC20("Anchored NVDA", "aNVDA", 18);
        MockERC20 ausd = new MockERC20("Agora USD", "AUSD", 6);
        MockOCR feed = new MockOCR(8);
        feed.report(180e8, vm.getBlockTimestamp() - 13);
        UnisonExchange impl = new UnisonExchange();
        UnisonExchange ex = UnisonExchange(
            address(new ERC1967Proxy(address(impl), abi.encodeCall(UnisonExchange.initialize, (address(this)))))
        );
        ex.listToken(address(nvda), false);
        ex.listToken(address(ausd), false);
        ChainlinkCausalReference cref = new ChainlinkCausalReference(address(this));
        uint256 mkt = ex.createMarket(
            UnisonExchange.MarketParams({
                base: address(nvda),
                quote: address(ausd),
                refAdapter: address(cref),
                tickSize: 10_000,
                minTick: 1,
                maxTick: uint32((1 << 21) - 1),
                maxBandTicks: 2001,
                bandBps: 100,
                feeBps: 2,
                maxFeeBps: 10,
                shards: 4,
                permissioned: false,
                strictAfterClose: true
            })
        );
        cref.setFeed(
            mkt, AggregatorV3Interface(address(feed)), AggregatorV3Interface(address(0)), 6, 1 days, 0, 0, 0, 0
        );
        ex.setCausal(mkt, address(cref), true, 2);
        LiquidityVault vault = new LiquidityVault(
            address(this),
            IUnisonVenue(address(ex)),
            mkt,
            "LP",
            "LP",
            LiquidityVault.Params({
                spreadBps: 15,
                depthBps: 50,
                widthTicks: 8,
                maxSkewTicks: 12,
                maxAuctionBps: 1000,
                swingBps: 30,
                extMult: 2,
                closedMult: 250,
                paused: false
            })
        );
        ex.addSource(mkt, address(vault));
        ausd.mint(address(this), 2_000_000e6);
        ausd.approve(address(vault), type(uint256).max);
        vault.requestDeposit(2_000_000e6);
        vm.roll(vm.getBlockNumber() + 1);
        vm.warp(vm.getBlockTimestamp() + 20);
        feed.report(180e8, vm.getBlockTimestamp() - 13);
        ex.clear(mkt, "");
        vault.process();

        handler = new CausalHandler(ex, feed, nvda, ausd, vault, mkt);
        targetContract(address(handler));
        bytes4[] memory sels = new bytes4[](5);
        sels[0] = CausalHandler.place.selector;
        sels[1] = CausalHandler.cancel.selector;
        sels[2] = CausalHandler.observe.selector;
        sels[3] = CausalHandler.clear.selector;
        sels[4] = CausalHandler.settleAndCheck.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: sels}));
    }

    function invariant_aWaitingOrderNeverLeavesBeforeItsAuction() public view {
        assertEq(handler.sealedCancels(), 0);
    }

    function invariant_theBatchIsExactlyTheOrdersSealedBeforeTheObservation() public view {
        assertEq(handler.partitionErrors(), 0);
    }

    function invariant_oracleTimeNeverRunsBackwards() public view {
        assertEq(handler.timeReversals(), 0);
    }

    function invariant_theReferenceTimeIsNeverTheChainClock() public view {
        assertEq(handler.chainClockStamps(), 0);
    }

    function afterInvariant() external view {
        // a run that tried to clear must have cleared: the path is exercised, not skipped
        if (handler.clearAttempts() > 0) assertGt(handler.clears(), 0, "clears happened");
    }
}

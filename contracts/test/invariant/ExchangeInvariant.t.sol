// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test, console} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {UnisonExchange} from "../../src/core/UnisonExchange.sol";
import {ManualReference} from "../../src/pricing/ManualReference.sol";
import {IReferenceAdapter} from "../../src/interfaces/IReferenceAdapter.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {LiquidityVault, IUnisonVenue} from "../../src/liquidity/LiquidityVault.sol";

/// @dev Drives random sequences of exchange operations. `settleAndCheck` cancels/claims everything
///      and asserts strong solvency: real token balance covers every ledger balance, and the
///      unallocated remainder (rounding dust) stays tiny.
contract ExchangeHandler is Test {
    UnisonExchange public ex;
    ManualReference public ref;
    MockERC20 public nvda;
    MockERC20 public ausd;
    uint256 public mkt;
    address[] public actors;
    address[] public extraAccounts; // curve sources holding venue balances

    uint256 public trades; // ghost: number of non-empty auctions
    uint256 public settles;
    uint256 public pausedClears; // ghost: clear calls that paused mid-job
    uint256 public resumedJobs; // ghost: jobs completed after at least one pause

    constructor(UnisonExchange ex_, ManualReference ref_, MockERC20 nvda_, MockERC20 ausd_, uint256 mkt_) {
        ex = ex_;
        ref = ref_;
        nvda = nvda_;
        ausd = ausd_;
        mkt = mkt_;
        for (uint256 i = 0; i < 4; i++) {
            address a = address(uint160(0xA000 + i));
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

    function place(uint256 actorSeed, uint256 sideSeed, uint256 tickSeed, uint256 qtySeed, uint256 iocSeed) external {
        address a = _actor(actorSeed);
        uint256 side = sideSeed % 2;
        // bids skew high, asks skew low, so books cross often; a few land outside the band
        uint256 tick = side == 0 ? 17_850 + (tickSeed % 400) : 17_750 + (tickSeed % 400);
        uint256 qty = 1e17 + (qtySeed % 20e18);
        uint256 flags = iocSeed % 5 == 0 ? 1 : 0;
        vm.prank(a);
        try ex.placeOrder(mkt, side, tick, qty, flags) {} catch {}
    }

    function cancel(uint256 actorSeed, uint256 slotSeed) external {
        address a = _actor(actorSeed);
        uint256 bm = ex.openOrderBitmap(a);
        if (bm == 0) return;
        uint256 s = slotSeed % 55;
        for (uint256 i = 0; i < 55; i++) {
            uint256 j = (s + i) % 55;
            if (bm & (1 << j) != 0) {
                vm.prank(a);
                try ex.cancelOrder(j) {} catch {}
                return;
            }
        }
    }

    function claimOne(uint256 actorSeed, uint256 slotSeed) external {
        address a = _actor(actorSeed);
        uint256[] memory s = new uint256[](1);
        s[0] = slotSeed % 55;
        try ex.claim(a, s) {} catch {}
    }

    function clearStep(uint256 priceSeed, uint256 statusSeed) external {
        _finishJob();
        vm.roll(block.number + 1);
        vm.warp(block.timestamp + 1);
        uint256 price = 178e6 + (priceSeed % 4e6); // $178..$182
        IReferenceAdapter.Status st =
            statusSeed % 10 == 0 ? IReferenceAdapter.Status.HALTED : IReferenceAdapter.Status.OPEN;
        ref.post(mkt, price, block.timestamp * 1000, st);
        try ex.clear(mkt, "") returns (uint256, uint256 vol) {
            if (vol > 0) trades++;
        } catch {}
    }

    /// Clear with a tight gas budget: exercises the resumable job (pause / resume across calls).
    function clearChunked(uint256 priceSeed, uint256 gasSeed) external {
        if (ex.jobOf(mkt).phase == 0) {
            vm.roll(block.number + 1);
            vm.warp(block.timestamp + 1);
            ref.post(mkt, 178e6 + (priceSeed % 4e6), block.timestamp * 1000, IReferenceAdapter.Status.OPEN);
        }
        bool wasRunning = ex.jobOf(mkt).phase != 0;
        try ex.clear{gas: 420_000 + (gasSeed % 1_500_000)}(mkt, "") returns (uint256, uint256 vol) {
            if (ex.jobOf(mkt).phase != 0) pausedClears++;
            else if (wasRunning) resumedJobs++;
            if (vol > 0) trades++;
        } catch {}
    }

    function _finishJob() internal {
        while (ex.jobOf(mkt).phase != 0) {
            ex.clear(mkt, "");
            resumedJobs++;
        }
    }

    /// Cancel every open order of every actor (settling fills), then check strong solvency.
    function settleAndCheck(uint256 seed) external {
        if (seed % 4 != 0) return; // let books build up between full settlements
        _finishJob();
        // merge anything still pending
        vm.roll(block.number + 1);
        vm.warp(block.timestamp + 1);
        ref.post(mkt, 180e6, block.timestamp * 1000, IReferenceAdapter.Status.HALTED);
        try ex.clear(mkt, "") {} catch {}

        for (uint256 u = 0; u < actors.length; u++) {
            address a = actors[u];
            uint256 bm = ex.openOrderBitmap(a);
            for (uint256 i = 0; i < 55; i++) {
                if (bm & (1 << i) != 0) {
                    vm.prank(a);
                    ex.cancelOrder(i); // must never revert on a valid open order
                }
            }
            assertEq(ex.openOrderBitmap(a), 0, "all orders closed");
        }
        assertEq(ex.bookTotal(mkt, 0), 0, "bid book empty");
        assertEq(ex.bookTotal(mkt, 1), 0, "ask book empty");

        _checkToken(address(nvda), 1e6); // base dust bound: 1e6 wei per settle cycle
        _checkToken(address(ausd), 1000); // quote dust bound: 0.001 AUSD per settle cycle
        settles++;
    }

    function addExtraAccount(address a) external {
        extraAccounts.push(a);
    }

    function extraCount() external view returns (uint256) {
        return extraAccounts.length;
    }

    function _checkToken(address token, uint256 dustPerCycle) internal view {
        uint256 ledger = ex.balanceOf(address(ex), token);
        for (uint256 u = 0; u < actors.length; u++) {
            ledger += ex.balanceOf(actors[u], token);
        }
        for (uint256 u = 0; u < extraAccounts.length; u++) {
            ledger += ex.balanceOf(extraAccounts[u], token);
        }
        uint256 physical = MockERC20(token).balanceOf(address(ex));
        assertGe(physical, ledger, "solvency: tokens cover every ledger balance");
        assertLe(physical - ledger, dustPerCycle * (trades + 1) * 4, "unallocated dust stays tiny");
    }

    function actorCount() external view returns (uint256) {
        return actors.length;
    }
}

contract ExchangeInvariantTest is StdInvariant, Test {
    UnisonExchange internal ex;
    ManualReference internal ref;
    MockERC20 internal nvda;
    MockERC20 internal ausd;
    ExchangeHandler internal handler;
    uint256 internal deposited;
    address internal vaultAddr;

    function setUp() public {
        nvda = new MockERC20("Anchored NVDA", "aNVDA", 18);
        ausd = new MockERC20("Agora USD", "AUSD", 6);
        ref = new ManualReference(address(this));
        UnisonExchange impl = new UnisonExchange();
        ex = UnisonExchange(
            address(new ERC1967Proxy(address(impl), abi.encodeCall(UnisonExchange.initialize, (address(this)))))
        );
        ex.listToken(address(nvda), false);
        ex.listToken(address(ausd), false);
        uint256 mkt = ex.createMarket(
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
        // a LiquidityVault quotes into every auction the fuzzer runs
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
                maxAuctionBps: 1_000,
                swingBps: 30,
                extMult: 2,
                closedMult: 4,
                paused: false
            })
        );
        ex.addSource(mkt, address(vault));
        ausd.mint(address(this), 2_000_000e6);
        ausd.approve(address(vault), type(uint256).max);
        vault.requestDeposit(2_000_000e6);
        vm.roll(block.number + 1);
        vm.warp(block.timestamp + 1);
        ref.post(mkt, 180e6, block.timestamp * 1000, IReferenceAdapter.Status.OPEN);
        ex.clear(mkt, "");
        vault.process();
        vaultAddr = address(vault);

        handler = new ExchangeHandler(ex, ref, nvda, ausd, mkt);
        handler.addExtraAccount(address(vault));
        ref.transferOwnership(address(handler));
        vm.prank(address(handler));
        ref.acceptOwnership();

        targetContract(address(handler));
        bytes4[] memory sels = new bytes4[](6);
        sels[0] = ExchangeHandler.place.selector;
        sels[1] = ExchangeHandler.cancel.selector;
        sels[2] = ExchangeHandler.claimOne.selector;
        sels[3] = ExchangeHandler.clearStep.selector;
        sels[4] = ExchangeHandler.settleAndCheck.selector;
        sels[5] = ExchangeHandler.clearChunked.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: sels}));
    }

    /// Tokens only leave via withdrawals (none in this run), so physical balances are constant.
    function invariant_physicalBalancesConserved() public view {
        assertEq(nvda.balanceOf(address(ex)), 4 * 10_000e18);
        assertEq(ausd.balanceOf(address(ex)), 4 * 5_000_000e6 + 2_000_000e6);
    }

    /// Free ledger balances can never exceed physical holdings (locks and dust are on top).
    function invariant_freeBalancesCovered() public view {
        uint256 n = handler.actorCount();
        uint256 sumN = ex.balanceOf(address(ex), address(nvda)) + ex.balanceOf(vaultAddr, address(nvda));
        uint256 sumQ = ex.balanceOf(address(ex), address(ausd)) + ex.balanceOf(vaultAddr, address(ausd));
        for (uint256 i = 0; i < n; i++) {
            sumN += ex.balanceOf(handler.actors(i), address(nvda));
            sumQ += ex.balanceOf(handler.actors(i), address(ausd));
        }
        assertGe(nvda.balanceOf(address(ex)), sumN);
        assertGe(ausd.balanceOf(address(ex)), sumQ);
    }

    /// Deterministic long run of the same actions: proves the fuzzer's world really trades a lot, and that
    /// strong solvency (everything settled → ledger ≡ physical tokens up to dust) holds after thousands of steps.
    function test_simulation_longRun() public {
        for (uint256 i = 0; i < 3_000; ++i) {
            uint256 r = uint256(keccak256(abi.encode("sim", i)));
            uint256 op = r % 20;
            if (op < 8) handler.place(r >> 8, r >> 16, r >> 32, r >> 64, r >> 96);
            else if (op < 10) handler.cancel(r >> 8, r >> 16);
            else if (op < 12) handler.claimOne(r >> 8, r >> 16);
            else if (op < 16) handler.clearStep(r >> 8, r >> 40);
            else if (op < 19) handler.clearChunked(r >> 8, r >> 40);
            else handler.settleAndCheck(0);
            invariant_freeBalancesCovered();
        }
        handler.settleAndCheck(0);
        console.log("sim trades", handler.trades(), "settles", handler.settles());
        console.log("sim paused clears", handler.pausedClears(), "resumed jobs", handler.resumedJobs());
        assertGt(handler.trades(), 150, "the simulated market trades heavily");
        assertGt(handler.pausedClears(), 10, "chunked clears paused and resumed");
    }

    function afterInvariant() public view {
        console.log("trades", handler.trades(), "settles", handler.settles());
        console.log("paused clears", handler.pausedClears(), "resumed jobs", handler.resumedJobs());
    }
}

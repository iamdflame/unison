// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {UnisonExchange} from "../../src/core/UnisonExchange.sol";
import {ExchangeBase} from "../../src/core/ExchangeBase.sol";
import {ManualReference} from "../../src/pricing/ManualReference.sol";
import {IReferenceAdapter} from "../../src/interfaces/IReferenceAdapter.sol";
import {MockERC20} from "../mocks/MockERC20.sol";

/// @notice The resumable clear job must produce exactly the same outcome whether it runs in one call or in
///         many gas-limited calls — and while it runs, nothing may change the levels it is about to fill.
contract ClearJobTest is Test {
    UnisonExchange internal ex;
    ManualReference internal ref;
    MockERC20 internal nvda;
    MockERC20 internal ausd;
    uint256 internal mkt;
    address[] internal actors;

    uint256 internal constant BID = 0;
    uint256 internal constant ASK = 1;

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
        for (uint256 i = 0; i < 24; ++i) {
            address a = address(uint160(0xB000 + i));
            actors.push(a);
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

    function _place(address a, uint256 side, uint256 tick, uint256 qty, uint256 flags) internal {
        vm.prank(a);
        ex.placeOrder(mkt, side, tick, qty, flags);
    }

    /// Band at ref $180 with 1% half-width: ticks [17_820, 18_180].
    function _seedBook() internal {
        for (uint256 i = 0; i < actors.length; ++i) {
            address a = actors[i];
            _place(a, BID, 17_950 + ((i * 7) % 120), 1e18 + i * 1e16, 0);
            _place(a, ASK, 17_960 + ((i * 5) % 110), 1e18 + i * 3e15, 0);
            if (i % 3 == 0) _place(a, BID, 18_300 + i, 2e17, 0); // above the band (ABOVE class)
            if (i % 4 == 0) _place(a, ASK, 17_700 - i, 3e17, 0); // below the band (BELOW class)
            if (i % 5 == 0) _place(a, BID, 18_050, 5e17, 1); // IOC
            if (i % 6 == 0) _place(a, ASK, 18_000, 4e17, 1); // IOC
        }
    }

    function _nextBlockRef() internal {
        vm.roll(block.number + 1);
        vm.warp(block.timestamp + 1);
        ref.post(mkt, 180e6, block.timestamp * 1000, IReferenceAdapter.Status.OPEN);
    }

    /// Cancels (settling) every open order, returns every balance.
    function _settleAll() internal returns (uint256[] memory out) {
        out = new uint256[](2 * actors.length + 2);
        for (uint256 u = 0; u < actors.length; ++u) {
            address a = actors[u];
            uint256 bm = ex.openOrderBitmap(a);
            for (uint256 i = 0; i < 55; ++i) {
                if (bm & (1 << i) != 0) {
                    vm.prank(a);
                    ex.cancelOrder(i);
                }
            }
            out[2 * u] = ex.balanceOf(a, address(nvda));
            out[2 * u + 1] = ex.balanceOf(a, address(ausd));
        }
        out[2 * actors.length] = ex.balanceOf(address(ex), address(nvda));
        out[2 * actors.length + 1] = ex.balanceOf(address(ex), address(ausd));
    }

    function test_chunkedClearEqualsSingleShot() public {
        _seedBook();
        _nextBlockRef();
        uint256 snap = vm.snapshotState();

        (uint256 t1, uint256 v1) = ex.clear(mkt, "");
        assertGt(v1, 0, "the seeded book trades");
        uint256[] memory single = _settleAll();

        vm.revertToState(snap);
        uint256 calls;
        uint256 paused;
        uint256 g = 1_200_000;
        while (true) {
            try ex.clear{gas: g}(mkt, "") returns (uint256 t, uint256 v) {
                ++calls;
                if (ex.jobOf(mkt).phase == 0) {
                    assertEq(t, t1, "same clearing tick");
                    assertEq(v, v1, "same volume");
                    break;
                }
                ++paused;
            } catch {
                g += 500_000; // a step that is not chunked (the auction itself) needs a bigger call
            }
            require(calls < 400, "job does not terminate");
        }
        assertGt(paused, 2, "the job really ran in pieces");
        uint256[] memory chunked = _settleAll();
        for (uint256 i = 0; i < single.length; ++i) {
            assertEq(chunked[i], single[i], "identical outcome per account and token");
        }
        assertEq(ex.bookTotal(mkt, BID), 0);
        assertEq(ex.bookTotal(mkt, ASK), 0);
    }

    function test_cancelBlockedWhileJobApplies() public {
        _seedBook();
        _nextBlockRef();
        // run until the job is in APPLY
        uint256 g = 1_200_000;
        for (uint256 n = 0; n < 400 && ex.jobOf(mkt).phase != 2; ++n) {
            try ex.clear{gas: g}(mkt, "") {} catch { g += 500_000; }
        }
        assertEq(ex.jobOf(mkt).phase, 2, "job is applying fills");
        // a cancel of a merged order would change a level the job may still fill
        vm.prank(actors[0]);
        vm.expectRevert(ExchangeBase.ClearInProgress.selector);
        ex.cancelOrder(0);
        // orders placed now belong to a later batch and are unaffected
        vm.prank(actors[1]);
        ex.placeOrder(mkt, BID, 17_900, 1e18, 0);
        // finishing the job unblocks cancels
        while (ex.jobOf(mkt).phase != 0) ex.clear(mkt, "");
        vm.prank(actors[0]);
        ex.cancelOrder(0);
    }

    function test_stuckFreeUnderSpam_manyOutsideLevels() public {
        // 300 distinct bid levels above the band: a single clear would be heavy, the job just takes more calls
        for (uint256 i = 0; i < 300; ++i) {
            _place(actors[i % actors.length], BID, 18_400 + i * 3, 1e16, 0);
        }
        _place(actors[0], ASK, 17_900, 3e18, 0); // fills all of them (3e18 = 300 * 1e16)
        _nextBlockRef();
        uint256 calls;
        uint256 g = 3_000_000;
        uint256 lc = ex.market(mkt).lastCleared;
        while (ex.market(mkt).lastCleared == lc) {
            try ex.clear{gas: g}(mkt, "") {} catch { g += 1_000_000; }
            ++calls;
            require(calls < 200, "no progress");
        }
        assertGt(calls, 1);
        assertEq(ex.market(mkt).auctions, 1);
        assertEq(ex.bookTotal(mkt, BID), 0, "all 300 outside levels fully filled");
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test, Vm} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {UnisonExchange} from "../../src/core/UnisonExchange.sol";
import {ExchangeBase} from "../../src/core/ExchangeBase.sol";
import {ManualReference} from "../../src/pricing/ManualReference.sol";
import {IReferenceAdapter} from "../../src/interfaces/IReferenceAdapter.sol";
import {ICurveSource} from "../../src/interfaces/ICurveSource.sol";
import {LiquidityVault, IUnisonVenue} from "../../src/liquidity/LiquidityVault.sol";
import {MockERC20} from "../mocks/MockERC20.sol";

/// @dev The venue as LiquidityVault sees it: a configurable market view and ledger balances.
contract MockVenue {
    IUnisonVenue.MarketView internal _m;
    mapping(address => mapping(address => uint256)) internal _bal;

    function setMarket(address base, address quote, uint64 baseUnit) external {
        _m.base = base;
        _m.quote = quote;
        _m.baseUnit = baseUnit;
    }

    function setBalance(address account, address token, uint256 amount) external {
        _bal[account][token] = amount;
    }

    function market(uint256) external view returns (IUnisonVenue.MarketView memory) {
        return _m;
    }

    function jobPhase(uint256) external pure returns (uint8) {
        return 0;
    }

    function balanceOf(address account, address token) external view returns (uint256) {
        return _bal[account][token];
    }

    function deposit(address, uint256) external {}

    function withdraw(address, uint256, address) external {}
}

/// @dev A curve source quoting a fixed curve (a designated maker).
contract FixedCurveSource is ICurveSource {
    Curve internal _c;

    function set(Curve memory c) external {
        _c = c;
    }

    function curve(uint256, uint256, uint8, uint256, uint256, uint256) external view returns (Curve memory) {
        return _c;
    }

    function onAuction(uint256, uint256, uint256, uint256, uint256, uint256, uint256, uint256) external {}
}

/// @notice Differential tests of the curve port (packages/engine/src/curve.ts):
///           * `LiquidityVault.curve` bit for bit (regime multipliers, skew, depth caps, uint32 truncation, reverts)
///           * one auction end to end through the real exchange — regime band, a real vault and a fixed-curve source
///             clipped and capped by `_loadCurves`, merged with random books, cleared, settled by `_settleCurves`
///         Run with: FOUNDRY_PROFILE=diff forge test   (needs node >= 24 on PATH and `pnpm install`)
contract CurveDiffTest is Test {
    string internal constant FFI = "../packages/engine/src/ffi.ts";
    uint256 internal constant B = 1e18;

    MockERC20 internal nvda;
    MockERC20 internal ausd;
    MockVenue internal venue;
    UnisonExchange internal ex;
    ManualReference internal mref;
    address[4] internal traders;

    function setUp() public {
        vm.warp(1_760_000_000);
        nvda = new MockERC20("aNVDA", "aNVDA", 18);
        ausd = new MockERC20("AUSD", "AUSD", 6);
        venue = new MockVenue();
        mref = new ManualReference(address(this));
        UnisonExchange impl = new UnisonExchange();
        ex = UnisonExchange(
            address(new ERC1967Proxy(address(impl), abi.encodeCall(UnisonExchange.initialize, (address(this)))))
        );
        ex.listToken(address(nvda), false);
        ex.listToken(address(ausd), false);
        nvda.approve(address(ex), type(uint256).max);
        ausd.approve(address(ex), type(uint256).max);
        for (uint256 i = 0; i < 4; ++i) {
            address t = address(uint160(0xD1FF00 + i));
            traders[i] = t;
            nvda.mint(t, 1e27);
            ausd.mint(t, 1e17);
            vm.startPrank(t);
            nvda.approve(address(ex), type(uint256).max);
            ausd.approve(address(ex), type(uint256).max);
            ex.deposit(address(nvda), 1e27);
            ex.deposit(address(ausd), 1e17);
            vm.stopPrank();
        }
    }

    function _ffi(string memory cmd, bytes memory input) internal returns (bytes memory) {
        string[] memory args = new string[](4);
        args[0] = "node";
        args[1] = FFI;
        args[2] = cmd;
        args[3] = vm.toString(input);
        return vm.ffi(args);
    }

    function _r(uint256 seed, uint256 i) internal pure returns (uint256) {
        return uint256(keccak256(abi.encode(seed, i)));
    }

    /// Valid (setParams-accepted) random vault parameters, also written to w[o..o+8].
    function _vaultParams(uint256 seed, uint256[] memory w, uint256 o)
        internal
        pure
        returns (LiquidityVault.Params memory p)
    {
        p = LiquidityVault.Params({
            spreadBps: uint16(1 + _r(seed, 100) % 300),
            depthBps: uint16(_r(seed, 101) % 6 == 0 ? _r(seed, 102) % 10_001 : _r(seed, 102) % 200),
            widthTicks: uint16(1 + _r(seed, 103) % 40),
            maxSkewTicks: uint16(_r(seed, 104) % 60),
            maxAuctionBps: uint16(_r(seed, 105) % 6 == 0 ? _r(seed, 106) % 10_001 : _r(seed, 106) % 2_000),
            swingBps: uint16(_r(seed, 107) % 1_001),
            extMult: uint8(1 + _r(seed, 108) % 6),
            closedMult: uint8(1 + _r(seed, 109) % 8),
            paused: _r(seed, 110) % 20 == 0
        });
        w[o] = p.spreadBps;
        w[o + 1] = p.depthBps;
        w[o + 2] = p.widthTicks;
        w[o + 3] = p.maxSkewTicks;
        w[o + 4] = p.maxAuctionBps;
        w[o + 5] = p.swingBps;
        w[o + 6] = p.extMult;
        w[o + 7] = p.closedMult;
        w[o + 8] = p.paused ? 1 : 0;
    }

    function _assertCurve(uint256[] memory out, uint256 o, ICurveSource.Curve memory c) internal pure {
        assertEq(out[o], c.bidTop, "bidTop");
        assertEq(out[o + 1], c.bidTicks, "bidTicks");
        assertEq(out[o + 2], c.bidPerTick, "bidPerTick");
        assertEq(out[o + 3], c.askBottom, "askBottom");
        assertEq(out[o + 4], c.askTicks, "askTicks");
        assertEq(out[o + 5], c.askPerTick, "askPerTick");
    }

    // ------------------------------------------------------------------ LiquidityVault.curve

    /// forge-config: diff.fuzz.runs = 256
    function testFuzz_vaultCurveMatchesEngine(uint256 seed) public {
        uint256[] memory w = new uint256[](18);
        LiquidityVault.Params memory p = _vaultParams(seed, w, 0);
        uint256 baseUnit = 10 ** (6 + _r(seed, 1) % 13);
        venue.setMarket(address(nvda), address(ausd), uint64(baseUnit));
        LiquidityVault vault = new LiquidityVault(address(this), IUnisonVenue(address(venue)), 0, "v", "v", p);

        uint256 refPrice = _r(seed, 6) % 16 == 0 ? 0 : 1 + _r(seed, 7) % 1e12;
        uint256 mode = _r(seed, 2) % 8;
        uint256 q = mode == 1 ? 0 : _r(seed, 4) % 1e15;
        // modes 5-7: base worth 0-3x the quote at the reference → base weight 0-75% (skews of both signs)
        uint256 b = mode == 0
            ? 0
            : mode < 5 || refPrice == 0
                ? _r(seed, 3) % (1e9 * baseUnit)
                : q * (_r(seed, 3) % 30_000) * baseUnit / (10_000 * refPrice);
        if (mode == 2) (b, q) = (0, 0);
        if (mode == 3) b = _r(seed, 3) >> (_r(seed, 5) % 64); // overflow territory
        if (mode == 4) q = _r(seed, 4) >> (_r(seed, 5) % 64);
        uint256 tickMode = _r(seed, 8) % 8;
        uint256 refTick = tickMode == 0
            ? (1 << 32) - 64 + _r(seed, 9) % 128 // bidTop / askBottom straddle the uint32 cast
            : tickMode == 1 ? _r(seed, 9) >> (_r(seed, 10) % 32) : 1 + _r(seed, 9) % ((1 << 21) - 1);
        uint8 status = uint8(_r(seed, 11) % 5);
        venue.setBalance(address(vault), address(nvda), b);
        venue.setBalance(address(vault), address(ausd), q);
        (w[9], w[10], w[11], w[12], w[13], w[14]) = (b, q, baseUnit, refPrice, status, refTick);
        (w[15], w[16], w[17]) = (refTick > 100 ? refTick - 100 : 1, refTick + 100, 1 + _r(seed, 12) % 1e5);

        uint256[] memory out = abi.decode(_ffi("curve", abi.encode(w)), (uint256[]));
        assertEq(out.length, 13, "shape");
        try vault.curve(0, refPrice, status, refTick, w[15], w[16]) returns (ICurveSource.Curve memory c) {
            assertEq(out[0] == 1, false, "engine reverted, vault did not");
            _assertCurve(out, 1, c);
        } catch {
            assertEq(out[0], 1, "vault reverted, engine did not");
        }
    }

    // ------------------------------------------------------------------ one auction end to end

    struct Auction {
        uint256 mkt;
        uint256 tickSize;
        uint256 px;
        uint256 status;
        uint256 t;
        LiquidityVault vault;
        FixedCurveSource maker;
        uint256 nSources;
        uint256 nOrders;
        uint256 refTick;
        uint256 lo;
        uint256 hi;
        uint256 bps;
    }

    function _createMarket(uint256 seed, Auction memory a) internal {
        a.tickSize = [uint256(1_000), 10_000, 100_000, 10_000][_r(seed, 1) % 4];
        uint256 target = 200 + _r(seed, 2) % 1_500_000 / (a.tickSize / 1_000); // refTick
        a.px = target * a.tickSize + _r(seed, 3) % a.tickSize;
        a.mkt = ex.createMarket(
            UnisonExchange.MarketParams({
                base: address(nvda),
                quote: address(ausd),
                refAdapter: address(mref),
                tickSize: uint64(a.tickSize),
                minTick: 1,
                maxTick: uint32((1 << 21) - 1),
                maxBandTicks: uint32(1 + _r(seed, 4) % 4_001),
                bandBps: uint16(1 + _r(seed, 5) % 400),
                feeBps: 3,
                maxFeeBps: 10,
                shards: 4,
                permissioned: false,
                strictAfterClose: false
            })
        );
        if (_r(seed, 6) % 2 == 0) {
            uint16 floor = uint16(1 + _r(seed, 7) % 300);
            ex.setRegime(a.mkt, uint16(1 + _r(seed, 8) % 800), uint16(1 + _r(seed, 9) % 2_000), floor, floor, 0, 10);
        }
        a.status = _r(seed, 10) % 4;
    }

    /// Seeds the sources' ledgers and writes the source words; returns the next word offset.
    function _sources(uint256 seed, Auction memory a, uint256[] memory w) internal returns (uint256 o) {
        o = 21;
        LiquidityVault.Params memory p = _vaultParams(seed, w, o + 1);
        a.vault = new LiquidityVault(address(this), IUnisonVenue(address(ex)), a.mkt, "v", "v", p);
        ex.addSource(a.mkt, address(a.vault));
        uint256 vq = _r(seed, 22) % 4 == 0 ? 0 : _r(seed, 23) % 1e13;
        uint256 k = _r(seed, 20) % 4;
        // base worth 0-3x the quote at the reference most of the time: inventory skews of both signs
        uint256 vb = k == 0 ? 0 : k == 1 ? _r(seed, 21) % 5_000e18 : vq * (_r(seed, 21) % 30_000) * B / (10_000 * a.px);
        _fund(address(a.vault), vb, vq);
        (w[o], w[o + 10], w[o + 11]) = (0, vb, vq);
        o += 12;
        a.nSources = 1;
        if (_r(seed, 24) % 2 == 0) {
            uint256 ref = a.px / a.tickSize;
            ICurveSource.Curve memory c = ICurveSource.Curve({
                bidTop: uint32(ref - 30 + _r(seed, 25) % 40),
                bidTicks: uint32(_r(seed, 26) % 20),
                bidPerTick: uint128(_r(seed, 27) % 20e18),
                askBottom: uint32(ref - 10 + _r(seed, 28) % 40),
                askTicks: uint32(_r(seed, 29) % 20),
                askPerTick: uint128(_r(seed, 30) % 20e18)
            });
            a.maker = new FixedCurveSource();
            a.maker.set(c);
            ex.addSource(a.mkt, address(a.maker));
            uint256 mb = _r(seed, 31) % 4 == 0 ? 0 : _r(seed, 32) % 300e18;
            uint256 mq = _r(seed, 33) % 4 == 0 ? 0 : _r(seed, 34) % 1e11;
            _fund(address(a.maker), mb, mq);
            (w[o], w[o + 1], w[o + 2], w[o + 3]) = (1, c.bidTop, c.bidTicks, c.bidPerTick);
            (w[o + 4], w[o + 5], w[o + 6], w[o + 10], w[o + 11]) = (c.askBottom, c.askTicks, c.askPerTick, mb, mq);
            o += 12;
            a.nSources = 2;
        }
    }

    function _fund(address who, uint256 base, uint256 quote) internal {
        nvda.mint(address(this), base);
        ausd.mint(address(this), quote);
        if (base != 0) ex.depositFor(who, address(nvda), base);
        if (quote != 0) ex.depositFor(who, address(ausd), quote);
    }

    /// Random orders around the reference (some beyond the band, some IOC); writes [side, tick, qty] words.
    function _orders(uint256 seed, Auction memory a, uint256[] memory w, uint256 o) internal {
        uint256 ref = a.px / a.tickSize;
        for (uint256 i = 0; i < a.nOrders; ++i) {
            uint256 rr = _r(seed, 1_000 + i);
            uint256 side = rr % 2;
            uint256 spread = 1 + (rr >> 8) % 300;
            uint256 tick = (rr >> 24) % 2 == 0 ? ref + (rr >> 32) % spread : ref - (rr >> 32) % spread;
            uint256 qty = 1 + (rr >> 64) % 30e18;
            vm.prank(traders[i % 4]);
            ex.placeOrder(a.mkt, side, tick, qty, (rr >> 160) % 5 == 0 ? 1 : 0);
            (w[o + 3 * i], w[o + 3 * i + 1], w[o + 3 * i + 2]) = (side, tick, qty);
        }
    }

    /// forge-config: diff.fuzz.runs = 200
    function testFuzz_auctionMatchesEngine(uint256 seed) public {
        Auction memory a;
        _createMarket(seed, a);
        a.nOrders = _r(seed, 11) % 14;
        uint256[] memory w = new uint256[](21 + 24 + 3 * a.nOrders);
        uint256 o = _sources(seed, a, w);
        _orders(seed, a, w, o);
        w = _trim(w, o + 3 * a.nOrders);

        a.t = vm.getBlockTimestamp() + 1;
        vm.roll(vm.getBlockNumber() + 1);
        vm.warp(a.t);
        mref.post(a.mkt, a.px, a.t * 1000, IReferenceAdapter.Status(a.status));
        ExchangeBase.Regime memory g = ex.regimeOf(a.mkt);
        (w[0], w[1], w[2], w[3], w[4], w[5]) = (a.px, a.tickSize, 1, (1 << 21) - 1, ex.market(a.mkt).maxBandTicks, 0);
        w[5] = ex.market(a.mkt).bandBps;
        (w[6], w[7], w[8], w[9]) = (B, a.status, 0, a.t);
        (w[10], w[11], w[12], w[13], w[14]) =
            (g.extBandBps, g.reopenBandBps, g.discFloorBps, g.discCapBps, g.discHorizonSec);
        (w[15], w[16], w[17], w[18]) = (g.discCadence, g.halted ? 1 : 0, g.closedSince, g.lastDiscoveryBatch);
        (w[19], w[20]) = (a.nSources, a.nOrders);

        // what the exchange will ask the vault for (before the auction moves its balances)
        (a.refTick, a.lo, a.hi, a.bps) = ex.previewBand(a.mkt, a.px, IReferenceAdapter.Status(a.status));
        bool vaultReverted;
        ICurveSource.Curve memory vc;
        try a.vault.curve(a.mkt, a.px, uint8(a.status), a.refTick, a.lo, a.hi) returns (ICurveSource.Curve memory c) {
            vc = c;
        } catch {
            vaultReverted = true;
        }

        uint256[] memory out = abi.decode(_ffi("auction", abi.encode(w)), (uint256[]));
        assertEq(out.length, 9 + 16 * a.nSources, "shape");

        vm.recordLogs();
        (uint256 tick, uint256 volume) = ex.clear(a.mkt, "");
        _checkAuction(a, out, tick, volume, vm.getRecordedLogs());
        if (a.status != uint256(IReferenceAdapter.Status.HALTED) && !vaultReverted) _assertCurve(out, 9, vc);
    }

    function _checkAuction(Auction memory a, uint256[] memory out, uint256 tick, uint256 volume, Vm.Log[] memory logs)
        internal
        view
    {
        bool halted = a.status == uint256(IReferenceAdapter.Status.HALTED);
        assertEq(out[0], halted ? 0 : 1, "ran");
        if (!halted) {
            assertEq(out[1], a.lo, "lo");
            assertEq(out[2], a.hi, "hi");
            assertEq(out[3], a.refTick, "refTick");
            assertEq(out[4], a.bps, "bandBps");
        }
        assertEq(out[6], tick, "tick");
        assertEq(out[7], volume, "volume");
        bool sawBatch;
        uint256[4][2] memory fills;
        for (uint256 i = 0; i < logs.length; ++i) {
            if (logs[i].emitter != address(ex)) continue;
            bytes32 topic = logs[i].topics[0];
            if (topic == ExchangeBase.BatchCleared.selector) {
                (, uint256 price, uint256 vol,,,, uint256 bandLo, uint256 bandHi,) = abi.decode(
                    logs[i].data, (uint256, uint256, uint256, uint256, uint256, uint8, uint256, uint256, bytes32)
                );
                assertEq(out[5], vol > 0 ? 1 : 0, "traded");
                assertEq(out[8], price, "price");
                assertEq(out[1], bandLo, "bandLo");
                assertEq(out[2], bandHi, "bandHi");
                sawBatch = true;
            } else if (topic == ExchangeBase.CurveFilled.selector) {
                address src = address(uint160(uint256(logs[i].topics[2])));
                uint256 k = src == address(a.vault) ? 0 : 1;
                (fills[k][0], fills[k][1], fills[k][2], fills[k][3]) =
                    abi.decode(logs[i].data, (uint256, uint256, uint256, uint256));
            }
        }
        assertTrue(sawBatch, "BatchCleared");
        for (uint256 k = 0; k < a.nSources; ++k) {
            uint256 base = 9 + 16 * k + 12;
            assertEq(out[base], fills[k][0], "boughtBase");
            assertEq(out[base + 1], fills[k][1], "paidQuote");
            assertEq(out[base + 2], fills[k][2], "soldBase");
            assertEq(out[base + 3], fills[k][3], "receivedQuote");
        }
    }

    function _trim(uint256[] memory w, uint256 n) internal pure returns (uint256[] memory) {
        assembly ("memory-safe") {
            mstore(w, n)
        }
        return w;
    }
}

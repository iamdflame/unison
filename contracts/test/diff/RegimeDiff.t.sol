// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ExchangeBase} from "../../src/core/ExchangeBase.sol";
import {ExchangeClearing} from "../../src/core/ExchangeClearing.sol";
import {IReferenceAdapter} from "../../src/interfaces/IReferenceAdapter.sol";

/// @dev Returns whatever reference the test sets.
contract StubReference is IReferenceAdapter {
    uint256 internal _price;
    uint256 internal _publishMs;
    Status internal _status;

    function set(uint256 price, uint256 publishMs, Status status) external {
        _price = price;
        _publishMs = publishMs;
        _status = status;
    }

    function read(uint256, uint256, bytes calldata) external view returns (uint256, uint256, Status) {
        return (_price, _publishMs, _status);
    }
}

/// @dev The exchange's clearing module over raw storage: market 0 and its regime are written directly, so any regime
///      state (closed periods, cadences, halts, last statuses) can be set up without replaying history.
contract RegimeHarness is ExchangeClearing {
    function setMarket(Market memory m) external {
        MainStorage storage $ = _s();
        if ($.markets.length == 0) $.markets.push();
        $.markets[0] = m;
    }

    function setRegime(Regime memory g) external {
        _s().regimes[0] = g;
    }

    function band(uint256 px, IReferenceAdapter.Status st)
        external
        view
        returns (uint256 refTick, uint256 lo, uint256 hi, uint256 bps)
    {
        return _band(0, _market(0), px, st);
    }

    function clearUpTo(uint256 upTo, bytes calldata payload)
        external
        returns (uint256 tick, uint256 volume, bool done)
    {
        return _clear(0, upTo, payload);
    }

    function regimeState() external view returns (Regime memory) {
        return _s().regimes[0];
    }

    function lastStatus() external view returns (uint8) {
        return _market(0).lastStatus;
    }
}

/// @notice Differential test of the regime logic (packages/engine/src/regime.ts) against ExchangeClearing:
///         `_band` / `_regimeBandBps` (incl. the DISCOVERY √t band), the TooEarly cadence of `_openJob`, the
///         regime state `_finalize` leaves behind, and `nextDiscoveryBatch` as the earliest batch the contract accepts.
///         Run with: FOUNDRY_PROFILE=diff forge test   (needs node >= 24 on PATH and `pnpm install`)
contract RegimeDiffTest is Test {
    string internal constant FFI = "../packages/engine/src/ffi.ts";
    uint8 internal constant CLOSED = uint8(IReferenceAdapter.Status.CLOSED);

    RegimeHarness internal h;
    StubReference internal ref;

    function setUp() public {
        h = new RegimeHarness();
        ref = new StubReference();
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

    /// Words: [refPrice, tickSize, minTick, maxTick, maxBandTicks, bandBps, lastStatus, status, now,
    ///         regime(9), upTo, lastCleared, refTimeMs] — the layout of ffi.ts `regime`.
    function _market(uint256 seed, uint256[] memory w) internal view returns (ExchangeBase.Market memory m) {
        uint256 k = _r(seed, 0) % 4;
        uint256 ts = k == 0 ? 1 : k == 1 ? 100 : k == 2 ? 10_000 : 1 + _r(seed, 1) % 1e6;
        uint256 minTick = 1 + _r(seed, 2) % 50;
        uint256 maxTick = _r(seed, 3) % 3 == 0 ? minTick + 1 + _r(seed, 4) % 100_000 : (1 << 21) - 1;
        uint256 px = (_r(seed, 5) % (maxTick + 2_000)) * ts + _r(seed, 6) % ts; // refTick below, inside, above
        if (px == 0) px = 1;
        uint256 upTo = 1_000 + _r(seed, 7) % 1_000;
        m.refAdapter = address(ref);
        m.active = true;
        m.shards = 4;
        m.bandBps = uint16(1 + _r(seed, 8) % 5_000);
        m.minTick = uint32(minTick);
        m.maxTick = uint32(maxTick);
        m.maxBandTicks = uint32(1 + _r(seed, 9) % 12_001);
        m.baseUnit = 1e18;
        m.tickSize = uint64(ts);
        m.lastStatus = uint8(_r(seed, 10) % 4);
        m.lastCleared = uint64(upTo - 1 - _r(seed, 11) % 20);
        w[0] = px;
        w[1] = ts;
        w[2] = minTick;
        w[3] = maxTick;
        w[4] = m.maxBandTicks;
        w[5] = m.bandBps;
        w[6] = m.lastStatus;
        w[7] = _r(seed, 12) % 4; // status
        w[8] = 1_760_000_000 + _r(seed, 13) % 1_000_000; // block.timestamp
        w[18] = upTo;
        w[19] = m.lastCleared;
        w[20] = w[8] * 1000 + _r(seed, 14) % 1000; // reference publish time (ms)
    }

    function _regime(uint256 seed, uint256[] memory w) internal pure returns (ExchangeBase.Regime memory g) {
        g.extBandBps = uint16(_r(seed, 20) % 5 == 0 ? 0 : _r(seed, 21) % 5_001);
        g.reopenBandBps = uint16(_r(seed, 22) % 5 == 0 ? 0 : _r(seed, 23) % 5_001);
        g.discFloorBps = uint16(_r(seed, 24) % 3_000);
        g.discCapBps = uint16(_r(seed, 25) % 5_001);
        g.discHorizonSec = uint32(_r(seed, 26) % 4 == 0 ? 0 : _r(seed, 27) % 500_000);
        g.discCadence = uint32(_r(seed, 28) % 20);
        g.halted = _r(seed, 29) % 4 == 0;
        // closed since some time before (or, for robustness, after) now; 0 = not closed
        g.closedSince = uint64(_r(seed, 30) % 3 == 0 ? 0 : w[8] - 600_000 + _r(seed, 31) % 700_000);
        g.lastDiscoveryBatch = uint64(_r(seed, 32) % 3 == 0 ? 0 : w[18] - 30 + _r(seed, 33) % 35);
        w[9] = g.extBandBps;
        w[10] = g.reopenBandBps;
        w[11] = g.discFloorBps;
        w[12] = g.discCapBps;
        w[13] = g.discHorizonSec;
        w[14] = g.discCadence;
        w[15] = g.halted ? 1 : 0;
        w[16] = g.closedSince;
        w[17] = g.lastDiscoveryBatch;
    }

    /// Runs the real clear path (`_openJob` → … → `_finalize`) for batches <= upTo and checks TooEarly.
    function _clearExpecting(uint256 upTo, bool tooEarly) internal {
        vm.roll(upTo + 1);
        (bool ok, bytes memory ret) = address(h).call(abi.encodeCall(RegimeHarness.clearUpTo, (upTo, bytes(""))));
        if (tooEarly) {
            assertFalse(ok, "expected TooEarly");
            assertEq(bytes4(ret), ExchangeBase.TooEarly.selector, "TooEarly");
        } else {
            assertTrue(ok, "clear should run");
        }
    }

    /// The DISCOVERY band's √: OZ `Math.sqrt` vs the engine's `sqrt`, 32 values per call — random widths plus
    /// perfect squares and their neighbours, where a rounding difference would show.
    /// forge-config: diff.fuzz.runs = 64
    function testFuzz_sqrtMatchesEngine(uint256 seed) public {
        uint256[] memory xs = new uint256[](32);
        for (uint256 i = 0; i < 32; i += 4) {
            uint256 r = _r(seed, i);
            uint256 s = r >> (128 + (r % 128)); // a root of 0..128 bits
            xs[i] = r >> (r % 256);
            xs[i + 1] = s * s;
            xs[i + 2] = s * s + 1;
            xs[i + 3] = s == 0 ? 0 : s * s - 1;
        }
        uint256[] memory out = abi.decode(_ffi("sqrt", abi.encode(xs)), (uint256[]));
        assertEq(out.length, 32, "shape");
        for (uint256 i = 0; i < 32; ++i) {
            assertEq(out[i], Math.sqrt(xs[i]), "sqrt");
        }
    }

    /// forge-config: diff.fuzz.runs = 256
    function testFuzz_regimeMatchesEngine(uint256 seed) public {
        uint256[] memory w = new uint256[](21);
        ExchangeBase.Market memory m = _market(seed, w);
        ExchangeBase.Regime memory g = _regime(seed, w);
        h.setMarket(m);
        h.setRegime(g);
        vm.warp(w[8]);
        IReferenceAdapter.Status st = IReferenceAdapter.Status(w[7]);
        uint256[] memory out = abi.decode(_ffi("regime", abi.encode(w)), (uint256[]));
        assertEq(out.length, 10, "shape");

        (uint256 refTick, uint256 lo, uint256 hi, uint256 bps) = h.band(w[0], st);
        assertEq(out[0], refTick, "refTick");
        assertEq(out[1], lo, "lo");
        assertEq(out[2], hi, "hi");
        assertEq(out[3], bps, "bandBps");

        // cadence and the regime state a completed clear leaves behind
        ref.set(w[0], w[20], st);
        uint256 snap = vm.snapshotState();
        _clearExpecting(w[18], out[4] == 1);
        if (out[4] == 0) {
            ExchangeBase.Regime memory after_ = h.regimeState();
            assertEq(after_.closedSince, out[7], "closedSince");
            assertEq(after_.lastDiscoveryBatch, out[8], "lastDiscoveryBatch");
            assertEq(h.lastStatus(), out[9], "lastStatus");
        }

        // nextDiscoveryBatch is exactly the first batch a DISCOVERY call auction may cover
        if (uint8(st) == CLOSED && !g.halted) {
            uint256 next = out[6];
            vm.revertToState(snap);
            snap = vm.snapshotState();
            _clearExpecting(next, false);
            if (next - 1 > m.lastCleared) {
                vm.revertToState(snap);
                _clearExpecting(next - 1, true);
            }
        }
    }
}

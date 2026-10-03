// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {Clearing} from "../../src/core/Clearing.sol";
import {OrderMath} from "../../src/core/OrderMath.sol";
import {BookStore} from "../../src/core/BookStore.sol";
import {BookHarness} from "../unit/BookStore.t.sol";

/// @notice Differential tests: the Solidity engine and the independent TypeScript engine
///         (packages/engine, bigint-exact) must agree bit-for-bit on random inputs.
///         Run with: FOUNDRY_PROFILE=diff forge test   (needs node >= 24 on PATH and `pnpm install`)
contract EngineDiffTest is Test {
    string internal constant FFI = "../packages/engine/src/ffi.ts";
    uint256 internal constant B = 1e18;
    uint256 internal constant T = 18_000;

    function _ffi(string memory cmd, bytes memory input) internal returns (bytes memory) {
        string[] memory args = new string[](4);
        args[0] = "node";
        args[1] = FFI;
        args[2] = cmd;
        args[3] = vm.toString(input);
        return vm.ffi(args);
    }

    /// forge-config: diff.fuzz.runs = 300
    function testFuzz_clearingMatchesEngine(uint256 seed) public {
        uint256 n = 1 + (seed % 16);
        Clearing.Input memory x;
        x.lo = 1_000 + ((seed >> 8) % 1_000);
        x.hi = x.lo + n - 1;
        x.refTick = x.lo + ((seed >> 20) % n);
        x.bids = new uint256[](n);
        x.asks = new uint256[](n);
        for (uint256 i = 0; i < n; ++i) {
            uint256 r = uint256(keccak256(abi.encode(seed, i)));
            if (r % 3 != 0) x.bids[i] = (r >> 8) % 1e21;
            if ((r >> 4) % 3 != 0) x.asks[i] = (r >> 96) % 1e21;
        }
        if ((seed >> 40) % 3 == 0) x.bidAbove = (seed >> 48) % 1e21;
        if ((seed >> 120) % 3 == 0) x.askBelow = (seed >> 128) % 1e21;

        Clearing.Result memory r = Clearing.compute(x);
        bytes memory out =
            _ffi("clear", abi.encode(x.lo, x.hi, x.refTick, x.bidAbove, x.askBelow, x.bids, x.asks));
        (
            bool traded,
            uint256 tick,
            uint256 volume,
            uint256 bm,
            uint256 br,
            uint256 bf,
            uint256 am,
            uint256 ar,
            uint256 af
        ) = abi.decode(out, (bool, uint256, uint256, uint256, uint256, uint256, uint256, uint256, uint256));
        assertEq(traded, r.traded, "traded");
        assertEq(tick, r.tick, "tick");
        assertEq(volume, r.volume, "volume");
        assertEq(bm, r.bidMarginal, "bidMarginal");
        assertEq(br, r.bidRatio, "bidRatio");
        assertEq(bf, r.bidMarginalFill, "bidMarginalFill");
        assertEq(am, r.askMarginal, "askMarginal");
        assertEq(ar, r.askRatio, "askRatio");
        assertEq(af, r.askMarginalFill, "askMarginalFill");
    }

    /// forge-config: diff.fuzz.runs = 200
    function testFuzz_apportionMatchesEngine(uint256 seed) public {
        uint256 k = 1 + (seed % 12);
        uint256[] memory qs = new uint256[](k);
        uint256 classQ;
        for (uint256 i = 0; i < k; ++i) {
            qs[i] = uint256(keccak256(abi.encode(seed, i))) % 1e24;
            classQ += qs[i];
        }
        uint256 need = classQ == 0 ? 0 : (seed >> 8) % (classQ + 1);
        uint256[] memory ts = abi.decode(_ffi("apportion", abi.encode(need, qs)), (uint256[]));
        uint256 before;
        for (uint256 i = 0; i < k; ++i) {
            assertEq(ts[i], OrderMath.apportion(need, before, qs[i], classQ), "share");
            before += qs[i];
        }
    }

    struct Run {
        uint256[] ops;
        uint256 nOps;
        uint256[] returned;
    }

    function _push(Run memory run, uint256 kind, uint256 a, uint256 b) internal pure {
        run.ops[run.nOps++] = kind;
        run.ops[run.nOps++] = a;
        run.ops[run.nOps++] = b;
    }

    /// forge-config: diff.fuzz.runs = 200
    function testFuzz_bookMatchesEngine(uint256 seed, bool isBid) public {
        BookHarness h = new BookHarness(isBid ? 0 : 1);
        Run memory run;
        run.ops = new uint256[](3 * 48);
        run.returned = new uint256[](48);
        bool closedByIoc;
        for (uint256 i = 0; i < 48; ++i) {
            uint256 r = uint256(keccak256(abi.encode(seed, i)));
            uint256 op = r % 13;
            uint256 n = h.count();
            if (op < 3 || n == 0) {
                if (n >= 40) continue;
                uint256 q = 1 + ((r >> 8) % 50e18);
                h.add(T, q);
                _push(run, 0, q, 0);
                closedByIoc = false;
            } else if (op < 7) {
                uint256 rem = h.remaining(T);
                if (rem == 0) continue;
                uint256 f = (r >> 8) % 4 == 0 ? rem : 1 + ((r >> 16) % rem);
                uint256 p = 100e6 + ((r >> 128) % 200e6);
                h.fill(T, f, p);
                _push(run, 1, f, p);
            } else if (op < 9) {
                uint256 id = (r >> 8) % n;
                if (!h.isOpen(id)) continue;
                run.returned[id] += h.leave(id);
                _push(run, 2, id, 0);
            } else if (op < 11) {
                uint256 id = (r >> 8) % n;
                h.drawFor(id);
                _push(run, 3, id, 0);
            } else if (op < 12) {
                if (h.remaining(T) == 0) continue;
                h.forceClose(T);
                _push(run, 4, 0, 0);
                closedByIoc = true;
            } else if (closedByIoc && !isBid) {
                uint256 id = (r >> 8) % n;
                run.returned[id] += h.drawRet(id);
                _push(run, 5, id, 0);
            }
        }
        uint256[] memory ops = new uint256[](run.nOps);
        for (uint256 i = 0; i < run.nOps; ++i) ops[i] = run.ops[i];
        uint256[] memory out = abi.decode(_ffi("book", abi.encode(isBid, B, ops)), (uint256[]));

        uint256 n2 = h.count();
        assertEq(out.length, 5 * n2 + 7, "shape");
        for (uint256 id = 0; id < n2; ++id) {
            BookStore.Valuation memory v = h.value(id);
            assertEq(out[5 * id], v.remainder, "remainder");
            assertEq(out[5 * id + 1], v.quote, "quote");
            assertEq(out[5 * id + 2], v.closed ? 1 : 0, "closed");
            assertEq(out[5 * id + 3], h.credited(id), "credited");
            assertEq(out[5 * id + 4], run.returned[id], "returned");
        }
        BookStore.Level memory l = h.level(T);
        uint256 o = 5 * n2;
        assertEq(out[o], l.remaining, "level.remaining");
        assertEq(out[o + 1], l.epoch, "level.epoch");
        assertEq(out[o + 2], l.scale, "level.scale");
        assertEq(out[o + 3], l.closed ? 1 : 0, "level.closed");
        assertEq(out[o + 4], l.survival, "level.survival");
        assertEq(out[o + 5], l.pot, "level.pot");
        assertEq(out[o + 6], l.acc, "level.acc");
    }
}

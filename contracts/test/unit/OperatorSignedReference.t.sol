// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {UnisonExchange} from "../../src/core/UnisonExchange.sol";
import {OperatorSignedReference} from "../../src/pricing/OperatorSignedReference.sol";
import {IReferenceAdapter} from "../../src/interfaces/IReferenceAdapter.sol";
import {MockERC20} from "../mocks/MockERC20.sol";

contract OperatorSignedReferenceTest is Test {
    UnisonExchange internal ex;
    OperatorSignedReference internal osr;
    MockERC20 internal nvda;
    MockERC20 internal ausd;
    uint256 internal mkt;

    uint256 internal constant PK_ECDSA = 0xA11CE;
    uint256 internal constant PK_P256 = 0xB0B;
    uint256 internal constant P256_N = 0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551;
    uint256 internal idEcdsa;
    uint256 internal idP256;

    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    function setUp() public {
        vm.warp(1_760_000_000);
        nvda = new MockERC20("Anchored NVDA", "aNVDA", 18);
        ausd = new MockERC20("Agora USD", "AUSD", 6);
        UnisonExchange impl = new UnisonExchange();
        ex = UnisonExchange(
            address(new ERC1967Proxy(address(impl), abi.encodeCall(UnisonExchange.initialize, (address(this)))))
        );
        osr = new OperatorSignedReference(address(this), address(ex), IERC20(address(ausd)), 1, 10_000);
        idEcdsa = osr.addEcdsaSigner(vm.addr(PK_ECDSA));
        (uint256 qx, uint256 qy) = vm.publicKeyP256(PK_P256);
        idP256 = osr.addP256Signer(bytes32(qx), bytes32(qy));

        ex.listToken(address(nvda), false);
        ex.listToken(address(ausd), false);
        mkt = ex.createMarket(
            UnisonExchange.MarketParams({
                base: address(nvda),
                quote: address(ausd),
                refAdapter: address(osr),
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
        _fund(alice);
        _fund(bob);
    }

    function _fund(address a) internal {
        nvda.mint(a, 100e18);
        ausd.mint(a, 100_000e6);
        vm.startPrank(a);
        nvda.approve(address(ex), type(uint256).max);
        ausd.approve(address(ex), type(uint256).max);
        ex.deposit(address(nvda), 100e18);
        ex.deposit(address(ausd), 100_000e6);
        vm.stopPrank();
    }

    function _sig(uint256 id, bytes32 digest) internal view returns (OperatorSignedReference.Sig memory g) {
        g.signerId = uint8(id);
        if (id == idEcdsa) {
            (g.v, g.r, g.s) = vm.sign(PK_ECDSA, digest);
        } else {
            (bytes32 r, bytes32 s) = vm.signP256(PK_P256, digest);
            if (uint256(s) > P256_N / 2) s = bytes32(P256_N - uint256(s)); // low-s form
            g.r = r;
            g.s = s;
        }
    }

    function _payload(uint256 batch, uint256 price, uint64 ts, uint8 status, uint256[] memory ids)
        internal
        view
        returns (bytes memory)
    {
        bytes32 d = osr.digestOf(mkt, batch, price, ts, status);
        OperatorSignedReference.Sig[] memory sigs = new OperatorSignedReference.Sig[](ids.length);
        for (uint256 i = 0; i < ids.length; ++i) sigs[i] = _sig(ids[i], d);
        return abi.encode(OperatorSignedReference.Report(price, ts, status, sigs));
    }

    function _one(uint256 id) internal pure returns (uint256[] memory a) {
        a = new uint256[](1);
        a[0] = id;
    }

    function _crossAndNextBlock() internal {
        vm.prank(alice);
        ex.placeOrder(mkt, 0, 18_020, 2e18, 0);
        vm.prank(bob);
        ex.placeOrder(mkt, 1, 17_980, 2e18, 0);
        vm.roll(block.number + 1);
        vm.warp(block.timestamp + 1);
    }

    function _nowMs() internal view returns (uint64) {
        return uint64(block.timestamp * 1000);
    }

    function test_ecdsaSigned_clears() public {
        _crossAndNextBlock();
        bytes memory p = _payload(block.number - 1, 180e6, _nowMs(), 0, _one(idEcdsa));
        (uint256 tick, uint256 vol) = ex.clear(mkt, p);
        assertEq(vol, 2e18);
        assertEq(tick, 18_000);
        (uint256 px,, uint64 batch,) = osr.last(mkt);
        assertEq(px, 180e6);
        assertEq(batch, block.number - 1);
    }

    function test_p256Signed_clears() public {
        _crossAndNextBlock();
        (, uint256 vol) = ex.clear(mkt, _payload(block.number - 1, 180e6, _nowMs(), 0, _one(idP256)));
        assertEq(vol, 2e18);
    }

    function test_quorumTwo_mixedKeyTypes() public {
        osr.setConfig(2, 10_000);
        _crossAndNextBlock();
        uint256 b = block.number - 1;
        bytes memory single = _payload(b, 180e6, _nowMs(), 0, _one(idEcdsa));
        vm.expectRevert(OperatorSignedReference.QuorumNotMet.selector);
        ex.clear(mkt, single);
        uint256[] memory both = new uint256[](2);
        both[0] = idEcdsa;
        both[1] = idP256;
        (, uint256 vol) = ex.clear(mkt, _payload(b, 180e6, _nowMs(), 0, both));
        assertEq(vol, 2e18);
    }

    function test_batchBinding_keeperCannotReuseOrChoose() public {
        _crossAndNextBlock();
        // signed for an earlier batch → the digest the adapter checks differs
        bytes memory wrong = _payload(block.number - 2, 180e6, _nowMs(), 0, _one(idEcdsa));
        vm.expectRevert(OperatorSignedReference.BadSignature.selector);
        ex.clear(mkt, wrong);
    }

    function test_clearUpTo_signedBatchSurvivesLateInclusion() public {
        _crossAndNextBlock();
        uint256 b = block.number - 1; // the relay signs for batch b
        bytes memory p = _payload(b, 180e6, _nowMs(), 0, _one(idEcdsa));
        // a later order lands in batch b+1, and the keeper's tx is only mined two blocks later
        vm.prank(alice);
        ex.placeOrder(mkt, 0, 18_020, 1e18, 0);
        vm.roll(block.number + 2);
        vm.expectRevert(OperatorSignedReference.BadSignature.selector);
        ex.clear(mkt, p); // binds batch head-1 ≠ b
        (, uint256 vol) = ex.clearUpTo(mkt, b, p);
        assertEq(vol, 2e18);
        assertEq(ex.market(mkt).lastCleared, b, "batch b+1 stays pending for the next job");
        assertGt(ex.market(mkt).pendingTail, ex.market(mkt).pendingHead);
    }

    function test_rejects_stale_future_backwards_tampered() public {
        _crossAndNextBlock();
        uint256 b = block.number - 1;
        bytes memory stale = _payload(b, 180e6, _nowMs() - 20_000, 0, _one(idEcdsa));
        bytes memory future = _payload(b, 180e6, _nowMs() + 5_000, 0, _one(idEcdsa));
        vm.expectRevert(OperatorSignedReference.StaleReport.selector);
        ex.clear(mkt, stale);
        vm.expectRevert(OperatorSignedReference.FutureReport.selector);
        ex.clear(mkt, future);
        // tampered price with a valid signature for another price
        bytes32 d = osr.digestOf(mkt, b, 180e6, _nowMs(), 0);
        OperatorSignedReference.Sig[] memory sigs = new OperatorSignedReference.Sig[](1);
        sigs[0] = _sig(idEcdsa, d);
        bytes memory tampered = abi.encode(OperatorSignedReference.Report(190e6, _nowMs(), 0, sigs));
        vm.expectRevert(OperatorSignedReference.BadSignature.selector);
        ex.clear(mkt, tampered);

        ex.clear(mkt, _payload(b, 180e6, _nowMs(), 0, _one(idEcdsa)));
        // a later job cannot go back in time
        vm.roll(block.number + 1);
        vm.warp(block.timestamp + 1);
        bytes memory older = _payload(block.number - 1, 180e6, _nowMs() - 2_000, 0, _one(idEcdsa));
        vm.expectRevert(OperatorSignedReference.NonMonotonic.selector);
        ex.clear(mkt, older);
    }

    function test_onlyVenueMayConsume_andInactiveSigner() public {
        vm.expectRevert(OperatorSignedReference.NotVenue.selector);
        osr.read(mkt, 1, "");
        osr.setSignerActive(idEcdsa, false);
        _crossAndNextBlock();
        bytes memory p = _payload(block.number - 1, 180e6, _nowMs(), 0, _one(idEcdsa));
        vm.expectRevert(OperatorSignedReference.InactiveSigner.selector);
        ex.clear(mkt, p);
    }

    function test_bond_slash_unbond() public {
        address slasher = makeAddr("creAudit");
        address vault = makeAddr("vault");
        osr.grantRole(osr.SLASHER_ROLE(), slasher);
        ausd.mint(address(this), 10_000e6);
        ausd.approve(address(osr), type(uint256).max);
        osr.bond(idEcdsa, 10_000e6);

        osr.requestUnbond(idEcdsa, 10_000e6);
        vm.expectRevert(OperatorSignedReference.UnbondNotReady.selector);
        osr.unbond(idEcdsa, address(this));

        // the auditor slashes during the delay
        vm.prank(slasher);
        osr.slash(idEcdsa, 4_000e6, vault, "deviation");
        assertEq(ausd.balanceOf(vault), 4_000e6);

        vm.warp(block.timestamp + 7 days);
        osr.unbond(idEcdsa, address(this));
        assertEq(ausd.balanceOf(address(this)), 6_000e6, "only what survived the slash");
        assertEq(osr.signer(idEcdsa).bond, 0);
    }
}

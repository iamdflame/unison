// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {UnisonExchange} from "../../src/core/UnisonExchange.sol";
import {ExchangeBase} from "../../src/core/ExchangeBase.sol";
import {OperatorSignedReference} from "../../src/pricing/OperatorSignedReference.sol";
import {CREAuditReceiver, IUnisonOps, IOperatorReference} from "../../src/audit/CREAuditReceiver.sol";
import {MockERC20} from "../mocks/MockERC20.sol";

/// @notice CRE consensus reports driving Unison's controls through the KeystoneForwarder.
contract CREAuditReceiverTest is Test {
    UnisonExchange internal ex;
    OperatorSignedReference internal osr;
    CREAuditReceiver internal rx;
    MockERC20 internal nvda;
    MockERC20 internal ausd;
    uint256 internal mkt;
    address internal forwarder = makeAddr("keystoneForwarder");
    address internal workflowOwner = makeAddr("creWorkflowOwner");
    address internal insurance = makeAddr("insurance");
    uint256 internal constant RELAY_PK = 0xBEEF1;
    uint256 internal signerId;

    function setUp() public {
        vm.warp(1_760_000_000);
        nvda = new MockERC20("aNVDA", "aNVDA", 18);
        ausd = new MockERC20("AUSD", "AUSD", 6);
        UnisonExchange impl = new UnisonExchange();
        ex = UnisonExchange(
            address(new ERC1967Proxy(address(impl), abi.encodeCall(UnisonExchange.initialize, (address(this)))))
        );
        osr = new OperatorSignedReference(address(this), address(ex), IERC20(address(ausd)), 1, 30_000);
        signerId = osr.addEcdsaSigner(vm.addr(RELAY_PK));
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
        rx = new CREAuditReceiver(
            address(this),
            IUnisonOps(address(ex)),
            IOperatorReference(address(osr)),
            forwarder,
            workflowOwner,
            50, // 50 bp max deviation
            1_000e6,
            insurance
        );
        ex.grantRole(ex.HALT_ROLE(), address(rx));
        ex.grantRole(ex.CAP_ROLE(), address(rx));
        osr.grantRole(osr.SLASHER_ROLE(), address(rx));
        ausd.mint(address(this), 10_000e6);
        ausd.approve(address(osr), type(uint256).max);
        osr.bond(signerId, 10_000e6);
        _useReference(180e6);
    }

    /// The venue consumes an operator-signed reference (what the DON then audits).
    function _useReference(uint256 price) internal {
        vm.roll(block.number + 1);
        vm.warp(vm.getBlockTimestamp() + 1);
        uint64 ts = uint64(vm.getBlockTimestamp() * 1000);
        bytes32 d = osr.digestOf(mkt, block.number - 1, price, ts, 0);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(RELAY_PK, d);
        OperatorSignedReference.Sig[] memory sigs = new OperatorSignedReference.Sig[](1);
        sigs[0] = OperatorSignedReference.Sig(uint8(signerId), v, r, s);
        ex.clearUpTo(mkt, block.number - 1, abi.encode(OperatorSignedReference.Report(price, ts, 0, sigs)));
    }

    function _meta(address owner) internal pure returns (bytes memory) {
        return abi.encodePacked(bytes32(uint256(0xC0FFEE)), bytes10("unisonaudt"), owner);
    }

    function _audit(uint256 audited) internal view returns (bytes memory) {
        (, uint64 opMs,,) = osr.last(mkt);
        return abi.encode(rx.KIND_AUDIT(), abi.encode(mkt, audited, opMs, uint8(signerId)));
    }

    function test_onlyForwarder_andOnlyOurWorkflow() public {
        bytes memory rep = _audit(180e6);
        vm.expectRevert(CREAuditReceiver.NotForwarder.selector);
        rx.onReport(_meta(workflowOwner), rep);
        vm.prank(forwarder);
        vm.expectRevert(CREAuditReceiver.WrongWorkflow.selector);
        rx.onReport(_meta(makeAddr("someoneElse")), rep);
    }

    function test_audit_withinTolerance_noAction() public {
        bytes memory rep = _audit(180.5e6); // 27.7 bp
        vm.prank(forwarder);
        rx.onReport(_meta(workflowOwner), rep);
        assertFalse(ex.regimeOf(mkt).halted);
        assertEq(osr.signer(signerId).bond, 10_000e6);
    }

    function test_audit_deviation_haltsMarket_andSlashesSigner() public {
        bytes memory rep = _audit(176e6); // operator 180 vs consensus 176 = 227 bp
        vm.prank(forwarder);
        rx.onReport(_meta(workflowOwner), rep);
        assertTrue(ex.regimeOf(mkt).halted, "market halted");
        assertEq(osr.signer(signerId).bond, 9_000e6, "signer slashed");
        assertEq(ausd.balanceOf(insurance), 1_000e6);
    }

    function test_audit_ofAnOlderReference_isRejected() public {
        bytes memory old = _audit(176e6);
        _useReference(181e6); // the venue moved on
        vm.prank(forwarder);
        vm.expectRevert(CREAuditReceiver.StaleAudit.selector);
        rx.onReport(_meta(workflowOwner), old);
    }

    function test_dailyCaps_andHaltMirror() public {
        uint256[] memory ids = new uint256[](1);
        uint128[] memory caps = new uint128[](1);
        ids[0] = mkt;
        caps[0] = 1_234e18;
        bytes memory capsRep = abi.encode(rx.KIND_CAPS(), abi.encode(ids, caps));
        vm.prank(forwarder);
        rx.onReport(_meta(workflowOwner), capsRep);
        (ExchangeBase.Caps memory c,) = ex.capsOf(mkt);
        assertEq(c.dailyCap, 1_234e18);

        bytes memory haltOn = abi.encode(rx.KIND_HALT(), abi.encode(mkt, true, bytes32("LUDP")));
        bytes memory haltOff = abi.encode(rx.KIND_HALT(), abi.encode(mkt, false, bytes32("resumed")));
        vm.prank(forwarder);
        rx.onReport(_meta(workflowOwner), haltOn);
        assertTrue(ex.regimeOf(mkt).halted);
        vm.prank(forwarder);
        rx.onReport(_meta(workflowOwner), haltOff);
        assertFalse(ex.regimeOf(mkt).halted);
    }
}

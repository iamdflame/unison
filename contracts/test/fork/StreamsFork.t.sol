// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {StreamsCausalReference} from "../../src/pricing/StreamsCausalReference.sol";
import {IVerifierProxy} from "../../src/interfaces/external/IVerifierProxy.sol";
import {AggregatorV3Interface} from "../../src/interfaces/external/AggregatorV3Interface.sol";
import {IReferenceAdapter} from "../../src/interfaces/IReferenceAdapter.sol";

/// @notice The Data Streams adapter against Chainlink's real verifier on Monad mainnet (chain 143), with reports
///         Chainlink's DON signed and that were verified there before (test/fixtures/streams: an ETH/USD report from
///         tx 0xd104fa8c… on 2 Sep 2026, an RWA report from tx 0xa8756375… on 24 Jul 2026):
///           forge test --fork-url https://rpc.monad.xyz --match-contract StreamsForkTest -vv
///         If Chainlink retires that DON configuration, verification of these old reports starts to revert.
contract StreamsForkTest is Test {
    IVerifierProxy internal constant VERIFIER = IVerifierProxy(0xEd813D895457907399E41D36Ec0bE103E32148c8);
    bytes32 internal constant ETH_USD = 0x000362205e10b3a147d02792eccee483dca6c7b44ecce7012cb8c6e0b68b3ae9;
    bytes32 internal constant RWA_V8 = 0x0008af7f045a765dfdc071b9e7bf16246d22bb3f80966a8a350d560354a88532;
    uint32 internal constant ETH_AT = 1_788_360_082; // its observationsTimestamp, also its validFromTimestamp
    uint32 internal constant RWA_AT = 1_773_332_135;

    StreamsCausalReference internal sref;

    function setUp() public {
        if (block.chainid != 143) vm.skip(true);
        sref = new StreamsCausalReference(address(this), VERIFIER);
        sref.setStream(1, ETH_USD, AggregatorV3Interface(address(0)), 6, 0x04, 0, 0, 30, 0);
        sref.setStream(2, RWA_V8, AggregatorV3Interface(address(0)), 6, 0x04, 0, 0, 30, 0);
    }

    function _fixture(string memory name) internal view returns (bytes memory) {
        return vm.parseBytes(string.concat("0x", vm.readFile(string.concat("test/fixtures/streams/", name, ".hex"))));
    }

    function test_fork_verifierIsOpenAndFree() public view {
        assertEq(VERIFIER.s_feeManager(), address(0), "no fee manager: verifying costs only gas");
    }

    function test_fork_signedReport_verifiesStoresAndReads() public {
        uint256 gasBefore = gasleft();
        (bytes32 feed, uint32 at) = sref.submit(_fixture("eth-usd-v3"));
        emit log_named_uint("submit gas (verify + store)", gasBefore - gasleft());
        assertEq(feed, ETH_USD);
        assertEq(at, ETH_AT);
        (uint256 px, uint256 observedAt, IReferenceAdapter.Status st, uint80 round) =
            sref.readAfter(1, ETH_AT - 1, abi.encode(ETH_AT, uint80(0)));
        assertEq(px, 2_398_258_622, "ETH at $2,398.258622, in 6-decimal USD units");
        assertEq(observedAt, ETH_AT);
        assertEq(uint8(st), uint8(IReferenceAdapter.Status.OPEN));
        assertEq(round, ETH_AT);
        vm.expectRevert(StreamsCausalReference.NotAfterSeal.selector);
        sref.readAfter(1, ETH_AT, abi.encode(ETH_AT, uint80(0)));
    }

    function test_fork_signedRwaReport_readsItsMarketStatus() public {
        sref.submit(_fixture("rwa-v8"));
        (uint256 px,, IReferenceAdapter.Status st,) = sref.readAfter(2, RWA_AT - 1, abi.encode(RWA_AT, uint80(0)));
        assertEq(px, 100_005_000, "mid $100.005");
        assertEq(uint8(st), uint8(IReferenceAdapter.Status.OPEN), "marketStatus 2: open");
    }

    function test_fork_alteredReport_isRefused() public {
        (bytes32[3] memory ctx, bytes memory report, bytes32[] memory rs, bytes32[] memory ss, bytes32 vs) =
            abi.decode(_fixture("eth-usd-v3"), (bytes32[3], bytes, bytes32[], bytes32[], bytes32));
        report[6 * 32 + 31] = bytes1(uint8(report[6 * 32 + 31]) ^ 0x01); // one wei off the price
        vm.expectRevert();
        sref.submit(abi.encode(ctx, report, rs, ss, vs));
    }
}

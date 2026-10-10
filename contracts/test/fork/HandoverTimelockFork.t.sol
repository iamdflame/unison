// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {UnisonExchange} from "../../src/core/UnisonExchange.sol";
import {HandoverTimelock} from "../../script/HandoverTimelock.s.sol";

/// @dev Stands in for a Safe: the handover reads only its code, threshold and owners.
contract StandInSafe {
    address[] internal owners;
    uint256 internal threshold;

    constructor(address[] memory o, uint256 t) {
        owners = o;
        threshold = t;
    }

    function getOwners() external view returns (address[] memory) {
        return owners;
    }

    function getThreshold() external view returns (uint256) {
        return threshold;
    }
}

/// @notice The one-run handover rehearsed on Monad mainnet state (chain 143), after the v3 upgrade it requires (live
///         since 10 October 2026, block 112,255,125):
///           forge test --fork-url https://rpc.monad.xyz --match-contract HandoverTimelockForkTest -vv
contract HandoverTimelockForkTest is Test {
    address internal constant EXCHANGE = 0x1696170d40E703F1378989383c21Ec96ED1Adf75;
    address internal constant V2_IMPL = 0xBcE55ebB12E017a2A1a484375Fa006E32Fb656eF; // live 6 to 10 October 2026
    address internal constant DEPLOYER = 0x55DF8EA97d41b7F487c6Dcc077dFd0B487E3557D;
    address internal constant OLD_GUARDIAN = 0x0562b2b0914b3Bb082A623657729452fc9bf26E4;
    address internal constant CAUSAL_REF = 0xB161400dDfC592fD66b57dDaE46966ED74Ce891d;
    address internal constant VAULT_NVDA = 0x76d9FeAb2d1DD7e689eA253503b848633792f8Db;

    UnisonExchange internal ex = UnisonExchange(EXCHANGE);
    StandInSafe internal adminSafe;
    StandInSafe internal guardianSafe;

    function setUp() public {
        if (block.chainid != 143) vm.skip(true);
        address[] memory o = new address[](3);
        (o[0], o[1], o[2]) = (makeAddr("founder"), makeAddr("outside signer 1"), makeAddr("outside signer 2"));
        adminSafe = new StandInSafe(o, 2);
        guardianSafe = new StandInSafe(o, 1);
    }

    /// @dev v2 had no version().
    function _liveVersion() internal view returns (uint256) {
        try ex.version() returns (uint256 v) {
            return v;
        } catch {
            return 2;
        }
    }

    /// @dev On a fork from before 10 October, the upgrade the handover requires; after it, today's source over today's
    ///      state (initializeV3 runs once).
    function _upgradeV3() internal {
        UnisonExchange impl = new UnisonExchange();
        bytes memory init = _liveVersion() < 3 ? abi.encodeCall(UnisonExchange.initializeV3, ()) : bytes("");
        vm.prank(DEPLOYER);
        ex.upgradeToAndCall(address(impl), init);
    }

    function test_fork_refusesBeforeV3() public {
        if (_liveVersion() >= 3) {
            // mainnet is past v3: go back to the v2 code it replaced, to show the refusal on live state
            vm.prank(DEPLOYER);
            ex.upgradeToAndCall(V2_IMPL, "");
        }
        HandoverTimelock h = new HandoverTimelock();
        vm.expectRevert(bytes("upgrade the exchange to v3 first (script/UpgradePhaseA.s.sol)"));
        h.handover(DEPLOYER, address(adminSafe), address(guardianSafe));
    }

    function test_fork_oneRunHandover() public {
        _upgradeV3();
        TimelockController tl = new HandoverTimelock().handover(DEPLOYER, address(adminSafe), address(guardianSafe));

        // no window: the delay is a week from the first block, and every ownership has already moved
        assertEq(tl.getMinDelay(), 7 days);
        assertEq(Ownable2Step(CAUSAL_REF).owner(), address(tl));
        assertEq(Ownable2Step(CAUSAL_REF).pendingOwner(), address(0));

        // the deployer and the old guardian key can do nothing
        vm.prank(DEPLOYER);
        vm.expectRevert();
        ex.pause();
        vm.prank(DEPLOYER);
        vm.expectRevert();
        ex.upgradeToAndCall(address(new UnisonExchange()), "");
        vm.prank(OLD_GUARDIAN);
        vm.expectRevert();
        ex.setHalt(1, true);

        // the guardian Safe stops a market at once
        vm.prank(address(guardianSafe));
        ex.setHalt(1, true);
        assertTrue(ex.regimeOf(1).halted);

        // an upgrade waits a week in public, then anyone can execute it
        UnisonExchange next = new UnisonExchange();
        bytes memory call = abi.encodeCall(ex.upgradeToAndCall, (address(next), ""));
        bytes32 salt = keccak256("an upgrade");
        vm.prank(address(adminSafe));
        tl.schedule(EXCHANGE, 0, call, bytes32(0), salt, 7 days);
        vm.warp(block.timestamp + 7 days - 1);
        vm.expectRevert();
        tl.execute(EXCHANGE, 0, call, bytes32(0), salt);
        vm.warp(block.timestamp + 1);
        vm.prank(makeAddr("anyone"));
        tl.execute(EXCHANGE, 0, call, bytes32(0), salt);

        // and the guardian Safe can cancel a proposal before it is ready
        bytes32 salt2 = keccak256("a second upgrade");
        vm.prank(address(adminSafe));
        tl.schedule(EXCHANGE, 0, call, bytes32(0), salt2, 7 days);
        bytes32 id = tl.hashOperation(EXCHANGE, 0, call, bytes32(0), salt2);
        vm.prank(address(guardianSafe));
        tl.cancel(id);
        assertFalse(tl.isOperation(id));

        // nobody can shorten the week except through a week-long proposal
        vm.prank(address(adminSafe));
        vm.expectRevert();
        tl.updateDelay(0);
    }
}

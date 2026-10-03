// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {UnisonExchange} from "../../src/core/UnisonExchange.sol";
import {ExchangeBase} from "../../src/core/ExchangeBase.sol";
import {ManualReference} from "../../src/pricing/ManualReference.sol";
import {IReferenceAdapter} from "../../src/interfaces/IReferenceAdapter.sol";
import {IEligibility} from "../../src/interfaces/IEligibility.sol";
import {AttestationEligibility} from "../../src/compliance/AttestationEligibility.sol";
import {EligibilityRouter} from "../../src/compliance/EligibilityRouter.sol";
import {IssuerDenylistEligibility, IIssuerCompliance} from "../../src/compliance/IssuerDenylistEligibility.sol";
import {MockERC20} from "../mocks/MockERC20.sol";

contract MockIssuerCompliance is IIssuerCompliance {
    mapping(address => bool) public isDenylisted;

    function set(address a, bool d) external {
        isDenylisted[a] = d;
    }
}

/// @notice Tokenized-Securities-Venue conditions as code (SEC Release 34-106402; SPEC §8).
contract ComplianceTest is Test {
    UnisonExchange internal ex;
    ManualReference internal ref;
    MockERC20 internal nvda;
    MockERC20 internal ausd;
    uint256 internal mkt;
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal carol = makeAddr("carol");
    address internal dave = makeAddr("dave");

    function setUp() public {
        vm.warp(1_760_000_000);
        nvda = new MockERC20("aNVDA", "aNVDA", 18);
        ausd = new MockERC20("AUSD", "AUSD", 6);
        ref = new ManualReference(address(this));
        UnisonExchange impl = new UnisonExchange();
        ex = UnisonExchange(
            address(new ERC1967Proxy(address(impl), abi.encodeCall(UnisonExchange.initialize, (address(this)))))
        );
        ex.listToken(address(nvda), false);
        ex.listToken(address(ausd), false);
        mkt = ex.createMarket(_params(false));
        address[4] memory us = [alice, bob, carol, dave];
        for (uint256 i = 0; i < 4; ++i) {
            nvda.mint(us[i], 100e18);
            ausd.mint(us[i], 100_000e6);
            vm.startPrank(us[i]);
            nvda.approve(address(ex), type(uint256).max);
            ausd.approve(address(ex), type(uint256).max);
            ex.deposit(address(nvda), 100e18);
            ex.deposit(address(ausd), 100_000e6);
            vm.stopPrank();
        }
    }

    function _params(bool permissioned) internal view returns (UnisonExchange.MarketParams memory) {
        return UnisonExchange.MarketParams({
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
            permissioned: permissioned,
            strictAfterClose: false
        });
    }

    function _clear() internal returns (uint256 vol) {
        vm.roll(block.number + 1);
        vm.warp(vm.getBlockTimestamp() + 1);
        ref.post(mkt, 180e6, vm.getBlockTimestamp() * 1000, IReferenceAdapter.Status.OPEN);
        (, vol) = ex.clear(mkt, "");
    }

    function test_dailyVolumeCap_limitsAuction_thenResetsAtUtcMidnight() public {
        ex.setDailyCap(mkt, 3e18); // e.g. 0.25% of a 1,200-share ADV (tier 1)
        vm.prank(alice);
        ex.placeOrder(mkt, 0, 18_010, 5e18, 0);
        vm.prank(bob);
        ex.placeOrder(mkt, 1, 17_990, 5e18, 0);
        assertEq(_clear(), 3e18, "auction volume capped at the remaining daily cap");
        (, uint256 left) = ex.capsOf(mkt);
        assertEq(left, 0);
        assertEq(_clear(), 0, "cap exhausted: no auction for the rest of the UTC day");

        uint256 nextDay = (vm.getBlockTimestamp() / 1 days + 1) * 1 days + 10;
        vm.warp(nextDay - 1);
        assertEq(_clear(), 2e18, "new UTC day: the resting remainder trades");
        (ExchangeBase.Caps memory c,) = ex.capsOf(mkt);
        assertEq(c.traded, 2e18);
        assertEq(c.day, nextDay / 1 days);
    }

    function test_tierSymbolLimits() public {
        ex.setTier(mkt, 1);
        for (uint256 i = 1; i < 75; ++i) {
            ex.setTier(ex.createMarket(_params(false)), 1);
        }
        assertEq(ex.tierCount(1), 75);
        uint256 extra = ex.createMarket(_params(false));
        vm.expectRevert(ExchangeBase.TierFull.selector);
        ex.setTier(extra, 1);
        ex.setTier(extra, 2); // tier 2 still has room
        ex.setTier(mkt, 0); // delisting a tier-1 symbol frees a slot
        ex.setTier(extra, 1);
        assertEq(ex.tierCount(1), 75);
        assertEq(ex.tierCount(2), 0);
    }

    function test_eligibility_attestation_jurisdiction_class_issuerDenylist() public {
        AttestationEligibility kyc = new AttestationEligibility(address(this), 2); // professionals only
        kyc.setBlockedCountry("US", true);
        MockIssuerCompliance issuer = new MockIssuerCompliance();
        IssuerDenylistEligibility deny = new IssuerDenylistEligibility(address(this));
        deny.addSource(IIssuerCompliance(address(issuer)));
        EligibilityRouter router = new EligibilityRouter(address(this));
        router.addSource(IEligibility(address(kyc)));
        router.addSource(IEligibility(address(deny)));
        ex.setEligibility(address(router));
        uint256 pm = ex.createMarket(_params(true)); // permissioned market

        uint64 exp = uint64(vm.getBlockTimestamp() + 1 days);
        kyc.attest(alice, exp, "DE", 2, keccak256("apass:alice"));
        kyc.attest(bob, exp, "US", 2, keccak256("apass:bob"));
        kyc.attest(carol, exp, "SG", 3, keccak256("apass:carol"));
        kyc.attest(dave, exp, "FR", 1, keccak256("apass:dave")); // retail
        issuer.set(carol, true); // the issuer denylisted carol

        vm.prank(alice);
        ex.placeOrder(pm, 0, 18_000, 1e18, 0);
        address[3] memory rejected = [bob, carol, dave];
        for (uint256 i = 0; i < 3; ++i) {
            vm.prank(rejected[i]);
            vm.expectRevert(ExchangeBase.NotEligible.selector);
            ex.placeOrder(pm, 0, 18_000, 1e18, 0);
        }
        // attestations expire
        vm.warp(exp + 1);
        vm.prank(alice);
        vm.expectRevert(ExchangeBase.NotEligible.selector);
        ex.placeOrder(pm, 0, 18_000, 1e18, 0);
        // open markets stay open to everyone
        vm.prank(bob);
        ex.placeOrder(mkt, 0, 18_000, 1e18, 0);
    }

    function test_publicNotice() public {
        vm.expectEmit(true, true, false, true, address(ex));
        emit ExchangeBase.NoticePosted(mkt, keccak256("disclosure-v1.pdf"), "ipfs://bafy-disclosure");
        ex.postNotice(mkt, keccak256("disclosure-v1.pdf"), "ipfs://bafy-disclosure");
    }
}

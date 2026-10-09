// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test, console} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {UnisonExchange} from "../../src/core/UnisonExchange.sol";
import {ExchangeBase} from "../../src/core/ExchangeBase.sol";
import {ChainlinkCausalReference} from "../../src/pricing/ChainlinkCausalReference.sol";
import {IReferenceAdapter} from "../../src/interfaces/IReferenceAdapter.sol";
import {AggregatorV3Interface} from "../../src/interfaces/external/AggregatorV3Interface.sol";

interface IWMONc {
    function deposit() external payable;
}

interface IAStockc {
    function MINTER_ROLE() external view returns (bytes32);
    function getRoleMember(bytes32 role, uint256 index) external view returns (address);
    function mint(address to, uint256 amount) external;
}

/// @notice The causal upgrade rehearsed on Monad mainnet state (chain 143), against the LIVE exchange and the REAL
///         Chainlink feeds:
///           forge test --fork-url https://rpc.monad.xyz --match-contract CausalForkTest -vv
///         Pin --fork-block-number for a reproducible run (any block after the exchange's deployment).
contract CausalForkTest is Test {
    address internal constant EXCHANGE = 0x1696170d40E703F1378989383c21Ec96ED1Adf75;
    address internal constant ADMIN = 0x55DF8EA97d41b7F487c6Dcc077dFd0B487E3557D;
    address internal constant VAULT_NVDA = 0x76d9FeAb2d1DD7e689eA253503b848633792f8Db;
    address internal constant VAULT_WMON = 0x92f15839efcD72E6C9236ca63F1de4ee159CeeF3;
    address internal constant OWNER_PASSKEY = 0x13250C2DE5CE381432F4F1c77249af6789D62da7;

    address internal constant AUSD = 0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a;
    address internal constant ANVDA = 0x701193374879131f923532987c7Ef363a91a80eB;
    address internal constant WMON = 0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A;
    address internal constant CL_MON_USD = 0xBcD78f76005B7515837af6b50c7C52BCf73822fb;
    address internal constant CL_WNVDAX_USD = 0x03ffa4673c060339E6a8E5Ba1a12B3301c966bf0;
    address internal constant CL_AUSD_USD = 0xE20751C7B5867bCBef815ffc1b284c3f412a9e13;
    address internal constant CL_GBP_USD = 0x1ffC8B75a16FFfbd7879F042B580F7607Dcf5C30;
    address internal constant MENTO_AUSD_USDM_POOL = 0xb0a0264Ce6847F101b76ba36A4a3083ba489F501;
    uint8 internal constant SKEW = 2;

    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    function setUp() public {
        if (block.chainid != 143) vm.skip(true);
    }

    /// Every feed Unison uses carries the oracle's own observation time: strictly before the report landed, never
    /// out of order. (MON/USD, GBP/USD, AUSD/USD are OCR2 aggregators; wNVDAx-USD is a DualAggregator.)
    function test_fork_feedsCarrySignedObservationTimes() public view {
        address[4] memory feeds = [CL_MON_USD, CL_WNVDAX_USD, CL_AUSD_USD, CL_GBP_USD];
        for (uint256 f = 0; f < feeds.length; ++f) {
            AggregatorV3Interface a = AggregatorV3Interface(feeds[f]);
            (uint80 r,,,,) = a.latestRoundData();
            uint256 later = type(uint256).max;
            for (uint80 k = 0; k < 12; ++k) {
                (, int256 ans, uint256 observedAt, uint256 arrivedAt,) = a.getRoundData(r - k);
                assertGt(ans, 0, "answer");
                assertLt(observedAt, arrivedAt, "observed strictly before it landed on chain");
                assertLe(arrivedAt - observedAt, 600, "landed within minutes of the observation");
                assertLt(observedAt, later, "observation times only move forward");
                later = observedAt;
            }
        }
    }

    /// The live proxy upgrades in place with every market, balance and receipt intact; then both markets switch to
    /// the causal clock and clear at the first real Chainlink observation after their orders.
    function test_fork_upgradeLiveExchange_thenClearCausally() public {
        if (EXCHANGE.code.length == 0) vm.skip(true); // a fork from before the deployment
        UnisonExchange ex = UnisonExchange(EXCHANGE);
        // a fork from after the cutover (6 Oct 2026): what this rehearsed has run on mainnet, and
        // UpgradePhaseAForkTest rehearses the next upgrade
        try ex.causalOf(0) returns (ExchangeBase.Causal memory c) {
            if (c.on) vm.skip(true);
        } catch {}
        UnisonExchange.Market memory m0 = ex.market(0);
        UnisonExchange.Market memory m1 = ex.market(1);
        uint256 vq = ex.balanceOf(VAULT_NVDA, AUSD);
        uint256 vb = ex.balanceOf(VAULT_NVDA, ANVDA);
        uint256 pk = ex.balanceOf(OWNER_PASSKEY, AUSD);

        UnisonExchange impl = new UnisonExchange();
        vm.prank(ADMIN);
        ex.upgradeToAndCall(address(impl), "");

        assertEq(keccak256(abi.encode(ex.market(0))), keccak256(abi.encode(m0)), "market 0 unchanged");
        assertEq(keccak256(abi.encode(ex.market(1))), keccak256(abi.encode(m1)), "market 1 unchanged");
        assertEq(ex.balanceOf(VAULT_NVDA, AUSD), vq, "vault AUSD unchanged");
        assertEq(ex.balanceOf(VAULT_NVDA, ANVDA), vb, "vault aNVDA unchanged");
        assertEq(ex.balanceOf(OWNER_PASSKEY, AUSD), pk, "owner balance unchanged");
        assertFalse(ex.causalOf(0).on);
        assertFalse(ex.causalOf(1).on);

        ChainlinkCausalReference cref = new ChainlinkCausalReference(address(this));
        cref.setFeed(
            0, AggregatorV3Interface(CL_WNVDAX_USD), AggregatorV3Interface(CL_AUSD_USD), 6, 3900, 90_000, 0, 432_000, 50
        );
        cref.setFeed(
            1, AggregatorV3Interface(CL_MON_USD), AggregatorV3Interface(CL_AUSD_USD), 6, 3600, 90_000, 0, 0, 50
        );

        // market 0 holds the owner's resting bid: the switch waits until it is cancelled
        uint256 bm = ex.openOrderBitmap(OWNER_PASSKEY);
        if (ex.bookTotal(0, 0) != 0) {
            vm.prank(ADMIN);
            vm.expectRevert(ExchangeBase.ClearInProgress.selector);
            ex.setCausal(0, address(cref), true, SKEW);
            for (uint256 i = 0; i < 55; ++i) {
                if (bm & (1 << i) != 0) {
                    vm.prank(OWNER_PASSKEY);
                    ex.cancelOrder(i);
                }
            }
        }
        vm.startPrank(ADMIN);
        ex.setCausal(0, address(cref), true, SKEW);
        ex.setCausal(1, address(cref), true, SKEW);
        vm.stopPrank();

        _wmonCrossesAtTheNextObservation(ex);
        _aNvdaSellsIntoTheVaultAtTheNextObservation(ex);
    }

    // ------------------------------------------------------------------ helpers

    /// Two traders cross on WMON/AUSD. Their orders are placed just before a real MON/USD observation (the fork's
    /// clock is set back for them), so that observation is the first after the seal; the clear names it.
    function _wmonCrossesAtTheNextObservation(UnisonExchange ex) internal {
        (uint80 r, uint256 obs, uint256 prevObs, uint256 now_) = _lastTwo(CL_MON_USD);
        if (obs - prevObs < 2) return; // the two latest rounds too close to seal between them
        vm.deal(alice, 20_000 ether);
        vm.prank(alice);
        IWMONc(WMON).deposit{value: 20_000 ether}();
        _depositAll(ex, alice, WMON);
        _ausd(bob, 1000e6);
        _depositAll(ex, bob, AUSD);

        uint256 px = _monPrice(r);
        vm.warp(obs - SKEW - 1);
        vm.roll(vm.getBlockNumber() + 1);
        vm.prank(alice);
        ex.placeOrder(1, 1, px - px / 100, 10_000e18, 0); // sells at up to 1% under
        vm.prank(bob);
        ex.placeOrder(1, 0, px + px / 100, 10_000e18, 0); // buys at up to 1% over
        vm.warp(now_);
        vm.roll(vm.getBlockNumber() + 1);
        (, uint256 vol) = ex.clear(1, abi.encode(r, _quoteInForce(obs)));
        console.log("WMON causal print: volume", vol, "observed at", obs);
        assertEq(vol, 10_000e18);
        assertEq(ex.market(1).lastRefTimeMs, obs * 1000, "the receipt carries Chainlink's observation time");
        assertTrue(ex.market(1).lastRefTimeMs != vm.getBlockTimestamp() * 1000);
    }

    /// A seller of real aNVDA (minted by Anchored's minter) sells into the LIVE vault's bid at the first wNVDAx
    /// observation after the order.
    function _aNvdaSellsIntoTheVaultAtTheNextObservation(UnisonExchange ex) internal {
        (uint80 r, uint256 obs, uint256 prevObs, uint256 now_) = _lastTwo(CL_WNVDAX_USD);
        if (obs - prevObs < 2) return;
        address minter = IAStockc(ANVDA).getRoleMember(IAStockc(ANVDA).MINTER_ROLE(), 0);
        vm.prank(minter);
        IAStockc(ANVDA).mint(alice, 0.005e18);
        _depositAll(ex, alice, ANVDA);
        uint256 vaultBefore = ex.balanceOf(VAULT_NVDA, ANVDA);
        vm.warp(obs - SKEW - 1);
        vm.roll(vm.getBlockNumber() + 1);
        vm.prank(alice);
        ex.placeOrder(0, 1, 1, 0.005e18, 0); // sells at any price inside the band
        vm.warp(now_);
        vm.roll(vm.getBlockNumber() + 1);
        (uint256 tick, uint256 vol) = ex.clear(0, abi.encode(r, _quoteInForce(obs)));
        console.log("aNVDA causal print: tick", tick, "volume", vol);
        UnisonExchange.Market memory m = ex.market(0);
        assertEq(m.lastRefTimeMs, obs * 1000, "the receipt carries Chainlink's observation time");
        if (m.lastStatus == uint8(IReferenceAdapter.Status.OPEN)) {
            assertGt(vol, 0, "the live vault bought");
            assertEq(ex.balanceOf(VAULT_NVDA, ANVDA), vaultBefore + vol);
        }
    }

    function _lastTwo(address feed) internal view returns (uint80 r, uint256 obs, uint256 prevObs, uint256 now_) {
        AggregatorV3Interface a = AggregatorV3Interface(feed);
        (r,, obs,,) = a.latestRoundData();
        (,, prevObs,,) = a.getRoundData(r - 1);
        now_ = vm.getBlockTimestamp();
    }

    function _quoteInForce(uint256 obs) internal view returns (uint80 q) {
        AggregatorV3Interface a = AggregatorV3Interface(CL_AUSD_USD);
        (q,,,,) = a.latestRoundData();
        while (true) {
            (,, uint256 qObs,,) = a.getRoundData(q);
            if (qObs <= obs) return q;
            --q;
        }
    }

    function _monPrice(uint80 r) internal view returns (uint256) {
        (, int256 mon,,,) = AggregatorV3Interface(CL_MON_USD).getRoundData(r);
        (, int256 ausd,,,) = AggregatorV3Interface(CL_AUSD_USD).latestRoundData();
        return (uint256(mon) * 1e6) / uint256(ausd); // 6-dec AUSD per MON; tickSize 1
    }

    function _depositAll(UnisonExchange ex, address who, address token) internal {
        uint256 amt = IERC20(token).balanceOf(who);
        vm.startPrank(who);
        IERC20(token).approve(address(ex), amt);
        ex.deposit(token, amt);
        vm.stopPrank();
    }

    function _ausd(address who, uint256 amount) internal {
        vm.prank(MENTO_AUSD_USDM_POOL);
        IERC20(AUSD).transfer(who, amount);
    }
}

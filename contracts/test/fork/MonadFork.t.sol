// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test, console} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {UnisonExchange} from "../../src/core/UnisonExchange.sol";
import {ManualReference} from "../../src/pricing/ManualReference.sol";
import {ChainlinkReference} from "../../src/pricing/ChainlinkReference.sol";
import {Session} from "../../src/pricing/Session.sol";
import {IReferenceAdapter} from "../../src/interfaces/IReferenceAdapter.sol";
import {AggregatorV3Interface} from "../../src/interfaces/external/AggregatorV3Interface.sol";
import {ExchangeBase} from "../../src/core/ExchangeBase.sol";
import {IssuerDenylistEligibility, IIssuerCompliance} from "../../src/compliance/IssuerDenylistEligibility.sol";

interface IAStock {
    function COMPLIANCE() external view returns (address);
    function MINTER_ROLE() external view returns (bytes32);
    function getRoleMember(bytes32 role, uint256 index) external view returns (address);
    function mint(address to, uint256 amount) external;
}

interface IAnchoredCompliance {
    function isApproved(address account) external view returns (bool);
    function isDenylisted(address account) external view returns (bool);
    function addToDenylist(address[] calldata accounts) external;
}

interface IWMON {
    function deposit() external payable;
}

/// @notice Mainnet-fork rehearsal against REAL Monad assets and oracles (chain 143): Anchored aNVDA (an
///         issuer-denylisted security token), Agora AUSD, WMON, Mento GBPm, Chainlink GBP/USD, MON/USD, AUSD/USD.
///         Runs only on a Monad fork, on Foundry's Monad EVM:
///           anvil --fork-url https://rpc.monad.xyz --port 8546 --code-size-limit 131072
///           forge test --fork-url http://127.0.0.1:8546 --match-contract MonadForkTest -vv
contract MonadForkTest is Test {
    address internal constant AUSD = 0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a;
    address internal constant ANVDA = 0x701193374879131f923532987c7Ef363a91a80eB;
    address internal constant WMON = 0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A;
    address internal constant GBPM = 0x39bb4E0a204412bB98e821d25e7d955e69d40Fd1;
    address internal constant CL_GBP_USD = 0x1ffC8B75a16FFfbd7879F042B580F7607Dcf5C30;
    address internal constant CL_MON_USD = 0xBcD78f76005B7515837af6b50c7C52BCf73822fb;
    address internal constant CL_AUSD_USD = 0xE20751C7B5867bCBef815ffc1b284c3f412a9e13;
    /// Chainlink tokenized-equity feed (24/5): Backed xStocks' NVDA, "Calculated" with its share multiplier
    address internal constant CL_WNVDAX_USD = 0x03ffa4673c060339E6a8E5Ba1a12B3301c966bf0;
    address internal constant MENTO_AUSD_USDM_POOL = 0xb0a0264Ce6847F101b76ba36A4a3083ba489F501;
    /// holder of the role that may call addToDenylist on Anchored's compliance (discovered on-chain)
    address internal constant ANCHORED_DENYLIST_MANAGER = 0x8F563446550509C5BD3Fb0FC6752Be18Ddc2f6B7;

    UnisonExchange internal ex;
    ManualReference internal manual;
    ChainlinkReference internal cl;
    uint256 internal nvdaMkt;
    uint256 internal monMkt;
    uint256 internal gbpMkt;
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    function setUp() public {
        if (block.chainid != 143) {
            vm.skip(true);
            return;
        }
        UnisonExchange impl = new UnisonExchange();
        ex = UnisonExchange(
            address(new ERC1967Proxy(address(impl), abi.encodeCall(UnisonExchange.initialize, (address(this)))))
        );
        manual = new ManualReference(address(this));
        cl = new ChainlinkReference(address(this));
        ex.listToken(AUSD, false);
        ex.listToken(ANVDA, true);
        ex.listToken(WMON, false);
        ex.listToken(GBPM, false);
        nvdaMkt = ex.createMarket(_p(ANVDA, address(manual), 10_000, 100, 4001));
        monMkt = ex.createMarket(_p(WMON, address(cl), 1, 200, 12_001));
        gbpMkt = ex.createMarket(_p(GBPM, address(cl), 100, 50, 801));
        cl.setFeed(
            monMkt, AggregatorV3Interface(CL_MON_USD), AggregatorV3Interface(CL_AUSD_USD), 6, 3_600, 90_000, 0, 0
        );
        cl.setFeed(
            gbpMkt,
            AggregatorV3Interface(CL_GBP_USD),
            AggregatorV3Interface(CL_AUSD_USD),
            6,
            90_000,
            90_000,
            Session.FX_OPEN,
            Session.FX_CLOSE
        );
    }

    function _p(address base, address adapter, uint64 tickSize, uint16 bandBps, uint32 maxBandTicks)
        internal
        pure
        returns (UnisonExchange.MarketParams memory)
    {
        return UnisonExchange.MarketParams({
            base: base,
            quote: AUSD,
            refAdapter: adapter,
            tickSize: tickSize,
            minTick: 1,
            maxTick: uint32((1 << 21) - 1),
            maxBandTicks: maxBandTicks,
            bandBps: bandBps,
            feeBps: 3,
            maxFeeBps: 10,
            shards: 4,
            permissioned: false,
            strictAfterClose: false
        });
    }

    function _depositAll(address who, address token) internal {
        uint256 amt = IERC20(token).balanceOf(who);
        vm.startPrank(who);
        IERC20(token).approve(address(ex), amt);
        ex.deposit(token, amt);
        vm.stopPrank();
    }

    function _ausd(address who, uint256 amount) internal {
        uint256 pool = IERC20(AUSD).balanceOf(MENTO_AUSD_USDM_POOL);
        require(pool >= amount, "pool AUSD");
        vm.prank(MENTO_AUSD_USDM_POOL);
        IERC20(AUSD).transfer(who, amount);
    }

    /// Real aNVDA and real AUSD through a full venue cycle, and the venue mirrors the issuer's denylist.
    ///   Findings on mainnet state (2026-10-03): aStocks transfer freely between non-denylisted addresses
    ///   (no allowlist on transfer or mint); the issuer's COMPLIANCE() denylist is enforced inside the token.
    function test_fork_anchoredStock_fullCycle_issuerDenylistMirrored() public {
        address minter = IAStock(ANVDA).getRoleMember(IAStock(ANVDA).MINTER_ROLE(), 0);
        vm.prank(minter);
        IAStock(ANVDA).mint(alice, 5e18);
        _depositAll(alice, ANVDA);
        assertEq(IERC20(ANVDA).balanceOf(address(ex)), 5e18, "venue holds real aNVDA without allowlisting");
        _ausd(bob, 2_000e6);
        _depositAll(bob, AUSD);

        vm.prank(alice);
        uint256 s = ex.placeOrder(nvdaMkt, 1, 17_900, 5e18, 0);
        vm.prank(bob);
        uint256 b = ex.placeOrder(nvdaMkt, 0, 18_100, 5e18, 0);
        vm.roll(block.number + 1);
        vm.warp(block.timestamp + 1);
        manual.post(nvdaMkt, 180e6, block.timestamp * 1000, IReferenceAdapter.Status.OPEN);
        (uint256 tick, uint256 vol) = ex.clear(nvdaMkt, "");
        assertEq(vol, 5e18);
        assertEq(tick, 18_000, "uniform price at the reference");
        uint256[] memory sl = new uint256[](1);
        sl[0] = s;
        ex.claim(alice, sl);
        sl[0] = b;
        ex.claim(bob, sl);
        uint256 q = ex.balanceOf(alice, AUSD);
        vm.prank(alice);
        ex.withdraw(AUSD, q, alice);
        assertEq(IERC20(AUSD).balanceOf(alice), 900e6 - 270_000, "alice: $900 minus 3 bps");

        // The issuer denylists bob. Inside the venue the token cannot see him, so Unison mirrors the denylist.
        address compliance = IAStock(ANVDA).COMPLIANCE();
        IssuerDenylistEligibility elig = new IssuerDenylistEligibility(address(this));
        elig.addSource(IIssuerCompliance(compliance));
        ex.setEligibility(address(elig));
        address[] memory who = new address[](1);
        who[0] = bob;
        vm.prank(ANCHORED_DENYLIST_MANAGER);
        IAnchoredCompliance(compliance).addToDenylist(who);
        uint256 got = ex.balanceOf(bob, ANVDA);
        assertApproxEqAbs(got, 5e18, 1);
        vm.prank(bob);
        vm.expectRevert(ExchangeBase.NotEligible.selector);
        ex.withdraw(ANVDA, got, bob);
        assertTrue(elig.isEligible(alice), "alice is unaffected");
    }

    /// Live Chainlink feeds drive WMON (24/7) and GBPm (FX session) references.
    function test_fork_chainlinkReferences_live() public view {
        (uint256 monPx,, IReferenceAdapter.Status monSt) = cl.read(monMkt, 0, "");
        (uint256 gbpPx,, IReferenceAdapter.Status gbpSt) = cl.read(gbpMkt, 0, "");
        console.log("WMON/AUSD ref (6-dec)", monPx, "status", uint8(monSt));
        console.log("GBPm/AUSD ref (6-dec)", gbpPx, "status", uint8(gbpSt));
        assertGt(monPx, 1_000);
        assertLt(monPx, 10_000_000);
        assertGt(gbpPx, 1_000_000);
        assertLt(gbpPx, 2_000_000);
        if (!Session.isOpen(Session.FX_OPEN, Session.FX_CLOSE, block.timestamp)) {
            assertEq(uint8(gbpSt), uint8(IReferenceAdapter.Status.CLOSED), "FX weekend means DISCOVERY");
        }
    }

    /// The mainnet beta's aNVDA market: real aNVDA against real AUSD, priced by Chainlink's tokenized-equity feed
    /// (wNVDAx-USD, 24/5) over AUSD/USD, so no team key signs the reference. A 0.01-share trade clears at one
    /// price inside the band, and outside the 24/5 window (a Saturday) the reference reads CLOSED: DISCOVERY.
    function test_fork_aNVDA_onChainlinkEquityFeed_fractionalTrade() public {
        uint256 m = ex.createMarket(_p(ANVDA, address(cl), 10_000, 100, 4001));
        cl.setFeed(
            m, AggregatorV3Interface(CL_WNVDAX_USD), AggregatorV3Interface(CL_AUSD_USD), 6, 3_900, 90_000, 0, 432_000
        );
        (uint256 px,, IReferenceAdapter.Status st) = cl.read(m, 0, "");
        console.log("aNVDA/AUSD reference (6-dec)", px, "status", uint8(st));
        assertGt(px, 50e6, "NVDA above $50");
        assertLt(px, 1_000e6, "NVDA below $1,000");
        (,,, uint256 at,) = AggregatorV3Interface(CL_WNVDAX_USD).latestRoundData();
        bool fresh = block.timestamp - at <= 3_900;
        bool inWindow = Session.isOpen(0, 432_000, block.timestamp);
        assertEq(uint8(st), uint8(fresh && inWindow ? IReferenceAdapter.Status.OPEN : IReferenceAdapter.Status.CLOSED));

        address minter = IAStock(ANVDA).getRoleMember(IAStock(ANVDA).MINTER_ROLE(), 0);
        vm.prank(minter);
        IAStock(ANVDA).mint(alice, 0.05e18);
        _depositAll(alice, ANVDA);
        _ausd(bob, 50e6);
        _depositAll(bob, AUSD);
        uint256 tick = px / 10_000;
        vm.prank(alice);
        ex.placeOrder(m, 1, tick - tick / 200, 0.01e18, 0);
        vm.prank(bob);
        ex.placeOrder(m, 0, tick + tick / 200, 0.01e18, 0);
        vm.roll(block.number + 1);
        vm.warp(block.timestamp + 1);
        (uint256 printed, uint256 vol) = ex.clear(m, "");
        console.log("aNVDA print tick", printed, "volume", vol);
        if (st == IReferenceAdapter.Status.OPEN) {
            assertEq(vol, 0.01e18, "a hundredth of a share trades");
            assertApproxEqAbs(printed, tick, tick / 100, "at the reference, within the band");
        }

        // a Saturday: the feed's 24/5 window is shut, so the venue runs DISCOVERY around the last close
        uint256 sat = block.timestamp + ((5 days + 12 hours + 7 days - Session.weekSecond(block.timestamp)) % 7 days);
        vm.warp(sat);
        (,, IReferenceAdapter.Status weekend) = cl.read(m, 0, "");
        assertEq(uint8(weekend), uint8(IReferenceAdapter.Status.CLOSED), "weekend means DISCOVERY");
    }

    /// Real WMON trades against real AUSD on the live MON/USD reference.
    function test_fork_wmonMarket_tradesOnChainlinkReference() public {
        vm.deal(alice, 20_000 ether);
        vm.prank(alice);
        IWMON(WMON).deposit{value: 10_000 ether}();
        _depositAll(alice, WMON);
        _ausd(bob, 1_000e6);
        _depositAll(bob, AUSD);
        (uint256 px,, IReferenceAdapter.Status st) = cl.read(monMkt, 0, "");
        console.log("MON/AUSD reference", px, "status", uint8(st));
        uint256 refTick = px; // tickSize = 1 quote unit
        vm.prank(alice);
        ex.placeOrder(monMkt, 1, refTick - refTick / 100, 10_000e18, 0);
        vm.prank(bob);
        ex.placeOrder(monMkt, 0, refTick + refTick / 100, 10_000e18, 0);
        vm.roll(block.number + 1);
        vm.warp(block.timestamp + 1);
        (uint256 tick, uint256 vol) = ex.clear(monMkt, "");
        console.log("WMON print tick", tick, "volume", vol);
        assertEq(vol, 10_000e18);
    }
}

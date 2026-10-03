// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {IReferenceAdapter} from "../../src/interfaces/IReferenceAdapter.sol";
import {AggregatorV3Interface} from "../../src/interfaces/external/AggregatorV3Interface.sol";
import {IPyth} from "../../src/interfaces/external/IPyth.sol";
import {ChainlinkReference} from "../../src/pricing/ChainlinkReference.sol";
import {PythReference} from "../../src/pricing/PythReference.sol";
import {Session} from "../../src/pricing/Session.sol";

contract MockAggregator is AggregatorV3Interface {
    uint8 public decimals;
    int256 public answer;
    uint256 public updatedAt;

    constructor(uint8 d) {
        decimals = d;
    }

    function set(int256 a, uint256 t) external {
        answer = a;
        updatedAt = t;
    }

    function description() external pure returns (string memory) {
        return "mock";
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (1, answer, updatedAt, updatedAt, 1);
    }
}

contract MockPyth is IPyth {
    mapping(bytes32 => Price) internal prices;
    uint256 public updates;

    function getPriceUnsafe(bytes32 id) external view returns (Price memory) {
        return prices[id];
    }

    function getUpdateFee(bytes[] calldata updateData) external pure returns (uint256) {
        return updateData.length;
    }

    /// update = abi.encode(id, price, conf, expo, publishTime)
    function updatePriceFeeds(bytes[] calldata updateData) external payable {
        require(msg.value == updateData.length, "fee");
        for (uint256 i = 0; i < updateData.length; ++i) {
            (bytes32 id, int64 p, uint64 c, int32 e, uint256 t) =
                abi.decode(updateData[i], (bytes32, int64, uint64, int32, uint256));
            prices[id] = Price(p, c, e, t);
            ++updates;
        }
    }
}

contract PushReferencesTest is Test {
    // Wed 2025-10-08 12:00 UTC (1970-01-01 was a Thursday)
    uint256 internal constant WED_NOON = 1_759_924_800;

    function test_session_fxWindowWrapsTheWeek() public pure {
        uint32 o = Session.FX_OPEN;
        uint32 c = Session.FX_CLOSE;
        assertTrue(Session.isOpen(o, c, WED_NOON), "Wednesday");
        assertTrue(Session.isOpen(o, c, WED_NOON + 2 days + 9 hours), "Fri 21:00");
        assertFalse(Session.isOpen(o, c, WED_NOON + 2 days + 10 hours), "Fri 22:00 closes");
        assertFalse(Session.isOpen(o, c, WED_NOON + 3 days), "Saturday");
        assertFalse(Session.isOpen(o, c, WED_NOON + 4 days + 9 hours), "Sun 21:00");
        assertTrue(Session.isOpen(o, c, WED_NOON + 4 days + 10 hours), "Sun 22:00 opens");
        assertTrue(Session.isOpen(0, 0, WED_NOON + 3 days), "24/7");
    }

    function test_chainlink_priceWithQuoteFeed_andWeekendClosed() public {
        vm.warp(WED_NOON);
        MockAggregator gbp = new MockAggregator(8);
        MockAggregator ausd = new MockAggregator(8);
        gbp.set(1.3242e8, block.timestamp - 60);
        ausd.set(0.9998e8, block.timestamp - 60);
        ChainlinkReference cl = new ChainlinkReference(address(this));
        cl.setFeed(
            7,
            AggregatorV3Interface(address(gbp)),
            AggregatorV3Interface(address(ausd)),
            6,
            86_400,
            Session.FX_OPEN,
            Session.FX_CLOSE
        );
        (uint256 px, uint256 ts, IReferenceAdapter.Status st) = cl.read(7, 0, "");
        assertEq(px, 1_324_464); // 1.3242 / 0.9998 in 6-dec AUSD (floor)
        assertEq(ts, block.timestamp * 1000);
        assertEq(uint8(st), uint8(IReferenceAdapter.Status.OPEN));

        vm.warp(WED_NOON + 3 days); // Saturday: flickering weekend quotes must not be traded on
        gbp.set(1.3241e8, block.timestamp - 60);
        ausd.set(1e8, block.timestamp - 60);
        (,, st) = cl.read(7, 0, "");
        assertEq(uint8(st), uint8(IReferenceAdapter.Status.CLOSED));
    }

    function test_chainlink_staleFeedIsClosed() public {
        vm.warp(WED_NOON);
        MockAggregator mon = new MockAggregator(8);
        mon.set(0.032e8, block.timestamp - 2 hours);
        ChainlinkReference cl = new ChainlinkReference(address(this));
        cl.setFeed(1, AggregatorV3Interface(address(mon)), AggregatorV3Interface(address(0)), 6, 3_600, 0, 0);
        (uint256 px,, IReferenceAdapter.Status st) = cl.read(1, 0, "");
        assertEq(px, 32_000);
        assertEq(uint8(st), uint8(IReferenceAdapter.Status.CLOSED));
    }

    function test_pyth_pullUpdatePaysFee_andReturnsPublishTime() public {
        vm.warp(WED_NOON);
        MockPyth pyth = new MockPyth();
        address venue = makeAddr("venue");
        PythReference pr = new PythReference(address(this), IPyth(address(pyth)), venue);
        vm.deal(address(pr), 1 ether);
        bytes32 id = keccak256("XAU/USD");
        pr.setFeed(3, id, 6, 60, 50, 0, 0);

        bytes[] memory upd = new bytes[](1);
        upd[0] = abi.encode(id, int64(398_512_000_000), uint64(150_000_000), int32(-8), block.timestamp);
        vm.prank(venue);
        (uint256 px, uint256 ts, IReferenceAdapter.Status st) = pr.read(3, 0, abi.encode(upd));
        assertEq(px, 3_985_120_000); // $3,985.12 in 6-dec quote units
        assertEq(ts, block.timestamp * 1000);
        assertEq(uint8(st), uint8(IReferenceAdapter.Status.OPEN));
        assertEq(pyth.updates(), 1);

        // a wide confidence interval is not a tradable reference
        upd[0] = abi.encode(id, int64(398_512_000_000), uint64(30_000_000_000), int32(-8), block.timestamp);
        vm.prank(venue);
        (,, st) = pr.read(3, 0, abi.encode(upd));
        assertEq(uint8(st), uint8(IReferenceAdapter.Status.CLOSED));

        // only the venue can make the adapter pay update fees
        vm.expectRevert(PythReference.NotVenue.selector);
        pr.read(3, 0, abi.encode(upd));
    }
}

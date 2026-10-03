// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IReferenceAdapter} from "../interfaces/IReferenceAdapter.sol";
import {IPyth} from "../interfaces/external/IPyth.sol";
import {Session} from "./Session.sol";

/// @title PythReference — pull-oracle references with a true "published after the batch closed" guarantee
/// @notice The keeper passes a Hermes update (`abi.encode(bytes[])`) fetched after the batch closed; the
///         adapter pays the update fee from its own balance and returns Pyth's publish time, so the exchange
///         rejects any price that was already known while the batch's orders were being placed.
///         Status is OPEN inside the weekly session while the price is fresh and its confidence interval is
///         tight; CLOSED otherwise.
contract PythReference is IReferenceAdapter, Ownable2Step {
    struct Feed {
        bytes32 id;
        uint32 maxAgeSec;
        uint16 maxConfBps;
        uint8 quoteTokenDecimals;
        uint32 openSec;
        uint32 closeSec;
        bool set;
    }

    IPyth public immutable pyth;
    address public immutable venue;
    mapping(uint256 => Feed) public feeds;

    event FeedSet(uint256 indexed marketId, bytes32 id, uint32 maxAgeSec, uint16 maxConfBps, uint32 openSec, uint32 closeSec);
    event Withdrawn(address to, uint256 amount);

    error UnknownFeed();
    error BadAnswer();
    error NotVenue();

    constructor(address owner_, IPyth pyth_, address venue_) Ownable(owner_) {
        pyth = pyth_;
        venue = venue_;
    }

    /// @notice Funds Pyth update fees.
    receive() external payable {}

    function withdraw(address payable to, uint256 amount) external onlyOwner {
        (bool ok,) = to.call{value: amount}("");
        require(ok);
        emit Withdrawn(to, amount);
    }

    function setFeed(
        uint256 marketId,
        bytes32 id,
        uint8 quoteTokenDecimals,
        uint32 maxAgeSec,
        uint16 maxConfBps,
        uint32 openSec,
        uint32 closeSec
    ) external onlyOwner {
        feeds[marketId] = Feed(id, maxAgeSec, maxConfBps, quoteTokenDecimals, openSec, closeSec, true);
        emit FeedSet(marketId, id, maxAgeSec, maxConfBps, openSec, closeSec);
    }

    function read(uint256 marketId, uint256, bytes calldata payload)
        external
        returns (uint256 price, uint256 publishTimeMs, Status status)
    {
        Feed memory f = feeds[marketId];
        if (!f.set) revert UnknownFeed();
        if (payload.length != 0) {
            if (msg.sender != venue) revert NotVenue(); // only the venue spends the fee balance
            bytes[] memory upd = abi.decode(payload, (bytes[]));
            pyth.updatePriceFeeds{value: pyth.getUpdateFee(upd)}(upd);
        }
        IPyth.Price memory p = pyth.getPriceUnsafe(f.id);
        if (p.price <= 0 || p.publishTime == 0 || p.publishTime > block.timestamp) revert BadAnswer();
        uint256 v = uint256(uint64(p.price));
        int256 e = int256(uint256(f.quoteTokenDecimals)) + p.expo;
        price = e >= 0 ? v * 10 ** uint256(e) : v / 10 ** uint256(-e);
        if (price == 0) revert BadAnswer();
        bool fresh = block.timestamp - p.publishTime <= f.maxAgeSec;
        bool tight = uint256(p.conf) * 10_000 <= v * f.maxConfBps;
        status = fresh && tight && Session.isOpen(f.openSec, f.closeSec, block.timestamp) ? Status.OPEN : Status.CLOSED;
        publishTimeMs = p.publishTime * 1000;
    }
}

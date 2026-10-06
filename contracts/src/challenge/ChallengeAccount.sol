// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @notice The slice of the exchange a challenge account uses.
interface IChallengeVenue {
    function deposit(address token, uint256 amount) external;
    function withdraw(address token, uint256 amount, address to) external;
    function placeOrder(uint256 marketId, uint256 side, uint256 tick, uint256 qty, uint256 flags)
        external
        returns (uint256 slotIdx);
    function claim(address account, uint256[] calldata slots) external;
    function balanceOf(address account, address token) external view returns (uint256);
    function openOrderBitmap(address account) external view returns (uint256);
}

/// @title ChallengeAccount — a trading account whose every fill is on the record (the standing challenge)
/// @notice Opened through a LatencyChallenge for one owner and one market. It trades auction orders (one auction, the
///         remainder returned), one at a time, and records each fill exactly: the order's registration time, its side,
///         the base it bought or sold, and the quote it paid or received including fees. Nothing is chosen after the
///         fact: every fill is recorded, so a claim can't leave the losing ones out. Funds move only between the owner
///         and the venue, and only while no order is open, so each fill is exactly the change it made to the ledger.
contract ChallengeAccount {
    using SafeERC20 for IERC20;

    struct Fill {
        uint64 placedAt; // the order's registration time (unix seconds)
        uint8 side; // 0 bought base, 1 sold base
        uint128 base; // base units bought or sold
        uint128 quote; // quote units paid (buy, fee included) or received (sell, fee deducted)
    }

    IChallengeVenue public immutable venue;
    address public immutable challenge;
    address public immutable owner;
    uint256 public immutable marketId;
    address public immutable base;
    address public immutable quote;

    Fill[] internal _fills;
    bool public orderOpen;
    uint256 internal _slot;
    uint8 internal _side;
    uint64 internal _placedAt;
    uint256 internal _baseBefore;
    uint256 internal _quoteBefore;

    event OrderSent(uint256 slot, uint8 side, uint256 tick, uint256 qty, uint64 placedAt);
    event FillRecorded(uint256 indexed index, uint64 placedAt, uint8 side, uint128 base, uint128 quote);

    error NotOwner();
    error OrderOpen();
    error NoOrder();
    error AuctionNotRun();

    constructor(address owner_, IChallengeVenue venue_, uint256 marketId_, address base_, address quote_) {
        challenge = msg.sender;
        owner = owner_;
        venue = venue_;
        marketId = marketId_;
        base = base_;
        quote = quote_;
        IERC20(base_).forceApprove(address(venue_), type(uint256).max);
        IERC20(quote_).forceApprove(address(venue_), type(uint256).max);
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier idle() {
        if (orderOpen) revert OrderOpen();
        _;
    }

    /// @notice Moves the owner's tokens onto the venue ledger, for this account.
    function deposit(address token, uint256 amount) external onlyOwner idle {
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        venue.deposit(token, amount);
    }

    /// @notice Sends ledger funds back to the owner. Only the owner, and only between orders.
    function withdraw(address token, uint256 amount) external onlyOwner idle {
        venue.withdraw(token, amount, owner);
    }

    /// @notice Sends one auction order (IOC): it trades in one auction, and what doesn't fill comes back.
    /// @param side 0 buys base, 1 sells base
    function order(uint8 side, uint256 tick, uint256 qty) external onlyOwner idle returns (uint256 slot) {
        _baseBefore = venue.balanceOf(address(this), base);
        _quoteBefore = venue.balanceOf(address(this), quote);
        slot = venue.placeOrder(marketId, side, tick, qty, 1);
        _slot = slot;
        _side = side;
        _placedAt = uint64(block.timestamp);
        orderOpen = true;
        emit OrderSent(slot, side, tick, qty, uint64(block.timestamp));
    }

    /// @notice Records the open order's fill once its auction has run. Anyone may call it; the keeper's auto-claim may
    ///         already have settled the order, which changes nothing here.
    function settle() external {
        if (!orderOpen) revert NoOrder();
        uint256[] memory slots = new uint256[](1);
        slots[0] = _slot;
        venue.claim(address(this), slots);
        if (venue.openOrderBitmap(address(this)) & (uint256(1) << _slot) != 0) revert AuctionNotRun();
        uint256 b = venue.balanceOf(address(this), base);
        uint256 q = venue.balanceOf(address(this), quote);
        orderOpen = false;
        (uint256 traded, uint256 money) =
            _side == 0 ? (b - _baseBefore, _quoteBefore - q) : (_baseBefore - b, q - _quoteBefore);
        if (traded == 0) return; // nothing filled: the order's funds came back whole
        _fills.push(Fill(_placedAt, _side, uint128(traded), uint128(money)));
        emit FillRecorded(_fills.length - 1, _placedAt, _side, uint128(traded), uint128(money));
    }

    function fillCount() external view returns (uint256) {
        return _fills.length;
    }

    function fillAt(uint256 i) external view returns (Fill memory) {
        return _fills[i];
    }
}

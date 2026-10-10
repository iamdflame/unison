// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ICurveSource} from "../interfaces/ICurveSource.sol";
import {IReferenceAdapter} from "../interfaces/IReferenceAdapter.sol";
import {IUnisonVenue} from "./LiquidityVault.sol";

/// @title PegPool — a pegged order anyone can join: one price level at a fixed offset from each auction's reference
/// @notice A bid pool holds the quote token and bids for base `offsetBps` below each auction's reference; an ask pool
///         holds base and offers it `offsetBps` above. The level moves with every reference, so a pegged order is never
///         left behind by the price. On a causal market it can't be picked off on what a trader already knows either:
///         the auction prices at an oracle observation made after every order in it was sealed (SPEC §7.4).
///
///         The pool is a curve source: the exchange asks for its curve at every auction and settles its fills at the
///         auction's uniform price (at or better than the peg), from the pool's own ledger balance, with no fee.
///         Shares are pro-rata claims on that balance (quote not yet spent and base bought, for a bid pool), so a fill
///         changes what every share holds in the same proportion, and nothing depends on the exchange's accounting
///         callback, which may be skipped. Quotes only while the reference market trades (OPEN or EXTENDED).
///
///         Entry and exit are asynchronous, as in LiquidityVault:
///           * a deposit executes at the first reference published after it was requested, and only while the
///             reference market trades, valued at that reference: nobody joins the pool knowing the next price, and
///             nobody joins at a weekend's stale one;
///           * a redemption pays the pool's balances out pro rata, in kind, at the first reference after it was
///             requested: nobody leaves ahead of an auction they can already see. A redemption the token or the
///             exchange refuses is held for its owner (`claim`), and the queue moves on.
///         It has no owner and no parameters to change: side, offset and market are fixed at deployment.
contract PegPool is ERC20, ICurveSource, ReentrancyGuardTransient {
    using SafeERC20 for IERC20;

    uint256 internal constant VIRTUAL_SHARES = 1e6; // inflation-attack offset
    uint256 public constant MAX_PROCESS = 64;
    uint16 public constant MAX_OFFSET_BPS = 1_000;

    struct Request {
        address owner;
        uint64 time;
        uint128 amount; // deposit: the pool's asset; redemption: shares
    }

    IUnisonVenue public immutable venue;
    uint256 public immutable marketId;
    IERC20 public immutable base;
    IERC20 public immutable quote;
    uint256 public immutable baseUnit;
    uint256 public immutable tickSize;
    /// @notice true: holds quote and bids below the reference; false: holds base and offers it above
    bool public immutable isBid;
    uint16 public immutable offsetBps;

    Request[] internal _deposits;
    Request[] internal _redeems;
    uint256 public depositHead;
    uint256 public redeemHead;

    /// @notice Redemptions held because the token or the exchange refused to deliver them (owner => token => amount),
    ///         outside the pool's ledger balance: neither quoted nor counted.
    mapping(address => mapping(address => uint256)) public held;

    event DepositRequested(uint256 indexed id, address indexed owner, uint256 assets);
    event RedeemRequested(uint256 indexed id, address indexed owner, uint256 shares);
    event Deposited(uint256 indexed id, address indexed owner, uint256 assets, uint256 shares, uint256 nav);
    event Redeemed(uint256 indexed id, address indexed owner, uint256 shares, uint256 baseOut, uint256 quoteOut);
    event RedemptionHeld(uint256 indexed id, address indexed owner, address indexed token, uint256 amount);
    event HeldClaimed(address indexed owner, address indexed token, uint256 amount);
    event Filled(uint256 indexed batch, uint256 price, uint256 refPrice, uint256 bought, uint256 sold);

    error NotVenue();
    error BadParams();
    error ZeroAmount();
    error ClearRunning();

    constructor(
        IUnisonVenue venue_,
        uint256 marketId_,
        bool isBid_,
        uint16 offsetBps_,
        string memory name_,
        string memory symbol_
    ) ERC20(name_, symbol_) {
        if (offsetBps_ == 0 || offsetBps_ > MAX_OFFSET_BPS) revert BadParams();
        venue = venue_;
        marketId = marketId_;
        isBid = isBid_;
        offsetBps = offsetBps_;
        IUnisonVenue.MarketView memory m = venue_.market(marketId_);
        if (m.tickSize == 0 || m.baseUnit == 0) revert BadParams();
        base = IERC20(m.base);
        quote = IERC20(m.quote);
        baseUnit = m.baseUnit;
        tickSize = m.tickSize;
        IERC20(m.quote).forceApprove(address(venue_), type(uint256).max);
        IERC20(m.base).forceApprove(address(venue_), type(uint256).max);
    }

    /// @notice The token a deposit brings: quote for a bid pool, base for an ask pool.
    function asset() public view returns (IERC20) {
        return isBid ? quote : base;
    }

    // ------------------------------------------------------------------ balances

    function balances() public view returns (uint256 baseBal, uint256 quoteBal) {
        baseBal = venue.balanceOf(address(this), address(base));
        quoteBal = venue.balanceOf(address(this), address(quote));
    }

    /// @notice The pool's value in quote units at `price` (quote units per whole base token).
    function navAt(uint256 price) public view returns (uint256) {
        (uint256 b, uint256 q) = balances();
        return q + Math.mulDiv(b, price, baseUnit);
    }

    // ------------------------------------------------------------------ curve (ICurveSource)

    /// @notice One level, `offsetBps` from the reference tick (at least one tick away): every unit of quote a bid pool
    ///         holds, as base at that level's price, or every unit of base an ask pool holds.
    function curve(uint256 mId, uint256 refPrice, uint8 status, uint256 refTick, uint256, uint256)
        external
        view
        returns (Curve memory c)
    {
        if (mId != marketId || refPrice == 0) return c;
        if (status != uint8(IReferenceAdapter.Status.OPEN) && status != uint8(IReferenceAdapter.Status.EXTENDED)) {
            return c;
        }
        uint256 off = Math.mulDiv(refTick, offsetBps, 10_000, Math.Rounding.Ceil);
        if (off == 0) off = 1;
        (uint256 b, uint256 q) = balances();
        if (isBid) {
            if (refTick <= off) return c;
            uint256 tick = refTick - off;
            uint256 qty = Math.mulDiv(q, baseUnit, tick * tickSize); // the base its quote buys at that price
            if (qty == 0 || qty > type(uint128).max || tick > type(uint32).max) return c;
            c.bidTop = uint32(tick);
            c.bidTicks = 1;
            c.bidPerTick = uint128(qty);
        } else {
            uint256 tick = refTick + off;
            if (b == 0 || b > type(uint128).max || tick > type(uint32).max) return c;
            c.askBottom = uint32(tick);
            c.askTicks = 1;
            c.askPerTick = uint128(b);
        }
    }

    /// @notice Attribution only (the venue calls it after settling the pool's fills; it may be skipped).
    function onAuction(uint256 mId, uint256 batch, uint256 price, uint256 refPrice, uint256 boughtBase, uint256, uint256 soldBase, uint256)
        external
    {
        if (msg.sender != address(venue) || mId != marketId) revert NotVenue();
        emit Filled(batch, price, refPrice, boughtBase, soldBase);
    }

    // ------------------------------------------------------------------ async flows

    function requestDeposit(uint256 assets) external nonReentrant returns (uint256 id) {
        if (assets == 0 || assets > type(uint128).max) revert ZeroAmount();
        asset().safeTransferFrom(msg.sender, address(this), assets);
        id = _deposits.length;
        _deposits.push(Request(msg.sender, uint64(block.timestamp), uint128(assets)));
        emit DepositRequested(id, msg.sender, assets);
    }

    function requestRedeem(uint256 shares) external nonReentrant returns (uint256 id) {
        if (shares == 0 || shares > type(uint128).max) revert ZeroAmount();
        _transfer(msg.sender, address(this), shares); // escrowed until execution
        id = _redeems.length;
        _redeems.push(Request(msg.sender, uint64(block.timestamp), uint128(shares)));
        emit RedeemRequested(id, msg.sender, shares);
    }

    /// @notice Executes requests made before the venue's latest reference was published, at that reference.
    ///         Redemptions first, deposits only while the reference market trades. Permissionless.
    function process() external nonReentrant returns (uint256 done) {
        if (venue.jobPhase(marketId) != 0) revert ClearRunning(); // balances only at a completed auction
        IUnisonVenue.MarketView memory m = venue.market(marketId);
        if (m.lastRefPrice == 0) return 0;
        uint256 h = redeemHead;
        uint256 end = _redeems.length;
        while (h < end && done < MAX_PROCESS) {
            Request memory r = _redeems[h];
            if (uint256(r.time) * 1000 >= m.lastRefTimeMs) break; // no reference published after the request yet
            _executeRedeem(h, r);
            delete _redeems[h];
            ++h;
            ++done;
        }
        redeemHead = h;
        bool live = m.lastStatus == uint8(IReferenceAdapter.Status.OPEN)
            || m.lastStatus == uint8(IReferenceAdapter.Status.EXTENDED);
        if (!live) return done; // a closed or halted market's reference is not a price to join at
        h = depositHead;
        end = _deposits.length;
        while (h < end && done < MAX_PROCESS) {
            Request memory r = _deposits[h];
            if (uint256(r.time) * 1000 >= m.lastRefTimeMs) break;
            _executeDeposit(h, r, m.lastRefPrice);
            delete _deposits[h];
            ++h;
            ++done;
        }
        depositHead = h;
    }

    function _executeDeposit(uint256 id, Request memory r, uint256 ref) private {
        uint256 assets = r.amount;
        uint256 nav = navAt(ref);
        uint256 value = isBid ? assets : Math.mulDiv(assets, ref, baseUnit);
        uint256 shares = Math.mulDiv(value, totalSupply() + VIRTUAL_SHARES, nav + 1);
        venue.deposit(address(asset()), assets);
        _mint(r.owner, shares);
        emit Deposited(id, r.owner, assets, shares, nav);
    }

    function _executeRedeem(uint256 id, Request memory r) private {
        uint256 shares = r.amount;
        uint256 supply = totalSupply(); // includes the escrowed shares
        (uint256 b, uint256 q) = balances();
        uint256 outB = Math.mulDiv(b, shares, supply);
        uint256 outQ = Math.mulDiv(q, shares, supply);
        _burn(address(this), shares);
        _deliver(id, r.owner, address(base), outB);
        _deliver(id, r.owner, address(quote), outQ);
        emit Redeemed(id, r.owner, shares, outB, outQ);
    }

    /// @dev As in LiquidityVault v2: a refused delivery is held for its owner outside the ledger balance.
    function _deliver(uint256 id, address owner, address token, uint256 amount) private {
        if (amount == 0) return;
        try venue.withdraw(token, amount, owner) {}
        catch {
            venue.withdraw(token, amount, address(this));
            held[owner][token] += amount;
            emit RedemptionHeld(id, owner, token, amount);
        }
    }

    /// @notice Retries a held redemption through the exchange, under the same checks as any withdrawal. Only to the owner.
    function claim(address token) external nonReentrant {
        uint256 amount = held[msg.sender][token];
        if (amount == 0) revert ZeroAmount();
        held[msg.sender][token] = 0;
        venue.deposit(token, amount);
        venue.withdraw(token, amount, msg.sender);
        emit HeldClaimed(msg.sender, token, amount);
    }

    function pending() external view returns (uint256 deposits, uint256 redemptions) {
        return (_deposits.length - depositHead, _redeems.length - redeemHead);
    }

    function depositRequest(uint256 id) external view returns (Request memory) {
        return _deposits[id];
    }

    function redeemRequest(uint256 id) external view returns (Request memory) {
        return _redeems[id];
    }
}

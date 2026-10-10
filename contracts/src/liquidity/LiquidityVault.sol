// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ICurveSource} from "../interfaces/ICurveSource.sol";
import {IReferenceAdapter} from "../interfaces/IReferenceAdapter.sol";

interface IUnisonVenue {
    struct MarketView {
        address base;
        address quote;
        address refAdapter;
        uint8 baseIdx;
        uint8 quoteIdx;
        uint8 shards;
        bool active;
        bool permissioned;
        bool strictAfterClose;
        uint16 bandBps;
        uint16 feeBps;
        uint16 maxFeeBps;
        uint32 minTick;
        uint32 maxTick;
        uint32 maxBandTicks;
        uint64 baseUnit;
        uint64 tickSize;
        uint64 lastCleared;
        uint64 pendingHead;
        uint64 pendingTail;
        uint64 auctions;
        uint64 lastPrintTick;
        uint64 lastRefTimeMs;
        uint8 lastStatus;
        uint256 lastRefPrice;
        bytes32 receiptHash;
    }

    function market(uint256 marketId) external view returns (MarketView memory);
    function jobPhase(uint256 marketId) external view returns (uint8);
    function balanceOf(address account, address token) external view returns (uint256);
    function deposit(address token, uint256 amount) external;
    function withdraw(address token, uint256 amount, address to) external;
}

/// @title LiquidityVault — the market's always-on liquidity, priced against the reference (SPEC §4.3)
/// @notice LPs deposit quote (AUSD) and own a share of the vault's inventory, which sits in the venue ledger
///         and is quoted every auction as a curve around the reference:
///           * half-spread = spreadBps × regime multiplier (EXTENDED / CLOSED quote wider, HALTED never trades)
///           * inventory skew shifts both sides toward rebalancing to 50/50
///           * depth per tick is a fraction of NAV, capped per auction (bounded loss per batch)
///         Deposits and redemptions are ASYNC (ERC-7540 style): a request executes only at a reference published
///         after it was made, so no LP can trade the vault against a price it already knows (e.g. a Monday gap).
///         While the reference market is closed a swing fee applies, paid to the LPs who stay.
///         Every fill is attributed on-chain: spread captured vs. inventory marked to the reference.
///         v2: a redemption the token or the exchange refuses to deliver (an LP the issuer froze after asking) is held
///         for that LP, outside the vault's ledger balance, and the queue moves on; `claim` retries it through the
///         exchange under the same checks as any withdrawal. In v1 one refused transfer stopped every request behind it.
contract LiquidityVault is ERC20, ICurveSource, AccessControl, ReentrancyGuardTransient {
    using SafeERC20 for IERC20;

    bytes32 public constant RISK_ROLE = keccak256("RISK_ROLE");
    uint256 internal constant VIRTUAL_SHARES = 1e6; // inflation-attack offset
    uint256 public constant MAX_PROCESS = 64;

    struct Params {
        uint16 spreadBps; // half-spread at OPEN
        uint16 depthBps; // NAV fraction quoted per tick per side
        uint16 widthTicks; // ticks per side
        uint16 maxSkewTicks; // skew at 100% / 0% base weight
        uint16 maxAuctionBps; // NAV fraction a side may trade in one auction
        uint16 swingBps; // fee on flows executed while the reference market is closed / halted
        uint8 extMult; // spread multiplier in EXTENDED
        uint8 closedMult; // spread multiplier in CLOSED (DISCOVERY)
        bool paused;
    }

    struct Request {
        address owner;
        bool redeem;
        uint64 time;
        uint128 amount; // deposit: quote units; redeem: shares
    }

    IUnisonVenue public immutable venue;
    uint256 public immutable marketId;
    IERC20 public immutable base;
    IERC20 public immutable quote;
    uint256 public immutable baseUnit;
    uint8 internal immutable _quoteDecimals;

    Params public params;
    Request[] internal _queue;
    uint256 public head;

    // attribution (quote units, signed)
    int256 public spreadPnl;
    int256 public inventoryPnl;
    uint256 public lastMark;
    uint256 public tradedBase;
    uint256 public auctionsTraded;

    /// @notice Redemptions held for an LP because the token or the exchange refused to deliver them (owner => token
    ///         => amount). They sit in this contract, outside the vault's ledger balance, so they are neither quoted
    ///         nor counted in NAV.
    mapping(address => mapping(address => uint256)) public held;

    event ParamsSet(Params p);
    event DepositRequested(uint256 indexed id, address indexed owner, uint256 assets);
    event RedeemRequested(uint256 indexed id, address indexed owner, uint256 shares);
    event Deposited(uint256 indexed id, address indexed owner, uint256 assets, uint256 shares, uint256 nav, uint256 swingFee);
    event Redeemed(
        uint256 indexed id, address indexed owner, uint256 shares, uint256 baseOut, uint256 quoteOut, uint256 swingFee
    );
    event Filled(uint256 indexed batch, uint256 price, uint256 refPrice, uint256 bought, uint256 sold, int256 spreadPnl);
    event RedemptionHeld(uint256 indexed id, address indexed owner, address indexed token, uint256 amount);
    event HeldClaimed(address indexed owner, address indexed token, uint256 amount);

    error NotVenue();
    error BadParams();
    error ZeroAmount();
    error ClearRunning();

    constructor(
        address admin,
        IUnisonVenue venue_,
        uint256 marketId_,
        string memory name_,
        string memory symbol_,
        Params memory p
    ) ERC20(name_, symbol_) {
        venue = venue_;
        marketId = marketId_;
        IUnisonVenue.MarketView memory m = venue_.market(marketId_);
        base = IERC20(m.base);
        quote = IERC20(m.quote);
        baseUnit = m.baseUnit;
        _quoteDecimals = ERC20(m.quote).decimals();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(RISK_ROLE, admin);
        _setParams(p);
        IERC20(m.quote).forceApprove(address(venue_), type(uint256).max);
        IERC20(m.base).forceApprove(address(venue_), type(uint256).max);
    }

    // ------------------------------------------------------------------ risk params

    function setParams(Params calldata p) external onlyRole(RISK_ROLE) {
        _setParams(p);
    }

    function _setParams(Params memory p) private {
        if (
            p.spreadBps == 0 || p.widthTicks == 0 || p.depthBps > 10_000 || p.maxAuctionBps > 10_000
                || p.swingBps > 1_000 || p.extMult == 0 || p.closedMult == 0
        ) revert BadParams();
        params = p;
        emit ParamsSet(p);
    }

    // ------------------------------------------------------------------ NAV

    function balances() public view returns (uint256 baseBal, uint256 quoteBal) {
        baseBal = venue.balanceOf(address(this), address(base));
        quoteBal = venue.balanceOf(address(this), address(quote));
    }

    /// @notice Net asset value in quote units at `price` (quote units per whole base token).
    function navAt(uint256 price) public view returns (uint256) {
        (uint256 b, uint256 q) = balances();
        return q + Math.mulDiv(b, price, baseUnit);
    }

    function nav() external view returns (uint256) {
        return navAt(venue.market(marketId).lastRefPrice);
    }

    // ------------------------------------------------------------------ curve (ICurveSource)

    function curve(uint256 mId, uint256 refPrice, uint8 status, uint256 refTick, uint256, uint256)
        external
        view
        returns (Curve memory c)
    {
        Params memory p = params;
        if (mId != marketId || p.paused || refPrice == 0 || status == uint8(IReferenceAdapter.Status.HALTED)) {
            return c;
        }
        (uint256 b, uint256 q) = balances();
        uint256 baseVal = Math.mulDiv(b, refPrice, baseUnit);
        uint256 navQ = q + baseVal;
        if (navQ == 0) return c;

        uint256 mult = status == uint8(IReferenceAdapter.Status.OPEN)
            ? 1
            : status == uint8(IReferenceAdapter.Status.EXTENDED) ? p.extMult : p.closedMult;
        uint256 half = (refTick * p.spreadBps * mult) / 10_000;
        if (half == 0) half = 1;
        // skew > 0 when overweight base: both quotes move down (sell base cheaper, buy it lower)
        int256 skew = ((int256((baseVal * 10_000) / navQ) - 5_000) * int256(uint256(p.maxSkewTicks))) / 5_000;

        int256 bidTop = int256(refTick) - int256(half) - skew;
        int256 askBot = int256(refTick) + int256(half) - skew;
        uint256 perTickQuote = (navQ * p.depthBps) / 10_000;
        uint256 sideCap = (navQ * p.maxAuctionBps) / 10_000;
        if (perTickQuote * p.widthTicks > sideCap) perTickQuote = sideCap / p.widthTicks;
        uint256 perTick = Math.mulDiv(perTickQuote, baseUnit, refPrice);
        if (perTick == 0 || perTick > type(uint128).max) return c;

        if (bidTop >= 1) {
            c.bidTop = uint32(uint256(bidTop));
            c.bidTicks = p.widthTicks;
            c.bidPerTick = uint128(perTick);
        }
        if (askBot >= 1) {
            c.askBottom = uint32(uint256(askBot));
            c.askTicks = p.widthTicks;
            c.askPerTick = uint128(perTick);
        }
    }

    /// @notice Attribution of every auction the vault traded in (called by the venue after settlement).
    function onAuction(
        uint256 mId,
        uint256 batch,
        uint256 price,
        uint256 refPrice,
        uint256 boughtBase,
        uint256,
        uint256 soldBase,
        uint256
    ) external {
        if (msg.sender != address(venue) || mId != marketId) revert NotVenue();
        // mark the inventory held BEFORE this auction to the new reference
        (uint256 b,) = balances();
        uint256 before = b + soldBase - boughtBase;
        _mark(before, refPrice);
        // spread captured vs the reference on this auction's fills
        int256 sp = (int256(refPrice) - int256(price)) * int256(boughtBase) / int256(baseUnit)
            + (int256(price) - int256(refPrice)) * int256(soldBase) / int256(baseUnit);
        spreadPnl += sp;
        // post-fill inventory is marked from the reference onwards
        lastMark = refPrice;
        tradedBase += boughtBase + soldBase;
        auctionsTraded += 1;
        emit Filled(batch, price, refPrice, boughtBase, soldBase, sp);
    }

    function _mark(uint256 baseBal, uint256 refPrice) private {
        if (lastMark != 0 && refPrice != lastMark) {
            inventoryPnl += (int256(refPrice) - int256(lastMark)) * int256(baseBal) / int256(baseUnit);
        }
        lastMark = refPrice;
    }

    // ------------------------------------------------------------------ async flows (ERC-7540 style)

    function requestDeposit(uint256 assets) external nonReentrant returns (uint256 id) {
        if (assets == 0 || assets > type(uint128).max) revert ZeroAmount();
        quote.safeTransferFrom(msg.sender, address(this), assets);
        id = _queue.length;
        _queue.push(Request(msg.sender, false, uint64(block.timestamp), uint128(assets)));
        emit DepositRequested(id, msg.sender, assets);
    }

    function requestRedeem(uint256 shares) external nonReentrant returns (uint256 id) {
        if (shares == 0 || shares > type(uint128).max) revert ZeroAmount();
        _transfer(msg.sender, address(this), shares); // escrowed until execution
        id = _queue.length;
        _queue.push(Request(msg.sender, true, uint64(block.timestamp), uint128(shares)));
        emit RedeemRequested(id, msg.sender, shares);
    }

    /// @notice Executes queued requests that were made before the venue's latest reference was published,
    ///         at that reference. Permissionless.
    function process() external nonReentrant returns (uint256 done) {
        if (venue.jobPhase(marketId) != 0) revert ClearRunning(); // NAV only at a completed auction
        IUnisonVenue.MarketView memory m = venue.market(marketId);
        uint256 ref = m.lastRefPrice;
        if (ref == 0) return 0;
        bool closed = m.lastStatus == uint8(IReferenceAdapter.Status.CLOSED)
            || m.lastStatus == uint8(IReferenceAdapter.Status.HALTED);
        uint256 swing = closed ? params.swingBps : 0;
        {
            (uint256 b,) = balances();
            _mark(b, ref);
        }
        uint256 h = head;
        uint256 end = _queue.length;
        while (h < end && done < MAX_PROCESS) {
            Request memory r = _queue[h];
            if (uint256(r.time) * 1000 >= m.lastRefTimeMs) break; // reference not yet published after the request
            if (r.redeem) _executeRedeem(h, r, swing);
            else _executeDeposit(h, r, ref, swing);
            delete _queue[h];
            ++h;
            ++done;
        }
        head = h;
    }

    function _executeDeposit(uint256 id, Request memory r, uint256 ref, uint256 swing) private {
        uint256 assets = r.amount;
        uint256 navQ = navAt(ref);
        uint256 fee = (assets * swing) / 10_000;
        uint256 shares = Math.mulDiv(assets - fee, totalSupply() + VIRTUAL_SHARES, navQ + 1);
        venue.deposit(address(quote), assets); // the swing fee stays in the vault for existing LPs
        _mint(r.owner, shares);
        emit Deposited(id, r.owner, assets, shares, navQ, fee);
    }

    function _executeRedeem(uint256 id, Request memory r, uint256 swing) private {
        uint256 shares = r.amount;
        uint256 supply = totalSupply(); // includes the escrowed shares
        (uint256 b, uint256 q) = balances();
        uint256 keep = 10_000 - swing;
        uint256 outB = Math.mulDiv(b, shares * keep, supply * 10_000);
        uint256 outQ = Math.mulDiv(q, shares * keep, supply * 10_000);
        _burn(address(this), shares);
        _deliver(id, r.owner, address(base), outB);
        _deliver(id, r.owner, address(quote), outQ);
        emit Redeemed(id, r.owner, shares, outB, outQ, swing);
    }

    /// @dev Pays a redemption out through the exchange. If the token or the exchange refuses this owner, the amount
    ///      leaves the vault's ledger balance for this contract and is held for them, so the requests behind keep
    ///      settling. (If the exchange refused the vault itself, nothing could settle anyway: that still reverts.)
    function _deliver(uint256 id, address owner, address token, uint256 amount) private {
        if (amount == 0) return;
        try venue.withdraw(token, amount, owner) {}
        catch {
            venue.withdraw(token, amount, address(this));
            held[owner][token] += amount;
            emit RedemptionHeld(id, owner, token, amount);
        }
    }

    /// @notice Retries a held redemption: deposited back and withdrawn to the owner through the exchange, under the
    ///         same checks as any withdrawal. Reverts, changing nothing, while it is still refused. Only to the owner.
    function claim(address token) external nonReentrant {
        uint256 amount = held[msg.sender][token];
        if (amount == 0) revert ZeroAmount();
        held[msg.sender][token] = 0;
        venue.deposit(token, amount);
        venue.withdraw(token, amount, msg.sender);
        emit HeldClaimed(msg.sender, token, amount);
    }

    /// @notice 2: refused redemptions are held instead of stopping the queue.
    function version() external pure returns (uint256) {
        return 2;
    }

    function queueLength() external view returns (uint256) {
        return _queue.length;
    }

    function request(uint256 id) external view returns (Request memory) {
        return _queue[id];
    }

    function decimals() public view override returns (uint8) {
        return _quoteDecimals + 6; // shares carry 6 extra decimals of precision over the quote token
    }
}

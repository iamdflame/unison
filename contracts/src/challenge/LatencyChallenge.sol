// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ICausalReference} from "../interfaces/ICausalReference.sol";
import {ChallengeAccount, IChallengeVenue} from "./ChallengeAccount.sol";

interface IChallengeMarkets {
    function marketPricing(uint256 marketId) external view returns (uint256 tickSize, uint256 baseUnit);
}

/// @title LatencyChallenge — a standing pot for anyone who profits from being fast
/// @notice Latency profit is defined here, frozen at deployment, and checked against Chainlink's own history: an
///         account's fills inside the window, each marked to the first Chainlink observation made at least
///         `horizonSec` after its order, showing an average edge after fees above `epsilonBps` over at least
///         `minFills` fills. Directional luck averages out over that many fills; knowing the next price first does
///         not. Anyone opens an account here and trades through it; every fill is recorded, so a claim can't leave
///         the losing ones out. A claim that meets the definition takes the whole pot, at once, with no one to ask.
///         If the window ends with the pot still here, the sponsor takes it back: the rule held.
///
///         The same contract runs against a market priced at the first observation after its orders (SPEC §7.4) and
///         against a market kept on the older rule, so the definition is shown to bite where there is an edge.
contract LatencyChallenge {
    using SafeERC20 for IERC20;

    /// @dev claims for fills inside the window stay open this long after it ends, before the sponsor may reclaim
    uint256 public constant GRACE = 3 days;

    IERC20 public immutable pot;
    address public immutable venue;
    uint256 public immutable marketId;
    address public immutable base;
    address public immutable quote;
    uint256 public immutable baseUnit;
    /// @dev marks fills with the first observation at least `horizonSec` after each order, from this adapter's feed
    ICausalReference public immutable markout;
    uint256 public immutable markoutMarketId;
    uint64 public immutable start;
    uint64 public immutable end;
    uint32 public immutable horizonSec;
    uint16 public immutable epsilonBps;
    uint32 public immutable minFills;
    address public immutable sponsor;

    mapping(address => bool) public isTeam;
    mapping(address => address) public accountOf;
    mapping(address => address) public ownerOf;
    address[] public accounts;
    bool public paid;

    event Opened(address indexed owner, address account);
    event Claimed(
        address indexed account, address indexed owner, uint256 fills, int256 edge, uint256 notional, uint256 amount
    );
    event Reclaimed(address indexed sponsor, uint256 amount);

    error Team();
    error Closed();
    error AlreadyOpen();
    error UnknownAccount();
    error Rounds();
    error NotEnoughFills(uint256 fills);
    error NoEdge(int256 edge, uint256 notional);
    error NotSponsor();
    error StillOpen();

    struct Terms {
        IERC20 pot;
        address venue;
        uint256 marketId;
        address base;
        address quote;
        ICausalReference markout;
        uint256 markoutMarketId;
        uint64 start;
        uint64 end;
        uint32 horizonSec;
        uint16 epsilonBps;
        uint32 minFills;
        address sponsor;
        address[] team;
    }

    constructor(Terms memory t) {
        pot = t.pot;
        venue = t.venue;
        marketId = t.marketId;
        base = t.base;
        quote = t.quote;
        (, baseUnit) = IChallengeMarkets(t.venue).marketPricing(t.marketId);
        markout = t.markout;
        markoutMarketId = t.markoutMarketId;
        start = t.start;
        end = t.end;
        horizonSec = t.horizonSec;
        epsilonBps = t.epsilonBps;
        minFills = t.minFills;
        sponsor = t.sponsor;
        for (uint256 i = 0; i < t.team.length; ++i) {
            isTeam[t.team[i]] = true;
        }
    }

    /// @notice Opens a trading account for the caller. The team can't: its fills are not the challenge.
    function open() external returns (address account) {
        if (isTeam[msg.sender]) revert Team();
        if (block.timestamp >= end || paid) revert Closed();
        if (accountOf[msg.sender] != address(0)) revert AlreadyOpen();
        account = address(new ChallengeAccount(msg.sender, IChallengeVenue(venue), marketId, base, quote));
        accountOf[msg.sender] = account;
        ownerOf[account] = msg.sender;
        accounts.push(account);
        emit Opened(msg.sender, account);
    }

    /// @notice An account's latency edge: every fill made inside the window, each marked to the first Chainlink
    ///         observation at least `horizonSec` after its order. `baseRounds[i]` / `quoteRounds[i]` name that
    ///         observation for fill i (one entry per recorded fill; fills outside the window are skipped); the adapter
    ///         proves each is the first, so no round can be picked.
    /// @return edge     quote units: what the fills were worth at the markouts, minus what they cost (fees included)
    /// @return notional quote units traded
    /// @return fills    fills counted
    function edgeOf(address account, uint80[] calldata baseRounds, uint80[] calldata quoteRounds)
        public
        view
        returns (int256 edge, uint256 notional, uint256 fills)
    {
        if (ownerOf[account] == address(0)) revert UnknownAccount();
        ChallengeAccount a = ChallengeAccount(account);
        uint256 n = a.fillCount();
        if (baseRounds.length != n || quoteRounds.length != n) revert Rounds();
        for (uint256 i = 0; i < n; ++i) {
            ChallengeAccount.Fill memory f = a.fillAt(i);
            if (f.placedAt < start || f.placedAt > end) continue;
            (uint256 price,,,) = markout.readAfter(
                markoutMarketId, f.placedAt + horizonSec - 1, abi.encode(baseRounds[i], quoteRounds[i])
            );
            int256 worth = int256((uint256(f.base) * price) / baseUnit);
            edge += f.side == 0 ? worth - int256(uint256(f.quote)) : int256(uint256(f.quote)) - worth;
            notional += f.quote;
            ++fills;
        }
    }

    /// @notice Pays the whole pot to the account's owner if its edge meets the definition.
    function claim(address account, uint80[] calldata baseRounds, uint80[] calldata quoteRounds) external {
        if (paid) revert Closed();
        (int256 edge, uint256 notional, uint256 fills) = edgeOf(account, baseRounds, quoteRounds);
        if (fills < minFills) revert NotEnoughFills(fills);
        if (edge <= 0 || uint256(edge) * 10_000 <= uint256(epsilonBps) * notional) revert NoEdge(edge, notional);
        paid = true;
        address to = ownerOf[account];
        uint256 amount = pot.balanceOf(address(this));
        pot.safeTransfer(to, amount);
        emit Claimed(account, to, fills, edge, notional, amount);
    }

    /// @notice After the window and its grace period, a pot nobody could claim goes back to the sponsor.
    function reclaim() external {
        if (msg.sender != sponsor) revert NotSponsor();
        if (block.timestamp <= end + GRACE) revert StillOpen();
        if (paid) revert Closed();
        uint256 amount = pot.balanceOf(address(this));
        pot.safeTransfer(sponsor, amount);
        emit Reclaimed(sponsor, amount);
    }

    function accountCount() external view returns (uint256) {
        return accounts.length;
    }
}

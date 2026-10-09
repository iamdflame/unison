// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {StreamsCausalReference} from "./StreamsCausalReference.sol";
import {IUnisonVenue} from "../liquidity/LiquidityVault.sol";

interface IClearable {
    function clear(uint256 marketId, bytes calldata payload) external returns (uint256 tick, uint256 volume);
}

/// @title ClearRouter — bring an auction's report on chain and clear the auction, in one transaction
/// @notice Stateless and permissionless. The keeper uses it, and so can anyone waiting on an auction (the trade
///         ticket's "Settle this auction"): the report decides the price and the boundary, so the caller chooses
///         nothing. The exchange pays its keeper reward to whoever clears, here this router, so the router passes it
///         straight on to the caller.
contract ClearRouter {
    function submitAndClear(
        StreamsCausalReference adapter,
        bytes[] calldata signedReports,
        address exchange,
        uint256 marketId,
        bytes calldata payload
    ) external returns (uint256 tick, uint256 volume) {
        for (uint256 i = 0; i < signedReports.length; ++i) {
            adapter.submit(signedReports[i]);
        }
        (tick, volume) = IClearable(exchange).clear(marketId, payload);
        IUnisonVenue venue = IUnisonVenue(exchange);
        address quote = venue.market(marketId).quote;
        uint256 reward = venue.balanceOf(address(this), quote);
        if (reward != 0) {
            // a refused transfer must not undo the auction; what stays here goes to the next caller
            try venue.withdraw(quote, reward, msg.sender) {} catch {}
        }
    }
}

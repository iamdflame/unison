// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {MockERC20} from "./MockERC20.sol";

/// @notice A token whose issuer can freeze an address, as Agora can on AUSD and Anchored on its stocks: transfers to
///         or from a frozen address revert.
contract MockFreezableERC20 is MockERC20 {
    mapping(address => bool) public frozen;

    error Frozen(address account);

    constructor(string memory name_, string memory symbol_, uint8 decimals_) MockERC20(name_, symbol_, decimals_) {}

    function freeze(address account, bool on) external {
        frozen[account] = on;
    }

    function _update(address from, address to, uint256 value) internal override {
        if (frozen[from]) revert Frozen(from);
        if (frozen[to]) revert Frozen(to);
        super._update(from, to, value);
    }
}

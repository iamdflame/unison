// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Pages} from "../libraries/Pages.sol";

/// @title ExchangeLayout — raw storage layout of the exchange (SPEC §9)
/// @notice Everything an account touches on the order path lives in ONE page-aligned 128-slot page:
///           slots 0..15   free balances per listed token index
///           slot  16      eligibility cache (expiry seconds << 8 | class bits)
///           slot  17      open-order bitmap (bit i = order slot i used)
///           slots 18..127 orders, 2 slots each → 55 order slots
///         Pending-order aggregates live in per-market ring buffers (RING batches) whose slots are
///         reused, so steady-state order entry pays no state-growth gas.
library ExchangeLayout {
    uint256 internal constant MAX_TOKENS = 16;
    uint256 internal constant ELIG_SLOT = 16;
    uint256 internal constant BITMAP_SLOT = 17;
    uint256 internal constant ORDERS_BASE = 18;
    uint256 internal constant MAX_ORDERS = 55;

    uint256 internal constant RING = 256; // pending batch ring size per market
    uint256 internal constant GROUP_PAGES = 8; // up to 8*127 pending groups per batch

    bytes32 internal constant NS_ACCOUNT = keccak256("unison.account");
    bytes32 internal constant NS_PENDING = keccak256("unison.pending");
    bytes32 internal constant NS_GROUPS = keccak256("unison.groups");
    bytes32 internal constant NS_MERGE = keccak256("unison.merge");
    bytes32 internal constant NS_IOCPOST = keccak256("unison.iocpost");

    // ------------------------------------------------------------------ account page

    function accountBase(address account) internal pure returns (uint256) {
        return Pages.base(NS_ACCOUNT, bytes32(uint256(uint160(account))));
    }

    function balanceSlot(address account, uint256 tokenIdx) internal pure returns (uint256) {
        return accountBase(account) + tokenIdx;
    }

    function orderSlots(address account, uint256 i) internal pure returns (uint256 a, uint256 b) {
        uint256 base = accountBase(account) + ORDERS_BASE + 2 * i;
        return (base, base + 1);
    }

    // ------------------------------------------------------------------ order record codec
    // slot A: qty uint96 | tick uint32 | market uint32 | side uint8 | shard uint8 | flags uint8 | state uint8 | batch uint64
    // slot B: epoch uint32 | survival uint96 | acc uint128   (entry snapshot once live)

    uint256 internal constant STATE_EMPTY = 0;
    uint256 internal constant STATE_PENDING = 1;
    uint256 internal constant STATE_LIVE = 2;

    uint256 internal constant FLAG_IOC = 1;

    struct OrderRec {
        uint256 qty;
        uint256 tick;
        uint256 market;
        uint256 side;
        uint256 shard;
        uint256 flags;
        uint256 state;
        uint256 batch;
        uint256 epoch;
        uint256 survival;
        uint256 acc;
    }

    function decodeOrder(uint256 a, uint256 b) internal pure returns (OrderRec memory o) {
        o.qty = a & type(uint96).max;
        o.tick = (a >> 96) & type(uint32).max;
        o.market = (a >> 128) & type(uint32).max;
        o.side = (a >> 160) & 0xff;
        o.shard = (a >> 168) & 0xff;
        o.flags = (a >> 176) & 0xff;
        o.state = (a >> 184) & 0xff;
        o.batch = a >> 192;
        o.epoch = b & type(uint32).max;
        o.survival = (b >> 32) & type(uint96).max;
        o.acc = b >> 128;
    }

    function encodeOrder(OrderRec memory o) internal pure returns (uint256 a, uint256 b) {
        a = o.qty | (o.tick << 96) | (o.market << 128) | (o.side << 160) | (o.shard << 168) | (o.flags << 176)
            | (o.state << 184) | (o.batch << 192);
        b = o.epoch | (o.survival << 32) | (o.acc << 128);
    }

    // ------------------------------------------------------------------ pending ring

    /// @dev Aggregate of pending (not yet merged) quantity for one (batch, side, shard, ioc, tick).
    ///      Packed: tag uint64 (batch) | qty uint128.
    function pendingSlot(uint256 market, uint256 batch, uint256 side, uint256 shard, uint256 ioc, uint256 tick)
        internal
        pure
        returns (uint256)
    {
        uint256 ringIdx = batch % RING;
        return Pages.base5(NS_PENDING, market, ringIdx, (side << 8) | (shard << 1) | ioc, tick >> 7, 0)
            + (tick & 127);
    }

    /// @dev Group-list page for a batch: slot0 = tag uint64 | count uint32 | ts uint64 ; slots 1..127 entries
    function groupPage(uint256 market, uint256 batch, uint256 pageNo) internal pure returns (uint256) {
        return Pages.base4(NS_GROUPS, market, batch % RING, pageNo, 0);
    }

    function packGroup(uint256 side, uint256 shard, uint256 ioc, uint256 tick) internal pure returns (uint256) {
        return tick | (side << 32) | (shard << 40) | (ioc << 48);
    }

    function unpackGroup(uint256 g) internal pure returns (uint256 side, uint256 shard, uint256 ioc, uint256 tick) {
        tick = g & type(uint32).max;
        side = (g >> 32) & 0xff;
        shard = (g >> 40) & 0xff;
        ioc = (g >> 48) & 0xff;
    }

    // ------------------------------------------------------------------ snapshots

    function mergeSnapSlot(uint256 market, uint256 batch, uint256 side, uint256 shard, uint256 tick)
        internal
        pure
        returns (uint256)
    {
        return uint256(keccak256(abi.encode(NS_MERGE, market, batch, side, shard, tick)));
    }

    function iocPostSlot(uint256 market, uint256 batch, uint256 side, uint256 shard, uint256 tick)
        internal
        pure
        returns (uint256)
    {
        return uint256(keccak256(abi.encode(NS_IOCPOST, market, batch, side, shard, tick)));
    }

    /// @dev Snapshot packing: epoch uint32 | survival uint96 | acc uint128. An unset snapshot has
    ///      survival == 0 (a set snapshot always has survival >= BookStore.S_MIN > 0).
    function packSnap(uint256 epoch, uint256 survival, uint256 acc) internal pure returns (uint256) {
        return epoch | (survival << 32) | (acc << 128);
    }

    function unpackSnap(uint256 w) internal pure returns (uint256 epoch, uint256 survival, uint256 acc) {
        epoch = w & type(uint32).max;
        survival = (w >> 32) & type(uint96).max;
        acc = w >> 128;
    }
}

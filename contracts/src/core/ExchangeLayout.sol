// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Pages} from "../libraries/Pages.sol";

/// @title ExchangeLayout — raw storage layout of the exchange (SPEC §9)
/// @notice Everything an account touches on the order path lives in ONE page-aligned 128-slot page:
///           slots 0..15   free balances per listed token index
///           slot  16      eligibility cache (reserved)
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
    // slot A: qty u96 | tick u24 | market u24 | side u8 | shard u8 | flags u8 | state u8 | batch u48
    //         | feeBps u16 | maxFeeBps u16
    // slot B: credited u128 (bids: base received so far; asks: gross quote received so far)
    // The entry snapshot is shared by every order of the same (batch, side, shard, tick) group and lives in
    // the group's merge record, so an order never needs its own copy.

    uint256 internal constant STATE_EMPTY = 0;
    uint256 internal constant STATE_OPEN = 1;

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
        uint256 feeBps;
        uint256 maxFeeBps;
        uint256 credited;
    }

    function decodeOrder(uint256 a, uint256 b) internal pure returns (OrderRec memory o) {
        o.qty = a & type(uint96).max;
        o.tick = (a >> 96) & type(uint24).max;
        o.market = (a >> 120) & type(uint24).max;
        o.side = (a >> 144) & 0xff;
        o.shard = (a >> 152) & 0xff;
        o.flags = (a >> 160) & 0xff;
        o.state = (a >> 168) & 0xff;
        o.batch = (a >> 176) & type(uint48).max;
        o.feeBps = (a >> 224) & 0xffff;
        o.maxFeeBps = a >> 240;
        o.credited = b & type(uint128).max;
    }

    function encodeOrder(OrderRec memory o) internal pure returns (uint256 a, uint256 b) {
        a = o.qty | (o.tick << 96) | (o.market << 120) | (o.side << 144) | (o.shard << 152) | (o.flags << 160)
            | (o.state << 168) | (o.batch << 176) | (o.feeBps << 224) | (o.maxFeeBps << 240);
        b = o.credited;
    }

    // ------------------------------------------------------------------ pending ring

    /// @dev Aggregate of pending (not yet merged) quantity for one (batch, side, shard, ioc, tick).
    ///      Packed: tag u64 (batch) | qty (rest).
    function pendingSlot(uint256 market, uint256 batch, uint256 side, uint256 shard, uint256 ioc, uint256 tick)
        internal
        pure
        returns (uint256)
    {
        uint256 ringIdx = batch % RING;
        return Pages.base5(NS_PENDING, market, ringIdx, (side << 8) | (shard << 1) | ioc, tick >> 7, 0)
            + (tick & 127);
    }

    /// @dev Group-list page for a batch: slot0 = tag u64 | count u32 | ts at bit 96 ; slots 1..127 entries
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

    // ------------------------------------------------------------------ merge snapshots

    /// @dev Book shard of an order: main books 0..7, IOC books 8..15.
    function bookShard(uint256 shard, uint256 ioc) internal pure returns (uint256) {
        return ioc != 0 ? shard + 8 : shard;
    }

    /// @dev Two words (one page): [acc] [survival u128 | epoch u64 | scale u32]. Unset ⇔ second word == 0.
    function mergeSlot(uint256 market, uint256 batch, uint256 side, uint256 bshard, uint256 tick)
        internal
        pure
        returns (uint256)
    {
        return uint256(keccak256(abi.encode(NS_MERGE, market, batch, side, bshard, tick))) & ~uint256(1);
    }

    function storeSnap(uint256 slot, uint256 epoch, uint256 scale, uint256 survival, uint256 acc) internal {
        Pages.store(slot, acc);
        Pages.store(slot + 1, survival | (epoch << 128) | (scale << 192));
    }

    function loadSnap(uint256 slot)
        internal
        view
        returns (bool set, uint256 epoch, uint256 scale, uint256 survival, uint256 acc)
    {
        uint256 w = Pages.load(slot + 1);
        if (w == 0) return (false, 0, 0, 0, 0);
        return (true, (w >> 128) & type(uint64).max, (w >> 192) & type(uint32).max, w & type(uint128).max, Pages.load(slot));
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test, console} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {UnisonExchange} from "../../src/core/UnisonExchange.sol";
import {ManualReference} from "../../src/pricing/ManualReference.sol";
import {IReferenceAdapter} from "../../src/interfaces/IReferenceAdapter.sol";
import {MockERC20} from "../mocks/MockERC20.sol";

/// @notice Gas per operation. Identical code runs on two EVMs:
///   Ethereum rules: forge test --match-contract GasBench -vv
///   Monad rules:    forge test --fork-url http://127.0.0.1:8546 --match-contract GasBench -vv   (Monad fork)
contract GasBench is Test {
    UnisonExchange internal ex;
    ManualReference internal ref;
    MockERC20 internal nvda;
    MockERC20 internal ausd;
    uint256 internal mkt;
    address[] internal users;

    function setUp() public {
        nvda = new MockERC20("aNVDA", "aNVDA", 18);
        ausd = new MockERC20("AUSD", "AUSD", 6);
        ref = new ManualReference(address(this));
        UnisonExchange impl = new UnisonExchange();
        ex = UnisonExchange(
            address(new ERC1967Proxy(address(impl), abi.encodeCall(UnisonExchange.initialize, (address(this)))))
        );
        ex.listToken(address(nvda), false);
        ex.listToken(address(ausd), false);
        mkt = ex.createMarket(
            UnisonExchange.MarketParams({
                base: address(nvda),
                quote: address(ausd),
                refAdapter: address(ref),
                tickSize: 10_000,
                minTick: 1,
                maxTick: uint32((1 << 21) - 1),
                maxBandTicks: 2801,
                bandBps: 100,
                feeBps: 3,
                maxFeeBps: 10,
                shards: 4,
                permissioned: false,
                strictAfterClose: false
            })
        );
        for (uint256 i = 0; i < 200; ++i) {
            address u = address(uint160(0xC0000 + i));
            users.push(u);
            nvda.mint(u, 1_000e18);
            ausd.mint(u, 1_000_000e6);
            vm.startPrank(u);
            nvda.approve(address(ex), type(uint256).max);
            ausd.approve(address(ex), type(uint256).max);
            vm.stopPrank();
        }
    }

    function _g(string memory what, uint256 used) internal pure {
        console.log(string.concat(what, ": "), used);
    }

    function _depositAll(uint256 n) internal {
        for (uint256 i = 0; i < n; ++i) {
            vm.startPrank(users[i]);
            ex.deposit(address(nvda), 100e18);
            ex.deposit(address(ausd), 100_000e6);
            vm.stopPrank();
        }
    }

    function _clear() internal returns (uint256 used, uint256 vol) {
        vm.roll(block.number + 1);
        vm.warp(block.timestamp + 1);
        ref.post(mkt, 180e6, block.timestamp * 1000, IReferenceAdapter.Status.OPEN);
        uint256 g = gasleft();
        (, vol) = ex.clear(mkt, "");
        used = g - gasleft();
    }

    function test_gas_orderLifecycle() public {
        console.log("chainid", block.chainid);
        uint256 g;
        vm.startPrank(users[0]);
        g = gasleft();
        ex.deposit(address(ausd), 100_000e6);
        _g("deposit (first, cold account page)", g - gasleft());
        g = gasleft();
        ex.deposit(address(nvda), 100e18);
        _g("deposit (second token, warm page)", g - gasleft());
        g = gasleft();
        ex.placeOrder(mkt, 0, 18_010, 1e18, 0);
        _g("placeOrder (first of block: new batch + group)", g - gasleft());
        g = gasleft();
        ex.placeOrder(mkt, 0, 18_010, 1e18, 0);
        _g("placeOrder (same block, same tick group)", g - gasleft());
        g = gasleft();
        ex.placeOrder(mkt, 0, 18_005, 1e18, 0);
        _g("placeOrder (same block, new tick group)", g - gasleft());
        g = gasleft();
        ex.cancelOrder(2);
        _g("cancelOrder (pending, same block)", g - gasleft());
        vm.stopPrank();

        vm.prank(users[1]);
        ex.deposit(address(nvda), 100e18);
        vm.prank(users[1]);
        ex.placeOrder(mkt, 1, 17_990, 2e18, 0);
        (uint256 used,) = _clear();
        _g("clear (2 makers, 1 taker, 2 levels)", used);

        uint256[] memory sl = new uint256[](2);
        sl[0] = 0;
        sl[1] = 1;
        g = gasleft();
        ex.claim(users[0], sl);
        _g("claim (2 filled bids)", g - gasleft());
    }

    function test_gas_clearScaling() public {
        _depositAll(200);
        uint256[4] memory sizes = [uint256(10), 50, 100, 200];
        for (uint256 k = 0; k < sizes.length; ++k) {
            uint256 n = sizes[k];
            for (uint256 i = 0; i < n; ++i) {
                vm.prank(users[i]);
                // half buyers, half sellers, spread over 40 ticks around the reference
                ex.placeOrder(mkt, i % 2, i % 2 == 0 ? 18_000 + (i % 40) : 17_980 + (i % 40), 1e17, 0);
            }
            (uint256 used, uint256 vol) = _clear();
            console.log(string.concat("clear with ", vm.toString(n), " new orders: gas"), used, "volume", vol);
            for (uint256 i = 0; i < n; ++i) {
                // settle everything so the next round starts from an empty book
                uint256 bm = ex.openOrderBitmap(users[i]);
                for (uint256 s = 0; s < 55; ++s) {
                    if (bm & (1 << s) != 0) {
                        vm.prank(users[i]);
                        ex.cancelOrder(s);
                    }
                }
            }
        }
    }
}

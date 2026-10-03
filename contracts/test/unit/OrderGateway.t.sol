// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import {UnisonExchange} from "../../src/core/UnisonExchange.sol";
import {ManualReference} from "../../src/pricing/ManualReference.sol";
import {IReferenceAdapter} from "../../src/interfaces/IReferenceAdapter.sol";
import {OrderGateway, IGatewayVenue} from "../../src/access/OrderGateway.sol";
import {WebAuthn} from "../../src/libraries/WebAuthn.sol";
import {MockERC20} from "../mocks/MockERC20.sol";

contract MockSmartWallet is IERC1271 {
    address public immutable owner;

    constructor(address owner_) {
        owner = owner_;
    }

    function isValidSignature(bytes32 hash, bytes calldata sig) external view returns (bytes4) {
        return ECDSA.recover(hash, sig) == owner ? IERC1271.isValidSignature.selector : bytes4(0xffffffff);
    }
}

contract OrderGatewayTest is Test {
    UnisonExchange internal ex;
    ManualReference internal ref;
    OrderGateway internal gw;
    MockERC20 internal nvda;
    MockERC20 internal ausd;
    uint256 internal mkt;
    uint256 internal mkt2;

    uint256 internal constant ALICE_PK = 0xA11CE;
    uint256 internal constant AGENT_PK = 0xA6E7;
    uint256 internal constant PASSKEY_PK = 0xBEEF;
    uint256 internal constant OWNER_PK = 0x0E7;
    uint256 internal constant P256_N = 0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551;
    address internal alice;
    address internal relayer = makeAddr("relayer");

    function setUp() public {
        vm.warp(1_760_000_000);
        alice = vm.addr(ALICE_PK);
        nvda = new MockERC20("aNVDA", "aNVDA", 18);
        ausd = new MockERC20("AUSD", "AUSD", 6);
        ref = new ManualReference(address(this));
        UnisonExchange impl = new UnisonExchange();
        ex = UnisonExchange(
            address(new ERC1967Proxy(address(impl), abi.encodeCall(UnisonExchange.initialize, (address(this)))))
        );
        ex.listToken(address(nvda), false);
        ex.listToken(address(ausd), false);
        mkt = ex.createMarket(_params());
        mkt2 = ex.createMarket(_params());
        gw = new OrderGateway(IGatewayVenue(address(ex)));
        ex.grantRole(ex.GATEWAY_ROLE(), address(gw));
        _fund(alice);
    }

    function _params() internal view returns (UnisonExchange.MarketParams memory) {
        return UnisonExchange.MarketParams({
            base: address(nvda),
            quote: address(ausd),
            refAdapter: address(ref),
            tickSize: 10_000,
            minTick: 1,
            maxTick: uint32((1 << 21) - 1),
            maxBandTicks: 2001,
            bandBps: 100,
            feeBps: 2,
            maxFeeBps: 10,
            shards: 4,
            permissioned: false,
            strictAfterClose: false
        });
    }

    /// Funds `who`'s venue account via depositFor (works for any account, incl. passkey / contract accounts).
    function _fund(address who) internal {
        nvda.mint(address(this), 100e18);
        ausd.mint(address(this), 100_000e6);
        nvda.approve(address(ex), type(uint256).max);
        ausd.approve(address(ex), type(uint256).max);
        ex.depositFor(who, address(nvda), 100e18);
        ex.depositFor(who, address(ausd), 100_000e6);
    }

    function _order(address account, uint256 marketId, uint8 side, uint32 tick, uint96 qty, uint256 nonce)
        internal
        view
        returns (OrderGateway.Order memory)
    {
        // vm.getBlockTimestamp(): under via-IR, block.timestamp may be cached across vm.warp within a test
        return OrderGateway.Order(account, marketId, side, tick, qty, 0, nonce, uint64(vm.getBlockTimestamp() + 60));
    }

    function _ecdsa(uint256 pk, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _sigAccount(uint256 pk, bytes32 digest) internal pure returns (bytes memory) {
        return abi.encode(uint8(0), _ecdsa(pk, digest));
    }

    function _sigSession(uint256 pk, bytes32 digest) internal pure returns (bytes memory) {
        return abi.encode(uint8(1), abi.encode(vm.addr(pk), _ecdsa(pk, digest)));
    }

    /// A real WebAuthn "get" assertion over `digest`, as a browser authenticator would produce it.
    function _sigPasskey(uint256 pk, bytes32 digest) internal pure returns (bytes memory) {
        bytes memory authData = abi.encodePacked(sha256("unison.trade"), bytes1(0x05), uint32(1)); // UP|UV
        string memory cd = string.concat(
            '{"type":"webauthn.get","challenge":"',
            Base64.encodeURL(abi.encodePacked(digest)),
            '","origin":"https://unison.trade","crossOrigin":false}'
        );
        bytes32 h = sha256(abi.encodePacked(authData, sha256(bytes(cd))));
        (bytes32 r, bytes32 s) = vm.signP256(pk, h);
        if (uint256(s) > P256_N / 2) s = bytes32(P256_N - uint256(s));
        return abi.encode(uint8(2), abi.encode(WebAuthn.Assertion(authData, cd, 23, 1, r, s)));
    }

    function test_eoaSignedOrder_relayed_andReplayBlocked() public {
        OrderGateway.Order memory o = _order(alice, mkt, 0, 17_990, 1e18, 1);
        bytes memory sig = _sigAccount(ALICE_PK, gw.orderDigest(o));
        vm.prank(relayer);
        uint256 slot = gw.place(o, sig);
        assertEq(ex.orderOf(alice, slot).qty, 1e18, "order belongs to alice, relayer paid gas");
        vm.prank(relayer);
        vm.expectRevert(OrderGateway.NonceUsed.selector);
        gw.place(o, sig);
        // tampered quantity
        o.nonce = 2;
        bytes memory sig2 = _sigAccount(ALICE_PK, gw.orderDigest(o));
        o.qty = 2e18;
        vm.expectRevert(OrderGateway.BadSignature.selector);
        gw.place(o, sig2);
    }

    function test_agentSessionKey_tradesWithinCaps_cannotWithdraw() public {
        address agent = vm.addr(AGENT_PK);
        vm.prank(alice);
        gw.grantSession(agent, uint64(block.timestamp + 1 hours), 2e18, 400e6, 1 << mkt);

        OrderGateway.Order memory ok = _order(alice, mkt, 0, 17_990, 2e18, 10); // $359.80 ≤ $400
        gw.place(ok, _sigSession(AGENT_PK, gw.orderDigest(ok)));

        OrderGateway.Order memory big = _order(alice, mkt, 0, 17_990, 3e18, 11);
        bytes memory s1 = _sigSession(AGENT_PK, gw.orderDigest(big));
        vm.expectRevert(OrderGateway.SessionCap.selector);
        gw.place(big, s1);

        OrderGateway.Order memory pricey = _order(alice, mkt, 0, 21_000, 2e18, 12); // $420 > $400
        bytes memory s2 = _sigSession(AGENT_PK, gw.orderDigest(pricey));
        vm.expectRevert(OrderGateway.SessionCap.selector);
        gw.place(pricey, s2);

        OrderGateway.Order memory other = _order(alice, mkt2, 0, 17_990, 1e18, 13);
        bytes memory s3 = _sigSession(AGENT_PK, gw.orderDigest(other));
        vm.expectRevert(OrderGateway.SessionCap.selector);
        gw.place(other, s3);

        // an agent can never move funds out
        OrderGateway.Withdraw memory w =
            OrderGateway.Withdraw(alice, address(ausd), 1e6, vm.addr(AGENT_PK), 14, uint64(block.timestamp + 60));
        bytes32 wd = _withdrawDigest(w);
        bytes memory ws = _sigSession(AGENT_PK, wd);
        vm.expectRevert(OrderGateway.SessionNotAllowed.selector);
        gw.withdraw(w, ws);

        vm.warp(vm.getBlockTimestamp() + 2 hours);
        OrderGateway.Order memory late = _order(alice, mkt, 0, 17_990, 1e18, 15);
        bytes memory s4 = _sigSession(AGENT_PK, gw.orderDigest(late));
        vm.expectRevert(OrderGateway.SessionExpired.selector);
        gw.place(late, s4);
    }

    function _withdrawDigest(OrderGateway.Withdraw memory w) internal view returns (bytes32) {
        bytes32 structHash =
            keccak256(abi.encode(gw.WITHDRAW_TYPEHASH(), w.account, w.token, w.amount, w.to, w.nonce, w.deadline));
        (, string memory name, string memory version, uint256 chainId, address verifying,,) = gw.eip712Domain();
        bytes32 domain = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes(name)),
                keccak256(bytes(version)),
                chainId,
                verifying
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", domain, structHash));
    }

    function test_erc1271SmartWallet() public {
        MockSmartWallet wallet = new MockSmartWallet(vm.addr(OWNER_PK));
        _fund(address(wallet));
        OrderGateway.Order memory o = _order(address(wallet), mkt, 1, 18_010, 1e18, 1);
        uint256 slot = gw.place(o, _sigAccount(OWNER_PK, gw.orderDigest(o)));
        assertEq(ex.orderOf(address(wallet), slot).side, 1);
    }

    function test_passkeyAccount_tradesAndWithdraws() public {
        (uint256 qx, uint256 qy) = vm.publicKeyP256(PASSKEY_PK);
        address acct = gw.registerPasskey(bytes32(qx), bytes32(qy));
        assertEq(acct, gw.passkeyAccount(bytes32(qx), bytes32(qy)));
        _fund(acct);

        // buy with a passkey signature, cross with alice, clear
        OrderGateway.Order memory o = _order(acct, mkt, 0, 18_020, 2e18, 1);
        gw.place(o, _sigPasskey(PASSKEY_PK, gw.orderDigest(o)));
        OrderGateway.Order memory a = _order(alice, mkt, 1, 17_980, 2e18, 1);
        gw.place(a, _sigAccount(ALICE_PK, gw.orderDigest(a)));
        vm.roll(block.number + 1);
        vm.warp(block.timestamp + 1);
        ref.post(mkt, 180e6, block.timestamp * 1000, IReferenceAdapter.Status.OPEN);
        (, uint256 vol) = ex.clear(mkt, "");
        assertEq(vol, 2e18);
        uint256[] memory sl = new uint256[](1);
        ex.claim(acct, sl);
        assertEq(ex.balanceOf(acct, address(nvda)), 102e18, "passkey account received the fill");

        // withdraw to a wallet, authorized by a fresh passkey assertion
        address dest = makeAddr("coldWallet");
        OrderGateway.Withdraw memory w =
            OrderGateway.Withdraw(acct, address(nvda), 2e18, dest, 2, uint64(block.timestamp + 60));
        gw.withdraw(w, _sigPasskey(PASSKEY_PK, _withdrawDigest(w)));
        assertEq(nvda.balanceOf(dest), 2e18);

        // a different passkey cannot act for this account
        OrderGateway.Order memory forged = _order(acct, mkt, 0, 18_000, 1e18, 3);
        bytes memory fs = _sigPasskey(0xDEAD, gw.orderDigest(forged));
        vm.expectRevert(OrderGateway.BadSignature.selector);
        gw.place(forged, fs);
    }

    function test_onlyGatewayActsForAccounts_andBatchSkipsBadOrders() public {
        vm.prank(relayer);
        vm.expectRevert();
        ex.placeOrderFor(alice, mkt, 0, 17_990, 1e18, 0);

        OrderGateway.Order[] memory os = new OrderGateway.Order[](3);
        bytes[] memory sigs = new bytes[](3);
        os[0] = _order(alice, mkt, 0, 17_990, 1e18, 21);
        os[1] = _order(alice, mkt, 0, 17_991, 1e18, 22);
        os[2] = _order(alice, mkt, 0, 17_992, 1e18, 23);
        sigs[0] = _sigAccount(ALICE_PK, gw.orderDigest(os[0]));
        sigs[1] = _sigAccount(AGENT_PK, gw.orderDigest(os[1])); // wrong signer
        sigs[2] = _sigAccount(ALICE_PK, gw.orderDigest(os[2]));
        uint256[] memory slots = gw.placeBatch(os, sigs);
        assertTrue(slots[0] != type(uint256).max);
        assertEq(slots[1], type(uint256).max, "bad signature skipped");
        assertTrue(slots[2] != type(uint256).max);
    }
}

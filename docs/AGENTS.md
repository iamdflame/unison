# Unison for AI agents

Trading agents are a first-class audience. Unison gives them three properties that continuous venues can't:

1. **Speed buys no better price.** Every order in a 300 ms batch gets the same price. An agent competes on judgement, not latency. (The forming batch is public, so a fast agent can still react to it before it closes; it cannot get a better price than anyone else in it.)
2. **Bounded authority.** A human hands an agent a session key with caps, not their keys:
   - markets allowed (a bitmask);
   - maximum quantity per order;
   - maximum notional per order;
   - expiry.

   Session keys can place and cancel orders. They can never withdraw.
3. **Gasless.** The agent signs EIP-712 orders and a relayer submits them.

## Grant a session key (the human, once)

```ts
import { orderGatewayAbi } from "@unison/sdk";

await wallet.writeContract({
  address: deployment.gateway,
  abi: orderGatewayAbi,
  functionName: "grantSession",
  // key, expiry (unix s), maxQty (base units), maxNotional (quote units), marketMask
  args: [agentAddress, BigInt(now + 86_400), 5n * 10n ** 18n, 2_000_000_000n, 1n << 0n],
});
```

Passkey or ERC-1271 accounts can sign the grant instead with `grantSessionSigned`.

## Trade (the agent, forever after, without gas)

```ts
import { buildOrder, signAsSession, orderToJson, Side, tickOfPrice } from "@unison/sdk";

const order = buildOrder({
  account: humanAddress, // the account being traded for
  marketId: 0n,
  side: Side.BID,
  tick: tickOfPrice(180_250_000n, 10_000n), // $180.25
  qty: 10n ** 18n,
  ttlSeconds: 60,
});
const sig = await signAsSession(agentKey, chainId, deployment.gateway, order);
await fetch(`${RELAYER}/v1/orders`, { method: "POST", body: JSON.stringify(orderToJson(order, sig)) });
```

The relayer checks every order with `eth_call` before spending gas, and rejects any that break a cap. The gateway enforces the caps again on-chain.

## Read the market

| Need | Call |
|---|---|
| Live reference, regime, band | `client.market(id)`, `client.regime(id)`, `client.previewBand(id, ref, status)` |
| Depth ladder | `client.depth(id, side, lo, hi)` |
| Your fills | `client.previewOrder(account, slot)` |
| The tape | `client.watchBatches(id, cb)` (one uniform print per auction) |
| What would happen if the auction ran now | `client.simulateClearUpTo(id, upTo, payload)`, or `@unison/engine` locally (bit-exact) |

## MCP server

`services/mcp` exposes the same capabilities as Model Context Protocol tools: `markets`, `market`, `depth`, `tape`, `place_order` and `cancel_order` (session-key signed, relayed), `order_status`, `my_orders`, `vault`.

Any MCP-capable agent can trade Unison within the caps its human granted:

```jsonc
// e.g. claude_desktop_config.json
{ "mcpServers": { "unison": { "command": "node", "args": ["--conditions=development", "services/mcp/src/main.ts"],
  "env": { "DEPLOYMENT": "deployments/31337.json", "AGENT_PRIVATE_KEY": "0x…", "AGENT_ACCOUNT": "0x…" } } } }
```

For the live networks, point `DEPLOYMENT` at `deployments/monad-testnet.json` (test funds) or `deployments/monad-mainnet.json` (real assets: aNVDA and WMON, inside the caps the human granted), with `RPC_URL` and the matching relayer ([API](API.md)). Mainnet has no faucet: the human funds the account from a wallet first.

## Why this is safe

- **Caps are enforced in the contract**, not only off-chain (`OrderGateway._checkSessionCaps`).
- **Session keys can't move funds:** `withdraw` rejects them with `SessionNotAllowed`.
- **Revocation is immediate:** `grantSession(key, 0, …)` revokes. Nonces are single-use, and deadlines bound how long a stale signed order lives.

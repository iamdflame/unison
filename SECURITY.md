# Security

Unison runs on Monad mainnet with real assets. If you find a vulnerability, please report it privately, so it can be fixed before anyone is hurt.

## Reporting

Use GitHub's private vulnerability reporting on this repository: **Security → Report a vulnerability** (https://github.com/iamdflame/unison/security/advisories/new). Please don't open a public issue or pull request, or post about it, until it is fixed.

Say what you found, how to reproduce it, and the impact you expect. A Foundry test against a mainnet fork is the clearest proof ([`contracts/test/fork`](contracts/test/fork) shows how). We'll acknowledge the report and keep you updated until it's fixed, and with your agreement we'll credit you in the advisory.

## In scope

- The contracts on Monad mainnet ([every address](docs/evidence/mainnet.md)): the exchange and its implementation, the gateway, `ChainlinkCausalReference`, `ChainlinkReference`, the vaults, the eligibility contracts and the standing challenge.
- The services that operate them (keeper, relayer, tape, the house adversary) and the web app at https://www.unisonfi.com.
- [`mm-plugin-unison`](integrations/agent-wallet-plugin) and the SDK.

## What happens next

- The guardian key can pause the exchange or halt a market at once while a fix is prepared. A halt moves no funds: the next auction trades nothing and returns every waiting order.
- Contract fixes ship as an upgrade. Until the admin roles move behind the public timelock (48 h, rising to 7 days), the team can ship one directly; after that, every upgrade waits in public first.

## Not a vulnerability

- Trading profitably against the rule is the [standing challenge](https://www.unisonfi.com/challenge). It pays its pot to anyone who beats the rule under its published definition: claim it on chain.
- The testnet and its faucet hold no real value.

The threat model is in [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md).

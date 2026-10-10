# Security

Unison runs on Monad mainnet with real assets. If you find a vulnerability, please report it privately, so it can be fixed before anyone is hurt.

## Reporting

Use GitHub's private vulnerability reporting on this repository: **Security → Report a vulnerability** (https://github.com/iamdflame/unison/security/advisories/new). Please don't open a public issue or pull request, or post about it, until it is fixed.

Say what you found, how to reproduce it, and the impact you expect. A Foundry test against a mainnet fork is the clearest proof ([`contracts/test/fork`](contracts/test/fork) shows how). We'll acknowledge the report and keep you updated until it's fixed, and with your agreement we'll credit you in the advisory.

## In scope

- The contracts on Monad mainnet ([every address](docs/evidence/mainnet.md)): the exchange and its implementation, the gateway, `ChainlinkCausalReference`, `ChainlinkReference`, the vaults, the eligibility contracts and the standing challenge.
- The services that operate them (keeper, relayer, tape, the house adversary) and the web app at https://www.unisonfi.com.
- [`mm-plugin-unison`](integrations/agent-wallet-plugin) and the SDK.

## What's at risk today

- The contracts are not yet externally audited.
- The vaults hold about $65 in all, the challenge pots 19 AUSD, and daily caps bound each market (1 aNVDA, 20,000 WMON a day).
- One deployer key holds the admin roles. What it can do is listed in the [threat model](docs/THREAT_MODEL.md#what-the-admin-can-do).

## How the code is checked

- **Tests:** unit, fuzz and invariant tests, plus a differential fuzz of the clearing against its TypeScript twin.
- **Mainnet rehearsals:** every upgrade and handover runs first in CI, against live Monad state at the current block (`contracts/test/fork`).
- **Static analysis:** Slither and Aderyn run on every change, and each finding has a written verdict ([static analysis](docs/evidence/static-analysis.md)).
- **Symbolic proofs:** Halmos proves the clearing's price and fill properties for every input of two shapes ([proofs](docs/evidence/proofs.md)).

None of this replaces an outside audit, which hasn't happened yet.

## What happens next

- The guardian key can pause the exchange or halt a market at once while a fix is prepared. Neither moves funds. Since exchange v3 (10 October 2026), both return every waiting order at once, with no oracle read.
- Contract fixes ship as an upgrade. Until the admin roles move behind the timelock (7 days, proposed by a Safe with outside signers), the team can ship one directly; after that, every upgrade waits in public for a week first.

## Not a vulnerability

- Trading profitably against the rule is the [standing challenge](https://www.unisonfi.com/challenge). It pays its pot to anyone who beats the rule under its published definition: claim it on chain.
- The testnet and its faucet hold no real value.

The threat model is in [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md).

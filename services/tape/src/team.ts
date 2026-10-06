import type { Deployment } from "@unison/sdk";

/**
 * The accounts whose fills are the venue's own, counted apart from outside traders in GET /v1/stats:
 * - the deployment's named accounts;
 * - its house adversary, the sniper in the standing challenge, and the challenge accounts it trades through;
 * - TEAM_ACCOUNTS (comma-separated): the team's trading accounts.
 * Lowercased and deduplicated.
 */
export function teamAccounts(deployment: Pick<Deployment, "accounts" | "adversary">, raw: string | undefined): string[] {
  const list = [
    ...Object.values(deployment.accounts ?? {}),
    ...(deployment.adversary ? [deployment.adversary.address, ...deployment.adversary.accounts] : []),
    ...(raw ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  ];
  return [...new Set(list.map((a) => a.toLowerCase()))];
}

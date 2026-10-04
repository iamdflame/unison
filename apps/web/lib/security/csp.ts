/**
 * The Content-Security-Policy, assembled at build time from the network this build talks to: the page may load
 * only its own scripts, styles, fonts and images, and may connect only to its own origin, the tape, the relayer,
 * the reference relay and the chain's RPC. Anything injected can't phone home.
 *
 * Next's inline bootstrap scripts (and the pre-paint theme script) need 'unsafe-inline' for scripts on statically
 * rendered pages; nonces would force every page to render per request. The connect-src allowlist, frame-ancestors
 * and object-src carry the weight.
 */
const MONAD_RPC = ["https://rpc.monad.xyz", "wss://rpc.monad.xyz", "https://testnet-rpc.monad.xyz", "wss://testnet-rpc.monad.xyz"];

const origin = (u: string | undefined): string | null => {
  if (!u) return null;
  try {
    const url = new URL(u);
    return `${url.protocol}//${url.host}`;
  } catch {
    return null;
  }
};

export function contentSecurityPolicy(env: Record<string, string | undefined>, dev: boolean): string {
  const connect = new Set<string>(["'self'", ...MONAD_RPC]);
  for (const key of ["NEXT_PUBLIC_TAPE_URL", "NEXT_PUBLIC_RELAYER_URL", "NEXT_PUBLIC_RELAY_URL", "NEXT_PUBLIC_RPC_URL", "NEXT_PUBLIC_RPC_WS_URL"]) {
    const o = origin(env[key]);
    if (o) connect.add(o);
  }
  if (dev) connect.add("ws:");
  const directives: [string, string[]][] = [
    ["default-src", ["'self'"]],
    ["script-src", ["'self'", "'unsafe-inline'", ...(dev ? ["'unsafe-eval'"] : [])]],
    ["style-src", ["'self'", "'unsafe-inline'"]],
    ["img-src", ["'self'", "data:", "blob:"]],
    ["font-src", ["'self'", "data:"]],
    ["connect-src", [...connect]],
    ["worker-src", ["'self'", "blob:"]],
    ["manifest-src", ["'self'"]],
    ["frame-ancestors", ["'none'"]],
    ["object-src", ["'none'"]],
    ["base-uri", ["'self'"]],
    ["form-action", ["'self'"]],
  ];
  const policy = directives.map(([k, v]) => `${k} ${v.join(" ")}`);
  if (!dev) policy.push("upgrade-insecure-requests");
  return policy.join("; ");
}

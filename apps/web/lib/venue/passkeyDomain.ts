/**
 * Which domain a passkey belongs to (its WebAuthn RP ID). The site answers on more than one (www.unisonfi.com and its
 * vercel.app alias), and a passkey made for one is invisible on another unless the domains are related: every new
 * passkey is made for NEXT_PUBLIC_PASSKEY_RP_ID, and the other domains reach it as related origins, listed in
 * /.well-known/webauthn. Passkeys made before that (NEXT_PUBLIC_PASSKEY_LEGACY_RP_IDS, made for the vercel.app alias)
 * stay usable the same way. On localhost and preview hosts, a passkey belongs to the page's own host.
 */
const local = () => /^(localhost|127\.0\.0\.1)$/.test(globalThis.location?.hostname ?? "");

/** The domain new passkeys are made for, and sign-in asks first. */
export const passkeyRpId = (): string => (!local() && process.env.NEXT_PUBLIC_PASSKEY_RP_ID) || globalThis.location.hostname;

/** Domains older passkeys were made for, other than the current one: a second way to sign in. */
export const legacyRpIds = (): string[] =>
  local()
    ? []
    : (process.env.NEXT_PUBLIC_PASSKEY_LEGACY_RP_IDS ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s && s !== passkeyRpId());

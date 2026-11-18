// @ts-check
/**
 * Config plugin: let the iOS app use passkeys for the web's host (plan 2026-11-18, Task 6).
 *
 * A passkey belongs to the web host (`orrn.in`), the relying party the server names. iOS lets an app
 * use it only with the associated domain `webcredentials:<host>` in its entitlements, and only after
 * the host lists the app in `/.well-known/apple-app-site-association` (apps/web/scripts/well-known.ts).
 * The host is `ORRN_PASSKEY_RP_ID` at prebuild time, `orrn.in` when unset (a dev build against
 * dev.orrn.app sets it). Android needs no entitlement: `assetlinks.json` on the host is enough.
 * Rebuild after changing it (a new development build, not an OTA update).
 * Tests: __tests__/passkey.test.ts.
 */
const { createRunOncePlugin, withEntitlementsPlist } = require("expo/config-plugins");

const KEY = "com.apple.developer.associated-domains";
const DEFAULT_RP_ID = "orrn.in";

/** @param {Record<string, string | undefined>} env */
function passkeyDomain(env) {
  const rpId = (env.ORRN_PASSKEY_RP_ID ?? "").trim() || DEFAULT_RP_ID;
  return `webcredentials:${rpId}`;
}

/**
 * @param {Record<string, unknown>} entitlements
 * @param {string} domain
 */
function addPasskeyDomain(entitlements, domain) {
  const current = Array.isArray(entitlements[KEY]) ? /** @type {string[]} */ (entitlements[KEY]) : [];
  return { ...entitlements, [KEY]: current.includes(domain) ? current : [...current, domain] };
}

/** @type {import("expo/config-plugins").ConfigPlugin} */
const withPasskeyDomains = (config) =>
  withEntitlementsPlist(config, (cfg) => {
    cfg.modResults = /** @type {any} */ (addPasskeyDomain(cfg.modResults, passkeyDomain(process.env)));
    return cfg;
  });

module.exports = createRunOncePlugin(withPasskeyDomains, "with-passkey-domains", "1.0.0");
module.exports.passkeyDomain = passkeyDomain;
module.exports.addPasskeyDomain = addPasskeyDomain;

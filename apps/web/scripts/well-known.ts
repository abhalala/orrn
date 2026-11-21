import type { Plugin } from "vite";

/**
 * Passkey domain association files (plan 2026-11-18, Task 6). The iPhone and Android apps (`in.orrn.app`)
 * may use passkeys for the web's host only when the host lists them:
 * - `/.well-known/apple-app-site-association`: `webcredentials` with `<Apple Team ID>.in.orrn.app`;
 * - `/.well-known/assetlinks.json`: `delegate_permission/common.get_login_creds` for the Android
 *   package with the release signing certificate's SHA-256.
 * Each file is written only when its value is set (`ORRN_APPLE_TEAM_ID`, `ORRN_ANDROID_CERT_SHA256`,
 * build-time env from the deploy); without it the app hides its passkey button and nothing else
 * changes. A value that is set but malformed fails the build. The web Worker serves both as
 * `application/json` (packages/server/src/infra/webEdge.ts). Tested in scripts/well-known.test.ts.
 *
 * No imports beyond types: vite.config.ts bundles this file, and workspace packages would need a newer Node.
 */

const APP_ID = "in.orrn.app";
const AASA = ".well-known/apple-app-site-association";
const ASSET_LINKS = ".well-known/assetlinks.json";

type WellKnownEnv = { ORRN_APPLE_TEAM_ID?: string; ORRN_ANDROID_CERT_SHA256?: string };

/** `AB:CD:...` upper case, the form Android compares; throws on anything that is not 32 bytes of hex. */
function certFingerprint(raw: string): string {
  const hex = raw.replaceAll(":", "");
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error("ORRN_ANDROID_CERT_SHA256 must be the release certificate's SHA-256: 64 hex digits, colons optional.");
  }
  return hex.toUpperCase().match(/../g)!.join(":");
}

/** The files to write, by path under `dist`. Empty when neither value is set. */
export function wellKnownFiles(env: WellKnownEnv): Record<string, string> {
  const files: Record<string, string> = {};
  const team = env.ORRN_APPLE_TEAM_ID?.trim();
  if (team) {
    if (!/^[A-Z0-9]{10}$/.test(team)) throw new Error("ORRN_APPLE_TEAM_ID must be the 10-character Apple Developer Team ID.");
    files[AASA] = JSON.stringify({ webcredentials: { apps: [`${team}.${APP_ID}`] } });
  }
  const cert = env.ORRN_ANDROID_CERT_SHA256?.trim();
  if (cert) {
    files[ASSET_LINKS] = JSON.stringify([
      {
        relation: ["delegate_permission/common.get_login_creds"],
        target: { namespace: "android_app", package_name: APP_ID, sha256_cert_fingerprints: [certFingerprint(cert)] },
      },
    ]);
  }
  return files;
}

/** Writes the files into the build output. Alchemy's deploy runs a bare `vite build`, so this lives in the Vite config, not a package script. */
export function wellKnownPlugin(env: WellKnownEnv = process.env): Plugin {
  return {
    name: "orrn-well-known",
    apply: "build",
    generateBundle() {
      for (const [fileName, source] of Object.entries(wellKnownFiles(env))) {
        this.emitFile({ type: "asset", fileName, source });
      }
    },
  };
}

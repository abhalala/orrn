/**
 * The passkey relying party for a stage. A passkey belongs to the WEB app's host (`orrn.in`,
 * `dev.orrn.app`, `localhost`), never the API host, so one passkey works on every page of the
 * site and the apps that prove they belong to it. Only these origins may answer a challenge.
 * Tested in packages/server/test/auth-passkey.test.ts.
 */
export type PasskeyConfig = { rpID: string; rpName: "ORRN"; origin: string[] };

export function passkeyConfigFor(webUrl: string, androidApkKeyHash?: string): PasskeyConfig {
  const url = new URL(webUrl);
  const origin = [url.origin];
  if (androidApkKeyHash) origin.push(`android:apk-key-hash:${androidApkKeyHash}`);
  return { rpID: url.hostname, rpName: "ORRN", origin };
}

/**
 * The Android passkey origin's hash from the release signing certificate's SHA-256 (the value
 * `assetlinks.json` lists, hex, colons optional): base64url of those 32 bytes, no padding. Lets the
 * deploy take one owner value (`ORRN_ANDROID_CERT_SHA256`) for both. Undefined for a blank or
 * malformed value. Tested in packages/server/test/passkey-association.test.ts.
 */
export function apkKeyHashFromCertSha256(certSha256: string | undefined): string | undefined {
  const hex = (certSha256 ?? "").trim().replaceAll(":", "");
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) return undefined;
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i += 1) bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

type PasskeyEnv = { WEB_PUBLIC_URL?: string; CORS_ORIGIN?: string; ANDROID_APK_KEY_HASH?: string };

/** True for an `http:` or `https:` URL with a host. `new URL("localhost:3001")` parses, as scheme `localhost:`. */
function isWebUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return (url.protocol === "http:" || url.protocol === "https:") && url.hostname !== "";
  } catch {
    return false;
  }
}

/**
 * The stage's config, from the web URL `@orrn/server` `lib/webUrl.ts` reads (`WEB_PUBLIC_URL`, else
 * `CORS_ORIGIN`). A stage with neither, or with one that is not an http(s) URL with a host, fails
 * closed: no origin is allowed, so no passkey registers or signs in. The plugin never sees a null
 * origin, which would make it trust the request's own `Origin` header.
 */
export function passkeyConfigForEnv(environment: PasskeyEnv): PasskeyConfig {
  const webUrl = environment.WEB_PUBLIC_URL ?? environment.CORS_ORIGIN;
  if (webUrl && isWebUrl(webUrl)) return passkeyConfigFor(webUrl, environment.ANDROID_APK_KEY_HASH);
  return { rpID: "localhost", rpName: "ORRN", origin: [] };
}

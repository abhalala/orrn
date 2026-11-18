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

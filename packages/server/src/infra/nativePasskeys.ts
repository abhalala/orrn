import { apkKeyHashFromCertSha256 } from "@orrn/auth/passkey-config";

/**
 * Which native passkey values a deploy binds on the server Worker (plan 2026-11-18, Task 6). The
 * Worker's `auth.methods.native` turns each app's passkey button on, so a value is bound only when the
 * web build will also write that app's association file from the same owner value; otherwise the app
 * would show a button the OS refuses.
 * - iOS: `ORRN_APPLE_TEAM_ID`, the value `apple-app-site-association` is written from.
 * - Android: `ANDROID_APK_KEY_HASH` (the passkey origin `android:apk-key-hash:<hash>`) only when
 *   `ORRN_ANDROID_CERT_SHA256` (what `assetlinks.json` lists) is set and valid: derived from it, or the
 *   given hash when it agrees. A hash with no certificate, or one that disagrees, is not bound.
 * Warnings never carry a value. Tested in test/passkey-association.test.ts.
 */
export function nativePasskeyBindings(env: Record<string, string | undefined>): { appleTeamId?: string; androidApkKeyHash?: string; warnings: string[] } {
  const warnings: string[] = [];
  const appleTeamId = env.ORRN_APPLE_TEAM_ID?.trim() || undefined;
  const cert = env.ORRN_ANDROID_CERT_SHA256?.trim() ?? "";
  const given = env.ANDROID_APK_KEY_HASH?.trim() ?? "";
  const derived = apkKeyHashFromCertSha256(cert);
  let androidApkKeyHash: string | undefined;
  if (!cert) {
    if (given) warnings.push("ANDROID_APK_KEY_HASH is set without ORRN_ANDROID_CERT_SHA256; Android passkeys stay off until the certificate is set.");
  } else if (!derived) {
    warnings.push("ORRN_ANDROID_CERT_SHA256 is not a SHA-256 fingerprint (64 hex digits); Android passkeys stay off and the web build will refuse it.");
  } else if (given && given !== derived) {
    warnings.push("ANDROID_APK_KEY_HASH does not match ORRN_ANDROID_CERT_SHA256; Android passkeys stay off until they agree.");
  } else {
    androidApkKeyHash = derived;
  }
  return { appleTeamId, androidApkKeyHash, warnings };
}

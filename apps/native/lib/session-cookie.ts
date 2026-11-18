/**
 * Whether a cookie header (the Expo client's `getCookie()`, expired entries already dropped) carries a
 * Better Auth session. A cancelled passkey or Google attempt leaves a short-lived challenge or state
 * cookie in the jar; that is not a sign-in, so the phone must not treat it as one (a cold start offline
 * would show the offline screen instead of sign-in). No React Native imports, so bun tests it.
 */
export function hasSessionCookie(cookieHeader: string): boolean {
  return cookieHeader
    .split(";")
    .map((part) => part.trim().split("=")[0] ?? "")
    .some((name) => name.endsWith("session_token"));
}

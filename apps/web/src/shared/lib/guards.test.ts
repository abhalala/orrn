import { describe, expect, mock, test } from "bun:test";
import type { QueryClient } from "@tanstack/react-query";

import type { Me } from "./me";

// The real trpc module validates the Vite env at import; the guards only need the `auth.me` key.
// `trpcClient` is an empty stand-in. Bun keeps this mock for the other test files of the same run, and
// the ingest lib imports that name, so leaving it out broke them with "Export named not found".
mock.module("../utils/trpc", () => ({
  trpcClient: {},
  trpc: { auth: { me: { queryOptions: () => ({ queryKey: ["auth.me"], queryFn: async () => null }) } } },
  // Bun keeps a module mock for the whole run; a screen test that loads components needs the client's name to exist.
  trpcClient: {},
}));
const { requireCompanyMe, requirePlatformAdmin, requireSession } = await import("./guards");

function meWith(user: Record<string, unknown>, over: Record<string, unknown> = {}): Me {
  return {
    user: { id: "u1", name: "U", email: "u@orrn.local", onboardingCompleted: true, mustChangePassword: false, hasPassword: true, ...user },
    company: { id: "c1", name: "Co", slug: "co", status: "active", plan: "growth", role: "owner" },
    isPlatformAdmin: true,
    platformRole: "owner",
    impersonation: null,
    ...over,
  } as unknown as Me;
}

/** A query client whose `auth.me` is already cached, so `loadMe` answers from it. */
function clientWith(me: Me): QueryClient {
  return {
    getQueryData: () => me,
    ensureQueryData: async () => me,
    fetchQuery: async () => me,
  } as unknown as QueryClient;
}

async function redirectTarget(run: () => Promise<unknown>): Promise<string | null> {
  try {
    await run();
    return null;
  } catch (thrown) {
    const to = (thrown as { options?: { to?: string } }).options?.to;
    return to ?? "other-throw";
  }
}

const args = (me: Me) => ({ context: { queryClient: clientWith(me) }, location: { href: "/today" } });

describe("guards send an account with no password to /welcome", () => {
  // An already set-up account (old flow) with no credential password: without
  // this redirect it uses the app until the session ends and is then locked out.
  const noPassword = meWith({ hasPassword: false, onboardingCompleted: true });

  test("requireCompanyMe", async () => {
    expect(await redirectTarget(() => requireCompanyMe(args(noPassword)))).toBe("/welcome");
  });

  test("requireSession", async () => {
    expect(await redirectTarget(() => requireSession(args(noPassword)))).toBe("/welcome");
  });

  test("requirePlatformAdmin", async () => {
    expect(await redirectTarget(() => requirePlatformAdmin(args(noPassword)))).toBe("/welcome");
  });

  test("an account with a password passes all three", async () => {
    const ok = meWith({ hasPassword: true });
    expect(await redirectTarget(() => requireCompanyMe(args(ok)))).toBeNull();
    expect(await redirectTarget(() => requireSession(args(ok)))).toBeNull();
    expect(await redirectTarget(() => requirePlatformAdmin(args(ok)))).toBeNull();
  });
});

describe("requireCompanyMe: entering a plant (plan 2026-11-18, Task 9)", () => {
  const plant = (company: Record<string, unknown>) => ({
    company: { id: "c1", name: "Co", slug: "co", status: "active", plan: "growth", role: "packer", ...company },
  });

  test("a plant that requires secure sign-in, without a strong method: /welcome", async () => {
    const me = meWith({}, plant({ requireStrongSignIn: true, setupPending: false }));
    expect(await redirectTarget(() => requireCompanyMe(args(me)))).toBe("/welcome");
  });

  test("with a passkey, Google or the authenticator app: in", async () => {
    for (const strong of [{ hasPasskey: true }, { hasGoogle: true }, { twoFactorEnabled: true }]) {
      const me = meWith(strong, plant({ requireStrongSignIn: true, setupPending: false }));
      expect(await redirectTarget(() => requireCompanyMe(args(me)))).toBeNull();
    }
  });

  test("not when impersonating", async () => {
    const grant = { actorUserId: "u1", companyId: "c1", grantId: "g1", expiresAt: "2099-01-01T00:00:00.000Z" };
    const me = meWith({ onboardingCompleted: false }, { ...plant({ requireStrongSignIn: true, setupPending: true }), impersonation: grant });
    expect(await redirectTarget(() => requireCompanyMe(args(me)))).toBeNull();
  });

  test("a plant whose setup is pending for the person: /welcome, whatever the user flag says", async () => {
    expect(await redirectTarget(() => requireCompanyMe(args(meWith({ onboardingCompleted: true }, plant({ setupPending: true })))))).toBe("/welcome");
    expect(await redirectTarget(() => requireCompanyMe(args(meWith({ onboardingCompleted: false }, plant({ setupPending: false })))))).toBeNull();
  });
});

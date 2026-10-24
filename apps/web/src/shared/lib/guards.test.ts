import { describe, expect, mock, test } from "bun:test";
import type { QueryClient } from "@tanstack/react-query";

import type { Me } from "./me";

// The real trpc module validates the Vite env at import; the guards only need the `auth.me` key.
mock.module("../utils/trpc", () => ({
  trpc: { auth: { me: { queryOptions: () => ({ queryKey: ["auth.me"], queryFn: async () => null }) } } },
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

import { expect, type APIRequestContext, type Browser } from "@playwright/test";

import { localPassword } from "./accounts";
import { API_URL as API, WEB_ORIGIN as ORIGIN } from "./ports";

/**
 * Front-door fixtures that need what only an email carries (an invite token,
 * a magic link). The local API hands them over through dev-only hooks beside
 * /dev/seed (apps/server/src/dev-front-door.ts).
 */

export function uniqueEmail(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}@orrn.local`;
}

export type InviteRole = "owner" | "admin" | "manager" | "operator" | "packer" | "viewer";

/**
 * An invite (sent by the seeded owner) into a fresh company, so a test never
 * changes the shared demo company. Returns the invite page path and the company name.
 */
export async function devInvite(
  request: APIRequestContext,
  input: { email: string; role: InviteRole; expired?: boolean; companyName?: string },
) {
  const res = await request.post(`${API}/dev/invite`, { data: input });
  expect(res.ok(), `/dev/invite returned ${res.status()}: ${await res.text()}`).toBe(true);
  return (await res.json()) as { path: string; companyName: string };
}

/**
 * A waitlist-approved plant owner, made the real way: request access (public),
 * Godseye approves (seeded super admin), then the emailed magic link.
 * Returns the owner's email and the link.
 */
export async function approvedOwnerMagicLink(browser: Browser, companyName: string) {
  const email = uniqueEmail("owner");
  const ctx = await browser.newContext();
  try {
    const submit = await ctx.request.post(`${API}/trpc/waitlist.submit`, {
      headers: { origin: ORIGIN },
      data: { companyName, requesterName: "Mehul Vaghasiya", requesterEmail: email },
    });
    expect(submit.ok(), `waitlist.submit returned ${submit.status()}: ${await submit.text()}`).toBe(true);
    const { id } = ((await submit.json()) as { result: { data: { id: string } } }).result.data;

    const signIn = await ctx.request.post(`${API}/api/auth/sign-in/email`, {
      headers: { origin: ORIGIN },
      data: { email: "staff@orrn.local", password: localPassword() },
    });
    expect(signIn.ok(), `staff sign-in returned ${signIn.status()}`).toBe(true);
    const approve = await ctx.request.post(`${API}/trpc/platform.waitlistApprove`, {
      headers: { origin: ORIGIN },
      data: { id },
    });
    expect(approve.ok(), `waitlistApprove returned ${approve.status()}: ${await approve.text()}`).toBe(true);

    const link = await ctx.request.post(`${API}/dev/magic-link`, { data: { email } });
    expect(link.ok(), `/dev/magic-link returned ${link.status()}: ${await link.text()}`).toBe(true);
    return { email, url: ((await link.json()) as { url: string }).url };
  } finally {
    await ctx.close();
  }
}

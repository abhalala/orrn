import { createAuth } from "@orrn/auth";
import { atomicBatch, type createDb } from "@orrn/db";
import { user } from "@orrn/db/schema/auth";
import { company, companyRoles, invite } from "@orrn/db/schema/tenant";
import { webBaseUrl } from "@orrn/server/lib/webUrl";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { DEV_ACCOUNTS } from "./dev-accounts";

/**
 * Local-only helpers for the front-door e2e (Task 17). Invite tokens and magic
 * links only ever leave the server by email, which local dev prints to the
 * console, so a test cannot read them. These two hooks hand them over the same
 * way the real flows make them. Mounted beside POST /dev/seed behind the same
 * gate (development, the local password binding, a loopback host).
 */

type Db = ReturnType<typeof createDb>;

export const devInviteInput = z.object({
  email: z.string().trim().max(320).email(),
  role: z.enum(companyRoles),
  /** Name of the company to invite into; a fresh one each time, so tests never change the seeded demo company. */
  companyName: z.string().trim().min(1).max(200).optional(),
  /** An invite whose week has already run out (the expired-link screen). */
  expired: z.boolean().optional(),
});

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * A fresh active company (as waitlist approval makes one) and an invite into
 * it, stored exactly as `invite.create` stores it (lower-cased email, SHA-256
 * of the token), sent by the seeded owner.
 */
export async function createDevInvite(db: Db, input: z.infer<typeof devInviteInput>) {
  const owner = await db.select({ id: user.id }).from(user).where(eq(user.email, DEV_ACCOUNTS.owner.email)).get();
  if (!owner) throw new Error("dev invite: run POST /dev/seed first");

  const companyId = crypto.randomUUID();
  const companyName = input.companyName ?? "Ravi Aluminium Works";
  const token = crypto.randomUUID();
  const day = 24 * 60 * 60 * 1000;
  await atomicBatch(db, [
    db.insert(company).values({
      id: companyId,
      name: companyName,
      slug: `e2e-${companyId.slice(0, 8)}`,
      status: "active",
      settings: {},
      modules: [],
    }),
    db.insert(invite).values({
      id: crypto.randomUUID(),
      companyId,
      email: input.email.toLowerCase(),
      role: input.role,
      tokenHash: await sha256Hex(token),
      expiresAt: new Date(Date.now() + (input.expired ? -day : 7 * day)),
      invitedBy: owner.id,
    }),
  ]);
  return { token, path: `/invite/${token}`, companyName };
}

export const devMagicLinkInput = z.object({ email: z.string().trim().max(320).email() });

/**
 * A single-use magic sign-in link for an existing user, landing where the
 * waitlist approval email lands (`/setup-credentials`). The token is stored
 * through Better Auth's own adapter in the magic-link plugin's format, so
 * `/api/auth/magic-link/verify` treats it like one it sent.
 */
export async function createDevMagicLink(input: z.infer<typeof devMagicLinkInput>) {
  const ctx = await createAuth().$context;
  const token = crypto.randomUUID().replaceAll("-", "");
  await ctx.internalAdapter.createVerificationValue({
    identifier: token,
    value: JSON.stringify({ email: input.email.toLowerCase(), attempt: 0 }),
    expiresAt: new Date(Date.now() + 5 * 60 * 1000),
  });
  const url = new URL(`${ctx.baseURL.replace(/\/+$/, "")}/magic-link/verify`);
  url.searchParams.set("token", token);
  url.searchParams.set("callbackURL", `${webBaseUrl()}/setup-credentials`);
  return { url: url.toString() };
}

/**
 * M3 (final explore): an invite whose email fails is still written, never answers an error after
 * that, and hands the inviter a copyable link (as Godseye gets an owner's sign-in details). The log
 * names neither the address nor the link.
 */
import { afterAll, afterEach, beforeAll, describe, expect, mock, spyOn, test } from "bun:test";

import { auditLog, invite } from "@orrn/db/schema";
import { and, eq } from "drizzle-orm";

import { workersEnv } from "./env-mock";
import { createTestEnv, type TestEnv } from "./harness";

let env: TestEnv;
beforeAll(async () => {
  env = await createTestEnv();
}, 60_000);
afterAll(async () => {
  await env.dispose();
});

const saved: Record<string, unknown> = {};
function useEnv(values: Record<string, unknown>) {
  for (const [k, v] of Object.entries(values)) {
    if (!(k in saved)) saved[k] = workersEnv[k];
    workersEnv[k] = v;
  }
}
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete workersEnv[k];
    else workersEnv[k] = v;
    delete saved[k];
  }
});

const uid = () => crypto.randomUUID().slice(0, 8);

/** Purelymail SMTP switched on (production, password set) through the `SMTP_TRANSPORT` hook. */
function usePurelymail(replies: string[] | Error) {
  const transport = mock(async () => {
    if (replies instanceof Error) throw replies;
    const script = [...replies];
    return { readLine: async () => script.shift() ?? "421 closed", write: async () => {}, startTls: async () => {}, close: () => {} };
  });
  useEnv({ NODE_ENV: "production", PURELYMAIL_SMTP_PASSWORD: "smtp-test-pass", SMTP_TRANSPORT: transport });
  return transport;
}
const ACCEPTED = ["220 hi", "250 ehlo", "220 tls", "250 ehlo", "334 u", "334 p", "235 ok", "250 from", "250 to", "354 data", "250 queued"];

async function sha256(text: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(b))
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}

describe("M3: invites survive a failed email", () => {
  for (const failure of [
    { label: "Purelymail refuses the recipient", replies: ["220 hi", "250 ehlo", "220 tls", "250 ehlo", "334 u", "334 p", "235 ok", "250 from", "550 no such user"] },
    { label: "the SMTP connection throws", replies: new TypeError("connect failed") },
  ]) {
    test(`${failure.label}: the invite stands, the inviter gets the link to copy, the log has no link or address`, async () => {
      const { companyId } = await env.seedCompany();
      const email = `new.${uid()}@test.orrn`;
      const transport = usePurelymail(failure.replies);
      const errors = spyOn(console, "error").mockImplementation(() => {});
      const warns = spyOn(console, "warn").mockImplementation(() => {});
      let res: Awaited<ReturnType<ReturnType<TestEnv["caller"]>["invite"]["create"]>>;
      try {
        res = await env.caller({ role: "owner", companyId }).invite.create({ email, role: "operator" });
        expect(transport).toHaveBeenCalledTimes(1);
        const printed = [...errors.mock.calls, ...warns.mock.calls].flat().map(String).join("\n");
        expect(printed).not.toContain("/invite/");
        expect(printed).not.toContain(email);
      } finally {
        errors.mockRestore();
        warns.mockRestore();
      }
      expect(res).toMatchObject({ success: true, email, role: "operator", emailSent: false });
      expect(res.link).toStartWith("https://app.test/invite/");
      // The row is written and the link is the row's (the token hashes to it); the audit stands.
      const [row] = await env.db.select().from(invite).where(and(eq(invite.companyId, companyId), eq(invite.email, email)));
      expect(row!.id).toBe(res.inviteId);
      expect(row!.tokenHash).toBe(await sha256(res.link.split("/invite/")[1]!));
      expect(new Date(res.expiresAt).getTime()).toBe(row!.expiresAt.getTime());
      const audits = await env.db.select().from(auditLog).where(and(eq(auditLog.companyId, companyId), eq(auditLog.action, "member.invite")));
      expect(audits).toHaveLength(1);
      // The invite is pending in the list.
      expect((await env.caller({ role: "owner", companyId }).invite.list()).map((i) => i.email)).toContain(email);
    });
  }

  test("email sent: emailSent true, the link is still returned to the inviter", async () => {
    const { companyId } = await env.seedCompany();
    usePurelymail(ACCEPTED);
    const res = await env.caller({ role: "owner", companyId }).invite.create({ email: `ok.${uid()}@test.orrn`, role: "viewer" });
    expect(res).toMatchObject({ emailSent: true });
    expect(res.link).toStartWith("https://app.test/invite/");
  });

  test("no email set up (local): emailSent false, the link comes back", async () => {
    const { companyId } = await env.seedCompany();
    const log = spyOn(console, "log").mockImplementation(() => {});
    try {
      const res = await env.caller({ role: "owner", companyId }).invite.create({ email: `local.${uid()}@test.orrn`, role: "viewer" });
      expect(res.emailSent).toBe(false);
      expect(res.link).toStartWith("https://app.test/invite/");
    } finally {
      log.mockRestore();
    }
  });
});

describe("final fixes 5 (M4): invite.create takes a replay key; a repeat answers the first invite", () => {
  const KEY = "invite-key-000000001";

  test("the same key and request twice: one row, one audit row, the same link, no second email, replayed true", async () => {
    const { companyId } = await env.seedCompany();
    const owner = env.caller({ role: "owner", companyId });
    const email = `twice.${uid()}@test.orrn`;
    const transport = usePurelymail(ACCEPTED);
    const first = await owner.invite.create({ email, role: "operator", clientMutationId: KEY });
    const again = await owner.invite.create({ email: email.toUpperCase(), role: "operator", clientMutationId: KEY });
    expect(first).toMatchObject({ emailSent: true, replayed: false });
    expect(again).toMatchObject({ inviteId: first.inviteId, link: first.link, replayed: true, emailSent: false });
    expect(new Date(again.expiresAt).getTime()).toBe(new Date(first.expiresAt).getTime());
    expect(transport).toHaveBeenCalledTimes(1);
    const rows = await env.db.select().from(invite).where(and(eq(invite.companyId, companyId), eq(invite.email, email)));
    expect(rows).toHaveLength(1);
    expect(await env.db.select().from(auditLog).where(and(eq(auditLog.companyId, companyId), eq(auditLog.action, "member.invite")))).toHaveLength(1);
    // The link is the row's: its token hashes to the stored hash.
    const link = (await owner.invite.create({ email, role: "operator", clientMutationId: KEY })).link;
    expect(rows[0]!.tokenHash).toBe(await sha256(link.split("/invite/")[1]!));
  });

  test("two identical requests at once end on one row", async () => {
    const { companyId } = await env.seedCompany();
    const owner = env.caller({ role: "owner", companyId });
    const email = `race.${uid()}@test.orrn`;
    const [a, b] = await Promise.all([
      owner.invite.create({ email, role: "viewer", clientMutationId: "invite-race-0000001" }),
      owner.invite.create({ email, role: "viewer", clientMutationId: "invite-race-0000001" }),
    ]);
    expect(a.link).toBe(b.link);
    expect(await env.db.select().from(invite).where(and(eq(invite.companyId, companyId), eq(invite.email, email)))).toHaveLength(1);
  });

  test("the same key for another email or role is a CONFLICT; a call without a key still makes a random link", async () => {
    const { companyId } = await env.seedCompany();
    const owner = env.caller({ role: "owner", companyId });
    const email = `conflict.${uid()}@test.orrn`;
    const first = await owner.invite.create({ email, role: "viewer", clientMutationId: KEY });
    await expect(owner.invite.create({ email: `other.${uid()}@test.orrn`, role: "viewer", clientMutationId: KEY })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(owner.invite.create({ email, role: "operator", clientMutationId: KEY })).rejects.toMatchObject({ code: "CONFLICT" });
    const keyless = await owner.invite.create({ email: `plain.${uid()}@test.orrn`, role: "viewer" });
    expect(keyless.link).not.toBe(first.link);
    expect(keyless.replayed).toBe(false);
    await expect(owner.invite.create({ email, role: "viewer", clientMutationId: "short" })).rejects.toThrow();
  });
});

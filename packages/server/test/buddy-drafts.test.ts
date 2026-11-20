/**
 * orrn buddy, confirm-first writes (design 2026-11-18, §4.4, §7, §10, §12.4, §13).
 *
 * Pins: confirm runs the real procedure under the browser session and stores the result; a second confirm
 * replays it; two confirms at once run it once; the real write's audit row carries meta.buddyDraftId;
 * the draft id is the clientRequestId; a draft row naming a denied path never runs; reject and expiry;
 * only the person's own drafts; the buddy router is owner-only and never for impersonation;
 * auth.me.buddy; a confirmed ingest.shape.make goes through the plant's model caps.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";

import { auditLog, buddyDraft, buddyLink, countSession, customer, impersonationGrant } from "@orrn/db/schema";
import { and, eq, sql } from "drizzle-orm";

import { buddyPlant, connect, listPlant, setHermesEnv, tool } from "./buddy-fixture";
import { createTestEnv, type TestEnv } from "./harness";

let env: TestEnv;

beforeAll(async () => {
  env = await createTestEnv();
});

afterAll(async () => {
  setHermesEnv(false);
  await env.dispose();
});

async function draftCustomer(token: string, name: string): Promise<string> {
  const r = await tool(env, token, "orrn_call", { path: "customer.create", input: { name } });
  if (r.status !== "needs_confirm") throw new Error(`expected a draft, got ${JSON.stringify(r)}`);
  return r.data.draftId as string;
}

async function customersNamed(companyId: string, name: string): Promise<number> {
  const r = await env.db.select({ n: sql<number>`count(*)` }).from(customer).where(and(eq(customer.companyId, companyId), eq(customer.name, name))).get();
  return Number(r?.n ?? 0);
}

describe("listMine, confirm, replay", () => {
  test("the bubble lists the draft; confirm runs the real mutation as the person and stores the result", async () => {
    const p = await buddyPlant(env);
    const { token } = await connect(p);
    const draftId = await draftCustomer(token, "Kappa Synthetic Traders");
    const [card] = await p.owner.buddy.drafts.listMine();
    expect(card).toMatchObject({
      id: draftId,
      path: "customer.create",
      title: "customer: create",
      lines: [{ label: "Name", value: "Kappa Synthetic Traders" }],
      status: "pending",
      result: null,
      failure: null,
      link: null,
    });
    const done = await p.owner.buddy.drafts.confirm({ draftId });
    expect(done.status).toBe("confirmed");
    expect(done.result).toMatchObject({ success: true, id: expect.any(String) });
    expect(await customersNamed(p.companyId, "Kappa Synthetic Traders")).toBe(1);

    // The real write's own audit row carries the draft id; the draft has its own rows.
    const created = await env.db
      .select({ meta: auditLog.meta, actorId: auditLog.actorId })
      .from(auditLog)
      .where(and(eq(auditLog.companyId, p.companyId), eq(auditLog.action, "customer.create")))
      .get();
    expect(created).toMatchObject({ meta: { buddyDraftId: draftId }, actorId: p.users.owner.id });
    const draftAudit = await env.db
      .select({ action: auditLog.action })
      .from(auditLog)
      .where(and(eq(auditLog.companyId, p.companyId), eq(auditLog.subjectId, draftId)))
      .orderBy(auditLog.at);
    expect(draftAudit.map((r) => r.action)).toEqual(["buddy.draft.create", "buddy.draft.confirm"]);
  });

  test("double confirm: the second answers the stored result and runs nothing", async () => {
    const p = await buddyPlant(env);
    const { token } = await connect(p);
    const draftId = await draftCustomer(token, "Lambda Synthetic Co");
    const first = await p.owner.buddy.drafts.confirm({ draftId });
    const second = await p.owner.buddy.drafts.confirm({ draftId });
    expect(second).toEqual(first);
    expect(await customersNamed(p.companyId, "Lambda Synthetic Co")).toBe(1);
  });

  test("two confirms at once run the mutation once", async () => {
    const p = await buddyPlant(env);
    const { token } = await connect(p);
    const draftId = await draftCustomer(token, "Mu Synthetic Co");
    const results = await Promise.allSettled([p.owner.buddy.drafts.confirm({ draftId }), p.owner.buddy.drafts.confirm({ draftId })]);
    expect(await customersNamed(p.companyId, "Mu Synthetic Co")).toBe(1);
    for (const r of results) {
      if (r.status === "fulfilled") expect(r.value.status).toBe("confirmed");
      else expect(r.reason).toMatchObject({ code: "CONFLICT" });
    }
    expect((await p.owner.buddy.drafts.confirm({ draftId })).status).toBe("confirmed");
  });

  test("the draft id is the clientRequestId where the procedure takes one", async () => {
    const p = await buddyPlant(env);
    const { token } = await connect(p);
    await p.owner.stock.locations.seedDefaults();
    const loc = (await p.owner.stock.locations.list()).items[0]!;
    const r = await tool(env, token, "orrn_call", { path: "count.start", input: { locationIds: [loc.id] } });
    expect(r.status).toBe("needs_confirm");
    const draftId = r.data.draftId as string;
    const done = await p.owner.buddy.drafts.confirm({ draftId });
    expect(done.status).toBe("confirmed");
    const session = await env.db.select({ key: countSession.clientRequestId }).from(countSession).where(eq(countSession.companyId, p.companyId)).get();
    expect(session?.key).toBe(draftId);
  });

  test("a failing change leaves the draft failed with the server's sentence, and is not run again", async () => {
    const p = await buddyPlant(env);
    const { token } = await connect(p);
    const r = await tool(env, token, "orrn_call", { path: "customer.update", input: { id: "no-such-customer", name: "Nu Synthetic" } });
    expect(r.status).toBe("needs_confirm");
    const out = await p.owner.buddy.drafts.confirm({ draftId: r.data.draftId });
    expect(out.status).toBe("failed");
    expect(out.failure).toBeTruthy();
    expect((await p.owner.buddy.drafts.confirm({ draftId: r.data.draftId })).status).toBe("failed");
  });
});

describe("what never runs", () => {
  test("a draft row that names a denied path is refused at confirm (approve, merge, model_checked, discard)", async () => {
    const p = await buddyPlant(env);
    const { grantId } = await connect(p);
    const { createId } = await import("../src/lib/id");
    for (const path of ["ingest.candidate.approve", "ingest.merge.start", "ingest.vision.check", "ingest.candidate.discard", "buddy.grant.create", "company.updateSettings"]) {
      const id = createId();
      await env.db.insert(buddyDraft).values({
        id,
        companyId: p.companyId,
        requestedByUserId: p.users.owner.id,
        grantId,
        path,
        inputJson: { candidateId: "c1", expectSeq: 1 },
        expiresAt: new Date(Date.now() + 3_600_000),
      });
      const out = await p.owner.buddy.drafts.confirm({ draftId: id });
      expect({ path, status: out.status, failure: out.failure }).toEqual({ path, status: "failed", failure: "The buddy may not make this change." });
    }
  });

  test("reject: the change never runs, and a later confirm keeps it rejected", async () => {
    const p = await buddyPlant(env);
    const { token } = await connect(p);
    const draftId = await draftCustomer(token, "Xi Synthetic Co");
    expect((await p.owner.buddy.drafts.reject({ draftId })).status).toBe("rejected");
    expect((await p.owner.buddy.drafts.confirm({ draftId })).status).toBe("rejected");
    expect(await customersNamed(p.companyId, "Xi Synthetic Co")).toBe(0);
  });

  test("an expired draft is not run", async () => {
    const p = await buddyPlant(env);
    const { token } = await connect(p);
    const draftId = await draftCustomer(token, "Omicron Synthetic Co");
    await env.db.update(buddyDraft).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(buddyDraft.id, draftId));
    expect((await p.owner.buddy.drafts.listMine())[0]!.status).toBe("expired");
    expect((await p.owner.buddy.drafts.confirm({ draftId })).status).toBe("expired");
    expect(await customersNamed(p.companyId, "Omicron Synthetic Co")).toBe(0);
  });

  test("only the person's own drafts in this plant", async () => {
    const p = await buddyPlant(env);
    const { token } = await connect(p);
    const draftId = await draftCustomer(token, "Pi Synthetic Co");
    // A second owner of the same plant.
    const otherOwner = await env.seedUser("owner2");
    await env.addMembership(otherOwner, p.companyId, "owner");
    await expect(env.callerForUser(otherOwner, { company: p.companyId }).buddy.drafts.confirm({ draftId })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await env.callerForUser(otherOwner, { company: p.companyId }).buddy.drafts.listMine()).toEqual([]);
    // Another plant's owner.
    const q = await buddyPlant(env);
    await expect(q.owner.buddy.drafts.confirm({ draftId })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await customersNamed(p.companyId, "Pi Synthetic Co")).toBe(0);
  });
});

describe("the buddy router: owner only, never impersonation", () => {
  test("every role but the owner is refused", async () => {
    const p = await buddyPlant(env);
    for (const role of ["admin", "manager", "office", "viewer"] as const) {
      await expect(p.as(role).buddy.status()).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(p.as(role).buddy.drafts.listMine()).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(p.as(role).buddy.grant.create()).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  });

  test("an impersonating platform admin (who acts as owner) is refused", async () => {
    const p = await buddyPlant(env);
    const staff = await env.seedUser("staff");
    const { platformAdmin } = await import("@orrn/db/schema");
    await env.db.insert(platformAdmin).values({ userId: staff, role: "super_admin" });
    await env.db.insert(impersonationGrant).values({
      id: randomUUID(),
      platformAdminId: staff,
      companyId: p.companyId,
      reason: "synthetic test",
      expiresAt: new Date(Date.now() + 3_600_000),
    } as never);
    const imp = env.callerForUser(staff, { impersonate: p.companyId });
    const me = await imp.auth.me();
    expect(me.impersonation).not.toBeNull();
    expect(me.buddy).toBe(false);
    await expect(imp.buddy.status()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(imp.buddy.grant.create()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  test("grant.create only for a listed plant; status; revoke ends the link", async () => {
    const seeded = await env.seedCompany();
    const owner = env.caller({ role: "owner", companyId: seeded.companyId });
    await expect(owner.buddy.grant.create()).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await owner.buddy.status()).toEqual({ available: false, listed: false, connected: null });
    await listPlant(env, seeded.companyId);
    const { token, grantId } = await owner.buddy.grant.create();
    expect(token).toMatch(/^orrnb_[A-Za-z0-9_-]{43}$/);
    const st = await owner.buddy.status();
    expect(st).toMatchObject({ listed: true, connected: { grantId, lastUsedAt: null, expiresAt: expect.any(String) } });
    // A second connect revokes the first token.
    const second = await owner.buddy.grant.create();
    expect((await owner.buddy.status()).connected?.grantId).toBe(second.grantId);
    const links = await env.db.select().from(buddyLink).where(eq(buddyLink.companyId, seeded.companyId));
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ status: "active", hermesProfile: null });
    await owner.buddy.grant.revoke({ grantId: second.grantId });
    expect((await owner.buddy.status()).connected).toBeNull();
    expect((await env.db.select().from(buddyLink).where(eq(buddyLink.companyId, seeded.companyId)))[0]).toMatchObject({ status: "revoked" });
    // The plant's calls list (owner only) shows no token or body.
    const calls = await owner.buddy.calls.list();
    expect(Array.isArray(calls)).toBe(true);
  });
});

describe("auth.me.buddy (§13)", () => {
  afterEach(() => setHermesEnv(false));

  test("true only with the four HERMES_* names, a listed plant, the owner and an active link", async () => {
    const p = await buddyPlant(env);
    expect((await p.owner.auth.me()).buddy).toBe(false); // not configured, not connected
    setHermesEnv(true);
    expect((await p.owner.auth.me()).buddy).toBe(false); // not connected
    const { grantId } = await connect(p);
    expect((await p.owner.auth.me()).buddy).toBe(true);
    expect((await p.owner.buddy.status()).available).toBe(true);
    expect((await p.as("admin").auth.me()).buddy).toBe(false);
    setHermesEnv(false);
    expect((await p.owner.auth.me()).buddy).toBe(false);
    setHermesEnv(true);
    await p.owner.buddy.grant.revoke({ grantId });
    expect((await p.owner.auth.me()).buddy).toBe(false);
  });
});

describe("caps (§12.4)", () => {
  test("a confirmed ingest.shape.make draft goes through the same plant cap check as the import screen", async () => {
    const { plant: ingestPlant, upload } = await import("./ingest-portal-helpers");
    const { setShapeClientForTests } = await import("../src/lib/ingest/bot/client");
    const { FakeShapeClient } = await import("../src/lib/ingest/bot/fake");
    const { DAY_CALL_CAP } = await import("../src/lib/ingest/bot/caps");
    const { ingestBotRun } = await import("@orrn/db/schema/ingest");
    const ip = await ingestPlant(env);
    await listPlant(env, ip.companyId);
    const { token } = await ip.owner.buddy.grant.create();
    const { candidates } = await upload(ip.owner, [{ headers: ["Khata", "Gaam"], rows: [["Synthetic Party", "Morbi"]] }]);
    const c = candidates[0]!;
    // The plant used up its day of model calls.
    const runs = Array.from({ length: DAY_CALL_CAP }, (_, i) => ({
      id: `run_${randomUUID()}`,
      companyId: ip.companyId,
      blockId: `b-${i}`,
      candidateId: null,
      purpose: "shape" as const,
      model: "claude-haiku-5-5",
      attempt: 1,
      outcome: "invalid" as const,
    }));
    for (let i = 0; i < runs.length; i += 5) await env.db.insert(ingestBotRun).values(runs.slice(i, i + 5));
    const fake = new FakeShapeClient([]);
    setShapeClientForTests(fake);
    try {
      const r = await tool(env, token, "orrn_call", { path: "ingest.shape.make", input: { candidateId: c.id, expectSeq: c.serverSeq } });
      expect(r.status).toBe("needs_confirm");
      expect(r.data.reviewLink).toBe(`https://app.test/ingest/review/${c.id}`);
      const card = (await ip.owner.buddy.drafts.listMine()).find((d) => d.id === r.data.draftId)!;
      expect(card.link).toBe(`/ingest/review/${c.id}`);
      const out = await ip.owner.buddy.drafts.confirm({ draftId: r.data.draftId });
      expect(out.status).toBe("confirmed");
      expect(out.result).toMatchObject({ outcome: "capped" });
      expect(fake.calls).toHaveLength(0);
      // The import screen's own click answers the same.
      const fresh = await ip.owner.ingest.candidate.get({ candidateId: c.id });
      const direct = await ip.owner.ingest.shape.make({ candidateId: c.id, expectSeq: fresh.serverSeq });
      expect(direct.outcome).toBe("capped");
    } finally {
      setShapeClientForTests(null);
    }
  });
});

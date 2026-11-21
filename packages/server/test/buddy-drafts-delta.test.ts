/**
 * orrn buddy, drafts in the delta round (lead decisions 1, 5, 8 and 10; review B1, S4, N1, N3, N4; security D-M1,
 * D-M2, D-L1, D-L3). Real D1, through `/mcp` and `buddy.drafts.*`. Synthetic data only.
 *
 * Pins:
 * - B1 / D-M1: `die.share.create` is no tool and never runs from a draft; no stored result and nothing Hermes is told
 *   holds a token, a share link or a signed link (the stripper, and a walk of every result this file stored).
 * - S4 / D-M2: every id input shows the name of this plant's row; an irreversible draft whose id has no name here
 *   cannot be confirmed (the server refuses, the draft stays pending, Reject works); every id key of every allowed
 *   change is resolved or listed as having no name.
 * - D-L1: a draft of a grant past its expiry settles expired and never runs.
 * - D-L3: bidi controls in a value are marked and block an irreversible Confirm; ZWJ/ZWNJ are left alone.
 * - N1 a bare array gets the draft id as its request key; N3 a slow target keeps its claim longer; N4 an input key the
 *   procedure does not take makes no draft.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { buddyDraft, buddyGrant, customer, vendor } from "@orrn/db/schema";
import { and, eq, sql } from "drizzle-orm";

import { buddyPlant, connect, tool, type BuddyPlant } from "./buddy-fixture";
import { createTestEnv, type TestEnv } from "./harness";

let env: TestEnv;

beforeAll(async () => {
  env = await createTestEnv();
});

afterAll(async () => {
  await env.dispose();
});

async function draftOf(token: string, path: string, input: unknown): Promise<string> {
  const r = await tool(env, token, "orrn_call", { path, input });
  if (r.status !== "needs_confirm") throw new Error(`expected a draft, got ${JSON.stringify(r)}`);
  return r.data.draftId as string;
}

async function cardOf(p: BuddyPlant, draftId: string) {
  const card = (await p.owner.buddy.drafts.listMine()).find((d) => d.id === draftId);
  if (!card) throw new Error("no card");
  return card;
}

async function newCustomer(p: BuddyPlant, name: string): Promise<string> {
  const r = await p.owner.customer.create({ name });
  return (r as { id: string }).id;
}

async function newVendor(p: BuddyPlant, name: string): Promise<string> {
  await p.owner.vendor.create({ name });
  const row = await env.db.select({ id: vendor.id }).from(vendor).where(and(eq(vendor.companyId, p.companyId), eq(vendor.name, name))).get();
  return row!.id;
}

async function draftsIn(companyId: string): Promise<number> {
  const r = await env.db.select({ n: sql<number>`count(*)` }).from(buddyDraft).where(eq(buddyDraft.companyId, companyId)).get();
  return Number(r?.n ?? 0);
}

describe("B1 / D-M1: no share links through the buddy", () => {
  test("die.share.create is not a tool: orrn_call says not_found and makes no draft", async () => {
    const p = await buddyPlant(env);
    const { token } = await connect(p);
    const sectionId = await env.seedDie(p.companyId, { series: "R", sectionCode: "7100" });
    const r = await tool(env, token, "orrn_call", { path: "die.share.create", input: { sectionId, days: 30 } });
    expect(r.status).toBe("not_found");
    expect(await draftsIn(p.companyId)).toBe(0);
    const d = await tool(env, token, "orrn_describe", { path: "die.share.create" });
    expect(d.status).toBe("not_found");
  });

  test("a draft row naming die.share.create is refused at Confirm and mints no link", async () => {
    const p = await buddyPlant(env);
    const { grantId } = await connect(p);
    const sectionId = await env.seedDie(p.companyId, { series: "R", sectionCode: "7101" });
    const { createId } = await import("../src/lib/id");
    const id = createId();
    await env.db.insert(buddyDraft).values({
      id,
      companyId: p.companyId,
      requestedByUserId: p.users.owner.id,
      grantId,
      path: "die.share.create",
      inputJson: { sectionId, days: 30 },
      expiresAt: new Date(Date.now() + 3_600_000),
    });
    const out = await p.owner.buddy.drafts.confirm({ draftId: id, via: "bubble" });
    expect(out).toMatchObject({ status: "failed", failure: "The buddy may not make this change.", result: null });
    const { dieShare } = await import("@orrn/db/schema");
    const shares = await env.db.select({ id: dieShare.id }).from(dieShare).where(eq(dieShare.companyId, p.companyId));
    expect(shares).toEqual([]);
  });

  test("the stripper hides every secret-looking key and value, recursively, and keeps the rest", async () => {
    const { stripSecrets, HIDDEN } = await import("../src/lib/buddy/envelope");
    expect(HIDDEN).toBe("[hidden]");
    const input = {
      id: "keep-me",
      token: "abc",
      secret: "s",
      password: "p",
      url: "https://app.test/anything",
      signedUrl: "https://r2.test/x?X-Amz-Signature=1",
      shareUrl: "https://app.test/share/die/zzz",
      path: "/share/die/abc",
      otherPath: "/ingest/review/c1",
      reviewPath: "/ingest/review/c2",
      note: "see https://app.test/share/die/abc please",
      link: "https://r2.test/obj?X-Amz-Signature=deadbeef&X-Amz-Date=1",
      sigLink: "https://cdn.test/f?sig=abc",
      tokenLink: "https://cdn.test/f?a=1&token=abc",
      count: 3,
      nested: [{ token: "t2", name: "Synthetic Co", deeper: { url: "u", path: "/share/x" } }, "plain text", "x?token=1"],
      nothing: null,
    };
    expect(stripSecrets(input)).toEqual({
      id: "keep-me",
      token: HIDDEN,
      secret: HIDDEN,
      password: HIDDEN,
      url: HIDDEN,
      signedUrl: HIDDEN,
      shareUrl: HIDDEN,
      path: HIDDEN,
      otherPath: "/ingest/review/c1",
      reviewPath: "/ingest/review/c2",
      note: HIDDEN,
      link: HIDDEN,
      sigLink: HIDDEN,
      tokenLink: HIDDEN,
      count: 3,
      nested: [{ token: HIDDEN, name: "Synthetic Co", deeper: { url: HIDDEN, path: HIDDEN } }, "plain text", HIDDEN],
      nothing: null,
    });
    // A path that is not a share path stays; a bare string value is judged by its text.
    expect(stripSecrets({ path: "/ingest/files/a1" })).toEqual({ path: "/ingest/files/a1" });
    expect(stripSecrets("https://app.test/share/die/abc")).toBe(HIDDEN);
    expect(stripSecrets(null)).toBeNull();
  });

  test("what Hermes is told: a read's text that holds a share link is hidden on the MCP leg", async () => {
    const p = await buddyPlant(env);
    const { token } = await connect(p);
    const id = await newCustomer(p, "Share Note Synthetic Co");
    await env.db.update(customer).set({ notes: "drawing at https://app.test/share/die/abcdef" }).where(eq(customer.id, id));
    const r = await tool(env, token, "orrn_call", { path: "customer.get", input: { id } });
    expect(r.status).toBe("ok");
    expect(JSON.stringify(r.data)).not.toContain("/share/");
    expect(JSON.stringify(r.data)).toContain("Share Note Synthetic Co");
  });
});

describe("S4 / D-M2: ids shown as names", () => {
  test("vendor.merge shows both vendor names and which one is kept; it is irreversible and confirms", async () => {
    const p = await buddyPlant(env);
    const { token } = await connect(p);
    const keep = await newVendor(p, "Keep Synthetic Metals");
    const gone = await newVendor(p, "Gone Synthetic Scrap");
    const draftId = await draftOf(token, "vendor.merge", { keepId: keep, mergeIds: [gone] });
    const card = await cardOf(p, draftId);
    expect(card.irreversible).toBe(true);
    expect(card.confirmBlock).toBeNull();
    expect(card.fields).toEqual([
      { key: "keepId", label: "Keep id", value: "Keep Synthetic Metals", ref: { id: keep, name: "Keep Synthetic Metals" }, marked: false },
      { key: "mergeIds", label: "Merge ids", value: `Gone Synthetic Scrap (${gone})`, ref: null, marked: false },
    ]);
    expect((await p.owner.buddy.drafts.confirm({ draftId, via: "bubble" })).status).toBe("confirmed");
  });

  test("customer.delete shows the customer's name", async () => {
    const p = await buddyPlant(env);
    const { token } = await connect(p);
    const id = await newCustomer(p, "Delete Me Synthetic Party");
    await newCustomer(p, "Keep Me Synthetic Party");
    const draftId = await draftOf(token, "customer.delete", { id });
    const card = await cardOf(p, draftId);
    expect(card).toMatchObject({ irreversible: true, confirmBlock: null });
    expect(card.fields).toEqual([{ key: "id", label: "Id", value: "Delete Me Synthetic Party", ref: { id, name: "Delete Me Synthetic Party" }, marked: false }]);
    expect((await p.owner.buddy.drafts.confirm({ draftId, via: "bubble" })).status).toBe("confirmed");
  });

  test("an irreversible draft on an id with no name in this plant (another plant's customer) cannot be confirmed; Reject works", async () => {
    const p = await buddyPlant(env);
    const { token } = await connect(p);
    const q = await buddyPlant(env);
    const theirs = await newCustomer(q, "Other Plant Synthetic Party");
    const draftId = await draftOf(token, "customer.delete", { id: theirs });
    const card = await cardOf(p, draftId);
    expect(card.fields).toEqual([{ key: "id", label: "Id", value: theirs, ref: { id: theirs, name: null }, marked: false }]);
    expect(card.confirmBlock).toEqual({ reason: "unnamed_id", keys: ["id"] });
    let caught: unknown;
    try {
      await p.owner.buddy.drafts.confirm({ draftId, via: "bubble" });
    } catch (e) {
      caught = e;
    }
    expect(caught).toMatchObject({ code: "PRECONDITION_FAILED", meta: { reason: "CONFIRM_BLOCKED" } });
    const row = await env.db.select({ status: buddyDraft.status, claimedAt: buddyDraft.claimedAt }).from(buddyDraft).where(eq(buddyDraft.id, draftId)).get();
    expect(row).toEqual({ status: "pending", claimedAt: null });
    expect((await p.owner.buddy.drafts.reject({ draftId, via: "bubble" })).status).toBe("rejected");
    expect(await env.db.select({ id: customer.id }).from(customer).where(and(eq(customer.id, theirs), sql`${customer.deletedAt} is null`)).get()).toBeTruthy();
  });

  test("a reversible draft with an unknown id still shows the id and may be confirmed (the procedure refuses it)", async () => {
    const p = await buddyPlant(env);
    const { token } = await connect(p);
    const draftId = await draftOf(token, "customer.update", { id: "no-such-customer", name: "Nu Synthetic" });
    const card = await cardOf(p, draftId);
    expect(card).toMatchObject({ irreversible: false, confirmBlock: null });
    expect(card.fields[0]).toEqual({ key: "id", label: "Id", value: "no-such-customer", ref: { id: "no-such-customer", name: null }, marked: false });
  });

  test("a list of ids with one unknown entry blocks an irreversible Confirm on that key", async () => {
    const p = await buddyPlant(env);
    const { token } = await connect(p);
    const keep = await newVendor(p, "Keep Two Synthetic");
    const gone = await newVendor(p, "Gone Two Synthetic");
    const draftId = await draftOf(token, "vendor.merge", { keepId: keep, mergeIds: [gone, "no-such-vendor"] });
    const card = await cardOf(p, draftId);
    expect(card.fields[1]!.value).toBe(`Gone Two Synthetic (${gone}), no-such-vendor`);
    expect(card.confirmBlock).toEqual({ reason: "unnamed_id", keys: ["mergeIds"] });
  });

  test("every top-level id key of every allowed change is resolved to an entity or listed as having no name", async () => {
    const { buddyRegistry } = await import("../src/lib/buddy/registry");
    const { refEntity, isIdKey, NO_NAME, irreversiblePath, NO_NAME_ON_IRREVERSIBLE } = await import("../src/lib/buddy/draftRefs");
    const { RESOLVERS } = await import("../src/lib/buddy/draftNames");
    const missing: string[] = [];
    const noNameOnIrreversible: string[] = [];
    let checked = 0;
    for (const entry of (await buddyRegistry()).values()) {
      if (entry.decision.kind !== "allow" || entry.kind !== "mutation") continue;
      for (const key of entry.fields) {
        if (!isIdKey(key)) continue;
        checked += 1;
        const entity = refEntity(entry.path, key);
        if (entity === undefined) missing.push(`${entry.path}:${key}`);
        else if (entity === null) {
          const reason = NO_NAME[`${entry.path}:${key}`] ?? NO_NAME[key];
          if (!reason) missing.push(`${entry.path}:${key} (no reason)`);
          if (irreversiblePath(entry.path) && !NO_NAME_ON_IRREVERSIBLE.includes(`${entry.path}:${key}`)) noNameOnIrreversible.push(`${entry.path}:${key}`);
        } else if (!(entity in RESOLVERS)) missing.push(`${entry.path}:${key} -> ${entity} (no resolver)`);
      }
    }
    expect(checked).toBeGreaterThan(150);
    expect(missing).toEqual([]);
    expect(noNameOnIrreversible).toEqual([]);
  });
});

describe("D-L1: an expired grant", () => {
  test("a draft of a grant past its expiry settles expired at Confirm and never runs", async () => {
    const p = await buddyPlant(env);
    const { token, grantId } = await connect(p);
    const draftId = await draftOf(token, "customer.create", { name: "Expired Grant Synthetic Co" });
    await env.db.update(buddyGrant).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(buddyGrant.id, grantId));
    expect((await p.owner.buddy.drafts.confirm({ draftId, via: "bubble" })).status).toBe("expired");
    const made = await env.db.select({ id: customer.id }).from(customer).where(and(eq(customer.companyId, p.companyId), eq(customer.name, "Expired Grant Synthetic Co"))).get();
    expect(made).toBeUndefined();
  });
});

describe("D-L3: text direction controls", () => {
  test("a bidi control is marked on the card and blocks an irreversible Confirm", async () => {
    const p = await buddyPlant(env);
    const { token } = await connect(p);
    await p.owner.stock.locations.seedDefaults();
    const loc = (await p.owner.stock.locations.list()).items[0]!;
    const start = await draftOf(token, "count.start", { locationIds: [loc.id] });
    expect((await p.owner.buddy.drafts.confirm({ draftId: start, via: "bubble" })).status).toBe("confirmed");
    const { countSession } = await import("@orrn/db/schema");
    const session = await env.db.select({ id: countSession.id, number: countSession.number }).from(countSession).where(eq(countSession.companyId, p.companyId)).get();
    const draftId = await draftOf(token, "count.cancel", { sessionId: session!.id, reason: "wrong‮tnuoc" });
    const card = await cardOf(p, draftId);
    expect(card.irreversible).toBe(true);
    expect(card.fields).toEqual([
      { key: "sessionId", label: "Session id", value: session!.number, ref: { id: session!.id, name: session!.number }, marked: false },
      { key: "reason", label: "Reason", value: "wrong⟦U+202E⟧tnuoc", ref: null, marked: true },
    ]);
    expect(card.confirmBlock).toEqual({ reason: "bidi", keys: ["reason"] });
    await expect(p.owner.buddy.drafts.confirm({ draftId, via: "bubble" })).rejects.toMatchObject({ code: "PRECONDITION_FAILED", meta: { reason: "CONFIRM_BLOCKED" } });
    expect((await env.db.select({ status: buddyDraft.status }).from(buddyDraft).where(eq(buddyDraft.id, draftId)).get())?.status).toBe("pending");
  });

  test("a Hindi name with a zero width joiner drafts, shows unchanged and confirms", async () => {
    const p = await buddyPlant(env);
    const { token } = await connect(p);
    const name = "क्‍ष सिंथेटिक ट्रेडर्स";
    const draftId = await draftOf(token, "customer.create", { name });
    const card = await cardOf(p, draftId);
    expect(card.fields).toEqual([{ key: "name", label: "Name", value: name, ref: null, marked: false }]);
    expect(card.confirmBlock).toBeNull();
    expect((await p.owner.buddy.drafts.confirm({ draftId, via: "bubble" })).status).toBe("confirmed");
    const made = await env.db.select({ name: customer.name }).from(customer).where(and(eq(customer.companyId, p.companyId), eq(customer.name, name))).get();
    expect(made?.name).toBe(name);
  });
});

describe("nits", () => {
  test("N1: a bare row array gets the draft id as its request key (customer.importCsv)", async () => {
    const p = await buddyPlant(env);
    const { token } = await connect(p);
    const rows = [{ name: "Bare Row Synthetic One" }, { name: "Bare Row Synthetic Two" }];
    const draftId = await draftOf(token, "customer.importCsv", rows);
    expect((await env.db.select({ input: buddyDraft.inputJson }).from(buddyDraft).where(eq(buddyDraft.id, draftId)).get())?.input).toEqual({ rows });
    expect((await p.owner.buddy.drafts.confirm({ draftId, via: "bubble" })).status).toBe("confirmed");
    const { requestRowIds } = await import("../src/lib/importReplay");
    const want = await requestRowIds(p.companyId, "customer.import", draftId, 2);
    const made = await env.db.select({ id: customer.id }).from(customer).where(eq(customer.companyId, p.companyId));
    expect(made.map((m) => m.id).sort()).toEqual([...want].sort());
  });

  test("N3: a slow target (ingest.vision.readPage) keeps its claim past 2 minutes; a long dead claim still settles failed", async () => {
    const p = await buddyPlant(env);
    const { grantId } = await connect(p);
    const { createId } = await import("../src/lib/id");
    const make = async (claimedMinutesAgo: number) => {
      const id = createId();
      await env.db.insert(buddyDraft).values({
        id,
        companyId: p.companyId,
        requestedByUserId: p.users.owner.id,
        grantId,
        path: "ingest.vision.readPage",
        inputJson: { artifactId: "a-synthetic", page: 1 },
        expiresAt: new Date(Date.now() + 3_600_000),
        claimedAt: new Date(Date.now() - claimedMinutesAgo * 60_000),
      });
      return id;
    };
    const running = await make(3);
    await expect(p.owner.buddy.drafts.confirm({ draftId: running, via: "bubble" })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(p.owner.buddy.drafts.reject({ draftId: running, via: "bubble" })).rejects.toMatchObject({ code: "CONFLICT" });
    const dead = await make(60);
    expect((await p.owner.buddy.drafts.confirm({ draftId: dead, via: "bubble" })).status).toBe("failed");
  });

  test("N4: a top-level key the procedure does not take makes no draft", async () => {
    const p = await buddyPlant(env);
    const { token } = await connect(p);
    const r = await tool(env, token, "orrn_call", { path: "customer.create", input: { name: "Extra Key Synthetic", approved: true } });
    expect(r.status).toBe("invalid");
    expect(await draftsIn(p.companyId)).toBe(0);
  });
});

describe("no stored result holds a secret (decision 1)", () => {
  test("a walk of every buddy_draft.result_json this file stored finds no token, share link or signed link", async () => {
    const rows = await env.db.select({ id: buddyDraft.id, result: buddyDraft.resultJson }).from(buddyDraft);
    expect(rows.length).toBeGreaterThan(5);
    const bad: string[] = [];
    const walk = (v: unknown, at: string) => {
      if (typeof v === "string") {
        if (/\/share\/|X-Amz-Signature=|[?&]sig=|[?&]token=|orrnb_/.test(v)) bad.push(at);
      } else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${at}[${i}]`));
      else if (v && typeof v === "object") {
        for (const [k, x] of Object.entries(v)) {
          if (["token", "secret", "password", "url", "signedUrl", "shareUrl"].includes(k) && x !== "[hidden]") bad.push(`${at}.${k}`);
          walk(x, `${at}.${k}`);
        }
      }
    };
    for (const r of rows) walk(r.result, r.id);
    expect(bad).toEqual([]);
  });
});

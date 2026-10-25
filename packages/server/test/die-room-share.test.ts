/**
 * Die share link (FP-DR-20, backlog 48): create / list / revoke by the die room and masters, and the
 * public `die.share.view` (no session): token stored hashed, expiry 7 days default and 30 at most,
 * the neutral "no longer available" answer for unknown / revoked / expired links, a signed drawing URL
 * minted per view, the owner shown only to the party the link is for, no stock / cost / customer
 * data, tenant isolation, the permission matrix, and the rate limit.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";

import { auditLog, authThrottle, company, die, dieInstance, dieShare } from "@orrn/db/schema";
import { and, eq, like } from "drizzle-orm";

import { setClockForTests } from "../src/lib/clock";
import { workersEnv } from "./env-mock";
import { createTestEnv, type CompanyRole, type TestEnv } from "./harness";

let env: TestEnv;
let files: typeof import("../src/lib/dieFiles");
let share: typeof import("../src/lib/dieShare");
let appRouter: typeof import("../src/routers/index").appRouter;

class FakeR2 {
  objects = new Map<string, { body: Uint8Array; httpMetadata?: Record<string, string> }>();
  async put(key: string, value: Uint8Array | ReadableStream, opts?: { httpMetadata?: Record<string, string> }) {
    const body = value instanceof Uint8Array ? value : new Uint8Array(await new Response(value).arrayBuffer());
    this.objects.set(key, { body, httpMetadata: opts?.httpMetadata });
    return { key, size: body.byteLength };
  }
  async head(key: string) {
    const o = this.objects.get(key);
    return o ? { key, size: o.body.byteLength, httpMetadata: o.httpMetadata } : null;
  }
  async get(key: string) {
    return this.objects.get(key) ?? null;
  }
  async delete(key: string) {
    this.objects.delete(key);
  }
}
let r2: FakeR2;
const GONE = "This link is no longer available";
const DAY = 24 * 60 * 60 * 1000;

beforeAll(async () => {
  env = await createTestEnv();
  files = await import("../src/lib/dieFiles");
  share = await import("../src/lib/dieShare");
  appRouter = (await import("../src/routers/index")).appRouter;
});
afterEach(() => {
  setClockForTests(null);
  r2 = new FakeR2();
  workersEnv.DIE_FILES = r2;
});
afterAll(async () => {
  delete workersEnv.DIE_FILES;
  await env.dispose();
});

/** A caller with no session, as the browser of the party is. `ip` is what the platform reports. */
function visitor(ip: string | null = "203.0.113.7") {
  return appRouter.createCaller(async () => ({
    auth: null,
    db: env.db,
    request: new Request("https://api.test", { headers: ip ? { "cf-connecting-ip": ip } : {} }),
    session: null,
    membership: null,
    companyId: null,
    role: null,
    isPlatformAdmin: false,
    platformRole: null,
    impersonation: null,
    impersonationHeaderRejected: false,
    companyHeaderRejected: false,
  })) as unknown as ReturnType<typeof appRouter.createCaller>;
}

async function put(url: string, bytes: number) {
  const headers = new Headers({ "content-type": "application/octet-stream", "content-length": String(bytes) });
  return files.handleDieFileUpload(new Request(new URL(url, "https://api.test"), { method: "PUT", body: new Uint8Array(bytes).fill(7), headers }), { bucket: r2 as never });
}

async function plant(opts: { drawing?: boolean; ownerCustomer?: boolean } = {}) {
  r2 ??= new FakeR2();
  workersEnv.DIE_FILES = r2;
  const { companyId } = await env.seedCompany({ settings: { dieRoom: { newCopyOnTrial: false } } });
  const owner = opts.ownerCustomer ? await env.seedCustomer(companyId) : null;
  const section = await env.seedDie(companyId, {
    series: "Domal",
    sectionCode: "12170",
    name: "Domal channel",
    alloy: "6063",
    temper: "T6",
    weightMinG: 5_900,
    weightMaxG: 6_200,
    wallTenthMm: 12,
    ...(owner ? { ownerCustomerId: owner } : {}),
  });
  const as = (role: CompanyRole) => env.caller({ role, companyId });
  const dieRoom = as("die_room");
  const copy = await dieRoom.dieInstance.create({ sectionId: section });
  if (opts.drawing !== false) {
    const begun = await dieRoom.dieInstance.files.beginUpload({ sectionId: section, kind: "pdf", name: "12170-domal.pdf", size: 2048, mime: "application/pdf", pressDrawing: true });
    expect((await put(begun.uploadUrl, 2048)).status).toBe(200);
    await dieRoom.dieInstance.files.commit({ uploadId: begun.uploadId });
  }
  return { companyId, section, owner, copy, as, dieRoom };
}
const sha256 = async (s: string) =>
  Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))), (b) => b.toString(16).padStart(2, "0")).join("");

describe("create", () => {
  test("a 43-character token comes back once; only its SHA-256 is stored; default expiry is 7 days", async () => {
    const p = await plant();
    const t0 = new Date("2026-11-01T06:00:00Z");
    setClockForTests(t0);
    const made = await p.dieRoom.die.share.create({ sectionId: p.section });
    expect(made.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(made.path).toBe(`/share/die/${made.token}`);
    expect(made.url).toBe(`https://app.test/share/die/${made.token}`);
    expect(made.expiresAt.getTime()).toBe(t0.getTime() + 7 * DAY);
    const [row] = await env.db.select().from(dieShare).where(eq(dieShare.id, made.id));
    expect(row!.tokenHash).toBe(await sha256(made.token));
    expect(JSON.stringify(row)).not.toContain(made.token);
    expect(row).toMatchObject({ companyId: p.companyId, sectionId: p.section, customerId: null, revokedAt: null, viewCount: 0 });
    // Two links never share a token.
    const second = await p.dieRoom.die.share.create({ sectionId: p.section });
    expect(second.token).not.toBe(made.token);
  });

  test("days: up to 30 is allowed; 0, 31 and a fraction are refused", async () => {
    const p = await plant();
    setClockForTests(new Date("2026-11-01T06:00:00Z"));
    const long = await p.dieRoom.die.share.create({ sectionId: p.section, days: 30 });
    expect(long.expiresAt.getTime()).toBe(new Date("2026-11-01T06:00:00Z").getTime() + 30 * DAY);
    for (const days of [0, 31, 2.5]) await expect(p.dieRoom.die.share.create({ sectionId: p.section, days }), String(days)).rejects.toThrow();
  });

  test("the audit row names the party and the file, never the token or its hash", async () => {
    const p = await plant();
    const party = await env.seedCustomer(p.companyId);
    const made = await p.dieRoom.die.share.create({ sectionId: p.section, customerId: party, days: 3, note: "for the quote" });
    const rows = await env.db.select().from(auditLog).where(and(eq(auditLog.companyId, p.companyId), eq(auditLog.action, "die_share.create")));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ subjectType: "die", subjectId: p.section });
    expect(rows[0]!.meta).toMatchObject({ shareId: made.id, customerId: party, filename: "12170-domal.pdf", days: 3, section: "Domal 12170" });
    const text = JSON.stringify(rows[0]);
    expect(text).not.toContain(made.token);
    expect(text).not.toContain(await sha256(made.token));
  });

  test("refusals: no press drawing, an unknown section or party, another plant's section or party", async () => {
    const bare = await plant({ drawing: false });
    await expect(bare.dieRoom.die.share.create({ sectionId: bare.section })).rejects.toThrow("This section has no press drawing to share");
    const p = await plant();
    const q = await plant();
    await expect(p.dieRoom.die.share.create({ sectionId: "nope" })).rejects.toThrow("Section not found");
    await expect(p.dieRoom.die.share.create({ sectionId: q.section })).rejects.toThrow("Section not found");
    const foreignParty = await env.seedCustomer(q.companyId);
    await expect(p.dieRoom.die.share.create({ sectionId: p.section, customerId: foreignParty })).rejects.toThrow("Customer not found");
  });

  test("a section owned by a customer is shared with that owner only", async () => {
    const p = await plant({ ownerCustomer: true });
    const other = await env.seedCustomer(p.companyId);
    await expect(p.dieRoom.die.share.create({ sectionId: p.section })).rejects.toThrow(/^This die belongs to /);
    await expect(p.dieRoom.die.share.create({ sectionId: p.section, customerId: other })).rejects.toThrow(/^This die belongs to /);
    await expect(p.dieRoom.die.share.create({ sectionId: p.section, customerId: p.owner! })).resolves.toMatchObject({ token: expect.any(String) });
    // Nothing was stored for the refused tries.
    expect(await env.db.select().from(dieShare).where(eq(dieShare.sectionId, p.section))).toHaveLength(1);
  });
});

describe("list and revoke", () => {
  test("list shows status, party and view counts, newest first, and never a token or hash", async () => {
    const p = await plant();
    const party = await env.seedCustomer(p.companyId);
    setClockForTests(new Date("2026-11-01T06:00:00Z"));
    const a = await p.dieRoom.die.share.create({ sectionId: p.section, days: 1 });
    setClockForTests(new Date("2026-11-01T06:00:01Z"));
    const b = await p.dieRoom.die.share.create({ sectionId: p.section, customerId: party });
    await p.dieRoom.die.share.revoke({ id: b.id });
    setClockForTests(new Date("2026-11-03T06:00:00Z"));
    const c = await p.dieRoom.die.share.create({ sectionId: p.section });
    const out = await p.dieRoom.die.share.list({ sectionId: p.section });
    expect(out.items.map((i) => [i.id, i.status])).toEqual([[c.id, "active"], [b.id, "revoked"], [a.id, "expired"]]);
    expect(out.items[1]).toMatchObject({ customerId: party, partyName: expect.stringContaining("Customer") });
    expect(out.nextCursor).toBeNull();
    const text = JSON.stringify(out);
    for (const m of [a, b, c]) {
      expect(text).not.toContain(m.token);
      expect(text).not.toContain(await sha256(m.token));
    }
    expect(text).not.toContain("tokenHash");
  });

  test("list pages with a cursor", async () => {
    const p = await plant();
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      setClockForTests(new Date(Date.UTC(2026, 10, 1, 6, 0, i)));
      ids.push((await p.dieRoom.die.share.create({ sectionId: p.section })).id);
    }
    const first = await p.dieRoom.die.share.list({ sectionId: p.section, limit: 2 });
    expect(first.items.map((i) => i.id)).toEqual([ids[2]!, ids[1]!]);
    expect(first.nextCursor).not.toBeNull();
    const next = await p.dieRoom.die.share.list({ sectionId: p.section, limit: 2, cursor: first.nextCursor! });
    expect(next.items.map((i) => i.id)).toEqual([ids[0]!]);
    expect(next.nextCursor).toBeNull();
  });

  test("revoke stops the link, writes one audit row, and a second revoke is a quiet success", async () => {
    const p = await plant();
    const made = await p.dieRoom.die.share.create({ sectionId: p.section });
    await expect(visitor().die.share.view({ token: made.token })).resolves.toBeDefined();
    expect(await p.dieRoom.die.share.revoke({ id: made.id })).toEqual({ success: true, alreadyRevoked: false });
    expect(await p.as("manager").die.share.revoke({ id: made.id })).toEqual({ success: true, alreadyRevoked: true });
    await expect(visitor().die.share.view({ token: made.token })).rejects.toThrow(GONE);
    const rows = await env.db.select().from(auditLog).where(and(eq(auditLog.companyId, p.companyId), eq(auditLog.action, "die_share.revoke")));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.meta).toMatchObject({ shareId: made.id });
    const [row] = await env.db.select().from(dieShare).where(eq(dieShare.id, made.id));
    expect(row!.revokedAt).not.toBeNull();
    expect(row!.revokedBy).not.toBeNull();
  });

  test("another plant can neither list, revoke nor see a link", async () => {
    const p = await plant();
    const q = await plant();
    const made = await p.dieRoom.die.share.create({ sectionId: p.section });
    await expect(q.dieRoom.die.share.revoke({ id: made.id })).rejects.toThrow("Share link not found");
    await expect(q.dieRoom.die.share.list({ sectionId: p.section })).rejects.toThrow("Section not found");
    expect((await q.dieRoom.die.share.list({ sectionId: q.section })).items).toHaveLength(0);
    // And the revoke attempt did nothing.
    await expect(visitor().die.share.view({ token: made.token })).resolves.toBeDefined();
  });
});

describe("the public view", () => {
  test("shows the section, a signed drawing URL, the band and the best tier; nothing about stock, cost or customers", async () => {
    const p = await plant();
    await env.seedBundles(p.companyId, p.section, 3);
    const made = await p.dieRoom.die.share.create({ sectionId: p.section });
    const t0 = new Date("2026-11-01T06:00:00Z");
    setClockForTests(t0);
    const view = await visitor().die.share.view({ token: made.token });
    expect(view.section).toEqual({ series: "Domal", sectionCode: "12170", name: "Domal channel", alloy: "6063", temper: "T6" });
    expect(view.bands[0]).toEqual({ wallTenthMm: 12, weightMinG: 5_900, weightMaxG: 6_200, label: null, primary: true });
    expect(view.tier).toBeNull();
    expect(view.owner).toBeNull();
    expect(view.drawing!.filename).toBe("12170-domal.pdf");
    expect(view.drawing!.expiresAt).toBe(t0.getTime() + 10 * 60 * 1000);
    // The URL is a genuine signed GET for the section's own key.
    const u = new URL(view.drawing!.url);
    expect(u.pathname).toBe("/files/dies");
    const key = u.searchParams.get("key")!;
    expect(key.startsWith(`${p.companyId}/dies/${p.section}/`)).toBe(true);
    expect(await files.verifyDieFileUrl(key, Number(u.searchParams.get("exp")), u.searchParams.get("sig")!, t0.getTime())).toBe(true);
    // The answer carries exactly these keys: no stock, cost, customer, copy or company-id fields.
    expect(Object.keys(view).sort()).toEqual(["bands", "drawing", "expiresAt", "from", "owner", "section", "tier"]);
    const text = JSON.stringify(view);
    for (const word of ["bundle", "stock", "price", "rate", "cost", "customer", "companyId", p.copy.code, "12170-1"]) {
      expect(text.toLowerCase(), word).not.toContain(word.toLowerCase());
    }
  });

  test("each view mints a fresh signed URL and counts the view", async () => {
    const p = await plant();
    const made = await p.dieRoom.die.share.create({ sectionId: p.section });
    setClockForTests(new Date("2026-11-01T06:00:00Z"));
    const one = await visitor().die.share.view({ token: made.token });
    setClockForTests(new Date("2026-11-01T06:05:00Z"));
    const two = await visitor().die.share.view({ token: made.token });
    expect(two.drawing!.expiresAt).toBe(one.drawing!.expiresAt + 5 * 60 * 1000);
    expect(two.drawing!.url).not.toBe(one.drawing!.url);
    const out = await p.dieRoom.die.share.list({ sectionId: p.section });
    expect(out.items[0]).toMatchObject({ viewCount: 2 });
    expect(out.items[0]!.lastViewedAt!.getTime()).toBe(new Date("2026-11-01T06:05:00Z").getTime());
  });

  test("the best tier of the live copies shows; a retired copy does not count", async () => {
    const p = await plant();
    const second = await p.dieRoom.dieInstance.create({ sectionId: p.section });
    await env.db.update(dieInstance).set({ tierRank: 3 }).where(eq(dieInstance.id, p.copy.id));
    await env.db.update(dieInstance).set({ tierRank: 2 }).where(eq(dieInstance.id, second.id));
    const made = await p.dieRoom.die.share.create({ sectionId: p.section });
    expect((await visitor().die.share.view({ token: made.token })).tier).toBe(2);
    await env.db.update(dieInstance).set({ status: "retired" }).where(eq(dieInstance.id, second.id));
    expect((await visitor().die.share.view({ token: made.token })).tier).toBe(3);
  });

  test("the owner is named only to the party the link was made for", async () => {
    const p = await plant({ ownerCustomer: true });
    const made = await p.dieRoom.die.share.create({ sectionId: p.section, customerId: p.owner! });
    const view = await visitor().die.share.view({ token: made.token });
    expect(view.owner).toMatch(/^Customer /);
    // A plant-owned section shared with a named party does not name anyone.
    const q = await plant();
    const party = await env.seedCustomer(q.companyId);
    const plain = await q.dieRoom.die.share.create({ sectionId: q.section, customerId: party });
    expect((await visitor().die.share.view({ token: plain.token })).owner).toBeNull();
    // The section is handed to another owner after the link was made: the link no longer names them.
    const other = await env.seedCustomer(q.companyId);
    await env.db.update(die).set({ ownerCustomerId: other }).where(eq(die.id, q.section));
    expect((await visitor().die.share.view({ token: plain.token })).owner).toBeNull();
  });

  test("no press drawing now (removed after the link was made): the page still opens, with no drawing", async () => {
    const p = await plant();
    const made = await p.dieRoom.die.share.create({ sectionId: p.section });
    await env.db.update(die).set({ drawingKey: null }).where(eq(die.id, p.section));
    expect((await visitor().die.share.view({ token: made.token })).drawing).toBeNull();
  });

  test("expired, revoked, unknown, malformed and deleted-section links all answer the same sentence", async () => {
    const p = await plant();
    setClockForTests(new Date("2026-11-01T06:00:00Z"));
    const live = await p.dieRoom.die.share.create({ sectionId: p.section, days: 2 });
    const revoked = await p.dieRoom.die.share.create({ sectionId: p.section });
    await p.dieRoom.die.share.revoke({ id: revoked.id });
    const cases = [revoked.token, "x".repeat(43), "short", "", "../../etc/passwd", "a".repeat(300)];
    for (const token of cases) await expect(visitor().die.share.view({ token }), token).rejects.toThrow(token.length > 200 || token === "" ? undefined : GONE);
    // Just before the expiry it opens; at the expiry it is gone.
    setClockForTests(new Date(live.expiresAt.getTime() - 1));
    await expect(visitor().die.share.view({ token: live.token })).resolves.toBeDefined();
    setClockForTests(live.expiresAt);
    await expect(visitor().die.share.view({ token: live.token })).rejects.toThrow(GONE);
    // A deleted section and a suspended plant behave the same.
    setClockForTests(new Date("2026-11-01T07:00:00Z"));
    await env.db.update(die).set({ deletedAt: new Date() }).where(eq(die.id, p.section));
    await expect(visitor().die.share.view({ token: live.token })).rejects.toThrow(GONE);
  });

  test("a suspended plant's links are gone", async () => {
    const p = await plant();
    const made = await p.dieRoom.die.share.create({ sectionId: p.section });
    await env.db.update(company).set({ status: "suspended" }).where(eq(company.id, p.companyId));
    await expect(visitor().die.share.view({ token: made.token })).rejects.toThrow(GONE);
    await env.db.update(company).set({ status: "active" }).where(eq(company.id, p.companyId));
  });

  test("tenancy: a link shows its own plant's section even when another plant has the same section code", async () => {
    const p = await plant();
    const q = await plant();
    await env.db.update(die).set({ name: "Plant Q channel" }).where(eq(die.id, q.section));
    const made = await p.dieRoom.die.share.create({ sectionId: p.section });
    const view = await visitor().die.share.view({ token: made.token });
    expect(view.section.name).toBe("Domal channel");
    expect(view.drawing!.url).toContain(encodeURIComponent(`${p.companyId}/dies/${p.section}/`));
    expect(view.drawing!.url).not.toContain(q.companyId);
  });
});

describe("who may", () => {
  test("create, list and revoke: owner, admin, manager and the die room; everyone else is refused", async () => {
    const p = await plant();
    for (const role of ["owner", "admin", "manager", "die_room"] as const) {
      const made = await p.as(role).die.share.create({ sectionId: p.section });
      await expect(p.as(role).die.share.list({ sectionId: p.section }), role).resolves.toBeDefined();
      await expect(p.as(role).die.share.revoke({ id: made.id }), role).resolves.toMatchObject({ success: true });
    }
    const made = await p.dieRoom.die.share.create({ sectionId: p.section });
    for (const role of ["office", "accountant", "supervisor", "packer", "foundry", "press", "storekeeper", "operator", "viewer"] as const) {
      await expect(p.as(role).die.share.create({ sectionId: p.section }), `create ${role}`).rejects.toThrow("You don't have permission to do that");
      await expect(p.as(role).die.share.list({ sectionId: p.section }), `list ${role}`).rejects.toThrow("You don't have permission to do that");
      await expect(p.as(role).die.share.revoke({ id: made.id }), `revoke ${role}`).rejects.toThrow("You don't have permission to do that");
    }
  });

  test("the public view needs no session at all, and a signed-out caller cannot create", async () => {
    const p = await plant();
    const made = await p.dieRoom.die.share.create({ sectionId: p.section });
    await expect(env.caller(null).die.share.view({ token: made.token })).resolves.toBeDefined();
    await expect(env.caller(null).die.share.create({ sectionId: p.section })).rejects.toThrow();
    await expect(env.caller(null).die.share.list({ sectionId: p.section })).rejects.toThrow();
  });
});

describe("rate limit", () => {
  test("per IP: the 61st read in a window is a neutral 429; another IP is not affected; the next window opens again", async () => {
    const p = await plant();
    const t0 = new Date("2026-11-02T06:00:00Z").getTime();
    setClockForTests(new Date(t0));
    const made = await p.dieRoom.die.share.create({ sectionId: p.section });
    // Guesses count too, so the limit cannot be used to find a link.
    for (let i = 0; i < share.SHARE_VIEW_LIMIT.perIp; i++) await expect(visitor("198.51.100.1").die.share.view({ token: "nope" })).rejects.toThrow(GONE);
    await expect(visitor("198.51.100.1").die.share.view({ token: made.token })).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS", message: share.SHARE_BUSY });
    await expect(visitor("198.51.100.2").die.share.view({ token: made.token })).resolves.toBeDefined();
    setClockForTests(new Date(t0 + share.SHARE_VIEW_LIMIT.windowMs + 1));
    await expect(visitor("198.51.100.1").die.share.view({ token: made.token })).resolves.toBeDefined();
  });

  test("per link: the 31st read of one link in a window is limited, from any IP; other links are not", async () => {
    const p = await plant();
    setClockForTests(new Date("2026-11-02T08:00:00Z"));
    const a = await p.dieRoom.die.share.create({ sectionId: p.section });
    const b = await p.dieRoom.die.share.create({ sectionId: p.section });
    for (let i = 0; i < share.SHARE_VIEW_LIMIT.perLink; i++) await visitor(`192.0.2.${i + 1}`).die.share.view({ token: a.token });
    await expect(visitor("192.0.2.200").die.share.view({ token: a.token })).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    await expect(visitor("192.0.2.200").die.share.view({ token: b.token })).resolves.toBeDefined();
  });

  test("the counters key on the IP and on a hash of the link, never the token; no readable IP is limited per link only", async () => {
    const p = await plant();
    setClockForTests(new Date("2026-11-02T10:00:00Z"));
    const made = await p.dieRoom.die.share.create({ sectionId: p.section });
    await visitor("203.0.113.99").die.share.view({ token: made.token });
    await visitor(null).die.share.view({ token: made.token });
    const keys = (await env.db.select().from(authThrottle).where(like(authThrottle.key, "dieshare:%"))).map((r) => r.key);
    expect(keys.some((k) => k === "dieshare:i:203.0.113.99")).toBe(true);
    expect(keys.some((k) => k.startsWith("dieshare:t:"))).toBe(true);
    expect(keys.join("|")).not.toContain(made.token);
    // The caller with no readable IP left no IP row of its own.
    expect(keys.filter((k) => /^dieshare:i:(null|undefined|unknown)?$/.test(k))).toHaveLength(0);
  });
});

import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";

import { die, invite, user, waitlistRequest } from "@orrn/db/schema";
import { eq } from "drizzle-orm";

import { isDevLocalOrigin } from "../src/lib/devOrigins";
import { createTestEnv, type TestEnv } from "./harness";

let env: TestEnv;

beforeAll(async () => {
  env = await createTestEnv();
});

afterAll(async () => {
  await env.dispose();
});

const uid = () => crypto.randomUUID();

/** Capture the rendered email html (the mock mailer console.logs it) while `fn` runs. */
async function captureEmail(fn: () => Promise<unknown>) {
  const lines: string[] = [];
  const spy = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  });
  try {
    await fn();
  } finally {
    spy.mockRestore();
  }
  return lines.join("\n");
}

function inviteUrl(html: string) {
  const match = html.match(/href="([^"]*\/invite\/[^"]+)"/);
  return match?.[1] ?? null;
}

describe("invites (S7)", () => {
  test("invite link uses WEB_PUBLIC_URL", async () => {
    const { companyId } = await env.seedCompany();
    const html = await captureEmail(() =>
      env.caller({ role: "owner", companyId }).invite.create({ email: `a.${uid()}@test.orrn`, role: "viewer" }),
    );
    const url = inviteUrl(html);
    expect(url).not.toBeNull();
    expect(url!.startsWith("https://app.test/invite/")).toBe(true);
    expect(url).not.toContain("localhost");
  });

  test("invite for Ramesh@X.com is accepted by ramesh@x.com", async () => {
    const { companyId } = await env.seedCompany();
    const tag = uid().slice(0, 8);
    const mixed = `Ramesh.${tag}@X.com`;
    const html = await captureEmail(() =>
      env.caller({ role: "owner", companyId }).invite.create({ email: mixed, role: "operator" }),
    );
    const token = inviteUrl(html)!.split("/invite/")[1]!;

    // Better Auth stores the signed-up address lower-cased.
    const userId = uid();
    await env.db.insert(user).values({ id: userId, name: "Ramesh", email: mixed.toLowerCase() });

    const accepted = await env.caller(null).invite.acceptByToken({ token }).catch((e) => e);
    // Anonymous callers are still refused...
    expect(accepted).toMatchObject({ code: "UNAUTHORIZED" });

    // ...but the lower-cased account passes the email check, whatever case the invite was typed in.
    const { appRouter } = await import("../src/routers/index");
    const authed = appRouter.createCaller(async () => ({
      auth: null,
      db: env.db,
      request: new Request("https://api.test"),
      impersonation: null,
      impersonationHeaderRejected: false,
      companyHeaderRejected: false,
      session: { user: { id: userId, name: "Ramesh", email: mixed.toLowerCase() }, session: { id: "s" } },
      membership: null,
      companyId: null,
      role: null,
      isPlatformAdmin: false,
      platformRole: null,
    }) as never);
    await expect(authed.invite.acceptByToken({ token })).resolves.toEqual({ success: true });

    const [row] = await env.db.select().from(invite).where(eq(invite.companyId, companyId));
    expect(row!.acceptedAt).not.toBeNull();
    expect(row!.email).toBe(mixed.toLowerCase());
  });

  test("a legacy mixed-case invite row is still accepted by the lower-case account", async () => {
    const { companyId, users } = await env.seedCompany();
    const token = uid();
    const tokenHash = Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token))),
    )
      .map((x) => x.toString(16).padStart(2, "0"))
      .join("");
    const tag = uid().slice(0, 8);
    await env.db.insert(invite).values({
      id: uid(),
      companyId,
      email: `Legacy.${tag}@X.com`,
      role: "viewer",
      tokenHash,
      expiresAt: new Date(Date.now() + 60_000),
      invitedBy: users.owner.id,
    });
    const userId = uid();
    await env.db.insert(user).values({ id: userId, name: "L", email: `legacy.${tag}@x.com` });
    const { appRouter } = await import("../src/routers/index");
    const authed = appRouter.createCaller(async () => ({
      auth: null,
      db: env.db,
      request: new Request("https://api.test"),
      impersonation: null,
      impersonationHeaderRejected: false,
      companyHeaderRejected: false,
      session: { user: { id: userId, name: "L", email: `legacy.${tag}@x.com` }, session: { id: "s" } },
      membership: null,
      companyId: null,
      role: null,
      isPlatformAdmin: false,
      platformRole: null,
    }) as never);
    await expect(authed.invite.acceptByToken({ token })).resolves.toEqual({ success: true });
  });
});

describe("company sequence (S8)", () => {
  test("two concurrent nextCompanySeq calls return distinct values", async () => {
    const { companyId } = await env.seedCompany();
    const { nextCompanySeq } = await import("../src/lib/sequence");
    const values = await Promise.all(
      Array.from({ length: 20 }, () => nextCompanySeq({ db: env.db }, companyId)),
    );
    expect(new Set(values).size).toBe(20);
    expect([...values].sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    expect(await nextCompanySeq({ db: env.db }, companyId)).toBe(21);
  });
});

describe("dev-only CORS origins (S11)", () => {
  test("localhost origins are only allowed in development", () => {
    expect(isDevLocalOrigin({ NODE_ENV: "development" }, "http://localhost:3001")).toBe(true);
    expect(isDevLocalOrigin({ NODE_ENV: "development" }, "http://localhost:3002")).toBe(true);
    // Any port: every worktree runs its own web port (see corsOrigin.test.ts for the full matrix).
    expect(isDevLocalOrigin({ NODE_ENV: "development" }, "http://localhost:3003")).toBe(true);
    expect(isDevLocalOrigin({ NODE_ENV: "development" }, "http://127.0.0.1:3291")).toBe(true);
    expect(isDevLocalOrigin({ NODE_ENV: "development" }, "http://localhost.evil.example:3003")).toBe(false);
    expect(isDevLocalOrigin({ NODE_ENV: "production" }, "http://localhost:3001")).toBe(false);
    expect(isDevLocalOrigin({ NODE_ENV: "test" }, "http://localhost:3002")).toBe(false);
    expect(isDevLocalOrigin({}, "http://localhost:3001")).toBe(false);
  });
});

describe("dies (S16)", () => {
  const dieInput = (series: string, sectionCode: string) => ({
    series,
    sectionCode,
    weightMinG: 1000,
    weightMaxG: 2000,
  });

  test("creating a die with the series+section of a deleted die → CONFLICT 'A deleted die uses this code'", async () => {
    const { companyId } = await env.seedCompany();
    const owner = env.caller({ role: "owner", companyId });
    const { id } = await owner.die.create(dieInput("Z", "DEL-1"));
    await owner.die.delete({ id });
    await expect(owner.die.create(dieInput("Z", "DEL-1"))).rejects.toMatchObject({
      code: "CONFLICT",
      message: "A deleted die uses this code",
    });
  });

  test("renaming a die onto a deleted die's code → CONFLICT", async () => {
    const { companyId } = await env.seedCompany();
    const owner = env.caller({ role: "owner", companyId });
    const gone = await owner.die.create(dieInput("Z", "DEL-2"));
    await owner.die.delete({ id: gone.id });
    const live = await owner.die.create(dieInput("Z", "LIVE-2"));
    await expect(owner.die.update({ ...dieInput("Z", "DEL-2"), id: live.id })).rejects.toMatchObject({
      code: "CONFLICT",
      message: "A deleted die uses this code",
    });
  });

  test("validateImport flags a deleted-die code as an error row, not a valid new row", async () => {
    const { companyId } = await env.seedCompany();
    const owner = env.caller({ role: "owner", companyId });
    const gone = await owner.die.create(dieInput("Z", "DEL-4"));
    await owner.die.delete({ id: gone.id });
    await owner.die.create(dieInput("Z", "LIVE-4"));
    const res = await owner.die.validateImport([
      dieInput("Z", "DEL-4"),
      dieInput("Z", "LIVE-4"),
      dieInput("Z", "FRESH-4"),
    ]);
    expect(res.errors.map((r) => r.sectionCode)).toEqual(["DEL-4"]);
    expect(res.errors[0]!.error).toBe("A deleted die uses this code");
    expect(res.duplicates.map((r) => r.sectionCode)).toEqual(["LIVE-4"]);
    expect(res.validRows.map((r) => r.sectionCode)).toEqual(["FRESH-4"]);
  });

  test("import of a code held by a deleted die → CONFLICT, not 500", async () => {
    const { companyId } = await env.seedCompany();
    const owner = env.caller({ role: "owner", companyId });
    const gone = await owner.die.create(dieInput("Z", "DEL-3"));
    await owner.die.delete({ id: gone.id });
    await expect(
      owner.die.processImport({ newRows: [dieInput("Z", "DEL-3")], updatedRows: [] }),
    ).rejects.toMatchObject({ code: "CONFLICT", message: "A deleted die uses this code" });
  });
});

describe("input bounds (S15)", () => {
  test("createReceipt rejects weightKg 0 / pieces 0 / length 0 (BAD_REQUEST)", async () => {
    const { companyId } = await env.seedCompany();
    const dieId = await env.seedDie(companyId);
    const owner = env.caller({ role: "owner", companyId });
    const good = { quantity: 5, weightG: 25_000, lengthMm: 3000 };
    for (const bad of [{ weightG: 0 }, { quantity: 0 }, { lengthMm: 0 }]) {
      await expect(
        owner.bundle.createReceipt({ dieId, unit: "pcs", rows: [{ ...good, ...bad }] }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
    await expect(
      owner.bundle.createReceipt({ dieId, unit: "pcs", rows: [good] }),
    ).resolves.toBeDefined();
  });

  test("bundle.bulkImport rejects zero weight/length/quantity rows", async () => {
    const { companyId } = await env.seedCompany();
    const owner = env.caller({ role: "owner", companyId });
    await expect(
      owner.bundle.bulkImport({
        rows: [{ dieSeries: "A", dieSectionCode: "B", quantity: 1, weightG: 0, lengthMm: 3000 }],
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  test("customer.importCsv rejects > 2000 rows", async () => {
    const { companyId } = await env.seedCompany();
    const owner = env.caller({ role: "owner", companyId });
    const rows = Array.from({ length: 2001 }, (_, i) => ({ name: `C${i}` }));
    await expect(owner.customer.importCsv(rows)).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  test("die imports reject > 2000 rows", async () => {
    const { companyId } = await env.seedCompany();
    const owner = env.caller({ role: "owner", companyId });
    const rows = Array.from({ length: 2001 }, (_, i) => ({
      series: "S",
      sectionCode: `C${i}`,
      weightMinG: 1,
      weightMaxG: 2,
    }));
    await expect(owner.die.validateImport(rows)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(owner.die.processImport({ newRows: rows, updatedRows: [] })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await expect(owner.die.processImport({ newRows: [], updatedRows: rows.map((r) => ({ ...r, existingId: "x" })) })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  test("strings over 500 chars rejected on name/notes fields", async () => {
    const { companyId } = await env.seedCompany();
    const owner = env.caller({ role: "owner", companyId });
    const long = "x".repeat(501);
    await expect(owner.customer.create({ name: long })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(owner.customer.create({ name: "ok", notes: long })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      owner.die.create({ series: "S", sectionCode: "L1", name: long, weightMinG: 1, weightMaxG: 2 }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      owner.die.create({ series: "S", sectionCode: "L2", notes: long, weightMinG: 1, weightMaxG: 2 }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const dieId = await env.seedDie(companyId);
    await expect(
      owner.bundle.createReceipt({
        dieId,
        unit: "pcs",
        notes: long,
        rows: [{ quantity: 1, weightG: 1000, lengthMm: 1000 }],
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      env.caller(null).waitlist.submit({
        companyName: long,
        requesterName: "n",
        requesterEmail: "n@test.orrn",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      env.caller(null).waitlist.submit({
        companyName: "c",
        requesterName: "n",
        requesterEmail: "n@test.orrn",
        notes: long,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  test("die geometry keeps 0.1 mm precision; weights round to whole grams (R16)", async () => {
    const { companyId } = await env.seedCompany();
    const owner = env.caller({ role: "owner", companyId });
    const { id } = await owner.die.create({
      series: "S",
      sectionCode: "F1",
      thicknessMm: 38.1,
      legMm: 12.34,
      widthMm: 20,
      weightMinG: 2400.4,
      weightMaxG: 2600.6,
    });
    const [row] = await env.db.select().from(die).where(eq(die.id, id));
    expect(row!.thicknessMm).toBe(38.1);
    expect(row!.legMm).toBe(12.3); // finer than 0.1 mm is rounded away
    expect(row!.widthMm).toBe(20);
    expect(row!.weightMinG).toBe(2400);
    expect(row!.weightMaxG).toBe(2601);

    // An existing die with decimal geometry can be re-saved (update path).
    await expect(
      owner.die.update({ id, series: "S", sectionCode: "F1", thicknessMm: 38.1, weightMinG: 2400.4, weightMaxG: 2600 }),
    ).resolves.toBeDefined();
  });

  test("die geometry and weights reject negatives, zero weights and non-finite values", async () => {
    const { companyId } = await env.seedCompany();
    const owner = env.caller({ role: "owner", companyId });
    const base = { series: "S", sectionCode: "F2", weightMinG: 100, weightMaxG: 200 };
    for (const bad of [
      { legMm: -1 },
      { legMm: Number.NaN },
      { weightMinG: 0 },
      { weightMinG: 0.3 },
      { weightMaxG: -5 },
      { weightMinG: Number.POSITIVE_INFINITY },
      { weightMinG: 300 }, // min > max still refused
    ]) {
      await expect(owner.die.create({ ...base, ...bad })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
  });
});

describe("waitlist (S18)", () => {
  async function seedRequest(status: "pending" | "approved" | "rejected") {
    const id = uid();
    await env.db.insert(waitlistRequest).values({
      id,
      companyName: "Co",
      requesterName: "R",
      requesterEmail: `r.${id}@test.orrn`,
      status,
    });
    return id;
  }

  test("waitlistReject of an approved request → BAD_REQUEST", async () => {
    const id = await seedRequest("approved");
    await expect(env.caller({ platformRole: "super_admin" }).platform.waitlistReject({ id })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    const [row] = await env.db.select().from(waitlistRequest).where(eq(waitlistRequest.id, id));
    expect(row!.status).toBe("approved");
  });

  test("waitlistReject of a pending request rejects it; unknown id → NOT_FOUND", async () => {
    const id = await seedRequest("pending");
    await env.caller({ platformRole: "super_admin" }).platform.waitlistReject({ id });
    const [row] = await env.db.select().from(waitlistRequest).where(eq(waitlistRequest.id, id));
    expect(row!.status).toBe("rejected");
    await expect(
      env.caller({ platformRole: "super_admin" }).platform.waitlistReject({ id: uid() }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

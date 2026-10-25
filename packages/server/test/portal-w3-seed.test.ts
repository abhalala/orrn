/**
 * W3-PORTAL-S dev seed: KD Extrusion's party login (party@orrn.local) is active, sees its two granted
 * sections plus the 12230 it owns, has the portal booking SO-4 and a certificate (chemistry pending, casts cited)
 * on its completed dispatch, and never Royal Aluminium's dispatch. Running the seed twice gives the
 * same rows.
 */
import { afterAll, beforeAll, expect, test } from "bun:test";

import { customerPortalSection, customerPortalUser, membership, salesOrder, testCertificate, user } from "@orrn/db/schema";
import { asc, eq } from "drizzle-orm";

import { createTestEnv, type TestEnv } from "./harness";
import { precreateDevSeedUsers } from "./dev-seed-fixture";
import { portalHelpers } from "./portal-w3-fixture";

let env: TestEnv;

beforeAll(async () => {
  env = await createTestEnv();
}, 60_000);
afterAll(async () => {
  await env.dispose();
});

const h = portalHelpers(() => env);

test("dev seed: KD's party login, two grants + owned 12230, SO-4 booking, a pending certificate; idempotent", async () => {
  await precreateDevSeedUsers(env);
  const seedPath = "../../../apps/server/src/dev-seed";
  const { seedDevData } = (await import(seedPath)) as {
    seedDevData: (db: TestEnv["db"], opts: { password: string }) => Promise<{ ok: boolean; accounts?: Record<string, string> }>;
  };
  const companyId = "dev-company-orrn";
  const snapshot = async () => ({
    users: await env.db
      .select({ id: customerPortalUser.id, status: customerPortalUser.status, customerId: customerPortalUser.customerId, email: customerPortalUser.email })
      .from(customerPortalUser)
      .where(eq(customerPortalUser.companyId, companyId)),
    grants: await env.db
      .select({ id: customerPortalSection.id, dieId: customerPortalSection.dieId })
      .from(customerPortalSection)
      .where(eq(customerPortalSection.companyId, companyId))
      .orderBy(asc(customerPortalSection.id)),
    orders: await env.db
      .select({ id: salesOrder.id, number: salesOrder.number, source: salesOrder.source, status: salesOrder.status })
      .from(salesOrder)
      .where(eq(salesOrder.source, "portal")),
    certs: await env.db
      .select({ id: testCertificate.id, number: testCertificate.number, chemistry: testCertificate.chemistry })
      .from(testCertificate)
      .where(eq(testCertificate.companyId, companyId)),
  });

  const first = await seedDevData(env.db, { password: "dev-seed-test" });
  expect(first.ok).toBe(true);
  expect(first.accounts?.party).toBe("party@orrn.local");
  const a = await snapshot();
  expect(a.users).toEqual([{ id: "dev-portal-user-kd", status: "active", customerId: "dev-customer-kd", email: "party@orrn.local" }]);
  expect(a.grants).toEqual([
    { id: "dev-portal-section-13090", dieId: "dev-die-13090" },
    { id: "dev-portal-section-14701", dieId: "dev-die-14701" },
  ]);
  expect(a.orders).toEqual([{ id: "dev-so-4", number: "SO-4", source: "portal", status: "booking" }]);
  expect(a.certs).toHaveLength(1);
  expect(a.certs[0]).toMatchObject({ id: "dev-cert-done-1", chemistry: "pending" });
  expect(a.certs[0]!.number).toMatch(/^TC\/\d{4}-\d{2}\/1$/);

  // Read through the real portal procedures as the party.
  const [party] = await env.db.select({ id: user.id }).from(user).where(eq(user.email, "party@orrn.local"));
  expect(await env.db.select().from(membership).where(eq(membership.userId, party!.id))).toHaveLength(0);
  const api = await h.headerCaller(party!.id);
  const sections = await api.portal.sections.visible();
  expect(sections.map((s) => s.sectionCode).sort()).toEqual(["12230", "13090", "14701"]);
  expect(sections.find((s) => s.sectionCode === "12230")).toMatchObject({ owned: true, granted: false });
  const dispatches = await api.portal.dispatches.list();
  expect(dispatches.items.map((d) => d.id)).toEqual(["dev-dispatch-done-1"]);
  expect(dispatches.items[0]).toMatchObject({ hasPackingList: true, hasCertificate: true });
  const cert = await api.portal.certificate.get({ dispatchId: "dev-dispatch-done-1" });
  // D28: the certificate lists the casts behind the bundles (pending until the foundry tests them).
  const certSnap = cert.snapshot as { casts: { castNo: string; status: string }[]; chemistry: { status: string } };
  expect(Array.isArray(certSnap.casts)).toBe(true);
  expect(certSnap.chemistry.status).toBe("pending");
  for (const c of certSnap.casts) expect(c.status).toBe("pending");
  expect(JSON.stringify(cert)).not.toMatch(/generatedBy|rate|paise/i);
  expect((await api.portal.orders.list()).items.map((o) => o.number)).toContain("SO-4");
  const office = env.caller({ role: "office", companyId });
  expect((await office.portal.users.list()).map((u) => u.email)).toEqual(["party@orrn.local"]);
  // The office's next order continues after the seeded book (SO-1..SO-10).
  const next = await env.caller({ role: "owner", companyId }).orders.create({
    customerId: "dev-customer-royal",
    lines: [{ sectionId: "dev-die-14701", cutLengthMm: 3658, kgG: 100_000 }],
  });
  expect(next.number).toBe("SO-11");

  expect((await seedDevData(env.db, { password: "dev-seed-test" })).ok).toBe(true);
  expect(await snapshot()).toEqual(a);
}, 120_000);

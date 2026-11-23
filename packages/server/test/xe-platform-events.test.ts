/**
 * XE PLATFORM row 83: the webhook outbox statements inside the hot batches (dispatch complete, invoice issue, bundle
 * void and restore). Each writes one row per subscribed endpoint when `api` is on, and none when it is off.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { wrapSecret } from "@orrn/crypto";
import { bundle, company, customer, salesOrderLine, webhookDelivery, webhookEndpoint } from "@orrn/db/schema";
import { gstinCheckDigit, WEBHOOK_EVENT_KEYS } from "@orrn/domain";
import { eq } from "drizzle-orm";

import { DEV_MASTER_KEY } from "./env-mock";
import { createTestEnv, type TestEnv } from "./harness";
import { salesHelpers, SLOW, type SalesPlant } from "./sales-fixture";

let env: TestEnv;
let setClock: typeof import("../src/lib/clock").setClockForTests;
beforeAll(async () => {
  env = await createTestEnv();
  setClock = (await import("../src/lib/clock")).setClockForTests;
});
afterAll(async () => {
  await env.dispose();
});
afterEach(() => setClock(null));

const { plant, plRow } = salesHelpers(() => env);
const gstin = (first14: string) => first14 + gstinCheckDigit(first14);
const OCT = new Date("2026-10-03T06:30:00.000Z");

async function eventPlant(modules: string[]): Promise<SalesPlant> {
  const p = await plant({
    settings: { letterhead: { legalName: "Fourcubes Aluminium Pvt Ltd", gstin: gstin("24AAACF1234A1Z"), address: "Plot 12, GIDC, Surat", phone: "+91 98250 00000" } },
  });
  await env.db.update(company).set({ modules }).where(eq(company.id, p.companyId));
  await env.db.update(customer).set({ taxId: gstin("24ABCDE1234F1Z") }).where(eq(customer.id, p.customerId));
  if (modules.includes("billing")) {
    await p.as("admin").billing.settings.save({ stateCode: "24", pincode: "394230", place: "Surat" });
    await p.as("admin").billing.hsn.seedDefaults();
  }
  await env.db.insert(webhookEndpoint).values({
    id: crypto.randomUUID(),
    companyId: p.companyId,
    url: "https://hooks.example.com/orrn",
    events: [...WEBHOOK_EVENT_KEYS],
    secretWrapped: await wrapSecret("whsec_test", DEV_MASTER_KEY),
  });
  return p;
}

async function events(companyId: string) {
  const rows = await env.db.select().from(webhookDelivery).where(eq(webhookDelivery.companyId, companyId));
  return rows.map((r) => ({ event: r.event, data: JSON.parse(r.payload).data as Record<string, unknown> }));
}

async function completed(p: SalesPlant) {
  setClock(OCT);
  const o = await p.order([{ dieId: p.dieA, kg: 100 }], { status: "confirmed" });
  await env.db.update(salesOrderLine).set({ ratePaise: 24_550 }).where(eq(salesOrderLine.id, o.lineIds[0]!));
  const serials = await p.pack(p.dieA, [{ kg: 50 }, { kg: 50 }], o.lineIds[0]!);
  const dispatchId = await p.held(serials);
  await p.owner.dispatch.complete({ id: dispatchId });
  return { dispatchId, plId: (await plRow(dispatchId))!.id };
}

describe("outbox rows from the hot batches", () => {
  test("dispatch.done and invoice.issued land with their batch; payloads carry no money", async () => {
    const p = await eventPlant(["billing", "api"]);
    const { dispatchId, plId } = await completed(p);
    const afterDispatch = await events(p.companyId);
    const done = afterDispatch.filter((e) => e.event === "dispatch.done");
    expect(done.length).toBe(1);
    expect(done[0]!.data.dispatchId).toBe(dispatchId);
    expect(done[0]!.data.bundles).toBe(2);

    const { id } = await p.as("office").billing.invoices.createDraft({ packingListIds: [plId] });
    await p.as("office").billing.invoices.issue({ id });
    const issued = (await events(p.companyId)).filter((e) => e.event === "invoice.issued");
    expect(issued.length).toBe(1);
    expect(issued[0]!.data.invoiceId).toBe(id);
    expect(JSON.stringify(await events(p.companyId))).not.toMatch(/paise|rate|total/i);
  }, SLOW);

  test("stock.adjusted on a hand void and restore of a bundle", async () => {
    const p = await eventPlant(["api"]);
    const [serial] = await p.pack(p.dieA, [{ kg: 40 }]);
    const id = (await env.db.select({ id: bundle.id }).from(bundle).where(eq(bundle.serial, serial!)).get())!.id;
    await p.as("supervisor").bundle.transitionStatus({ id, toStatus: "void", reason: "wrong section" });
    await p.as("supervisor").bundle.transitionStatus({ id, toStatus: "available", reason: "found" });
    const adj = (await events(p.companyId)).filter((e) => e.event === "stock.adjusted");
    expect(adj.map((e) => e.data.change)).toEqual(["voided", "restored"]);
    expect(adj[0]!.data.bundleId).toBe(id);
  }, SLOW);

  test("no rows when the plant has not named api, even with an endpoint", async () => {
    const p = await eventPlant([]);
    await completed(p);
    expect(await events(p.companyId)).toEqual([]);
  }, SLOW);
});

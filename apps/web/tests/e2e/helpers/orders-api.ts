import { expect, request, type APIRequestContext, type Page } from "@playwright/test";

import { localPassword } from "./accounts";
import { API_URL, WEB_ORIGIN } from "./ports";

/**
 * API helpers for the Wave 2 order and dispatch specs. Each spec makes its OWN party (unique name
 * and city), orders and bundles, so it never depends on, or changes, the seeded SO-1/SO-2/SO-3
 * (booked on the first customers and dies) or what another spec is doing. Orders are closed at
 * the end with `closeOrders`.
 */

export async function q<T>(page: Page, path: string, input: unknown): Promise<T> {
  const res = await page
    .context()
    .request.get(`${API_URL}/trpc/${path}?input=${encodeURIComponent(JSON.stringify(input))}`, { headers: { origin: WEB_ORIGIN } });
  expect(res.ok(), `${path} returned ${res.status()}: ${await res.text()}`).toBe(true);
  return (await res.json()).result.data as T;
}

export async function m<T>(page: Page, path: string, input: unknown): Promise<T> {
  const res = await page.context().request.post(`${API_URL}/trpc/${path}`, { headers: { origin: WEB_ORIGIN }, data: input });
  expect(res.ok(), `${path} returned ${res.status()}: ${await res.text()}`).toBe(true);
  return (await res.json()).result.data as T;
}

/**
 * Setup runs as the owner whatever role the page is signed in as (an office user cannot create a
 * customer or pack): one signed-in API context per worker, so a test about the office screens
 * still builds its data.
 */
let ownerContext: Promise<APIRequestContext> | null = null;
function owner(): Promise<APIRequestContext> {
  ownerContext ??= (async () => {
    const api = await request.newContext({ extraHTTPHeaders: { origin: WEB_ORIGIN } });
    const res = await api.post(`${API_URL}/api/auth/sign-in/email`, { data: { email: "owner@orrn.local", password: localPassword() } });
    expect(res.ok(), `owner sign-in returned ${res.status()}`).toBe(true);
    return api;
  })();
  return ownerContext;
}

async function oq<T>(path: string, input: unknown): Promise<T> {
  const res = await (await owner()).get(`${API_URL}/trpc/${path}?input=${encodeURIComponent(JSON.stringify(input))}`);
  expect(res.ok(), `${path} returned ${res.status()}: ${await res.text()}`).toBe(true);
  return (await res.json()).result.data as T;
}

async function om<T>(path: string, input: unknown): Promise<T> {
  const res = await (await owner()).post(`${API_URL}/trpc/${path}`, { data: input });
  expect(res.ok(), `${path} returned ${res.status()}: ${await res.text()}`).toBe(true);
  return (await res.json()).result.data as T;
}

const rand = () => Math.random().toString(36).slice(2, 8);

export const FT12 = 3658;
export const FT18 = 5486;
export const DIE_PATTI = "dev-die-14701";
export const DIE_PATTI_15 = "dev-die-14715";
export const DIE_ANGLE = "dev-die-11250";

export const kg3 = (grams: number) => (grams / 1000).toLocaleString("en-IN", { minimumFractionDigits: 3, maximumFractionDigits: 3 });

export type Party = { id: string; name: string; city: string };

/** A new customer in a city of its own. */
export async function makeParty(_page: Page, label = "W2"): Promise<Party> {
  const tag = rand();
  const name = `${label} Traders ${tag}`;
  const city = `Testpur ${tag}`;
  const made = await om<{ id: string }>("customer.create", {
    name,
    phone: null,
    billingAddress: { line1: "Plot 1", city, state: "Gujarat", postalCode: "380001", country: "India" },
  });
  return { id: made.id, name, city };
}

export type MadeOrder = { id: string; number: string; po: string; lineIds: string[]; serverSeq: number };

export type OrderLineSpec = { sectionId?: string; cutLengthMm?: number; pcs: number };

/** A confirmed order for a party (booked with a PO, then confirmed). */
export async function confirmedOrder(
  _page: Page,
  customerId: string,
  lines: OrderLineSpec[],
  opts: { expectedDate?: string | null; orderDate?: string } = {},
): Promise<MadeOrder> {
  const po = `W2-${rand()}`;
  const made = await om<{ id: string; number: string }>("orders.create", {
    customerId,
    poNumber: po,
    ...(opts.orderDate ? { orderDate: opts.orderDate } : {}),
    ...(opts.expectedDate !== undefined ? { expectedDate: opts.expectedDate } : {}),
    lines: lines.map((l) => ({
      sectionId: l.sectionId ?? DIE_PATTI,
      cutLengthMm: l.cutLengthMm ?? FT12,
      qtyBasis: "pcs",
      pcs: l.pcs,
      tierRank: 1,
    })),
  });
  const got = await oq<{ order: { serverSeq: number }; lines: { lineId: string }[] }>("orders.get", { id: made.id });
  await om("orders.confirm", { id: made.id, serverSeq: got.order.serverSeq });
  const after = await oq<{ order: { serverSeq: number } }>("orders.get", { id: made.id });
  return { id: made.id, number: made.number, po, lineIds: got.lines.map((l) => l.lineId), serverSeq: after.order.serverSeq };
}

/** Packs bundles of kg (10 pcs each) for an order line; returns their serials, oldest first. */
export async function packFor(_page: Page, lineId: string, weightsKg: number[], opts: { sectionId?: string; lengthMm?: number } = {}): Promise<string[]> {
  const locations = await oq<{ items: { id: string; kind: string }[] }>("stock.locations.list", {});
  const yard = locations.items.find((l) => l.kind === "yard");
  const receipt = await om<{ groupId: string }>("bundle.createReceipt", {
    dieId: opts.sectionId ?? DIE_PATTI,
    unit: "inch",
    salesOrderLineId: lineId,
    ...(yard ? { locationId: yard.id } : {}),
    rows: weightsKg.map((kg) => ({ quantity: 10, weightG: Math.round(kg * 1000), lengthMm: opts.lengthMm ?? FT12 })),
  });
  const list = await oq<{ items: { serial: string; weightG: number }[] }>("bundle.listBundles", { groupId: receipt.groupId, limit: 100 });
  expect(list.items).toHaveLength(weightsKg.length);
  return list.items.sort((a, b) => a.weightG - b.weightG).map((b) => b.serial);
}

/** Sends bundles on a dispatch opened from the order, held and completed. */
export async function dispatchNow(_page: Page, orderId: string, serials: string[]): Promise<{ id: string; code: string }> {
  const made = await om<{ id: string; code: string }>("dispatch.create", { salesOrderId: orderId });
  await om("dispatch.addBundlesBySerial", { id: made.id, serials });
  await om("dispatch.reserve", { id: made.id });
  await om("dispatch.complete", { id: made.id });
  return made;
}

/** Closes orders at the end of a spec (so the open lists of other specs do not carry them). */
export async function closeOrders(_page: Page, ids: string[]) {
  for (const id of ids) {
    try {
      await om("orders.close", { id, reason: "W2 e2e cleanup" });
    } catch {
      // Already closed, or cancelled: nothing to clean.
    }
  }
}

/** Today in the plant's zone, plus `days` (the expected date a new order starts with). */
export function ymdPlus(days: number, nowMs = Date.now(), timeZone = "Asia/Kolkata"): string {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(nowMs));
  const [y, mo, d] = today.split("-").map(Number);
  return new Date(Date.UTC(y!, mo! - 1, d! + days)).toISOString().slice(0, 10);
}

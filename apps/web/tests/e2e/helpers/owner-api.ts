import { expect, request } from "@playwright/test";

import { localPassword } from "./accounts";
import { API_URL, WEB_ORIGIN } from "./ports";

/**
 * The owner's API for set-up a spec needs but its signed-in person may not do (customers, orders, party
 * numbers, plant stock). Its own request context: it never touches the page's session.
 */
export async function ownerApi() {
  const api = await request.newContext({ extraHTTPHeaders: { origin: WEB_ORIGIN } });
  const signIn = await api.post(`${API_URL}/api/auth/sign-in/email`, { data: { email: "owner@orrn.local", password: localPassword() } });
  expect(signIn.ok(), `owner sign-in returned ${signIn.status()}`).toBe(true);
  return {
    async query<T>(path: string, input: unknown): Promise<T> {
      const res = await api.get(`${API_URL}/trpc/${path}?input=${encodeURIComponent(JSON.stringify(input))}`);
      expect(res.ok(), `${path} returned ${res.status()}: ${await res.text()}`).toBe(true);
      return (await res.json()).result.data as T;
    },
    async mutate<T>(path: string, input: unknown): Promise<T> {
      const res = await api.post(`${API_URL}/trpc/${path}`, { data: input });
      expect(res.ok(), `${path} returned ${res.status()}: ${await res.text()}`).toBe(true);
      return (await res.json()).result.data as T;
    },
    dispose: () => api.dispose(),
  };
}

export type OwnerApi = Awaited<ReturnType<typeof ownerApi>>;

/** A new customer (optionally with its own party-number policy). */
export async function newCustomer(api: OwnerApi, name: string, policy?: "monthly" | "fy" | "lifelong") {
  const { id } = await api.mutate<{ id: string }>("customer.create", { name });
  if (policy) await api.mutate("customer.update", { id, name, bundleNumberPolicy: policy });
  return { id, name };
}

/** An open order of `customerId` for one section; returns its first line id. */
export async function newOrder(api: OwnerApi, customerId: string, dieId: string, kgG = 500_000, mm = 3505) {
  const res = await api.mutate<{ id: string; number: string }>("orders.create", {
    customerId,
    poNumber: null,
    lines: [{ sectionId: dieId, cutLengthMm: mm, kgG, pcs: null, finish: null }],
  });
  const got = await api.query<{ lines: { lineId: string }[] }>("orders.get", { id: res.id });
  return { id: res.id, number: res.number, lineId: got.lines[0]!.lineId };
}

/** Packs `rows` as one receipt (owner), returns the new bundles. Yard Y1 when the company has yards. */
export async function packBundles(
  api: OwnerApi,
  dieId: string,
  rows: { quantity: number; weightG: number; lengthMm?: number }[],
  opts: { salesOrderLineId?: string; dieInstanceId?: string; yardCode?: string } = {},
) {
  const locations = await api.query<{ items: { id: string; kind: string; code: string }[] }>("stock.locations.list", {});
  const yard = locations.items.find((l) => l.kind === "yard" && l.code === (opts.yardCode ?? "Y1")) ?? locations.items.find((l) => l.kind === "yard");
  const receipt = await api.mutate<{ groupId: string; bundles: { id: string; serial: string; partyNo: string | null }[] }>("bundle.createReceipt", {
    dieId,
    unit: "inch",
    ...(yard ? { locationId: yard.id } : {}),
    ...(opts.salesOrderLineId ? { salesOrderLineId: opts.salesOrderLineId } : {}),
    ...(opts.dieInstanceId ? { dieInstanceId: opts.dieInstanceId } : {}),
    rows: rows.map((r) => ({ quantity: r.quantity, weightG: r.weightG, lengthMm: r.lengthMm ?? 3505 })),
  });
  return receipt;
}

/** Moves bundles to plant stock (so the floor scan accepts them for any customer's load). */
export async function makePlantStock(api: OwnerApi, bundleIds: string[]) {
  await api.mutate("orders.reallocate", { bundleIds, toLineId: null, reason: "Plant stock for the e2e load" });
}

export async function dieId(api: OwnerApi, code: string) {
  const dies = await api.query<{ items: { id: string }[] }>("die.list", { search: code, limit: 5 });
  return dies.items[0]!.id;
}

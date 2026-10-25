import { expect, request, type Page } from "@playwright/test";

import { localPassword } from "./accounts";
import { API_URL, WEB_ORIGIN } from "./ports";

/**
 * D20: fresh bundles packed as "Plant stock" (`bundle.createReceipt({ source: "plant_stock" })`). The
 * server writes them as plant stock, so the floor scan adds them to any customer's load (D12) with no
 * office step. The page must be signed in as a `bundle.pack` holder. Returns the bundles in serial order.
 */
export async function packPlantStock(
  page: Page,
  count: number,
  /** The spec's own die (and copy): never "the first die in the list", which other specs may own or empty meanwhile. */
  own: { dieId: string; dieInstanceId?: string } | null = null,
): Promise<{ id: string; serial: string; weightG: number }[]> {
  const call = async <T>(method: "get" | "post", path: string, input: unknown): Promise<T> => {
    const res =
      method === "get"
        ? await page.context().request.get(`${API_URL}/trpc/${path}?input=${encodeURIComponent(JSON.stringify(input))}`, { headers: { origin: WEB_ORIGIN } })
        : await page.context().request.post(`${API_URL}/trpc/${path}`, { headers: { origin: WEB_ORIGIN }, data: input });
    expect(res.ok(), `${path} returned ${res.status()}: ${res.ok() ? "" : await res.text()}`).toBe(true);
    return (await res.json()).result.data as T;
  };
  // No die of the spec's own: the newest active plant die. Another spec may have just made a section owned by a
  // customer (die-room's owner block), which plant stock may never use without a copy and a grant ("This section has no copies").
  const dieId =
    own?.dieId ?? (await call<{ items: { id: string }[] }>("get", "die.list", { owner: "plant", status: "active", limit: 1 })).items[0]!.id;
  const locations = await call<{ items: { id: string; kind: string }[] }>("get", "stock.locations.list", {});
  const yard = locations.items.find((l) => l.kind === "yard");
  const rows = Array.from({ length: count }, (_, i) => ({ quantity: 20 + (i % 3), weightG: 50_000 + i * 137, lengthMm: 3658 }));
  const receipt = await call<{ groupId: string }>("post", "bundle.createReceipt", {
    dieId,
    ...(own?.dieInstanceId ? { dieInstanceId: own.dieInstanceId } : {}),
    unit: "inch",
    source: "plant_stock",
    ...(yard ? { locationId: yard.id } : {}),
    rows,
  });
  const list = await call<{ items: { id: string; serial: string; weightG: number; plantStock: boolean }[] }>("get", "bundle.listBundles", {
    groupId: receipt.groupId,
    limit: 100,
  });
  expect(list.items).toHaveLength(count);
  expect(list.items.every((b) => b.plantStock), "packed as plant stock").toBe(true);
  return list.items.map((b) => ({ id: b.id, serial: b.serial, weightG: b.weightG })).sort((a, b) => a.serial.localeCompare(b.serial, "en", { numeric: true }));
}

/**
 * A die section of the spec's own with one copy on the rack (BACKLOG 49 / explorer note): packing on
 * "the first die in the list" failed with "This section has no copies" when a spec running at the
 * same time gave that die an owner or retired its copies. Unowned, so no other spec's owner gate
 * reaches it. The page must be signed in as a `die.create` holder (owner).
 */
export async function ownSection(page: Page, tag: string): Promise<{ dieId: string; dieInstanceId: string; sectionCode: string }> {
  const post = async <T>(path: string, input: unknown): Promise<T> => {
    const res = await page.context().request.post(`${API_URL}/trpc/${path}`, { headers: { origin: WEB_ORIGIN }, data: input });
    expect(res.ok(), `${path} returned ${res.status()}: ${res.ok() ? "" : await res.text()}`).toBe(true);
    return (await res.json()).result.data as T;
  };
  const sectionCode = `${tag}${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`.toUpperCase().slice(0, 16);
  const die = await post<{ id: string }>("die.create", {
    series: "PATTI",
    sectionCode,
    name: "E2E scan patti",
    weightMinG: 2400,
    weightMaxG: 2600,
    thicknessMm: 10,
    widthMm: 25,
    status: "active",
  });
  const copy = await post<{ id: string }>("dieInstance.create", { sectionId: die.id, status: "available" });
  return { dieId: die.id, dieInstanceId: copy.id, sectionCode };
}

/**
 * Seeded and API-packed bundles are "not on a sales order" (D12), which the floor scan refuses.
 * Specs about building loads move their bundles to plant stock first, as the office does
 * (`orders.reallocate` to no line, an `order.reallocate` holder). A bundle already there is skipped.
 */
export async function toPlantStock(serials: readonly string[]): Promise<void> {
  if (serials.length === 0) return;
  const api = await request.newContext({ extraHTTPHeaders: { origin: WEB_ORIGIN } });
  try {
    const signIn = await api.post(`${API_URL}/api/auth/sign-in/email`, {
      data: { email: "owner@orrn.local", password: localPassword() },
    });
    if (!signIn.ok()) throw new Error(`plant stock: owner sign-in returned ${signIn.status()}`);
    const ids: string[] = [];
    for (const serial of serials) {
      const res = await api.get(`${API_URL}/trpc/bundle.getBySerial?input=${encodeURIComponent(JSON.stringify({ serial }))}`);
      if (!res.ok()) throw new Error(`plant stock: ${serial} not found (${res.status()})`);
      const data = (await res.json()).result.data as { bundle: { id: string; status: string } };
      if (data.bundle.status === "available") ids.push(data.bundle.id);
    }
    for (let i = 0; i < ids.length; i += 100) {
      const res = await api.post(`${API_URL}/trpc/orders.reallocate`, {
        data: { bundleIds: ids.slice(i, i + 100), toLineId: null, reason: "Plant stock for the e2e load" },
      });
      // Already plant stock (or moved by a parallel spec): not a failure for these specs.
      if (!res.ok() && res.status() !== 400) throw new Error(`plant stock: reallocate returned ${res.status()}: ${await res.text()}`);
    }
  } finally {
    await api.dispose();
  }
}

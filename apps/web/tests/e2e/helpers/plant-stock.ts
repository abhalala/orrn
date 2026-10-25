import { expect, type Page } from "@playwright/test";

import { API_URL, WEB_ORIGIN } from "./ports";

/**
 * D20: fresh bundles packed as "Plant stock" (`bundle.createReceipt({ source: "plant_stock" })`). The
 * server writes them as plant stock, so the floor scan adds them to any customer's load (D12) with no
 * office step. The page must be signed in as a `bundle.pack` holder. Returns the bundles in serial order.
 */
export async function packPlantStock(page: Page, count: number): Promise<{ id: string; serial: string; weightG: number }[]> {
  const call = async <T>(method: "get" | "post", path: string, input: unknown): Promise<T> => {
    const res =
      method === "get"
        ? await page.context().request.get(`${API_URL}/trpc/${path}?input=${encodeURIComponent(JSON.stringify(input))}`, { headers: { origin: WEB_ORIGIN } })
        : await page.context().request.post(`${API_URL}/trpc/${path}`, { headers: { origin: WEB_ORIGIN }, data: input });
    expect(res.ok(), `${path} returned ${res.status()}: ${res.ok() ? "" : await res.text()}`).toBe(true);
    return (await res.json()).result.data as T;
  };
  const dies = await call<{ items: { id: string }[] }>("get", "die.list", { limit: 1 });
  const locations = await call<{ items: { id: string; kind: string }[] }>("get", "stock.locations.list", {});
  const yard = locations.items.find((l) => l.kind === "yard");
  const rows = Array.from({ length: count }, (_, i) => ({ quantity: 20 + (i % 3), weightG: 50_000 + i * 137, lengthMm: 3658 }));
  const receipt = await call<{ groupId: string }>("post", "bundle.createReceipt", {
    dieId: dies.items[0]!.id,
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

import { request } from "@playwright/test";

import { localPassword } from "./accounts";
import { API_URL, WEB_ORIGIN } from "./ports";

/**
 * Seeded and API-packed bundles are "not on a sales order" (D12), which the floor scan refuses.
 * These specs are about building loads, so they move their bundles to plant stock first, as the office
 * does (`orders.reallocate` to no line, an `order.reallocate` holder). A bundle already there is skipped.
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

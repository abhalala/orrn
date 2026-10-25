import { expect, request, type APIRequestContext, type Page } from "@playwright/test";

import { API_URL, WEB_ORIGIN } from "./ports";

/**
 * A throwaway plant for a spec that changes company settings (review W2-OPPK-W r1 I-6). The seeded
 * demo company is shared by every spec running in parallel, so a test that flips a plant-wide
 * setting (packing-list scope, kg per piece, order lead days) does it HERE, never there.
 *
 * Made the way the front door makes members: a public sign-up per role, an invite from the local
 * `/dev/invite` hook (the first one makes the company, later ones join it), `invite.acceptByToken`,
 * and the welcome step done over the API. Local stack only.
 */

export type PlantRole = "owner" | "office";
type Member = { email: string; password: string };
export type FreshPlant = { companyId: string; companyName: string; members: Record<PlantRole, Member> };

const tag = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

async function ok(res: Awaited<ReturnType<APIRequestContext["post"]>>, what: string) {
  expect(res.ok(), `${what} returned ${res.status()}: ${await res.text()}`).toBe(true);
  return res;
}

async function join(role: PlantRole, companyId: string | null, companyName: string): Promise<{ member: Member; companyId: string }> {
  const email = `w2-${role}-${tag()}@orrn.local`;
  const password = `Plant-${crypto.randomUUID().slice(0, 12)}`;
  const api = await request.newContext({ extraHTTPHeaders: { origin: WEB_ORIGIN } });
  try {
    await ok(await api.post(`${API_URL}/api/auth/sign-up/email`, { data: { name: `W2 ${role}`, email, password } }), "sign-up");
    const invite = await ok(
      await api.post(`${API_URL}/dev/invite`, { data: { email, role, companyName, ...(companyId ? { companyId } : {}) } }),
      "/dev/invite",
    );
    const made = (await invite.json()) as { token: string; companyId: string };
    await ok(await api.post(`${API_URL}/api/auth/sign-in/email`, { data: { email, password } }), "sign-in");
    await ok(await api.post(`${API_URL}/trpc/invite.acceptByToken`, { data: { token: made.token } }), "invite.acceptByToken");
    // The welcome step (an owner also gives the company's details), so the app does not send them to /welcome.
    await ok(
      await api.post(`${API_URL}/trpc/auth.completeOnboarding`, {
        data: role === "owner" ? { facilityLocation: "Testpur", primaryContact: "+91 90000 00000", timezone: "Asia/Kolkata", pressCount: 1 } : {},
      }),
      "auth.completeOnboarding",
    );
    return { member: { email, password }, companyId: made.companyId };
  } finally {
    await api.dispose();
  }
}

/** A new active plant with an owner and an office member, both through the welcome step. */
export async function freshPlant(label: string): Promise<FreshPlant> {
  const companyName = `${label} Extrusions ${tag()}`;
  const owner = await join("owner", null, companyName);
  const office = await join("office", owner.companyId, companyName);
  return { companyId: owner.companyId, companyName, members: { owner: owner.member, office: office.member } };
}

/** Signs a browser context in as one of the plant's members (their only company). */
export async function signInPlant(page: Page, plant: FreshPlant, role: PlantRole) {
  const { email, password } = plant.members[role];
  const res = await page.context().request.post(`${API_URL}/api/auth/sign-in/email`, { headers: { origin: WEB_ORIGIN }, data: { email, password } });
  expect(res.ok(), `sign-in as the plant's ${role} returned ${res.status()}`).toBe(true);
}

/**
 * A die, a customer and two bundles on no order line (30 kg and 45 kg, 10 pcs each, 12 ft) in the
 * plant, sent on a completed dispatch (the office adds stock on no line, D12). For the packing list.
 */
export async function plantDispatch(page: Page, m: <T>(page: Page, path: string, input: unknown) => Promise<T>, q: <T>(page: Page, path: string, input: unknown) => Promise<T>) {
  const die = await m<{ id: string }>(page, "die.create", {
    series: "PATTI",
    sectionCode: `W2${tag()}`.toUpperCase().slice(0, 16),
    name: "Test patti",
    weightMinG: 2400,
    weightMaxG: 2600,
    thicknessMm: 10,
    widthMm: 25,
    status: "active",
  });
  const customer = await m<{ id: string }>(page, "customer.create", {
    name: `Plant Traders ${tag()}`,
    phone: null,
    billingAddress: { line1: "Plot 1", city: "Testpur", state: "Gujarat", postalCode: "380001", country: "India" },
  });
  const receipt = await m<{ groupId: string }>(page, "bundle.createReceipt", {
    dieId: die.id,
    unit: "inch",
    rows: [
      { quantity: 10, weightG: 30_000, lengthMm: 3658 },
      { quantity: 10, weightG: 45_000, lengthMm: 3658 },
    ],
  });
  const list = await q<{ items: { serial: string; weightG: number }[] }>(page, "bundle.listBundles", { groupId: receipt.groupId, limit: 100 });
  const serials = list.items.sort((a, b) => a.weightG - b.weightG).map((b) => b.serial);
  const made = await m<{ id: string; code: string }>(page, "dispatch.create", { customerId: customer.id });
  await m(page, "dispatch.addBundlesBySerial", { id: made.id, serials, allowUnassigned: true });
  await m(page, "dispatch.reserve", { id: made.id });
  await m(page, "dispatch.complete", { id: made.id });
  return made;
}

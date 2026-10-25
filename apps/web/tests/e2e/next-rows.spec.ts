import { expect, request, test, type Page } from "@playwright/test";

import { expectNoHorizontalScroll } from "../helpers/layout-guards";
import { signInViaApi } from "./helpers/accounts";
import { ownerApi } from "./helpers/owner-api";
import { m, q } from "./helpers/orders-api";
import { addPlantMember, freshPlant, plantDispatch, signInPlant, type FreshPlant } from "./helpers/fresh-plant";
import { API_URL, WEB_ORIGIN } from "./helpers/ports";

/**
 * W4-NEXTROWS: the remaining Next rows on real screens (local stack, this worktree's ports).
 * FP-PF-17 plant switcher, FP-OP-14 dispatch value, FP-DR-18 die work log, FP-OP-21 owner's press
 * view, FP-PF-14 release notes, FP-OP-19 order print and export, FP-PR-19 the station outbox.
 * Fixtures that touch the shared seed (a die copy, an order) are retired or closed in `finally`.
 */

const WIDTHS = [375, 820, 1280] as const;

async function ok(res: Awaited<ReturnType<Awaited<ReturnType<typeof request.newContext>>["post"]>>, what: string) {
  expect(res.ok(), `${what} returned ${res.status()}: ${await res.text()}`).toBe(true);
  return res;
}

/** Gives the plant's owner a second plant (an invite from the local `/dev/invite` hook, accepted as that owner). */
async function secondPlantFor(plant: FreshPlant): Promise<string> {
  const { email, password } = plant.members.owner;
  const api = await request.newContext({ extraHTTPHeaders: { origin: WEB_ORIGIN } });
  try {
    const name = `Second ${plant.companyName}`.slice(0, 80);
    const invite = await ok(await api.post(`${API_URL}/dev/invite`, { data: { email, role: "owner", companyName: name } }), "/dev/invite");
    const made = (await invite.json()) as { token: string };
    await ok(await api.post(`${API_URL}/api/auth/sign-in/email`, { data: { email, password } }), "sign-in");
    await ok(await api.post(`${API_URL}/trpc/invite.acceptByToken`, { data: { token: made.token } }), "invite.acceptByToken");
    return name;
  } finally {
    await api.dispose();
  }
}

test.describe("FP-PF-17 plant switcher", () => {
  test("hidden with one plant", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await signInViaApi(page, "office");
    await page.goto("/today");
    await expect(page.locator("main#main h1").first()).toBeVisible();
    await expect(page.getByTestId("plant-switcher")).toHaveCount(0);
  });

  for (const width of WIDTHS) {
    test(`two plants: switch from the header at ${width}px and land on Today of the other plant`, async ({ page }) => {
      const plant = await freshPlant(`Switch${width}`);
      const second = await secondPlantFor(plant);
      await page.setViewportSize({ width, height: 900 });
      await signInPlant(page, plant, "owner");
      await page.goto("/today");
      await expect(page.locator("main#main h1").first()).toBeVisible();
      const trigger = page.getByTestId("plant-switcher").filter({ visible: true }).first();
      await expect(trigger).toBeVisible();
      await expectNoHorizontalScroll(page);
      await trigger.click();
      const items = page.getByTestId("plant-switcher-item");
      await expect(items).toHaveCount(2);
      // Accepting the invite made the second plant the active one; switch back to the first.
      const target = (await page.getByRole("menuitemradio", { checked: false }).first().textContent()) ?? "";
      expect([plant.companyName, second].some((n) => target.includes(n))).toBe(true);
      const wanted = target.includes(plant.companyName) ? plant.companyName : second;
      await page.getByRole("menuitemradio", { checked: false }).first().click();
      await expect(page).toHaveURL(/\/today$/);
      // The header now names the other plant (something that only the new plant's `auth.me` can say).
      await expect(page.getByTestId("plant-switcher").filter({ visible: true }).first()).toContainText(wanted);
      await page.getByTestId("plant-switcher").filter({ visible: true }).first().click();
      await expect(page.getByRole("menuitemradio", { checked: true })).toContainText(wanted);
    });
  }

  test("switching away from a page of one plant never flashes Not found", async ({ page }) => {
    const plant = await freshPlant("Flash");
    await secondPlantFor(plant);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await signInPlant(page, plant, "owner");
    // A dispatch that exists only in the plant that is active now; its page is open when the plant is switched.
    const sent = await plantDispatch(page, m, q);
    await page.goto(`/dispatch/${sent.id}`);
    await expect(page.getByRole("region", { name: "Packing list" })).toBeVisible({ timeout: 30_000 });
    const before = (await page.getByTestId("plant-switcher").filter({ visible: true }).first().textContent()) ?? "";
    await page.evaluate(() => {
      const w = window as unknown as { __flashed: boolean };
      w.__flashed = false;
      new MutationObserver(() => {
        if (/not found in this company/i.test(document.body.innerText)) w.__flashed = true;
      }).observe(document.body, { subtree: true, childList: true, characterData: true });
    });
    await page.getByTestId("plant-switcher").filter({ visible: true }).first().click();
    await page.getByRole("menuitemradio", { checked: false }).first().click();
    await expect(page).toHaveURL(/\/today$/);
    await expect(page.getByTestId("plant-switcher").filter({ visible: true }).first()).not.toHaveText(before.trim());
    await expect(page.locator("main#main h1").first()).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __flashed: boolean }).__flashed)).toBe(false);
  });
});

test.describe("FP-PF-14 release notes on About", () => {
  for (const width of WIDTHS) {
    test(`About lists what changed (or says none yet) at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await signInViaApi(page, "office");
      // What the server lists (production and floor builds that carry notes), so the screen is checked against data, not just "something".
      const listed = await page.context().request.get(`${API_URL}/trpc/release.notes`, { headers: { origin: WEB_ORIGIN } });
      expect(listed.ok()).toBe(true);
      const items = ((await listed.json()).result.data.items as { channel: string; notes: string | null }[]);
      expect(items.every((r) => (r.channel === "production" || r.channel === "floor") && (r.notes ?? "").trim() !== "")).toBe(true);
      await page.goto("/settings?tab=about");
      const card = page.getByTestId("release-notes");
      await expect(card).toBeVisible();
      if (items.length === 0) await expect(card.getByTestId("release-notes-none")).toBeVisible();
      else {
        await expect(card.getByTestId("release-note")).toHaveCount(items.length);
        await expect(card.getByTestId("release-notes-none")).toHaveCount(0);
        await expect(card.getByTestId("release-note").first()).toContainText(items[0]!.notes!.trim().split("\n")[0]!.slice(0, 20));
      }
      await expectNoHorizontalScroll(page);
    });
  }
});

test.describe("FP-DR-18 die work log on the copy card", () => {
  for (const width of WIDTHS) {
    test(`log a correction that sends the copy back on trial at ${width}px`, async ({ page }) => {
      // A copy of its own on a section no other spec reads (Angle 11262), on the rack.
      const api = await ownerApi();
      const made = await api.mutate<{ id: string; code: string }>("dieInstance.create", { sectionId: "dev-die-11262", status: "available" });
      try {
        await page.setViewportSize({ width, height: 900 });
        await page.emulateMedia({ reducedMotion: "reduce" });
        await signInViaApi(page, "owner");
        await page.goto(`/dies/copies/${made.id}?tab=work`);
        const panel = page.getByTestId("work-panel");
        await expect(panel).toBeVisible({ timeout: 30_000 });
        await expectNoHorizontalScroll(page);

        await panel.getByTestId("work-add").click();
        const sheet = page.getByRole("dialog");
        await sheet.getByTestId("work-kind").selectOption({ label: "Correction" });
        await sheet.getByLabel("Hardness after (HV)").fill("960");
        await sheet.getByTestId("work-note").fill("Bearing opened at the nose");
        await sheet.getByLabel("Send the copy back on trial").check();
        await sheet.getByTestId("work-save").click();
        await expect(page.getByText(`Work logged on ${made.code}`)).toBeVisible();

        const row = panel.getByTestId("work-row").first();
        await expect(row).toContainText("Correction");
        await expect(row).toContainText("960 HV");
        await expect(row).toContainText("Sent on trial");
        await expect(row).toContainText("Bearing opened at the nose");
        await expectNoHorizontalScroll(page);
      } finally {
        // On trial now: retire the copy so the shared seed is as it was.
        await api.mutate("dieInstance.update", { id: made.id, status: "retired" });
        await api.dispose();
      }
    });
  }
});

test.describe("FP-OP-19 order print and export", () => {
  for (const width of WIDTHS) {
    test(`order sheet in Excel and the print button at ${width}px; the book exports`, async ({ page }) => {
      const api = await ownerApi();
      const { id: customerId } = await api.mutate<{ id: string }>("customer.create", { name: `Print Traders ${width}-${Date.now().toString(36)}` });
      const made = await api.mutate<{ id: string; number: string }>("orders.create", {
        customerId,
        poNumber: `PR-${width}-${Date.now().toString(36)}`,
        lines: [{ sectionId: "dev-die-11262", cutLengthMm: 3658, kgG: 250_000, pcs: null, finish: null }],
      });
      try {
        await page.setViewportSize({ width, height: 900 });
        await signInViaApi(page, "office");
        await page.goto(`/orders/${made.id}`);
        await expect(page.locator("[data-order-print]")).toBeVisible({ timeout: 30_000 });
        await expectNoHorizontalScroll(page);
        const [file] = await Promise.all([page.waitForEvent("download"), page.locator("[data-order-excel]").click()]);
        expect(file.suggestedFilename()).toBe(`order-${made.number.replace(/[^A-Za-z0-9._-]+/g, "-")}.xlsx`);

        await page.goto("/orders");
        const exportButton = page.locator("[data-book-export]");
        await expect(exportButton).toBeVisible({ timeout: 30_000 });
        const [book] = await Promise.all([page.waitForEvent("download"), exportButton.click()]);
        expect(book.suggestedFilename()).toMatch(/^order-book-\d{4}-\d{2}-\d{2}\.xlsx$/);
      } finally {
        // The booking would stay open on the shared seed: cancel it.
        await api.mutate("orders.cancel", { id: made.id, reason: "e2e cleanup" });
        await api.dispose();
      }
    });
  }

  test("the plan's shift die list in Excel (plans open from 820px)", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await signInViaApi(page, "office");
    await page.goto("/orders/plan/dev-plan-trial-1");
    await expect(page.locator("[data-plan-print]")).toBeVisible({ timeout: 30_000 });
    const [file] = await Promise.all([page.waitForEvent("download"), page.locator("[data-plan-excel]").click()]);
    expect(file.suggestedFilename()).toMatch(/^plan-PP-\d+\.xlsx$/);
  });
});

test.describe("FP-OP-14 dispatch value", () => {
  test("the value card shows to the office once the plant prices on the sales order, never to the packer", async ({ page }) => {
    // The setting is plant-wide: a throwaway plant of its own, with an owner, an office member and a packer.
    const plant = await freshPlant("Value");
    await addPlantMember(plant, "packer");
    await page.setViewportSize({ width: 820, height: 1000 });
    await signInPlant(page, plant, "owner");
    const sent = await plantDispatch(page, m, q);
    const open = async (role: "owner" | "office" | "packer") => {
      await signInPlant(page, plant, role);
      await page.goto(`/dispatch/${sent.id}`);
      await expect(page.getByRole("region", { name: "Packing list" })).toBeVisible({ timeout: 30_000 });
    };

    // Off (the default): the server sends no value, to anyone.
    await open("owner");
    await expect(page.getByTestId("dispatch-value")).toHaveCount(0);

    await m(page, "company.updateSettings", { priceOnSalesOrder: true });
    await open("office");
    const card = page.getByTestId("dispatch-value");
    await expect(card).toBeVisible();
    // These two bundles are on no order line, so nothing has a rate: the card says so and prices nothing.
    await expect(page.getByTestId("dispatch-value-amount")).toHaveText("₹0.00");
    await expect(page.getByTestId("dispatch-value-missing")).toContainText("no rate");
    await expectNoHorizontalScroll(page);

    await open("packer");
    await expect(page.getByTestId("dispatch-value")).toHaveCount(0);
    await expectNoHorizontalScroll(page);
  });
});

test.describe("FP-OP-21 press plan on the owner's phone", () => {
  test("375px: read-only plan and today's figures; no planning grid", async ({ page }) => {
    const api = await ownerApi();
    const fx = await pressFixture(api, "PH");
    try {
      await page.setViewportSize({ width: 375, height: 900 });
      await signInViaApi(page, "owner");
      // The plan's own page, by id: it shows whatever other released plans exist.
      await page.goto(`/orders/plan/${fx.planId}`);
      await expect(page.locator(`[data-phone-plan-card="${fx.planNumber}"]`)).toBeVisible({ timeout: 30_000 });
      await expectNoHorizontalScroll(page);
      // The list: the plan whose window covers now is always on it (review I-2), on its own press line.
      await page.goto("/orders/plan");
      await expect(page.locator("[data-phone-summary]")).toBeVisible({ timeout: 30_000 });
      const card = page.locator(`[data-phone-plan-card="${fx.planNumber}"]`);
      await expect(card).toBeVisible();
      await expect(card.locator("[data-phone-die]").first()).toBeVisible();
      await expect(card.locator("[data-die-chip]").first()).toBeVisible();
      await expect(page.getByRole("button", { name: /release/i })).toHaveCount(0);
      await expectNoHorizontalScroll(page);
      await expect(card.locator('[data-die-state="die_issued"]')).toHaveCount(1);
    } finally {
      await settlePress(api, fx);
      await api.dispose();
    }
  });

  for (const width of [820, 1280] as const) {
    test(`${width}px: the planning board, not the phone view`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await signInViaApi(page, "owner");
      await page.goto("/orders/plan");
      await expect(page.getByRole("heading").first()).toBeVisible({ timeout: 30_000 });
      await expect(page.locator("[data-phone-plan]")).toHaveCount(0);
      await expectNoHorizontalScroll(page);
    });
  }
});

type PressFx = { lineId: string; copyId: string; orderId: string; planId: string; planNumber: string; run: { id: string; number: string } };

/** Its own press line, die copy, order and released plan (one run, die issued); never a seeded line. */
async function pressFixture(api: Awaited<ReturnType<typeof ownerApi>>, prefix: string): Promise<PressFx> {
  const tag = `${Date.now().toString(36).slice(-4)}${Math.random().toString(36).slice(2, 4)}`.toUpperCase();
  const lineId = (await api.mutate<{ id: string }>("press.lines.create", { code: `${prefix}${tag}`, name: `${prefix} ${tag}` })).id;
  const copyId = (await api.mutate<{ id: string }>("dieInstance.create", { sectionId: "dev-die-13090", status: "available" })).id;
  await api.mutate("dieInstance.addReading", { dieInstanceId: copyId, kgPer12ftMilli: 2700 });
  const { id: customerId } = await api.mutate<{ id: string }>("customer.create", { name: `${prefix} Traders ${tag}` });
  const made = await api.mutate<{ id: string }>("orders.create", { customerId, poNumber: `${prefix}-${tag}`, lines: [{ sectionId: "dev-die-13090", cutLengthMm: 5486, qtyBasis: "pcs", pcs: 20, tierRank: 1 }] });
  const got = await api.query<{ order: { serverSeq: number }; lines: { lineId: string }[] }>("orders.get", { id: made.id });
  await api.mutate("orders.confirm", { id: made.id, serverSeq: got.order.serverSeq });
  const now = Date.now();
  const plan = await api.mutate<{ id: string; number: string }>("plans.create", {
    windowStart: now,
    windowEnd: now + 8 * 3_600_000,
    pressLineId: lineId,
    dies: [{ sectionId: "dev-die-13090", lines: [{ salesOrderLineId: got.lines[0]!.lineId, pcs: 20 }] }],
  });
  const run = (await api.mutate<{ runs: { id: string; number: string }[] }>("plans.release", { id: plan.id })).runs[0]!;
  await api.mutate("dieInstance.issues.issue", { dieInstanceId: copyId, pressLineId: lineId, pressRunId: run.id });
  const number = (await api.query<{ plan: { number: string } }>("plans.get", { id: plan.id })).plan.number;
  return { lineId, copyId, orderId: made.id, planId: plan.id, planNumber: number, run };
}

/** Leave the plant as it was: finish or void the run, retire the press and the copy, close the order. */
async function settlePress(api: Awaited<ReturnType<typeof ownerApi>>, fx: PressFx) {
  const runId = fx.run.id;
  const get = () => api.query<{ run: { status: string; castId: string | null }; planLines: { id: string; cutLengthMm: number }[]; downtime: { id: string; stoppedAt: string | null }[] }>("press.runs.get", { id: runId });
  let g = await get();
  if (g.run.status === "die_issued" || g.run.status === "queued") {
    const reasons = await api.query<{ id: string; code: string }[]>("press.reasons", { kind: "void" });
    await api.mutate("press.runs.void", { id: runId, reasonCodeId: (reasons.find((r) => r.code === "other") ?? reasons[0]!).id, note: "e2e cleanup" });
  } else if (g.run.status !== "logged" && g.run.status !== "voided") {
    if (g.run.status === "running") await api.mutate("press.runs.stop", { id: runId });
    g = await get();
    if (g.run.status === "stopped") await api.mutate("press.runs.count", { id: runId });
    g = await get();
    for (const d of g.downtime.filter((x) => !x.stoppedAt)) await api.mutate("press.downtime.stop", { id: d.id });
    await api.mutate("press.runs.handover", { id: runId, supervisorId: null });
    const casts = await api.query<{ items: { id: string; billetsOnHandG: number }[] }>("foundry.casts.list", { limit: 200 });
    const cast = [...casts.items].sort((a, b) => b.billetsOnHandG - a.billetsOnHandG)[0]!;
    await api.mutate("press.runs.billets", { id: runId, castId: g.run.castId ?? cast.id, rows: [{ lengthMm: 600, count: 1, kgG: 10_000 }] });
    await api.mutate("press.runs.lines", { id: runId, rows: g.planLines.map((p) => ({ cutLengthMm: p.cutLengthMm, pcs: 1, goodG: 1000, pressPlanLineId: p.id })) });
    await api.mutate("press.runs.qc", { id: runId, rows: [{ pcs: 0, kgG: 0, reasonCodeId: null, note: null, runLine: null }] });
    await api.mutate("press.runs.close", { id: runId });
  }
  await api.mutate("press.lines.retire", { id: fx.lineId });
  await api.mutate("dieInstance.update", { id: fx.copyId, status: "retired" });
  await api.mutate("orders.close", { id: fx.orderId, reason: "e2e cleanup" });
}

test.describe("FP-PR-19 press station outbox", () => {
  test.describe.configure({ mode: "serial" });
  let api: Awaited<ReturnType<typeof ownerApi>>;
  let fx: PressFx;
  let run: PressFx["run"];

  test.beforeAll(async () => {
    api = await ownerApi();
    fx = await pressFixture(api, "OB");
    run = fx.run;
  });

  test.afterAll(async () => {
    if (fx) await settlePress(api, fx);
    await api?.dispose();
  });

  test("offline Start waits with its key and goes when the connection is back; a refused Stop is shown on its own", async ({ page, context }) => {
    await page.setViewportSize({ width: 820, height: 1100 });
    await signInViaApi(page, "press");
    await page.goto(`/press/runs/${run.id}`);
    const start = page.getByRole("button", { name: "Start", exact: true });
    await expect(start).toBeVisible({ timeout: 30_000 });

    await context.setOffline(true);
    await start.click();
    const banner = page.locator("[data-outbox-banner]");
    await expect(banner).toHaveText("Offline: 1 change waiting");
    await expectNoHorizontalScroll(page);
    // The write sits in this tablet's storage, under this person's key, and nothing reached the server.
    expect((await api.query<{ run: { status: string } }>("press.runs.get", { id: run.id })).run.status).toBe("die_issued");

    await context.setOffline(false);
    await expect(page.locator("[data-outbox]")).toHaveCount(0, { timeout: 30_000 });
    await expect(page.locator('[data-slot="station"]')).toHaveAttribute("data-status", "running", { timeout: 30_000 });
    expect((await api.query<{ run: { status: string } }>("press.runs.get", { id: run.id })).run.status).toBe("running");

    // Offline Stop, while another device stops the run: the queued Stop comes back refused, as a conflict.
    const stop = page.getByRole("button", { name: "Stop", exact: true });
    await expect(stop).toBeVisible();
    await context.setOffline(true);
    await stop.click();
    await expect(banner).toHaveText("Offline: 1 change waiting");
    await api.mutate("press.runs.stop", { id: run.id });
    await context.setOffline(false);
    const conflict = page.locator('[data-outbox-conflict="stop"]');
    await expect(conflict).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("[data-outbox-banner]")).toHaveCount(0);
    // The refused change is kept across a reload, and the station shows what the run really is now.
    await page.reload();
    await expect(page.locator('[data-outbox-conflict="stop"]')).toBeVisible({ timeout: 30_000 });
    // Online, a new tap on that run waits behind the refused change, and says so (review m-3).
    const resume = page.getByRole("button", { name: "Resume", exact: true });
    await expect(resume).toBeVisible({ timeout: 30_000 });
    await resume.click();
    await expect(page.getByText("Waiting behind a refused change. Saved on this tablet.")).toBeVisible();
    await expect(page.locator("[data-outbox-banner]")).toHaveText("Waiting behind a refused change (1 change)");
    expect((await api.query<{ run: { status: string } }>("press.runs.get", { id: run.id })).run.status).toBe("stopped");
    // Removing the refused change lets the waiting one go.
    await page.locator('[data-outbox-conflict="stop"] [data-outbox-drop]').click();
    await expect(page.locator("[data-outbox]")).toHaveCount(0, { timeout: 30_000 });
    await expect(page.locator('[data-slot="station"]')).toHaveAttribute("data-status", "running", { timeout: 30_000 });
  });
});

test.describe("FP-PR-19 the outbox belongs to the person who queued it", () => {
  test.describe.configure({ mode: "serial" });
  let api: Awaited<ReturnType<typeof ownerApi>>;
  let fx: PressFx;

  test.beforeAll(async () => {
    api = await ownerApi();
    fx = await pressFixture(api, "OW");
  });
  test.afterAll(async () => {
    if (fx) await settlePress(api, fx);
    await api?.dispose();
  });

  test("A queues offline and signs out; B signs in and nothing is sent; A signs back in and it goes, as A", async ({ page, context }) => {
    const run = fx.run;
    const status = async () => (await api.query<{ run: { status: string; operatorId: string | null; supervisorId: string | null } }>("press.runs.get", { id: run.id })).run;
    await page.setViewportSize({ width: 390, height: 1000 });
    await signInViaApi(page, "press");
    await page.goto(`/press/runs/${run.id}`);
    const start = page.getByRole("button", { name: "Start", exact: true });
    await expect(start).toBeVisible({ timeout: 30_000 });

    // A taps Start with no connection. The list is kept under A's key: the plant AND the person.
    await context.setOffline(true);
    await start.click();
    await expect(page.locator("[data-outbox-banner]")).toHaveText("Offline: 1 change waiting");
    const keys = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("orrn.press.outbox.")));
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatch(/^orrn\.press\.outbox\.[^.]+\.[^.]+$/);
    const userA = keys[0]!.split(".").at(-1)!;

    // The connection returns, but the server does not get A's Start yet (the request is held back).
    await page.route(/\/trpc\/press\.runs\.start/, (route) => route.abort());
    await context.setOffline(false);
    await expect(page.locator("[data-outbox-banner]")).toHaveText("1 change waiting to send");

    // A signs out: told how many are still waiting.
    await page.getByRole("button", { name: "Account and more" }).click();
    await page.getByRole("dialog", { name: "More" }).getByRole("button", { name: "Sign out" }).click();
    await expect(page.getByText("1 change not sent yet. They stay saved on this tablet for you and go out when you sign in again.")).toBeVisible();
    await expect(page).toHaveURL(/\/$/);
    await page.unroute(/\/trpc\/press\.runs\.start/);
    expect((await status()).status).toBe("die_issued");

    // B (a supervisor) signs in at the same tablet and opens the same station: A's Start is not B's to send.
    await signInViaApi(page, "supervisor");
    await page.goto(`/press/runs/${run.id}`);
    await expect(page.locator('[data-slot="station"]')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("[data-outbox]")).toHaveCount(0);
    await page.waitForTimeout(2_500);
    expect((await status()).status).toBe("die_issued");
    expect(await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("orrn.press.outbox.")))).toEqual(keys);

    // A signs back in: the list is there and goes, as A (the operator is A, not the supervisor who was here).
    await page.context().clearCookies();
    await signInViaApi(page, "press");
    await page.goto(`/press/runs/${run.id}`);
    await expect(page.locator('[data-slot="station"]')).toHaveAttribute("data-status", "running", { timeout: 30_000 });
    await expect(page.locator("[data-outbox]")).toHaveCount(0);
    const after = await status();
    expect(after.status).toBe("running");
    expect(after.operatorId).toBe(userA);
    expect(after.supervisorId).toBeNull();
  });
});

import { expect, request, test, type Page } from "@playwright/test";

import { expectNoHorizontalScroll } from "../helpers/layout-guards";
import { signInViaApi } from "./helpers/accounts";
import { ownerApi } from "./helpers/owner-api";
import { freshPlant, signInPlant, type FreshPlant } from "./helpers/fresh-plant";
import { API_URL, WEB_ORIGIN } from "./helpers/ports";

/**
 * W4-NEXTROWS: the remaining Next rows on real screens (local stack, this worktree's ports).
 * FP-PF-17 plant switcher, FP-OP-14 dispatch value, FP-DR-18 die work log, FP-OP-21 owner's press
 * view, FP-PF-14 release notes, FP-OP-19 order print and export, FP-PR-19 the station outbox.
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
      await page.getByRole("menuitemradio", { checked: false }).first().click();
      await expect(page).toHaveURL(/\/today$/);
      await page.getByTestId("plant-switcher").filter({ visible: true }).first().click();
      await expect(page.getByRole("menuitemradio", { checked: true })).toContainText(target.includes(plant.companyName) ? plant.companyName : second);
    });
  }
});

test.describe("FP-PF-14 release notes on About", () => {
  for (const width of WIDTHS) {
    test(`About lists what changed (or says none yet) at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await signInViaApi(page, "office");
      await page.goto("/settings?tab=about");
      const card = page.getByTestId("release-notes");
      await expect(card).toBeVisible();
      await expect(card.getByTestId("release-note").or(card.getByTestId("release-notes-none")).first()).toBeVisible();
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
      await api.dispose();

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
      await api.dispose();

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

test.describe("FP-OP-21 press plan on the owner's phone", () => {
  test("375px: read-only plan and today's figures; no planning grid", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 900 });
    await signInViaApi(page, "owner");
    await page.goto("/orders/plan");
    await expect(page.locator("[data-phone-summary]")).toBeVisible({ timeout: 30_000 });
    const card = page.locator('[data-phone-plan-card="PP-2"]');
    await expect(card).toBeVisible();
    await expect(card.locator("[data-phone-die]").first()).toBeVisible();
    await expect(card.locator("[data-die-chip]").first()).toBeVisible();
    await expect(page.getByRole("button", { name: /release/i })).toHaveCount(0);
    await expectNoHorizontalScroll(page);
    // The plan's own page shows the same read-only view on a phone.
    await page.goto("/orders/plan/dev-plan-trial-2");
    await expect(page.locator('[data-phone-plan-card="PP-2"]')).toBeVisible({ timeout: 30_000 });
    await expectNoHorizontalScroll(page);
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

test.describe("FP-PR-19 press station outbox", () => {
  test.describe.configure({ mode: "serial" });
  type Run = { id: string; number: string };
  let api: Awaited<ReturnType<typeof ownerApi>>;
  let lineId = "";
  let copyId = "";
  let orderId = "";
  let run: Run;

  test.beforeAll(async () => {
    api = await ownerApi();
    const tag = Date.now().toString(36).slice(-5).toUpperCase();
    lineId = (await api.mutate<{ id: string }>("press.lines.create", { code: `OB${tag}`, name: `Outbox ${tag}` })).id;
    copyId = (await api.mutate<{ id: string }>("dieInstance.create", { sectionId: "dev-die-13090", status: "available" })).id;
    await api.mutate("dieInstance.addReading", { dieInstanceId: copyId, kgPer12ftMilli: 2700 });
    const { id: customerId } = await api.mutate<{ id: string }>("customer.create", { name: `Outbox Traders ${tag}` });
    const made = await api.mutate<{ id: string }>("orders.create", { customerId, poNumber: `OB-${tag}`, lines: [{ sectionId: "dev-die-13090", cutLengthMm: 5486, qtyBasis: "pcs", pcs: 20, tierRank: 1 }] });
    orderId = made.id;
    const got = await api.query<{ order: { serverSeq: number }; lines: { lineId: string }[] }>("orders.get", { id: made.id });
    await api.mutate("orders.confirm", { id: made.id, serverSeq: got.order.serverSeq });
    const now = Date.now();
    const plan = await api.mutate<{ id: string }>("plans.create", {
      windowStart: now,
      windowEnd: now + 8 * 3_600_000,
      pressLineId: lineId,
      dies: [{ sectionId: "dev-die-13090", lines: [{ salesOrderLineId: got.lines[0]!.lineId, pcs: 20 }] }],
    });
    run = (await api.mutate<{ runs: Run[] }>("plans.release", { id: plan.id })).runs[0]!;
    await api.mutate("dieInstance.issues.issue", { dieInstanceId: copyId, pressLineId: lineId, pressRunId: run.id });
  });

  test.afterAll(async () => {
    // Leave the plant as it was: finish the run, retire the press and the copy, close the order.
    const get = () => api.query<{ run: { status: string; castId: string | null }; planLines: { id: string; cutLengthMm: number }[]; downtime: { id: string; stoppedAt: string | null }[] }>("press.runs.get", { id: run.id });
    let g = await get();
    if (g.run.status === "die_issued" || g.run.status === "queued") {
      const reasons = await api.query<{ id: string; code: string }[]>("press.reasons", { kind: "void" });
      await api.mutate("press.runs.void", { id: run.id, reasonCodeId: (reasons.find((r) => r.code === "other") ?? reasons[0]!).id, note: "e2e cleanup" });
    } else if (g.run.status !== "logged") {
      if (g.run.status === "running") await api.mutate("press.runs.stop", { id: run.id });
      g = await get();
      if (g.run.status === "stopped") await api.mutate("press.runs.count", { id: run.id });
      g = await get();
      for (const d of g.downtime.filter((x) => !x.stoppedAt)) await api.mutate("press.downtime.stop", { id: d.id });
      await api.mutate("press.runs.handover", { id: run.id, supervisorId: null });
      const casts = await api.query<{ items: { id: string; billetsOnHandG: number }[] }>("foundry.casts.list", { limit: 200 });
      const cast = [...casts.items].sort((a, b) => b.billetsOnHandG - a.billetsOnHandG)[0]!;
      await api.mutate("press.runs.billets", { id: run.id, castId: g.run.castId ?? cast.id, rows: [{ lengthMm: 600, count: 1, kgG: 10_000 }] });
      await api.mutate("press.runs.lines", { id: run.id, rows: g.planLines.map((p) => ({ cutLengthMm: p.cutLengthMm, pcs: 1, goodG: 1000, pressPlanLineId: p.id })) });
      await api.mutate("press.runs.qc", { id: run.id, rows: [{ pcs: 0, kgG: 0, reasonCodeId: null, note: null, runLine: null }] });
      await api.mutate("press.runs.close", { id: run.id });
    }
    await api.mutate("press.lines.retire", { id: lineId });
    await api.mutate("dieInstance.update", { id: copyId, status: "retired" });
    await api.mutate("orders.close", { id: orderId, reason: "e2e cleanup" });
    await api.dispose();
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
    // The write is kept across a reload of the list (same tab storage), and nothing reached the server.
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
    await conflict.locator("[data-outbox-drop]").click();
    await expect(page.locator("[data-outbox]")).toHaveCount(0);
  });
});

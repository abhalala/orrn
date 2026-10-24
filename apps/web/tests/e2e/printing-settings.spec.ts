import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { signInViaApi, type LocalRole } from "./helpers/accounts";
import { expectNoClippedText, expectNoHorizontalScroll } from "../helpers/layout-guards";

/**
 * Printing (`/printing`) and Settings (`/settings`), plan Task 24, at the three
 * layouts (phone 375, iPad 820, laptop 1280): they render, carry their headings
 * and tabs, stay inside the screen, pass axe, and hide the gated actions from a
 * viewer. The seeded plant has no print jobs and no print computer, so the
 * queue and node cards are filled by rewriting the two read procedures' answers
 * in the browser; every other call is the real API.
 */

const WIDTHS = [375, 820, 1280] as const;

const procedureOf = (url: string) =>
  decodeURIComponent(new URL(url).pathname.split("/trpc/")[1] ?? "").split(",");

async function open(page: Page, path: string, opts: { role?: LocalRole; width: number; height?: number }) {
  await page.setViewportSize({ width: opts.width, height: opts.height ?? 900 });
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await signInViaApi(page, opts.role ?? "owner");
  await page.goto(path);
  await expect(page.locator("[data-slot='app-shell']")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator("main#main h1")).toBeVisible();
}

/** Rewrites one procedure's result in every (batched) tRPC response. */
async function rewrite<T>(page: Page, procedure: string, edit: (data: T) => void) {
  await page.route("**/trpc/**", async (route) => {
    const index = procedureOf(route.request().url()).indexOf(procedure);
    if (index === -1) return route.fallback();
    const response = await route.fetch();
    const body = await response.json();
    const entry = Array.isArray(body) ? body[index] : body;
    const data = entry?.result?.data;
    if (data) edit((data.json ?? data) as T);
    await route.fulfill({ response, json: body });
  });
}

type QueuePayload = {
  rows: Record<string, unknown>[];
  total: number;
  counts: { queued: number; sent: number; success: number; failed: number };
};

const FAILED_JOB = {
  id: "job-failed-1",
  status: "failed",
  attempt: 2,
  responseText: "Printer did not answer",
  layout: "x0",
  createdAt: "2026-10-20T10:00:00.000Z",
  updatedAt: "2026-10-20T10:01:00.000Z",
  profileName: "Packing bay",
  bundleSerial: "26I4086",
};

const withFailedJob = (page: Page) =>
  rewrite<QueuePayload>(page, "spool.queue", (q) => {
    q.rows = [FAILED_JOB];
    q.total = 1;
    q.counts = { queued: 0, sent: 0, success: 3, failed: 1 };
  });

async function blockingAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .exclude(".TanStackRouterDevtools")
    .exclude("[class*='tsqd-']")
    .exclude("[data-sonner-toaster]")
    .analyze();
  return results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => ({ id: v.id, help: v.help, targets: v.nodes.slice(0, 5).map((n) => n.target.join(" ")) }));
}

async function expectContained(page: Page) {
  // Lists dim while they load; axe must see them settled.
  await expect(page.locator("main#main [aria-busy='true']")).toHaveCount(0);
  await expectNoHorizontalScroll(page);
  await expectNoClippedText(page, "main#main");
  expect(await blockingAxeViolations(page)).toEqual([]);
}

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test.describe("printing", () => {
  for (const width of WIDTHS) {
    test(`owner ${width}: heading, tabs and the queue render inside the screen`, async ({ page }) => {
      await open(page, "/printing", { width });
      await expect(page.getByRole("heading", { level: 1, name: "Printing" })).toBeVisible();
      const tabs = page.getByRole("tablist", { name: "Printing" });
      for (const name of ["Queue", "Printers", "Labels"]) await expect(tabs.getByRole("tab", { name })).toBeVisible();
      await expect(tabs.getByRole("tab", { name: "Queue" })).toHaveAttribute("aria-selected", "true");
      // The seeded plant has nothing queued, so the page says so instead of showing a blank list.
      await expect(page.getByText("Nothing waiting to print.")).toBeVisible();
      await expect(page.getByTestId("queue-summary")).toHaveText("Nothing failed or waiting.");
      await expectContained(page);
    });

    test(`owner ${width}: a failed job shows its reason and Retry sends that job again`, async ({ page }) => {
      await withFailedJob(page);
      const retried: string[] = [];
      await page.route("**/trpc/spool.retryJob**", async (route) => {
        retried.push(route.request().postData() ?? "");
        const batched = new URL(route.request().url()).searchParams.has("batch");
        const result = { result: { data: { success: true } } };
        await route.fulfill({ json: batched ? [result] : result });
      });
      await open(page, "/printing", { width });
      await expect(page.getByTestId("queue-summary")).toHaveText("1 failed, 0 waiting");
      const main = page.locator("main#main");
      await expect(main.getByText("Printer did not answer")).toBeVisible();
      await expect(main.getByText("Attempt 2")).toBeVisible();
      await expect(main.getByRole("link", { name: "26I4086" })).toHaveAttribute("href", "/b/26I4086");
      await expectContained(page);
      await main.getByTestId("retry-job").click();
      await expect.poll(() => retried.length).toBe(1);
      expect(retried[0]).toContain("job-failed-1");
    });

    test(`viewer ${width}: sees the failed job but not Retry`, async ({ page }) => {
      await withFailedJob(page);
      await open(page, "/printing", { role: "viewer", width });
      const main = page.locator("main#main");
      await expect(main.getByText("Printer did not answer")).toBeVisible();
      await expect(main.getByTestId("retry-job")).toHaveCount(0);
      await expect(main.getByText("You can see the queue. Ask a manager to change printers or labels.")).toBeVisible();
      await expectContained(page);
    });
  }

  test("filter chips narrow the queue through the URL and Printers says what it knows", async ({ page }) => {
    await withFailedJob(page);
    await open(page, "/printing", { width: 1280 });
    const main = page.locator("main#main");
    await main.getByRole("button", { name: /^Failed/ }).click();
    await expect(page).toHaveURL(/status=failed/);
    await main.getByRole("tab", { name: "Printers" }).click();
    await expect(page).toHaveURL(/tab=printers/);
    // No print computer and no label printer in the seed: one honest next step, no invented status.
    await expect(main.getByText("Label printing isn't set up")).toBeVisible();
  });

  test("a print computer shows its last heartbeat, or that it has not reported in", async ({ page }) => {
    const node = (id: string, name: string, lastHeartbeatAt: string | null) => ({
      id,
      nodeName: name,
      siteLabel: "Main facility",
      status: lastHeartbeatAt ? "active" : "pending",
      runtimeVersion: null,
      lastHeartbeatAt,
      lastErrorMessage: null,
    });
    await rewrite<{ nodes: unknown[] }>(page, "edge.overview", (o) => {
      o.nodes = [node("n1", "Packing bay PC", "2026-10-20T10:00:00.000Z"), node("n2", "Spare PC", null)];
    });
    await open(page, "/printing?tab=printers", { width: 820 });
    const cards = page.getByTestId("print-node");
    await expect(cards).toHaveCount(2);
    await expect(cards.filter({ hasText: "Packing bay PC" })).toContainText("Last seen");
    await expect(cards.filter({ hasText: "Spare PC" })).toContainText("Has not reported in yet");
    await expect(cards.filter({ hasText: "Spare PC" })).not.toContainText("Last seen");
    await expectContained(page);
  });

  for (const width of WIDTHS) {
    test(`owner ${width}: Labels has the reprint entry, which opens the bundle`, async ({ page }) => {
      await open(page, "/printing?tab=labels", { width });
      await expect(page.getByRole("heading", { name: "Reprint a label" })).toBeVisible();
      await expectContained(page);
      await page.getByRole("button", { name: "Open bundle" }).click();
      await expect(page.getByText("Enter a bundle number.")).toBeVisible();
      await page.getByTestId("reprint-serial").fill("26I4086");
      await page.getByRole("button", { name: "Open bundle" }).click();
      await expect(page).toHaveURL(/\/b\/26I4086/);
    });
  }

  test("the old /spool address lands on /printing", async ({ page }) => {
    await open(page, "/spool", { width: 1280 });
    await expect(page).toHaveURL(/\/printing/);
    await expect(page.getByRole("heading", { level: 1, name: "Printing" })).toBeVisible();
  });
});

test.describe("settings", () => {
  for (const width of WIDTHS) {
    test(`owner ${width}: heading, tabs, company facts and the Save button`, async ({ page }) => {
      await open(page, "/settings", { width });
      await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
      const tabs = page.getByRole("tablist", { name: "Settings" });
      for (const name of ["Company", "Team", "Printing"]) await expect(tabs.getByRole("tab", { name })).toBeVisible();
      const company = page.getByTestId("settings-company");
      await expect(company.getByText("Company name")).toBeVisible();
      await expect(company.getByText("Language", { exact: true }).first()).toBeVisible();
      const save = company.getByRole("button", { name: "Save settings" });
      await expect(save).toBeDisabled();
      // Changing the unit makes the form saveable; nothing is written here.
      // The demo plant is on feet and inches, so mm is the change.
      await expect(company.getByRole("radio", { name: "Feet and inches" })).toBeChecked();
      await company.getByRole("radio", { name: "Millimetres (mm)" }).click();
      await expect(save).toBeEnabled();
      await company.getByRole("radio", { name: "Feet and inches" }).click();
      await expect(save).toBeDisabled();
      await expectContained(page);
    });

    test(`viewer ${width}: the company is read-only and Save is not offered`, async ({ page }) => {
      await open(page, "/settings", { role: "viewer", width });
      const company = page.getByTestId("settings-company");
      await expect(company.getByTestId("settings-read-only")).toBeVisible();
      await expect(company.getByRole("button", { name: "Save settings" })).toHaveCount(0);
      await page.getByRole("tab", { name: "Team" }).click();
      await expect(page.getByTestId("settings-team")).toBeVisible();
      await expect(page.getByRole("button", { name: "Invite member" })).toHaveCount(0);
      await expect(page.getByTestId("team-read-only")).toBeVisible();
      await expectContained(page);
    });

    test(`owner ${width}: Team lists members and offers the invite sheet`, async ({ page }) => {
      await open(page, "/settings?tab=team", { width });
      const team = page.getByTestId("settings-team");
      await expect(team.getByRole("heading", { name: "Members" })).toBeVisible();
      await expect(team.getByText("owner@orrn.local")).toBeVisible();
      await expect(team.getByRole("heading", { name: "Pending invites" })).toBeVisible();
      await expectContained(page);
      await team.getByTestId("invite-open").click();
      const sheet = page.getByRole("dialog", { name: "Invite a team member" });
      await expect(sheet).toBeVisible();
      await sheet.getByTestId("invite-email").fill("not-an-email");
      await sheet.getByRole("button", { name: "Send invite" }).click();
      await expect(sheet.getByText("Enter an email like name@company.com.")).toBeVisible();
    });

    test(`owner ${width}: the Printing section reports only what is stored`, async ({ page }) => {
      await open(page, "/settings?tab=printing", { width });
      const printing = page.getByTestId("settings-printing");
      await expect(printing.getByText("Label printing", { exact: true })).toBeVisible();
      await expect(printing.getByRole("heading", { name: "Label defaults" })).toBeVisible();
      await expectContained(page);
    });
  }

  test("the old members address lands on the Team tab", async ({ page }) => {
    await open(page, "/settings/members", { width: 1280 });
    await expect(page).toHaveURL(/\/settings\?tab=team/);
    await expect(page.getByTestId("settings-team")).toBeVisible();
  });
});

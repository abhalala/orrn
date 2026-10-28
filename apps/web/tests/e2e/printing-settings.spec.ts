import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { signInViaApi, type LocalRole } from "./helpers/accounts";
import { expectNoClippedText, expectNoHorizontalScroll } from "../helpers/layout-guards";

/**
 * Printing (`/printing`) and Settings (`/settings`), plan Task 24, at the three
 * layouts (phone 375, iPad 820, laptop 1280): they render, carry their headings
 * and tabs, stay inside the screen, pass axe, and hide the gated actions from a
 * viewer. The demo plant has two labels waiting (newest bundles of the day), a label
 * printer ("Packing bay") and one print computer that has not connected and reports no
 * scale; failed jobs and extra print computers are filled in by rewriting the two read
 * procedures' answers in the browser; every other call is the real API.
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
  counts: { queued: number; accepted: number; sent: number; success: number; failed: number; outcome_unknown: number; cancelled: number };
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
    q.counts = { queued: 0, accepted: 0, sent: 0, success: 3, failed: 1, outcome_unknown: 0, cancelled: 0 };
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
      // The demo plant has two labels waiting for the printer that has not connected yet: the summary strip says so.
      const summary = page.getByTestId("printing-summary");
      await expect(summary.locator("[data-summary='waiting']")).toHaveText(/Waiting to print\s*2$/);
      await expect(summary.locator("[data-summary='retry']")).toHaveText(/Needs a retry\s*0$/);
      await expect(summary.locator("[data-summary='computer']")).toHaveAttribute("data-state", "never");
      await expect(summary.locator("[data-summary='computer']")).toContainText("Never connected");
      const main = page.locator("main#main");
      for (const serial of ["BG-000008-B013", "BG-000008-B014"]) await expect(main.getByRole("link", { name: serial })).toBeVisible();
      await expect(main.getByText("Packing bay").first()).toBeVisible();
      await expect(main.getByText("Waiting", { exact: true }).first()).toBeVisible();
      await expect(page.getByText("No print jobs yet")).toHaveCount(0);
      // Waiting labels have not reached the printer: an owner can cancel them, and nothing offers a retry yet.
      await expect(main.getByTestId("cancel-job")).toHaveCount(2);
      await expect(main.getByTestId("retry-job")).toHaveCount(0);
      await expect(page.getByTestId("printing-restricted")).toHaveCount(0);
      // BACKLOG 102: the print computer has never connected, so the waiting labels come with a warning and what to do.
      const banner = page.getByTestId("print-computer-banner");
      await expect(banner).toHaveAttribute("data-kind", "never");
      await expect(banner).toContainText("The print computer has never connected");
      await expect(banner).toContainText("2 labels are waiting");
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
      await expect(page.getByTestId("printing-summary").locator("[data-summary='retry']")).toHaveText(/Needs a retry\s*1$/);
      const main = page.locator("main#main");
      await expect(main.getByTestId("job-reason")).toHaveText("Printer did not answer");
      await expect(main.getByTestId("job-attempt")).toHaveText("Attempt 2");
      await expect(main.getByRole("link", { name: "26I4086" })).toHaveAttribute("href", "/b/26I4086");
      await expectContained(page);
      await main.getByTestId("retry-job").click();
      await expect.poll(() => retried.length).toBe(1);
      expect(retried[0]).toContain("job-failed-1");
    });

    test(`viewer ${width}: sees the failed job but not Retry or Cancel`, async ({ page }) => {
      await withFailedJob(page);
      await open(page, "/printing", { role: "viewer", width });
      const main = page.locator("main#main");
      await expect(main.getByText("Printer did not answer")).toBeVisible();
      await expect(main.getByTestId("retry-job")).toHaveCount(0);
      await expect(main.getByTestId("cancel-job")).toHaveCount(0);
      await expect(page.getByTestId("printing-restricted")).toHaveText("You can see the queue. Ask a manager to change printers or labels.");
      await expectContained(page);
    });
  }

  test("filter chips narrow the queue through the URL and Printers says what it knows", async ({ page }) => {
    await withFailedJob(page);
    await open(page, "/printing", { width: 1280 });
    const main = page.locator("main#main");
    // Only statuses that have jobs get a chip.
    const filters = main.getByTestId("queue-filters");
    await expect(filters.getByRole("button")).toHaveText([/^All\s*4$/, /^Printed\s*3$/, /^Failed\s*1$/]);
    await filters.getByRole("button", { name: /^Failed/ }).click();
    await expect(page).toHaveURL(/status=failed/);
    await expect(filters.getByRole("button", { name: /^Failed/ })).toHaveAttribute("aria-pressed", "true");
    // The router marks the summary item for the filter on screen as the current page.
    await expect(page.getByTestId("printing-summary").locator("[data-summary='retry']")).toHaveAttribute("aria-current", "page");
    await main.getByRole("tab", { name: "Printers" }).click();
    await expect(page).toHaveURL(/tab=printers/);
    // One print computer that has not connected and reports no scale, and the label printer: nothing invented.
    const node = main.getByTestId("print-node");
    await expect(node).toHaveCount(1);
    await expect(node).toContainText("Packing bay node");
    await expect(node).toContainText("Has not reported in yet");
    await expect(node).toContainText("No scale");
    await expect(main.getByRole("heading", { name: "Packing bay", level: 3, exact: true })).toBeVisible();
    await expect(main.getByText("Label printing isn't set up")).toHaveCount(0);
  });

  test("summary items open the queue on their status, or Printers, from any tab", async ({ page }) => {
    await withFailedJob(page);
    await open(page, "/printing?tab=labels", { width: 820 });
    const summary = page.getByTestId("printing-summary");
    await summary.locator("[data-summary='retry']").click();
    await expect(page).toHaveURL(/\/printing\?status=failed$/);
    await expect(page.getByRole("tab", { name: "Queue" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("job-reason")).toHaveText("Printer did not answer");
    await summary.locator("[data-summary='printed']").click();
    await expect(page).toHaveURL(/status=success$/);
    await summary.locator("[data-summary='computer']").click();
    await expect(page).toHaveURL(/tab=printers$/);
    await expect(page.getByRole("tab", { name: "Printers" })).toHaveAttribute("aria-selected", "true");
    await expect(summary.locator("[data-summary='computer']")).toHaveAttribute("aria-current", "page");
  });

  test("an empty filter says so and shows every job again", async ({ page }) => {
    await open(page, "/printing?status=cancelled", { width: 375 });
    const main = page.locator("main#main");
    await expect(main.getByText("No jobs with this status")).toBeVisible();
    await main.getByRole("button", { name: "Show all jobs" }).click();
    await expect(page).toHaveURL(/\/printing$/);
    await expect(main.getByRole("link", { name: "BG-000008-B013" })).toBeVisible();
    await expectContained(page);
  });

  test("Cancel stops a waiting job", async ({ page }) => {
    const cancelled: string[] = [];
    await page.route("**/trpc/spool.cancelJob**", async (route) => {
      cancelled.push(route.request().postData() ?? "");
      const batched = new URL(route.request().url()).searchParams.has("batch");
      const result = { result: { data: { success: true, commandId: null } } };
      await route.fulfill({ json: batched ? [result] : result });
    });
    await open(page, "/printing", { width: 1280 });
    const main = page.locator("main#main");
    await main.getByRole("button", { name: "Cancel label BG-000008-B013" }).click();
    await expect.poll(() => cancelled.length).toBe(1);
    await expect(page.locator("[data-sonner-toast]").filter({ hasText: "Print job cancelled" })).toBeVisible();
  });

  test("labels waiting while the print computer stopped reporting in: offline since its last report (BACKLOG 102)", async ({ page }) => {
    await rewrite<{ nodes: unknown[] }>(page, "edge.overview", (o) => {
      o.nodes = [{ id: "n1", nodeName: "Packing bay PC", siteLabel: "Main facility", status: "offline", runtimeVersion: null, lastHeartbeatAt: "2026-10-20T10:00:00.000Z", lastErrorMessage: null }];
    });
    await open(page, "/printing", { width: 1280 });
    const banner = page.getByTestId("print-computer-banner");
    await expect(banner).toHaveAttribute("data-kind", "offline");
    await expect(banner).toContainText("The print computer has been offline since");
    await expect(banner).toContainText("switched on and online");
    await expectContained(page);
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
    test(`${width}: collectors on a print computer say simulated, sending or the problem, as last reported`, async ({ page }) => {
      const reportedAt = new Date().toISOString();
      const frameAt = new Date(Date.now() - 5_000).toISOString();
      await rewrite<{ nodes: unknown[] }>(page, "edge.overview", (o) => {
        o.nodes = [
          {
            id: "n1",
            nodeName: "Press office PC",
            siteLabel: "Main facility",
            status: "active",
            runtimeVersion: "1.5.0",
            lastHeartbeatAt: reportedAt,
            lastErrorMessage: null,
            scaleConfigured: false,
            scaleSimulated: false,
            scaleLastFrameAt: null,
            scaleReportedAt: reportedAt,
            collectors: [
              { kind: "press", line: "P1", source: "sim", configured: true, simulated: true, connected: true, lastFrameAt: frameAt, backlog: 0, lastError: null },
              { kind: "press", line: "P2", source: "modbus", configured: true, simulated: false, connected: false, lastFrameAt: null, backlog: 0, lastError: "owner: PLC make/protocol unknown (Q-PR8)" },
              { kind: "spectro", line: null, source: "watch_dir", configured: true, simulated: false, connected: true, lastFrameAt: null, backlog: 2, lastError: null },
            ],
            collectorsReportedAt: reportedAt,
          },
        ];
      });
      await open(page, "/printing?tab=printers", { width });
      const row = page.locator('[data-slot="collectors-row"]');
      await expect(row).toBeVisible();
      const sim = row.locator('[data-collector="press"]').first();
      await expect(sim).toHaveAttribute("data-state", "sending");
      await expect(sim).toContainText("Press P1");
      await expect(sim).toContainText("Simulated");
      await expect(sim).toContainText("Simulated data: no press or spectrometer is connected to this computer.");
      const stub = row.locator('[data-collector="press"]').nth(1);
      await expect(stub).toHaveAttribute("data-state", "quiet");
      await expect(stub).not.toContainText("Simulated");
      await expect(stub).toContainText("Last problem: owner: PLC make/protocol unknown (Q-PR8)");
      const spectro = row.locator('[data-collector="spectro"]');
      await expect(spectro).toContainText("Watching the folder");
      await expect(spectro).toContainText("2 waiting to send");
      await expectContained(page);
    });
  }

  for (const width of WIDTHS) {
    test(`owner ${width}: Printers leads with the print computer and shows the label each printer prints`, async ({ page }) => {
      await open(page, "/printing?tab=printers", { width });
      const main = page.locator("main#main");
      await expect(main.getByRole("heading", { level: 2, name: "Print computer" })).toBeVisible();
      const node = main.getByTestId("print-node");
      await expect(node).toHaveAttribute("data-state", "never");
      await expect(node.getByRole("heading", { level: 3, name: "Packing bay node" })).toBeVisible();
      await expect(node).toContainText("Not connected yet");
      await expect(node).toContainText("Has not reported in yet");
      await expect(main.getByRole("heading", { level: 2, name: "Label printers" })).toBeVisible();
      const printer = main.getByTestId("print-profile").filter({ hasText: "Packing bay" }).first();
      await expect(printer.getByRole("heading", { level: 3, name: "Packing bay", exact: true })).toBeVisible();
      // No print computer has reported, so the printer's status is said as not reported, never guessed.
      await expect(printer).toHaveAttribute("data-state", "unknown");
      await expect(printer.getByText("Not reported", { exact: true })).toBeVisible();
      await expect(printer.getByRole("img", { name: /label as it prints/ })).toBeVisible();
      await expect(printer.getByRole("link", { name: /^Edit label design/ })).toHaveAttribute("href", /\/printing\/templates\/.+/);
      await expect(printer.getByRole("button", { name: "Printer actions for Packing bay" })).toBeVisible();
      await expectContained(page);
    });

    test(`viewer ${width}: Printers shows the same printer and label without the actions`, async ({ page }) => {
      await open(page, "/printing?tab=printers", { role: "viewer", width });
      const printer = page.getByTestId("print-profile").filter({ hasText: "Packing bay" }).first();
      await expect(printer.getByRole("img", { name: /label as it prints/ })).toBeVisible();
      await expect(printer.getByTestId("printer-actions")).toHaveCount(0);
      await expect(printer.getByRole("link", { name: /^Edit label design/ })).toHaveCount(0);
      await expectContained(page);
    });
  }

  test("a reported printer shows its status, model, address and the hardware address it is locked to, in light and dark", async ({ page }) => {
    const verifiedAt = new Date(Date.now() - 60_000).toISOString();
    await page.route("**/trpc/**", async (route) => {
      const procedures = procedureOf(route.request().url());
      const index = procedures.indexOf("spool.listPrinters");
      if (index === -1) return route.fallback();
      const response = await route.fetch();
      const body = await response.json();
      const report = [
        {
          printerId: "dev-printer-1",
          name: "Packing bay",
          ipAddress: "192.168.1.50",
          port: 9100,
          status: "online",
          canPrint: true,
          lastSeenAt: verifiedAt,
          lastError: null,
          capabilities: { model: "TA220", macAddress: "00:1b:82:4c:9a:10", host: "192.168.1.50", port: 9100, features: [], verifiedAt },
        },
      ];
      const entry = { result: { data: report } };
      await route.fulfill({ response, status: 200, json: Array.isArray(body) ? body.map((e: unknown, i: number) => (i === index ? entry : e)) : entry });
    });
    await open(page, "/printing?tab=printers", { width: 1280 });
    const printer = page.getByTestId("print-profile").filter({ hasText: "Packing bay" }).first();
    await expect(printer).toHaveAttribute("data-state", "ready");
    await expect(printer.getByText("Ready", { exact: true })).toBeVisible();
    await expect(printer).toContainText("TA220");
    await expect(printer).toContainText("192.168.1.50:9100");
    await expect(printer).toContainText("00:1b:82:4c:9a:10");
    await expectContained(page);
    await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
    await expectContained(page);
  });

  test("owner: the printer menu sends a test label, calibrates after a confirm, and saves checked settings", async ({ page }) => {
    const calls: Record<string, string[]> = { "spool.testPrinter": [], "spool.deviceAction": [], "spool.updatePrinterPreferences": [] };
    for (const procedure of Object.keys(calls)) {
      await page.route(`**/trpc/${procedure}**`, async (route) => {
        calls[procedure]!.push(route.request().postData() ?? "");
        const batched = new URL(route.request().url()).searchParams.has("batch");
        const result = { result: { data: procedure === "spool.updatePrinterPreferences" ? { id: "p" } : { success: true, commandId: "c1" } } };
        await route.fulfill({ json: batched ? [result] : result });
      });
    }
    await open(page, "/printing?tab=printers", { width: 820 });
    const actions = page.getByRole("button", { name: "Printer actions for Packing bay" });

    await actions.click();
    await page.getByRole("menuitem", { name: "Print a test label" }).click();
    await expect.poll(() => calls["spool.testPrinter"]!.length).toBe(1);
    expect(calls["spool.testPrinter"]![0]).toContain("dev-printer-1");
    await expect(page.getByText("Sent to the print computer.", { exact: false })).toBeVisible();

    await actions.click();
    await page.getByRole("menuitem", { name: "Calibrate label size" }).click();
    const confirm = page.getByRole("dialog", { name: "Calibrate Packing bay?" });
    await expect(confirm).toContainText("Those labels are wasted.");
    expect(calls["spool.deviceAction"]).toHaveLength(0);
    await confirm.getByRole("button", { name: "Calibrate" }).click();
    await expect.poll(() => calls["spool.deviceAction"]!.length).toBe(1);
    expect(calls["spool.deviceAction"]![0]).toContain("calibrate");
    await expect(confirm).toHaveCount(0);

    await actions.click();
    await page.getByRole("menuitem", { name: "Printer settings" }).click();
    const sheet = page.getByRole("dialog", { name: "Settings for Packing bay" });
    await expect(sheet).toBeVisible();
    const width = sheet.getByLabel("Label width");
    await width.fill("");
    await sheet.getByRole("button", { name: "Save settings" }).click();
    await expect(sheet.getByText("Enter a size above 0 and up to 300 mm.")).toBeVisible();
    expect(calls["spool.updatePrinterPreferences"]).toHaveLength(0);
    await width.fill("102");
    await sheet.getByRole("radio", { name: "Black mark" }).click();
    await sheet.getByRole("switch", { name: "Cutter" }).click();
    await sheet.getByRole("button", { name: "Save settings" }).click();
    await expect.poll(() => calls["spool.updatePrinterPreferences"]!.length).toBe(1);
    const saved = calls["spool.updatePrinterPreferences"]![0]!;
    expect(saved).toContain('"mediaWidthMm":102');
    expect(saved).toContain('"mediaType":"black_mark"');
    expect(saved).toContain('"cutterEnabled":true');
    await expect(sheet).toHaveCount(0);
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

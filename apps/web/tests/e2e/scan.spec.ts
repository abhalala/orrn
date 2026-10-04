import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { signInViaApi } from "./helpers/accounts";
import { API_URL, WEB_ORIGIN } from "./helpers/ports";
import { expectNoClippedText, expectNoHorizontalScroll } from "../helpers/layout-guards";

/**
 * Scan (Task 16): the global scan sheet. Lookup opens the bundle page;
 * dispatch mode adds each scan to one dispatch with a pop and a running count.
 * There is no camera in CI, so scans go through the manual field (what a
 * wedge scanner types) or the dev-only seams the sheet installs:
 *
 * - `window.__orrnScan.open(mode)` opens the sheet in any mode (the dispatch
 *   screen that calls `useScan().open({ kind: "dispatch" })` is a later task);
 * - `window.__orrnFakeScan(value)` feeds a camera detection, through the same
 *   1.5 s de-dupe as the real detector.
 *
 * The camera tests run Chromium with its fake capture device.
 */

const API = API_URL;
const ORIGIN = WEB_ORIGIN;
const SEEDED_SERIAL = "BG-000001-B001";

// Chromium's fake capture device stands in for a camera (launch options are per file).
test.use({ launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] } });

type Scheme = "light" | "dark";
type ScanWindow = Window & {
  __orrnScan?: { open(mode: unknown): void };
  __orrnFakeScan?: (value: string) => void;
  __orrnScanReports?: { added: string[]; alreadyInDispatch: string[]; notFound: string[] }[];
  __orrnStreams?: MediaStream[];
  __orrnGumCalls?: number;
  __orrnDetector?: string;
};

async function open(page: Page, opts: { width: number; scheme?: Scheme; height?: number }) {
  await page.setViewportSize({ width: opts.width, height: opts.height ?? 900 });
  await page.emulateMedia({ colorScheme: opts.scheme ?? "light", reducedMotion: "reduce" });
  await signInViaApi(page, "owner");
  await page.goto("/today");
  await expect(page.locator("[data-slot='app-shell']")).toBeVisible();
  await expect(page.locator("main#main h1").first()).toBeVisible();
}

async function trpcQuery<T>(page: Page, path: string, input: unknown): Promise<T> {
  const res = await page
    .context()
    .request.get(`${API}/trpc/${path}?input=${encodeURIComponent(JSON.stringify(input))}`, { headers: { origin: ORIGIN } });
  expect(res.ok(), `${path} returned ${res.status()}`).toBe(true);
  return (await res.json()).result.data as T;
}

async function trpcMutation<T>(page: Page, path: string, input: unknown): Promise<T> {
  const res = await page.context().request.post(`${API}/trpc/${path}`, { headers: { origin: ORIGIN }, data: input });
  expect(res.ok(), `${path} returned ${res.status()}`).toBe(true);
  return (await res.json()).result.data as T;
}

/** A fresh draft dispatch of its own, so parallel tests never share one. */
async function newDraftDispatch(page: Page) {
  const customers = await trpcQuery<{ items: { id: string }[] }>(page, "customer.list", { limit: 1 });
  return trpcMutation<{ id: string; code: string }>(page, "dispatch.create", { customerId: customers.items[0]!.id });
}

async function serials(page: Page, status: "available" | "dispatched", count: number) {
  const list = await trpcQuery<{ items: { serial: string }[] }>(page, "bundle.listBundles", { status, limit: 100 });
  // Spread the picks so two tests running at once rarely pick the same bundle.
  const pool = list.items.map((b) => b.serial);
  const start = Math.floor(Math.random() * Math.max(1, pool.length - count));
  return pool.slice(start, start + count);
}

async function openDispatchScan(page: Page, dispatch: { id: string; code: string }) {
  await expect.poll(() => page.evaluate(() => typeof (window as ScanWindow).__orrnScan)).toBe("object");
  await page.evaluate(
    (d) => (window as ScanWindow).__orrnScan!.open({ kind: "dispatch", dispatchId: d.id, dispatchCode: d.code }),
    dispatch,
  );
  const sheet = page.getByRole("dialog", { name: `Scanning into ${dispatch.code}` });
  await expect(sheet).toBeVisible();
  return sheet;
}

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

test.describe("lookup", () => {
  test("a seeded serial typed in lower case opens its bundle page", async ({ page }) => {
    await open(page, { width: 390 });
    await page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: "Scan" }).click();
    const sheet = page.getByRole("dialog", { name: "Scan" });
    const field = sheet.getByLabel("Serial or label link");
    await expect(field).toBeFocused();
    await field.fill(SEEDED_SERIAL.toLowerCase());
    await field.press("Enter");
    await expect(page).toHaveURL(new RegExp(`/b/${SEEDED_SERIAL}$`));
    await expect(sheet).toBeHidden();
  });

  test("a label link (with the company) opens the bundle page", async ({ page }) => {
    await open(page, { width: 1280 });
    await page.getByRole("button", { name: "Scan", exact: true }).click();
    const field = page.getByRole("dialog", { name: "Scan" }).getByLabel("Serial or label link");
    await expect(field).toBeFocused();
    await field.fill(`https://orrn.in/b/${SEEDED_SERIAL.toLowerCase()}?c=demo`);
    await field.press("Enter");
    await expect(page).toHaveURL(new RegExp(`/b/${SEEDED_SERIAL}$`));
  });

  test("an unknown serial says Not found in this company, politely and in place", async ({ page }) => {
    await open(page, { width: 390 });
    await page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: "Scan" }).click();
    const sheet = page.getByRole("dialog", { name: "Scan" });
    const field = sheet.getByLabel("Serial or label link");
    await field.fill("bg-999999-z999");
    await field.press("Enter");
    const status = sheet.getByRole("status");
    await expect(status).toHaveAttribute("aria-live", "polite");
    await expect(status).toContainText("Not found in this company");
    await expect(status).toContainText("BG-999999-Z999");
    await expect(field).toBeFocused();
    await expect(page).toHaveURL(/\/today$/);

    await field.fill("hello there!");
    await field.press("Enter");
    await expect(status).toContainText("That isn't a bundle serial or label link");
  });

  test("a camera read goes through the same lookup", async ({ page }) => {
    await open(page, { width: 390 });
    await page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: "Scan" }).click();
    await expect(page.getByRole("dialog", { name: "Scan" })).toBeVisible();
    await page.evaluate((s) => (window as ScanWindow).__orrnFakeScan!(`${location.origin}/b/${s}`), SEEDED_SERIAL);
    await expect(page).toHaveURL(new RegExp(`/b/${SEEDED_SERIAL}$`));
  });
});

test.describe("dispatch mode", () => {
  test("adds a bundle with a pop and a count; the same scan again is calm and the count stays", async ({ page }) => {
    await open(page, { width: 390 });
    const dispatch = await newDraftDispatch(page);
    const [serial] = await serials(page, "available", 1);
    const sheet = await openDispatchScan(page, dispatch);
    const field = sheet.getByLabel("Serial or label link");
    const count = sheet.getByTestId("scan-count");
    const status = sheet.getByRole("status");
    await expect(count).toHaveText("0 added");

    await field.fill(serial!.toLowerCase());
    await field.press("Enter");
    await expect(status).toContainText(`Added ${serial}`);
    await expect(count).toHaveText("1 added");
    await expect(sheet.locator("[data-slot='scan-count-block']")).toHaveClass(/animate-pop/);
    await expect(field).toBeFocused();

    await field.fill(serial!);
    await field.press("Enter");
    await expect(status).toContainText("Already in this dispatch");
    await expect(count).toHaveText("1 added");
    // A neutral toast too, never an error one.
    const toast = page.locator("[data-sonner-toast]").filter({ hasText: "Already in this dispatch" });
    await expect(toast).toBeVisible();
    await expect(toast).not.toHaveAttribute("data-type", "error");
    // Visual only: the status line already announced it, so assistive tech hears it once.
    await expect(toast.locator("[aria-hidden='true']", { hasText: "Already in this dispatch" })).toHaveCount(1);

    // The screen that opened the sheet hears about every add.
    const reports = await page.evaluate(() => (window as ScanWindow).__orrnScanReports ?? []);
    expect(reports.flatMap((r) => r.added)).toEqual([serial]);

    // Recent scans list both, newest first, each with its word.
    const rows = sheet.getByRole("list", { name: "Recent scans" }).getByRole("listitem");
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText("Already added");
    await expect(rows.nth(1)).toContainText("Added");

    // The server agrees: one item.
    const detail = await trpcQuery<{ items: { serial: string }[] }>(page, "dispatch.getDispatch", { id: dispatch.id });
    expect(detail.items.map((i) => i.serial)).toEqual([serial]);

    await sheet.getByRole("button", { name: "Done scanning" }).click();
    await expect(sheet).toBeHidden();
  });

  test("rejects a dispatched bundle with its reason and an unknown one as not found", async ({ page }) => {
    await open(page, { width: 1280 });
    const dispatch = await newDraftDispatch(page);
    const [gone] = await serials(page, "dispatched", 1);
    const sheet = await openDispatchScan(page, dispatch);
    const field = sheet.getByLabel("Serial or label link");
    const status = sheet.getByRole("status");

    await field.fill(gone!);
    await field.press("Enter");
    await expect(status).toContainText("Already dispatched");
    await expect(sheet.getByTestId("scan-count")).toHaveText("0 added");

    await field.fill("BG-999999-Z999");
    await field.press("Enter");
    await expect(status).toContainText("Not found in this company");
    await expect(sheet.getByTestId("scan-count")).toHaveText("0 added");
  });

  test("a double camera read inside 1.5 s adds once and says nothing extra", async ({ page }) => {
    await open(page, { width: 390 });
    const dispatch = await newDraftDispatch(page);
    const [serial] = await serials(page, "available", 1);
    const sheet = await openDispatchScan(page, dispatch);
    // The same label read as a link, in lower case and bare: one bundle, one add.
    await page.evaluate((s) => {
      const w = window as ScanWindow;
      w.__orrnFakeScan!(s);
      w.__orrnFakeScan!(`${location.origin}/b/${s}?c=demo`);
      w.__orrnFakeScan!(s.toLowerCase());
    }, serial!);
    await expect(sheet.getByTestId("scan-count")).toHaveText("1 added");
    await page.waitForTimeout(400);
    await expect(sheet.getByRole("list", { name: "Recent scans" }).getByRole("listitem")).toHaveCount(1);
    await expect(sheet.getByRole("status")).not.toContainText("Already in this dispatch");
  });

  for (const scheme of ["light", "dark"] as const) {
    for (const width of [390, 1280]) {
      test(`${width} ${scheme}: no serious axe issues, nothing clipped`, async ({ page }) => {
        await open(page, { width, scheme });
        const dispatch = await newDraftDispatch(page);
        const [serial] = await serials(page, "available", 1);
        const sheet = await openDispatchScan(page, dispatch);
        const field = sheet.getByLabel("Serial or label link");
        await field.fill(serial!);
        await field.press("Enter");
        await expect(sheet.getByTestId("scan-count")).toHaveText("1 added");
        await field.fill("BG-999999-Z999");
        await field.press("Enter");
        await expect(sheet.getByRole("status")).toContainText("Not found in this company");
        expect(await blockingAxeViolations(page)).toEqual([]);
        await expectNoHorizontalScroll(page);
        await expectNoClippedText(page, "[data-slot='sheet']");
      });
    }
  }
});

test.describe("camera", () => {
  test.use({ hasTouch: true, isMobile: true });

  /** Counts getUserMedia calls and keeps every stream, so a test can check they were stopped. */
  async function spyOnCamera(page: Page, behaviour: "real" | "blocked" = "real") {
    await page.addInitScript((mode) => {
      const w = window as ScanWindow;
      w.__orrnGumCalls = 0;
      w.__orrnStreams = [];
      const md = navigator.mediaDevices;
      if (!md) return;
      const original = md.getUserMedia.bind(md);
      md.getUserMedia = async (constraints) => {
        w.__orrnGumCalls! += 1;
        if (mode === "blocked") throw new DOMException("Permission denied", "NotAllowedError");
        const stream = await original(constraints);
        w.__orrnStreams!.push(stream);
        return stream;
      };
    }, behaviour);
  }

  test("explains the camera before asking, then shows the viewfinder; closing stops the camera", async ({ page }) => {
    await spyOnCamera(page);
    await open(page, { width: 390 });
    await page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: "Scan" }).click();
    const sheet = page.getByRole("dialog", { name: "Scan" });
    await expect(sheet.getByText("Use the camera to scan")).toBeVisible();
    await expect(sheet.getByText("orrn uses the camera only to read bundle labels.")).toBeVisible();
    // Nothing asked for the camera yet, and the manual path is right there.
    expect(await page.evaluate(() => (window as ScanWindow).__orrnGumCalls)).toBe(0);
    await expect(sheet.getByLabel("Serial or label link")).toBeVisible();
    // On a phone the keyboard must not cover the camera: the field isn't focused.
    await expect(sheet.getByLabel("Serial or label link")).not.toBeFocused();

    await sheet.getByRole("button", { name: "Turn on camera" }).click();
    await expect(sheet.locator("video")).toBeVisible();
    await expect(sheet.getByText("Point the camera at the bundle label")).toBeVisible();
    await expect.poll(() => page.evaluate(() => (window as ScanWindow).__orrnStreams?.length ?? 0)).toBe(1);
    await expect
      .poll(() => page.evaluate(() => (window as ScanWindow).__orrnStreams![0]!.getTracks().every((t) => t.readyState === "live")))
      .toBe(true);

    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    await expect
      .poll(() => page.evaluate(() => (window as ScanWindow).__orrnStreams![0]!.getTracks().every((t) => t.readyState === "ended")))
      .toBe(true);
  });

  test("the camera stops when the page is hidden", async ({ page }) => {
    await spyOnCamera(page);
    await open(page, { width: 390 });
    await page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: "Scan" }).click();
    const sheet = page.getByRole("dialog", { name: "Scan" });
    await sheet.getByRole("button", { name: "Turn on camera" }).click();
    await expect(sheet.getByText("Point the camera at the bundle label")).toBeVisible();
    await expect.poll(() => page.evaluate(() => (window as ScanWindow).__orrnStreams?.length ?? 0)).toBe(1);
    const setVisibility = (state: "hidden" | "visible") =>
      page.evaluate((s) => {
        Object.defineProperty(document, "visibilityState", { configurable: true, get: () => s });
        document.dispatchEvent(new Event("visibilitychange"));
      }, state);
    await setVisibility("hidden");
    await expect
      .poll(() => page.evaluate(() => (window as ScanWindow).__orrnStreams![0]!.getTracks().every((t) => t.readyState === "ended")))
      .toBe(true);
    // Back on the page: the camera picks up again without asking.
    await setVisibility("visible");
    await expect.poll(() => page.evaluate(() => (window as ScanWindow).__orrnStreams?.length ?? 0)).toBe(2);
    await expect(sheet.getByText("Point the camera at the bundle label")).toBeVisible();
  });

  test("a blocked camera explains how to fix it and keeps the manual field", async ({ page }) => {
    await spyOnCamera(page, "blocked");
    await open(page, { width: 390 });
    await page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: "Scan" }).click();
    const sheet = page.getByRole("dialog", { name: "Scan" });
    await sheet.getByRole("button", { name: "Turn on camera" }).click();
    await expect(sheet.getByText(/The camera is blocked/)).toBeVisible();
    const field = sheet.getByLabel("Serial or label link");
    await field.fill(SEEDED_SERIAL);
    await field.press("Enter");
    await expect(page).toHaveURL(new RegExp(`/b/${SEEDED_SERIAL}$`));
  });

  for (const failure of ["fail-load", "fail-detect"] as const) {
    test(`a reader that ${failure === "fail-load" ? "can't load" : "can't read frames"} says so and stops the camera`, async ({ page }) => {
      await spyOnCamera(page);
      await page.addInitScript((f) => ((window as ScanWindow).__orrnDetector = f), failure);
      await open(page, { width: 390 });
      await page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: "Scan" }).click();
      const sheet = page.getByRole("dialog", { name: "Scan" });
      const region = sheet.locator("[data-slot='camera-scanner'] p[aria-live='polite']");
      // The camera's live region is there before anything goes wrong, so the error is announced.
      await expect(region).toHaveCount(1);
      await expect(region).toBeEmpty();
      await sheet.getByRole("button", { name: "Turn on camera" }).click();
      await expect(region).toHaveText(/The camera didn't start\. Type the serial below/, { timeout: 8000 });
      await expect(sheet.locator("video")).toHaveCount(0);
      await expect
        .poll(() => page.evaluate(() => (window as ScanWindow).__orrnStreams!.every((s) => s.getTracks().every((t) => t.readyState === "ended"))))
        .toBe(true);
      // Focus follows to the retry button, not lost behind the sheet.
      await expect(sheet.getByRole("button", { name: "Turn on camera" })).toBeFocused();
      await expect(sheet.getByLabel("Serial or label link")).toBeEnabled();
    });
  }

  test("focus moves with the camera controls", async ({ page }) => {
    await spyOnCamera(page);
    await open(page, { width: 390 });
    await page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: "Scan" }).click();
    const sheet = page.getByRole("dialog", { name: "Scan" });
    await sheet.getByRole("button", { name: "Turn on camera" }).click();
    await expect(sheet.getByRole("button", { name: "Turn off camera" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(sheet.getByRole("button", { name: "Turn on camera" })).toBeFocused();
  });
});

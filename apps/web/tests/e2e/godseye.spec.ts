import AxeBuilder from "@axe-core/playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { signInViaApi } from "./helpers/accounts";
import { API_URL, WEB_ORIGIN } from "./helpers/ports";
import { expectNoClippedText, expectNoHorizontalScroll } from "../helpers/layout-guards";

/**
 * Godseye (Task 27): the platform console for orrn staff, in violet. Needs
 * the local stack and the seeded staff account (staff@orrn.local,
 * super_admin). Each run files its own access request through the public
 * API, so runs never depend on each other or on leftovers.
 */

function uniq() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** Files an access request the way the public form does (`waitlist.submit`). */
async function fileRequest(page: Page, tag: string) {
  const company = `E2E Godseye ${tag}`;
  const email = `godseye.${tag}@e2e.orrn.local`;
  const res = await page.context().request.post(`${API_URL}/trpc/waitlist.submit`, {
    headers: { origin: WEB_ORIGIN, "content-type": "application/json" },
    data: { companyName: company, requesterName: `Requester ${tag}`, requesterEmail: email, notes: "Two presses, one packing line." },
  });
  expect(res.ok(), `waitlist.submit returned ${res.status()}`).toBe(true);
  return { company, email };
}

async function open(page: Page, path: string, opts: { width?: number; scheme?: "light" | "dark" } = {}) {
  await page.setViewportSize({ width: opts.width ?? 1280, height: 900 });
  await page.emulateMedia({ colorScheme: opts.scheme ?? "light", reducedMotion: "reduce" });
  await page.goto(path);
  await expect(page.locator("[data-slot='app-shell']")).toBeVisible();
  await expect(page.locator("main#main h1").first()).toBeVisible();
}

async function blockingAxeViolations(page: Page, include?: string) {
  const builder = new AxeBuilder({ page });
  if (include) builder.include(include);
  const results = await builder
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .exclude(".TanStackRouterDevtools")
    .exclude("[class*='tsqd-']")
    .exclude("[data-sonner-toaster]")
    .analyze();
  return results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => ({ id: v.id, help: v.help, targets: v.nodes.slice(0, 5).map((n) => n.target.join(" ")) }));
}

test("approve a request, set up label printing, impersonate and stop", async ({ page }) => {
  test.setTimeout(120_000);
  const tag = uniq();
  const { company, email } = await fileRequest(page, tag);
  await signInViaApi(page, "staff");

  // 1. Approve the request.
  await open(page, "/admin/requests");
  await expect(page.getByRole("heading", { level: 1, name: "Access requests" })).toBeVisible();
  const card = page.getByRole("article", { name: company });
  await expect(card).toBeVisible();
  await expect(card.getByText(email)).toBeVisible();
  await card.getByRole("button", { name: "Approve" }).click();
  const approveDialog = page.getByRole("dialog", { name: `Approve ${company}?` });
  await expect(approveDialog).toContainText(email);
  await approveDialog.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByText("Request approved")).toBeVisible();
  await expect(card).toHaveCount(0);

  // 2. Find the new company and open it.
  await page.goto("/admin/companies");
  await page.getByLabel("Search companies").fill(company);
  const link = page.getByRole("link", { name: new RegExp(company) });
  await expect(link).toHaveCount(1);
  await link.click();
  await expect(page.getByRole("heading", { level: 1, name: company })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Plan and modules" })).toHaveAttribute("aria-selected", "true");
  // A new company has no plan: Starter is offered and can be saved as is.
  const facts = page.getByRole("region", { name: "Company facts" });
  await expect(facts).toContainText("No plan");
  await expect(page.getByText("No plan saved yet.")).toBeVisible();
  await page.getByRole("checkbox", { name: /Dies/ }).check();
  await page.getByRole("button", { name: "Save plan" }).click();
  await expect(page.getByText("Plan saved")).toBeVisible();
  await expect(facts).toContainText("Starter");
  await expect(page.getByRole("button", { name: "Save plan" })).toBeDisabled();
  const companyUrl = new URL(page.url());
  const companyPath = companyUrl.pathname;

  // 3. Printing tab: set up a print station; the secrets show once.
  await page.getByRole("tab", { name: "Printing" }).click();
  await expect(page).toHaveURL(/tab=printing/);
  await expect(page.getByText("Label printing isn't set up")).toBeVisible();
  await page.getByRole("button", { name: "Set up label printing" }).click();
  const sheet = page.getByRole("dialog", { name: "Set up label printing" });
  const station = `e2e-${tag}`;
  await sheet.getByLabel("Station name").fill(station);
  await expect(sheet).toContainText(`${station}.spool.orrn.in`);
  await sheet.getByRole("button", { name: "Set up print station" }).click();
  const secrets = page.getByRole("dialog", { name: "Copy these now" });
  await expect(secrets).toBeVisible();
  for (const label of ["Address", "Instance ID", "Shared secret", "Tunnel token"]) {
    await expect(secrets.getByRole("button", { name: `Copy ${label}` })).toBeVisible();
  }
  await secrets.getByRole("button", { name: "Done" }).click();
  const stationCard = page.getByRole("article", { name: `${station}.spool.orrn.in` });
  await expect(stationCard).toBeVisible();
  await expect(stationCard.getByText("Waiting to connect")).toBeVisible();
  await expectNoClippedText(page, page.locator("main#main"));
  expect(await blockingAxeViolations(page), "printing tab with a station").toEqual([]);

  // 4. Access tab: impersonate, land on Today with the violet banner.
  await page.getByRole("tab", { name: "Access" }).click();
  await expect(page).toHaveURL(/tab=access/);
  await page.getByLabel("Reason (optional)").fill("E2E support check");
  await page.getByRole("button", { name: "Impersonate" }).click();
  await expect(page).toHaveURL(/\/today$/);
  const banner = page.locator("[data-slot='impersonation-banner']");
  await expect(banner).toBeVisible();
  await expect(banner).toContainText(`Viewing ${company} as orrn support`);
  await expect(banner).toContainText(/Ends at \d{2}:\d{2}/);
  await expect(page.locator("[data-slot='app-shell']")).toHaveAttribute("data-variant", "tenant");
  expect(await blockingAxeViolations(page, "[data-slot='impersonation-banner']"), "impersonation banner").toEqual([]);
  const stored = await page.evaluate(() => sessionStorage.getItem("orrn:impersonate-company-id"));
  expect(stored && JSON.parse(stored).expiresAt).toBeGreaterThan(Date.now());

  // 5. Stop: the grant is revoked, storage cleared, back on the company's Access tab.
  await banner.getByRole("button", { name: "Stop impersonating" }).click();
  await expect(page).toHaveURL(new RegExp(`${companyPath}\\?tab=access$`));
  await expect(page.locator("[data-slot='impersonation-banner']")).toHaveCount(0);
  expect(await page.evaluate(() => sessionStorage.getItem("orrn:impersonate-company-id"))).toBeNull();
  const sessions = page.getByRole("table", { name: "Support sessions" });
  await expect(sessions.getByRole("row", { name: /E2E support check/ })).toContainText("Stopped");

  // 6. Tidy up: turn the print station off again.
  await page.getByRole("tab", { name: "Printing" }).click();
  await page.getByRole("article", { name: `${station}.spool.orrn.in` }).getByRole("button", { name: "Turn off label printing" }).click();
  await page.getByRole("dialog", { name: `Turn off ${station}.spool.orrn.in?` }).getByRole("button", { name: "Turn off" }).click();
  await expect(page.getByText("Label printing turned off")).toBeVisible();
  await expect(page.getByText("Label printing isn't set up")).toBeVisible();
});

test("rejecting asks first and closes the request", async ({ page }) => {
  const tag = uniq();
  const { company } = await fileRequest(page, tag);
  await signInViaApi(page, "staff");
  await open(page, "/admin/requests");
  const card = page.getByRole("article", { name: company });
  await card.getByRole("button", { name: "Reject" }).click();
  const dialog = page.getByRole("dialog", { name: `Reject ${company}?` });
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "Reject" }).click();
  await dialog.getByRole("button", { name: "Reject" }).click();
  await expect(page.getByText("Request rejected")).toBeVisible();
  await expect(card).toHaveCount(0);
});

test("overview: KPI blocks link to their lists", async ({ page }) => {
  await signInViaApi(page, "staff");
  await open(page, "/admin");
  const kpis = page.getByRole("region", { name: "At a glance" });
  await expect(kpis.getByRole("link", { name: /Active companies/ })).toHaveAttribute("href", "/admin/companies?status=active");
  await expect(kpis.getByRole("link", { name: /Access requests/ })).toHaveAttribute("href", "/admin/requests");
  await expect(kpis.getByRole("link", { name: /Staff/ })).toHaveAttribute("href", "/admin/staff");
  await expect(page.locator("[data-slot='status-block'][data-tone='violet']")).toHaveCount(1);
});

test("staff: add a support account, then remove it", async ({ page }) => {
  const tag = uniq();
  await signInViaApi(page, "staff");
  await open(page, "/admin/staff");
  await page.getByRole("button", { name: "Add staff" }).click();
  const sheet = page.getByRole("dialog", { name: "Add a staff account" });
  await sheet.getByRole("button", { name: "Add account" }).click();
  await expect(sheet.getByText("Fill this in.")).toBeVisible();
  await sheet.getByLabel("Name").fill(`Support ${tag}`);
  await sheet.getByLabel("Email").fill(`support.${tag}@e2e.orrn.local`);
  await sheet.getByLabel("Temporary password").fill(`e2e-${tag}-password`);
  await sheet.getByRole("radio", { name: /^Support/ }).check();
  await sheet.getByRole("button", { name: "Add account" }).click();
  await expect(page.getByText("Staff account added")).toBeVisible();
  await page.getByRole("button", { name: `Remove Support ${tag}` }).click();
  await page.getByRole("dialog", { name: `Remove Support ${tag}?` }).getByRole("button", { name: "Remove" }).click();
  await expect(page.getByText("Staff access removed")).toBeVisible();
  await expect(page.getByText(`support.${tag}@e2e.orrn.local`)).toHaveCount(0);
});

test("a company waiting for approval reads in full on a phone", async ({ page }) => {
  const tag = uniq();
  const { company } = await fileRequest(page, tag);
  await signInViaApi(page, "staff");
  await open(page, "/admin/companies?status=pending", { width: 375 });
  await page.getByLabel("Search companies").fill(company);
  const link = page.getByRole("link", { name: new RegExp(company) });
  await expect(link).toHaveCount(1);
  await expect(page.locator("main#main [data-slot='chip']", { hasText: "Waiting for approval" })).toHaveCount(1);
  await expectNoClippedText(page, page.locator("main#main"));
  await link.click();
  await expect(page.getByRole("heading", { level: 1, name: company })).toBeVisible();
  await expect(page.getByRole("region", { name: "Company facts" })).toContainText("Waiting for approval");
  await expectNoHorizontalScroll(page);
  await expectNoClippedText(page, page.locator("main#main"));
});

const SCREENS = [
  { name: "overview", path: "/admin" },
  { name: "companies", path: "/admin/companies" },
  { name: "company-plan", path: "/admin/companies/dev-company-orrn" },
  { name: "company-printing", path: "/admin/companies/dev-company-orrn?tab=printing" },
  { name: "company-access", path: "/admin/companies/dev-company-orrn?tab=access" },
  { name: "requests", path: "/admin/requests" },
  { name: "staff", path: "/admin/staff" },
] as const;

for (const width of [375, 820, 1280]) {
  for (const scheme of ["light", "dark"] as const) {
    test(`Godseye screens: no sideways scroll, clipped text or axe issues at ${width}px (${scheme})`, async ({ page }) => {
      test.setTimeout(90_000);
      await signInViaApi(page, "staff");
      for (const screen of SCREENS) {
        await open(page, screen.path, { width, scheme });
        await expect(page.locator("[aria-busy='true']")).toHaveCount(0);
        await expectNoHorizontalScroll(page);
        await expectNoClippedText(page, page.locator("main#main"));
        expect(await blockingAxeViolations(page), `${screen.name} at ${width}px ${scheme}`).toEqual([]);
      }
    });
  }
}

/**
 * Screenshots for review (not assertions): set GODSEYE_SHOTS_DIR to collect
 * every Godseye screen at 375 and 1280, light and dark, on a fresh company
 * with a print station, plus the set-up sheet, the one-time secrets and the
 * impersonation banner on Today. Tidies up after itself.
 */
test("screenshots", async ({ page }) => {
  const dir = process.env.GODSEYE_SHOTS_DIR;
  test.skip(!dir, "GODSEYE_SHOTS_DIR not set");
  test.setTimeout(300_000);
  mkdirSync(dir!, { recursive: true });
  /** Fonts loaded and no animation or view transition still running, then a full-page capture. */
  const settle = () =>
    page.waitForFunction(
      () => document.fonts.status === "loaded" && document.getAnimations().every((a) => a.playState !== "running"),
      undefined,
      { timeout: 5_000 },
    ).catch(() => undefined);
  const shot = async (name: string) => {
    await settle();
    await page.screenshot({ path: join(dir!, `${name}.png`), fullPage: true });
  };
  const tag = uniq();
  const approved = await fileRequest(page, `${tag}a`);
  await fileRequest(page, `${tag}b`);
  await signInViaApi(page, "staff");

  // A fresh company with a print station.
  await open(page, "/admin/requests");
  await page.getByRole("article", { name: approved.company }).getByRole("button", { name: "Approve" }).click();
  await page.getByRole("dialog", { name: `Approve ${approved.company}?` }).getByRole("button", { name: "Approve" }).click();
  await expect(page.getByText("Request approved")).toBeVisible();
  await page.goto("/admin/companies");
  await page.getByLabel("Search companies").fill(approved.company);
  await page.getByRole("link", { name: new RegExp(approved.company) }).click();
  await expect(page.getByRole("heading", { level: 1, name: approved.company })).toBeVisible();
  const companyPath = new URL(page.url()).pathname;
  await page.getByRole("tab", { name: "Printing" }).click();
  await page.getByRole("button", { name: "Set up label printing" }).click();
  const sheet = page.getByRole("dialog", { name: "Set up label printing" });
  await sheet.getByLabel("Station name").fill(`shots-${tag}`);
  await page.waitForTimeout(400);
  await shot("printing-setup-sheet-1280-light");
  await sheet.getByRole("button", { name: "Set up print station" }).click();
  await expect(page.getByRole("dialog", { name: "Copy these now" })).toBeVisible();
  await page.waitForTimeout(400);
  await shot("printing-secrets-1280-light");
  await page.getByRole("dialog", { name: "Copy these now" }).getByRole("button", { name: "Done" }).click();

  const screens = [
    { name: "overview", path: "/admin" },
    { name: "companies", path: "/admin/companies" },
    { name: "company-plan", path: companyPath },
    { name: "company-printing", path: `${companyPath}?tab=printing` },
    { name: "company-access", path: `${companyPath}?tab=access` },
    { name: "requests", path: "/admin/requests" },
    { name: "staff", path: "/admin/staff" },
  ];
  for (const width of [375, 1280]) {
    for (const scheme of ["light", "dark"] as const) {
      for (const screen of screens) {
        await open(page, screen.path, { width, scheme });
        await expect(page.locator("[aria-busy='true']")).toHaveCount(0);
        await shot(`${screen.name}-${width}-${scheme}`);
      }
    }
  }

  // The impersonation banner on Today.
  await open(page, `${companyPath}?tab=access`);
  await page.getByLabel("Reason (optional)").fill("Screenshot run");
  await page.getByRole("button", { name: "Impersonate" }).click();
  await expect(page).toHaveURL(/\/today$/);
  for (const width of [375, 1280]) {
    for (const scheme of ["light", "dark"] as const) {
      await open(page, "/today", { width, scheme });
      await expect(page.locator("[data-slot='impersonation-banner']")).toBeVisible();
      await settle();
      await page.screenshot({ path: join(dir!, `today-banner-${width}-${scheme}.png`) });
    }
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.locator("[data-slot='impersonation-banner']").getByRole("button", { name: "Stop impersonating" }).click();
  await expect(page).toHaveURL(new RegExp(`${companyPath}\\?tab=access$`));
  await expect(page.getByRole("table", { name: "Support sessions" })).toContainText("Stopped");
  await shot("company-access-after-stop-1280-light");

  // Tidy up.
  await page.getByRole("tab", { name: "Printing" }).click();
  await page.getByRole("button", { name: "Turn off label printing" }).first().click();
  await page.getByRole("dialog", { name: /^Turn off / }).getByRole("button", { name: "Turn off" }).click();
  await expect(page.getByText("Label printing turned off")).toBeVisible();
});

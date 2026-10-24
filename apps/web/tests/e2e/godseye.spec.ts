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
async function fileRequest(page: Page, tag: string, opts: { email?: string } = {}) {
  const company = `E2E Godseye ${tag}`;
  const email = opts.email ?? `godseye.${tag}@e2e.orrn.local`;
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

test("approve a request, set up label printing, impersonate and stop", async ({ page, browser }) => {
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

  // The local server has no email service, so the details open to copy and send by hand.
  const details = page.getByRole("dialog", { name: "Email could not be sent" });
  await expect(details).toBeVisible();
  await expect(details).toContainText("Send this to Requester");
  await expect(details.getByText("Reason: Email sending is not set up on this server")).toBeVisible();
  await expect(card).toHaveCount(0);
  const firstLink = (await details.locator("code").filter({ hasText: "/continue?token=" }).innerText()).trim();
  expect(firstLink).toMatch(/\/continue\?token=[^\s]+$/);
  await expect(details.locator("code").filter({ hasText: email })).toBeVisible();
  expect(await details.getByLabel("Message").inputValue()).toContain(`set your password:\n${firstLink}`);
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: WEB_ORIGIN });
  await details.getByRole("button", { name: "Copy Sign-in link" }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(firstLink);
  expect(await blockingAxeViolations(page, "[data-slot='sheet']")).toEqual([]);
  await details.getByRole("button", { name: "Done" }).click();
  await expect(details).toHaveCount(0);

  // Still listed until the owner has a password, with a button for a fresh link.
  const awaiting = page.getByRole("region", { name: "Approved, password not set yet" });
  const owner = awaiting.getByRole("article", { name: company });
  await expect(owner).toBeVisible();
  await owner.getByRole("button", { name: "Get sign-in details" }).click();
  const fresh = page.getByRole("dialog", { name: "Email could not be sent" });
  await expect(fresh).toBeVisible();
  const secondLink = (await fresh.locator("code").filter({ hasText: "/continue?token=" }).innerText()).trim();
  expect(secondLink).not.toBe(firstLink);
  await fresh.getByRole("button", { name: "Done" }).click();

  // The owner's side (review T27 I-3), in a browser of their own: the newest link opens
  // /continue, Continue signs them in and lands on "Set your password". The fresh link
  // revoked the first one, so that one no longer works.
  const ownerContext = await browser.newContext({ baseURL: WEB_ORIGIN });
  const ownerPage = await ownerContext.newPage();
  const pathOf = (link: string) => {
    const url = new URL(link);
    return `${url.pathname}${url.search}`;
  };
  await ownerPage.goto(pathOf(secondLink));
  await expect(ownerPage.getByRole("heading", { level: 1, name: "Your workspace is ready" })).toBeVisible();
  await ownerPage.getByRole("button", { name: "Continue" }).click();
  await expect(ownerPage).toHaveURL(/\/welcome$/);
  await expect(ownerPage.getByRole("heading", { level: 1, name: "Set your password" })).toBeVisible();
  await ownerContext.clearCookies();
  await ownerPage.goto(pathOf(firstLink));
  await ownerPage.getByRole("button", { name: "Continue" }).click();
  await expect(ownerPage.getByRole("heading", { level: 1, name: "This link no longer works" })).toBeVisible();
  await ownerContext.close();

  // 2. Find the new company and open it.
  await page.goto("/admin/companies");
  await page.getByLabel("Search companies").fill(company);
  // The search writes ?q= 250 ms after typing; a click before that lands is replaced by it.
  await expect(page).toHaveURL(/[?&]q=/);
  const link = page.getByRole("link", { name: new RegExp(company) });
  await expect(link).toHaveCount(1);
  await link.click();
  await expect(page.getByRole("heading", { level: 1, name: company })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Plan and modules" })).toHaveAttribute("aria-selected", "true");
  // A new company has no plan: Starter is offered and can be saved as is.
  const facts = page.getByRole("region", { name: "Company facts" });
  await expect(facts).toContainText("No plan");
  await expect(page.getByText("No plan saved yet.")).toBeVisible();
  // Nothing saved means every module is on, and every box says so. Untick one to hide it.
  for (const name of [/Customers/, /Dies/, /Packing and stock/, /Dispatch and packing lists/]) {
    await expect(page.getByRole("checkbox", { name })).toBeChecked();
  }
  await page.getByRole("checkbox", { name: /Customers/ }).uncheck();
  await page.getByRole("button", { name: "Save plan" }).click();
  await expect(page.getByText("Plan saved", { exact: true })).toBeVisible();
  await expect(facts).toContainText("Starter");
  await expect(page.getByRole("button", { name: "Save plan" })).toBeDisabled();
  // What the server kept, not what the form remembers.
  await page.reload();
  await expect(page.getByRole("checkbox", { name: /Dies/ })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: /Customers/ })).not.toBeChecked();
  const companyUrl = new URL(page.url());
  const companyPath = companyUrl.pathname;

  // 3. Printing tab: set up a print station; the secrets show once.
  await page.getByRole("tab", { name: "Printing" }).click();
  await expect(page).toHaveURL(/tab=printing/);
  await expect(page.getByText("Label printing isn't set up")).toBeVisible();
  await page.getByRole("button", { name: "Set up label printing" }).click();
  const sheet = page.getByRole("dialog", { name: "Set up label printing" });
  // The suggested name comes from the company's short name (unique per run: it carries the tag).
  const station = await sheet.getByLabel("Station name").inputValue();
  expect(station).toBe(`e2e-godseye-${tag}`);
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

  // Rotate the secret: confirm first, then the new one shows once, in a sheet.
  await stationCard.getByRole("button", { name: "Rotate secret" }).click();
  const rotateDialog = page.getByRole("dialog", { name: `Rotate the secret for ${station}.spool.orrn.in?` });
  await rotateDialog.getByRole("button", { name: "Rotate secret" }).click();
  const rotated = page.getByRole("dialog", { name: "Secret rotated" });
  await expect(rotated.getByRole("button", { name: "Copy New shared secret" })).toBeVisible();
  await rotated.getByRole("button", { name: "Done" }).click();
  await expect(rotated).toHaveCount(0);
  // Install script: confirm, and the file downloads.
  await stationCard.getByRole("button", { name: "Install script" }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("dialog", { name: "Download the install script" }).getByRole("button", { name: "Download script" }).click();
  expect((await download).suggestedFilename()).toBe(`install-${station}-docker.sh`);
  await expect(page.getByText("Install script downloaded")).toBeVisible();
  // App downloads: a sheet with the computer picker.
  await stationCard.getByRole("button", { name: "Downloads" }).click();
  const downloads = page.getByRole("dialog", { name: "Download the print station app" });
  await expect(downloads.getByRole("radio", { name: "Mac with Apple chip" })).toBeChecked();
  await downloads.getByRole("button", { name: "Cancel" }).click();
  await expect(downloads).toHaveCount(0);
  // A second station is offered a name no station has used yet.
  await page.getByRole("button", { name: "Add a print station" }).click();
  const second = page.getByRole("dialog", { name: "Set up label printing" });
  await expect(second.getByLabel("Station name")).toHaveValue(`${station}-2`);
  await second.getByRole("button", { name: "Cancel" }).click();
  await expect(second).toHaveCount(0);

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
  // Touch target: the brief asks for 44px everywhere, laptop included.
  const stopButton = banner.getByRole("button", { name: "Stop impersonating" });
  // boundingBox() does not wait: a banner still settling after the Today load gave null (0 px).
  await expect(stopButton).toBeVisible();
  const stopBox = await stopButton.boundingBox();
  expect(stopBox?.height ?? 0).toBeGreaterThanOrEqual(44);
  await expect(page.locator("[data-slot='app-shell']")).toHaveAttribute("data-variant", "tenant");
  expect(await blockingAxeViolations(page, "[data-slot='impersonation-banner']"), "impersonation banner").toEqual([]);
  const stored = await page.evaluate(() => sessionStorage.getItem("orrn:impersonate-company-id"));
  expect(stored && JSON.parse(stored).expiresAt).toBeGreaterThan(Date.now());

  // Back to Godseye while still inside: no second session on top of this one.
  await page.goBack();
  await expect(page).toHaveURL(/tab=access/);
  await expect(page.getByText(`You are inside ${company} as support. Stop that session first.`)).toBeVisible();
  await expect(page.getByRole("button", { name: "Impersonate" })).toBeDisabled();
  await page.goto("/today");
  await expect(banner).toBeVisible();

  // 5. Stop. If the revoke never reaches the server, the banner stays and says so.
  await page.route("**/trpc/platform.impersonationRevokeGrant*", (route) => route.abort(), { times: 1 });
  await banner.getByRole("button", { name: "Stop impersonating" }).click();
  await expect(page.getByText("Couldn't stop the support session. Check the connection and try again.")).toBeVisible();
  await expect(banner).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem("orrn:impersonate-company-id"))).not.toBeNull();
  // Then it works: the grant is revoked, storage cleared, back on the company's Access tab.
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
  // Focus lands on the page heading, not on <body> (the card that opened the dialog is gone).
  await expect(page.getByRole("heading", { level: 1, name: "Access requests" })).toBeFocused();

  // A rejected request leaves no company behind: nothing waits for approval under its name.
  await page.goto("/admin/companies?status=pending");
  await page.getByLabel("Search companies").fill(company);
  await expect(page.getByText("No companies match. Try another search or filter.")).toBeVisible();
  await expect(page.getByRole("link", { name: new RegExp(company) })).toHaveCount(0);
});

test("approve and reject dialogs show a long email in full on a phone", async ({ page }) => {
  const tag = uniq();
  const email = `rameshbhai.patel.accounts.${tag}@shreeganeshjialuminium.co.in`;
  expect(email.length).toBeGreaterThan(50);
  const { company } = await fileRequest(page, tag, { email });
  await signInViaApi(page, "staff");
  await open(page, "/admin/requests", { width: 375 });
  const card = page.getByRole("article", { name: company });
  for (const action of ["Approve", "Reject"] as const) {
    await card.getByRole("button", { name: action }).click();
    const dialog = page.getByRole("dialog", { name: `${action} ${company}?` });
    await expect(dialog).toContainText(email);
    await expectNoClippedText(page, dialog);
    await expectNoHorizontalScroll(page);
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toHaveCount(0);
  }
  // Tidy up: reject it.
  await card.getByRole("button", { name: "Reject" }).click();
  await page.getByRole("dialog", { name: `Reject ${company}?` }).getByRole("button", { name: "Reject" }).click();
  await expect(card).toHaveCount(0);
});

test("approved owners without a password stay listed; their sign-in details read in full at 375, 820 and 1280, in Hindi too", async ({ page }) => {
  test.setTimeout(120_000);
  const tag = uniq();
  const email = `rameshbhai.patel.accounts.${tag}@shreeganeshjialuminium.co.in`;
  const { company } = await fileRequest(page, tag, { email });
  await signInViaApi(page, "staff");
  await open(page, "/admin/requests");
  await page.getByRole("article", { name: company }).getByRole("button", { name: "Approve" }).click();
  await page.getByRole("dialog", { name: `Approve ${company}?` }).getByRole("button", { name: "Approve" }).click();
  await expect(page.getByRole("dialog", { name: "Email could not be sent" })).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Done" }).click();

  for (const lang of ["en", "hi"] as const) {
    await page.evaluate((hi) => (hi ? localStorage.setItem("orrn.locale", "hi") : localStorage.removeItem("orrn.locale")), lang === "hi");
    for (const width of [375, 820, 1280]) {
      await open(page, "/admin/requests", { width, scheme: lang === "hi" ? "dark" : "light" });
      const owner = page.getByRole("article", { name: company });
      await expect(owner).toBeVisible();
      await expectNoHorizontalScroll(page);
      await owner.getByRole("button", { name: lang === "hi" ? "साइन इन डिटेल लें" : "Get sign-in details" }).click();
      const sheet = page.locator("[data-slot='sheet']");
      await expect(sheet).toBeVisible();
      await expect(sheet.getByLabel(lang === "hi" ? "संदेश" : "Message")).toBeVisible();
      await expectNoClippedText(page, sheet);
      await expectNoHorizontalScroll(page);
      await sheet.getByRole("button", { name: lang === "hi" ? "हो गया" : "Done" }).click();
      await expect(sheet).toHaveCount(0);
    }
  }
  await page.evaluate(() => localStorage.removeItem("orrn.locale"));
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

test("a company that does not exist still has a page heading and a way back", async ({ page }) => {
  await signInViaApi(page, "staff");
  await open(page, "/admin/companies/no-such-company");
  await expect(page.getByRole("heading", { level: 1, name: "Companies" })).toBeVisible();
  await expect(page.getByText("This company doesn't exist, or it was removed.")).toBeVisible();
  await expect(page.locator("main#main").getByRole("link", { name: "Companies", exact: true }).first()).toBeVisible();
});

/** How far the segmented control's raised thumb sits from the checked segment (0 = exactly under it). */
async function thumbMiss(page: Page) {
  return page.locator("main#main [data-slot='segmented-control']").first().evaluate((track) => {
    const thumb = track.querySelector(":scope > span[aria-hidden='true']")?.getBoundingClientRect();
    const checked = track.querySelector("[role='radio'][aria-checked='true']")?.getBoundingClientRect();
    if (!thumb || !checked) return Number.POSITIVE_INFINITY;
    return Math.round(Math.max(Math.abs(thumb.left - checked.left), Math.abs(thumb.width - checked.width)));
  });
}

test("the plan picker's highlight stays under the chosen plan on a phone, also after switching to Hindi", async ({ page }) => {
  await signInViaApi(page, "staff");
  await open(page, "/admin/companies/dev-company-orrn", { width: 375 });
  await expect(page.getByRole("radiogroup", { name: "Plan" })).toBeVisible();
  await expect.poll(() => thumbMiss(page), { timeout: 3_000 }).toBeLessThanOrEqual(1);
  // New labels, same full-width track: the thumb must follow the segment, not keep the English width.
  await page.getByRole("button", { name: "Account and more" }).click();
  await page.getByRole("dialog").getByRole("radio", { name: "हिंदी" }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "hi");
  await page.keyboard.press("Escape");
  try {
    await expect.poll(() => thumbMiss(page), { timeout: 3_000 }).toBeLessThanOrEqual(1);
  } finally {
    await page.evaluate(() => localStorage.removeItem("orrn.locale"));
  }
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
  // The search writes ?q= 250 ms after typing; a click before that lands is replaced by it.
  await expect(page).toHaveURL(/[?&]q=/);
  const link = page.getByRole("link", { name: new RegExp(company) });
  await expect(link).toHaveCount(1);
  await expect(page.locator("main#main [data-slot='chip']", { hasText: "Waiting for approval" })).toHaveCount(1);
  await expectNoClippedText(page, page.locator("main#main"));
  await link.click();
  await expect(page.getByRole("heading", { level: 1, name: company })).toBeVisible();
  await expect(page.getByRole("region", { name: "Company facts" })).toContainText("Waiting for approval");
  await expectNoHorizontalScroll(page);
  await expectNoClippedText(page, page.locator("main#main"));

  // Never approved: no owner yet, so it is reviewed through its request, never suspended or reactivated.
  const main = page.locator("main#main");
  await expect(main.getByRole("button", { name: "Reactivate" })).toHaveCount(0);
  await expect(main.getByRole("button", { name: "Suspend" })).toHaveCount(0);
  await expect(main.getByRole("link", { name: "Review the request" })).toHaveAttribute("href", "/admin/requests");
  await page.getByRole("tab", { name: "Access" }).click();
  await expect(main.getByText(`Only active companies can be opened. Approve the access request for ${company} first.`)).toBeVisible();
  await page.getByRole("tab", { name: "Printing" }).click();
  await expect(main.getByText(`Only active companies can print labels. Approve the access request for ${company} first.`)).toBeVisible();
  await main.getByRole("link", { name: "Review the request" }).click();
  await expect(page.getByRole("article", { name: company })).toBeVisible();
});

/**
 * The support session's end, on a fake clock: the banner switches to "in
 * under 5 minutes", then leaves the company on its own (no request needed:
 * the server already refuses an expired grant).
 */
test("the banner leaves the company on its own when the support session ends", async ({ page }) => {
  test.setTimeout(90_000);
  await signInViaApi(page, "staff");
  await page.clock.install();
  await open(page, "/admin/companies/dev-company-orrn?tab=access");
  await page.getByRole("radiogroup", { name: "Session length (minutes)" }).getByRole("radio", { name: "15", exact: true }).click();
  await page.getByLabel("Reason (optional)").fill("E2E timer check");
  await page.getByRole("button", { name: "Impersonate" }).click();
  await expect(page).toHaveURL(/\/today$/);
  const banner = page.locator("[data-slot='impersonation-banner']");
  await expect(banner).toContainText(/Ends at \d{2}:\d{2}/);
  await expect(banner).not.toContainText("in under 5 minutes");
  try {
    await page.clock.fastForward("11:00");
    await expect(banner).toContainText("in under 5 minutes");
    await page.clock.fastForward("05:00");
    await expect(page).toHaveURL(/\/admin\/companies\/dev-company-orrn\?tab=access$/);
    await expect(page.locator("[data-slot='impersonation-banner']")).toHaveCount(0);
    expect(await page.evaluate(() => sessionStorage.getItem("orrn:impersonate-company-id"))).toBeNull();
  } finally {
    // The server's clock did not move: stop the grant so it doesn't stay live for 15 minutes.
    const live = await page.context().request.get(`${API_URL}/trpc/platform.impersonationListActive`, {
      headers: { origin: WEB_ORIGIN },
    });
    const rows = ((await live.json()) as { result?: { data?: { id: string; companyId: string }[] } }).result?.data ?? [];
    for (const row of rows.filter((r) => r.companyId === "dev-company-orrn")) {
      await page.context().request.post(`${API_URL}/trpc/platform.impersonationRevokeGrant`, {
        headers: { origin: WEB_ORIGIN, "content-type": "application/json" },
        data: { id: row.id },
      });
    }
  }
});

/** Text inside main that is shortened with an ellipsis (wider than its box). */
async function shortenedText(page: Page) {
  return page.locator("main#main").evaluate((main) =>
    Array.from(main.querySelectorAll<HTMLElement>("*"))
      .filter((el) => {
        const cs = getComputedStyle(el);
        return cs.textOverflow === "ellipsis" && cs.display !== "none" && el.scrollWidth > el.clientWidth;
      })
      .map((el) => `${el.textContent?.trim()} (${el.scrollWidth} > ${el.clientWidth})`),
  );
}

test("Godseye screens in Hindi on a phone: nothing cut off, no label shortened", async ({ page }) => {
  test.setTimeout(90_000);
  await signInViaApi(page, "staff");
  await page.addInitScript(() => localStorage.setItem("orrn.locale", "hi"));
  for (const screen of SCREENS) {
    await open(page, screen.path, { width: 375 });
    await expect(page.locator("html")).toHaveAttribute("lang", "hi");
    await expect(page.locator("[aria-busy='true']")).toHaveCount(0);
    await expectNoHorizontalScroll(page);
    await expectNoClippedText(page, page.locator("main#main"));
    expect(await shortenedText(page), `${screen.name} in Hindi at 375px`).toEqual([]);
  }
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
  const waiting = await fileRequest(page, `${tag}b`);
  const longEmail = await fileRequest(page, `${tag}c`, {
    email: `rameshbhai.patel.accounts.${tag}@shreeganeshjialuminium.co.in`,
  });
  await signInViaApi(page, "staff");
  /** Viewport-only capture (dialogs and sheets are fixed to the screen). */
  const view = async (name: string) => {
    await settle();
    await page.screenshot({ path: join(dir!, `${name}.png`) });
  };
  const setHindi = async (on: boolean) => {
    await page.evaluate((hi) => (hi ? localStorage.setItem("orrn.locale", "hi") : localStorage.removeItem("orrn.locale")), on);
  };

  // A fresh company with a print station.
  await open(page, "/admin/requests");
  await page.getByRole("article", { name: approved.company }).getByRole("button", { name: "Approve" }).click();
  await page.getByRole("dialog", { name: `Approve ${approved.company}?` }).getByRole("button", { name: "Approve" }).click();
  await expect(page.getByRole("dialog", { name: "Email could not be sent" })).toBeVisible();
  await page.waitForTimeout(400);
  await view("fix1-signin-details-1280-light");
  await page.getByRole("dialog").getByRole("button", { name: "Done" }).click();
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

  // Fix round 1: a waiting company (Review the request), long email dialogs, Hindi durations, rotate and downloads sheets.
  await open(page, `/admin/companies?status=pending&q=${encodeURIComponent(waiting.company)}`, { width: 375 });
  await page.getByRole("link", { name: new RegExp(waiting.company) }).click();
  await expect(page.getByRole("heading", { level: 1, name: waiting.company })).toBeVisible();
  const waitingPath = new URL(page.url()).pathname;
  for (const lang of ["en", "hi"] as const) {
    await setHindi(lang === "hi");
    for (const tab of ["plan", "access", "printing"] as const) {
      await open(page, `${waitingPath}?tab=${tab}`, { width: 375 });
      await shot(`fix1-waiting-${tab}-375-light-${lang}`);
    }
    await open(page, "/admin/requests", { width: 375, scheme: lang === "hi" ? "dark" : "light" });
    await page.getByRole("article", { name: longEmail.company }).getByRole("button", { name: lang === "hi" ? "मंज़ूर करें" : "Approve", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await view(`fix1-approve-long-email-375-${lang}`);
    await page.keyboard.press("Escape");
    await open(page, `${companyPath}?tab=access`, { width: 375, scheme: lang === "hi" ? "dark" : "light" });
    await shot(`fix1-access-375-${lang}`);
    await open(page, `${companyPath}?tab=printing`, { width: 375 });
    await page.getByRole("article").first().getByRole("button", { name: lang === "hi" ? "सीक्रेट बदलें" : "Rotate secret" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await view(`fix1-rotate-confirm-375-${lang}`);
    await page.getByRole("dialog").getByRole("button", { name: lang === "hi" ? "सीक्रेट बदलें" : "Rotate secret" }).click();
    await expect(page.getByRole("dialog", { name: lang === "hi" ? "सीक्रेट बदल गया" : "Secret rotated" })).toBeVisible();
    await page.waitForTimeout(400);
    await view(`fix1-rotated-sheet-375-${lang}`);
    await page.getByRole("dialog").getByRole("button", { name: lang === "hi" ? "हो गया" : "Done" }).click();
    await page.getByRole("article").first().getByRole("button", { name: lang === "hi" ? "डाउनलोड" : "Downloads" }).click();
    await page.waitForTimeout(400);
    await view(`fix1-downloads-sheet-375-${lang}`);
    await page.keyboard.press("Escape");
  }
  await setHindi(false);

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

  // Tidy up (and the turned-off history, opened).
  await page.getByRole("tab", { name: "Printing" }).click();
  await page.getByRole("button", { name: "Turn off label printing" }).first().click();
  await page.getByRole("dialog", { name: /^Turn off / }).getByRole("button", { name: "Turn off" }).click();
  await expect(page.getByText("Label printing turned off")).toBeVisible();
  await page.getByText("Turned off earlier").click();
  await shot("fix1-printing-history-1280-light");
  await open(page, "/admin/requests");
  for (const req of [waiting, longEmail]) {
    await page.getByRole("article", { name: req.company }).getByRole("button", { name: "Reject" }).click();
    await page.getByRole("dialog", { name: `Reject ${req.company}?` }).getByRole("button", { name: "Reject" }).click();
    await expect(page.getByRole("article", { name: req.company })).toHaveCount(0);
  }
});

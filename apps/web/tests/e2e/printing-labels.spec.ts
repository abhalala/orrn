import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { operationsDense, type LabelDocument } from "@orrn/domain";

import { signInViaApi, type LocalRole } from "./helpers/accounts";
import { API_URL as API, WEB_ORIGIN as ORIGIN } from "./helpers/ports";
import { expectNoClippedText, expectNoHorizontalScroll } from "../helpers/layout-guards";

/**
 * Printing → Labels: the label design library. Each design is a card with a real print preview,
 * its size, publish and send state, and (for `spool.push_templates`) Edit label, Send and a menu
 * with Duplicate. New label names a design, picks a starter and opens it in the studio. A viewer
 * sees the same cards without any edit control. Designs are made through the real API.
 */

const WIDTHS = [375, 820, 1280, 1440] as const;

async function createDraft(page: Page, name: string, document: LabelDocument = operationsDense) {
  const response = await page.context().request.post(`${API}/trpc/spool.labelDocuments.createDraft`, {
    headers: { origin: ORIGIN },
    data: { name, document },
  });
  expect(response.ok(), `createDraft returned ${response.status()}: ${await response.text()}`).toBe(true);
  return (await response.json()).result.data as { id: string };
}

async function open(page: Page, width: number, role: LocalRole = "owner", scheme: "light" | "dark" = "light") {
  await page.setViewportSize({ width, height: 900 });
  await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
  await signInViaApi(page, role);
}

async function gotoLabels(page: Page) {
  await page.goto("/printing?tab=labels");
  await expect(page.getByRole("heading", { level: 2, name: /Label designs/ })).toBeVisible({ timeout: 20_000 });
  await expect(page.locator("main#main [aria-busy='true']")).toHaveCount(0);
}

async function expectContained(page: Page) {
  await expectNoHorizontalScroll(page);
  await expectNoClippedText(page, "main#main");
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .exclude(".TanStackRouterDevtools")
    .exclude("[class*='tsqd-']")
    .exclude("[data-sonner-toaster]")
    .analyze();
  const blocking = results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => ({ id: v.id, help: v.help, targets: v.nodes.slice(0, 5).map((n) => n.target.join(" ")) }));
  expect(blocking).toEqual([]);
}

/** The card for one design, found through the library search when the list is long. */
async function card(page: Page, name: string) {
  const search = page.getByLabel("Search label designs");
  if (await search.isVisible()) await search.fill(name);
  const found = page.getByTestId("label-design").filter({ has: page.getByRole("heading", { level: 3, name, exact: true }) });
  await expect(found).toHaveCount(1);
  return found;
}

for (const width of WIDTHS) {
  test(`owner ${width}: design cards show a real preview, size and state, inside the screen`, async ({ page }) => {
    await open(page, width);
    const name = `E2E library ${width} ${crypto.randomUUID().slice(0, 8)}`;
    await createDraft(page, name);
    await gotoLabels(page);
    await expect(page.getByRole("heading", { name: "Reprint a label" })).toBeVisible();
    // The quick reprint form stays inside its card at every width.
    const reprint = page.locator("section[aria-labelledby='reprint-title']");
    const [box, button] = await Promise.all([reprint.boundingBox(), reprint.getByRole("button", { name: "Open bundle" }).boundingBox()]);
    expect(button!.x + button!.width).toBeLessThanOrEqual(box!.x + box!.width);
    const design = await card(page, name);
    const preview = design.getByRole("img", { name: `Preview of ${name}` });
    await expect(preview).toBeVisible();
    // Real artwork: the QR and text are drawn, not a placeholder box.
    expect(await preview.locator("path, text").count()).toBeGreaterThan(5);
    await expect(design).toContainText("102.25 × 76.2 mm");
    const status = design.getByTestId("label-design-status");
    await expect(status).toContainText("Published v1");
    await expect(status).toContainText("Not sent to print computer");
    await expect(design.getByRole("link", { name: "Edit label" })).toBeVisible();
    await expect(design.getByRole("button", { name: "Send to print computer" })).toBeVisible();
    await expect(design.getByRole("button", { name: `More actions for ${name}` })).toBeVisible();
    await expect(page.getByRole("button", { name: "New label" })).toBeVisible();
    await expectContained(page);
    await page.screenshot({ path: test.info().outputPath(`labels-${width}.png`), fullPage: true });
  });
}

test("owner dark 1280: the library reads in dark mode", async ({ page }) => {
  await open(page, 1280, "owner", "dark");
  await createDraft(page, `E2E dark ${crypto.randomUUID().slice(0, 8)}`);
  await gotoLabels(page);
  await expectContained(page);
  await page.screenshot({ path: test.info().outputPath("labels-1280-dark.png"), fullPage: true });
});

test("owner: Edit label opens the design in the studio", async ({ page }) => {
  await open(page, 1280);
  const name = `E2E edit ${crypto.randomUUID().slice(0, 8)}`;
  const { id } = await createDraft(page, name);
  await gotoLabels(page);
  await (await card(page, name)).getByRole("link", { name: "Edit label" }).click();
  await expect(page).toHaveURL(new RegExp(`/printing/templates/${id}`));
  await expect(page.getByRole("heading", { level: 1, name: "Label Studio" })).toBeVisible();
});

test("owner: Duplicate makes a copy and opens it in the studio", async ({ page }) => {
  await open(page, 1280);
  const name = `E2E dup ${crypto.randomUUID().slice(0, 8)}`;
  const { id } = await createDraft(page, name);
  await gotoLabels(page);
  await (await card(page, name)).getByRole("button", { name: `More actions for ${name}` }).click();
  await page.getByRole("menuitem", { name: "Duplicate" }).click();
  await expect(page).toHaveURL(/\/printing\/templates\/[0-9a-f-]{36}/);
  expect(page.url()).not.toContain(id);
  await expect(page.getByRole("heading", { level: 1, name: "Label Studio" })).toBeVisible();
  await page.goto("/printing?tab=labels");
  await expect(await card(page, `${name} copy`)).toBeVisible();
});

test("owner: Send marks the design as sent, or says why it could not", async ({ page }) => {
  await open(page, 1280);
  const name = `E2E send ${crypto.randomUUID().slice(0, 8)}`;
  await createDraft(page, name);
  await gotoLabels(page);
  const design = await card(page, name);
  await design.getByRole("button", { name: "Send to print computer" }).click();
  const sent = page.getByText(`${name} sent to the print computer`);
  const failed = page.getByText("Couldn't send the label design. Check that the print computer is connected.");
  await expect(sent.or(failed)).toBeVisible();
  if (await sent.isVisible()) await expect(design.getByTestId("label-design-status")).toContainText("Sent ");
});

for (const width of [375, 1280] as const) {
  test(`owner ${width}: New label checks the name, starts from a starter and opens the studio`, async ({ page }) => {
    await open(page, width);
    await gotoLabels(page);
    await page.getByRole("button", { name: "New label" }).first().click();
    const dialog = page.getByRole("dialog", { name: "New label" });
    await expect(dialog).toBeVisible();
    // Every starter is offered with its preview; the name follows the pick until typed.
    for (const starter of ["Operations dense", "Polished classic", "Compact", "Dispatch weight", "Customer label", "Rack tag", "Shipping label", "Blank label"]) {
      await expect(dialog.getByRole("radio", { name: new RegExp(`^${starter}`) })).toBeAttached();
    }
    await dialog.getByTestId("starter-rackTag").click();
    await expect(dialog.getByRole("radio", { name: /^Rack tag/ })).toBeChecked();
    await expect(dialog.getByTestId("new-label-name")).toHaveValue(/^Rack tag/);
    await expect(dialog.getByTestId("starter-rackTag")).toContainText("50 × 25 mm");
    await dialog.getByTestId("new-label-name").fill("   ");
    await dialog.getByRole("button", { name: "Create and open studio" }).click();
    await expect(dialog.getByText("Enter a name.")).toBeVisible();
    await expectContained(page);
    const name = `E2E new ${width} ${crypto.randomUUID().slice(0, 8)}`;
    await dialog.getByTestId("new-label-name").fill(name);
    await page.screenshot({ path: test.info().outputPath(`labels-new-${width}.png`) });
    await dialog.getByRole("button", { name: "Create and open studio" }).click();
    await expect(page).toHaveURL(/\/printing\/templates\/[0-9a-f-]{36}/);
    await expect(page.getByRole("heading", { level: 1, name: "Label Studio" })).toBeVisible();
  });
}

test("owner: a taken name is refused before anything is created", async ({ page }) => {
  await open(page, 1280);
  const name = `E2E taken ${crypto.randomUUID().slice(0, 8)}`;
  await createDraft(page, name);
  await gotoLabels(page);
  await page.getByRole("button", { name: "New label" }).first().click();
  const dialog = page.getByRole("dialog", { name: "New label" });
  await dialog.getByTestId("new-label-name").fill(name.toUpperCase());
  await dialog.getByRole("button", { name: "Create and open studio" }).click();
  await expect(dialog.getByText("A label design already has this name.")).toBeVisible();
  await expect(page).toHaveURL(/tab=labels/);
});

test("owner: search narrows a long library by name", async ({ page }) => {
  await open(page, 1280);
  const run = crypto.randomUUID().slice(0, 8);
  for (let i = 0; i < 7; i += 1) await createDraft(page, `E2E search ${run} ${i}`);
  await gotoLabels(page);
  const search = page.getByLabel("Search label designs");
  await search.fill(`E2E search ${run} 3`);
  await expect(page.getByTestId("label-design")).toHaveCount(1);
  await search.fill(`no design is called ${run}`);
  await expect(page.getByText(`No label design matches "no design is called ${run}".`)).toBeVisible();
  await page.getByRole("button", { name: "Clear search" }).click();
  await expect(search).toHaveValue("");
  expect(await page.getByTestId("label-design").count()).toBeGreaterThan(6);
});

for (const width of [375, 1280] as const) {
  test(`viewer ${width}: sees the library read-only`, async ({ page }) => {
    await open(page, width, "viewer");
    await gotoLabels(page);
    const first = page.getByTestId("label-design").first();
    await expect(first.getByRole("img", { name: /^Preview of / })).toBeVisible();
    await expect(page.getByRole("link", { name: "Edit label" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Send to print computer" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "New label" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^More actions for / })).toHaveCount(0);
    await expectContained(page);
  });
}

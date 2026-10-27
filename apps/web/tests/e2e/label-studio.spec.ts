import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

import { operationsDense } from "@orrn/domain";

import { signInViaApi } from "./helpers/accounts";
import { API_URL as API, WEB_ORIGIN as ORIGIN } from "./helpers/ports";

async function blockingAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .exclude(".TanStackRouterDevtools")
    .exclude("[aria-label='Label canvas']")
    .analyze();
  return results.violations.filter((violation) => violation.impact === "critical" || violation.impact === "serious");
}

async function createDraft(page: Page, document = operationsDense) {
  const response = await page.context().request.post(`${API}/trpc/spool.labelDocuments.createDraft`, {
    headers: { origin: ORIGIN },
    data: { name: `E2E ${document.elements[0]!.id} ${crypto.randomUUID()}`, document },
  });
  expect(response.ok(), `createDraft returned ${response.status()}: ${await response.text()}`).toBe(true);
  return (await response.json()).result.data as { id: string; version: number };
}

test("owner edits, duplicates, undoes, and publishes a dense label", async ({ page }) => {
  await signInViaApi(page, "owner");
  const draft = await createDraft(page);
  await page.goto(`/printing/templates/${draft.id}`);
  await expect(page.getByRole("heading", { level: 1, name: "Label Studio" })).toBeVisible();
  await expect(page.getByTestId("element-serial")).toBeVisible();

  await page.getByTestId("element-serial").focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByLabel("X (mm)", { exact: true })).toHaveValue("4.25");
  await page.getByRole("button", { name: "Rotate 90°" }).click();
  await expect(page.getByLabel("Rotation", { exact: true })).toHaveValue("90");
  await page.getByRole("button", { name: "Duplicate", exact: true }).click();
  await expect(page.getByTestId("element-serial-copy")).toBeVisible();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByTestId("element-serial-copy")).toHaveCount(0);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByLabel("Rotation", { exact: true })).toHaveValue("0");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByLabel("X (mm)", { exact: true })).toHaveValue("4");
  expect(await blockingAxeViolations(page), "label studio accessibility").toEqual([]);
  await page.getByRole("button", { name: "Publish template", exact: true }).click();
  await expect(page.getByText("Template published")).toBeVisible();
});

test("server rejects an invalid document instead of publishing it", async ({ page }) => {
  await signInViaApi(page, "owner");
  const invalid = structuredClone(operationsDense);
  // @ts-expect-error intentionally forbidden variable for server validation
  invalid.elements[0]!.variable = "uuid";
  const response = await page.context().request.post(`${API}/trpc/spool.labelDocuments.createDraft`, {
    headers: { origin: ORIGIN },
    data: { name: "Invalid label", document: invalid },
  });
  expect(response.status()).toBe(400);
  expect(await response.text()).toContain("Forbidden label variable");
});

for (const width of [375, 820, 1280]) {
  test(`studio controls fit at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await signInViaApi(page, "owner");
    const draft = await createDraft(page);
    await page.goto(`/printing/templates/${draft.id}`);
    await expect(page.getByRole("heading", { level: 1, name: "Label Studio" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Publish template", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}

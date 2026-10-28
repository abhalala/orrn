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
  await createDraft(page);
  await page.goto("/printing?tab=labels");
  await page.getByRole("link", { name: "Edit label" }).first().click();
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

test("opens a legacy dot-based template instead of crashing", async ({ page }) => {
  await signInViaApi(page, "owner");
  const templateId = crypto.randomUUID();
  await page.route("**/trpc/**", async (route) => {
    if (!route.request().url().includes("spool.labelDocuments.get")) return route.fallback();
    const response = await route.fetch();
    const body = await response.json();
    const legacy = {
      id: templateId,
      companyId: "dev-company-orrn",
      serverSeq: 1,
      name: "Legacy bundle",
      kind: "bundle",
      variables: {},
      version: 1,
      schema: {
        name: "Bundle",
        width_mm: 102.25,
        height_mm: 76.2,
        gap_mm: 3,
        dpi: 203,
        elements: [{ type: "text", x: 20, y: 20, content: "{{serial}}", font: "3" }],
      },
      draftSchema: null,
      draftUpdatedAt: null,
      spoolTemplateId: null,
      spoolPushedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      deletedAt: null,
    };
    if (Array.isArray(body)) {
      const index = decodeURIComponent(new URL(route.request().url()).pathname.split("/trpc/")[1] ?? "").split(",").indexOf("spool.labelDocuments.get");
      body[index] = { result: { data: legacy } };
      await route.fulfill({ response, json: body });
    } else {
      await route.fulfill({ response, json: { result: { data: legacy } } });
    }
  });
  await page.goto(`/printing/templates/${templateId}`);
  await expect(page.getByRole("heading", { level: 1, name: "Label Studio" })).toBeVisible();
  await expect(page.getByTestId("element-element-0")).toContainText("serialNumber");
  await expect(page.getByText("Something went wrong!")).toHaveCount(0);
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

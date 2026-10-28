import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

import { compactLabel, operationsDense } from "@orrn/domain";

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

async function openStudio(page: Page, document = operationsDense) {
  await signInViaApi(page, "owner");
  const draft = await createDraft(page, document);
  await page.goto(`/printing/templates/${draft.id}`);
  await expect(page.getByRole("heading", { level: 1, name: "Label Studio" })).toBeVisible();
  return draft;
}

const xField = (page: Page) => page.getByLabel("X (mm)", { exact: true });

test("owner nudges, rotates, duplicates, undoes, and publishes a dense label", async ({ page }) => {
  await openStudio(page);
  await page.getByTestId("element-serial").focus();
  await page.keyboard.press("ArrowRight");
  await expect(xField(page)).toHaveValue("4.25");
  await page.getByRole("button", { name: "Rotate 90°" }).click();
  await expect(page.getByLabel("Rotation", { exact: true })).toHaveValue("90");
  await page.getByRole("button", { name: "Duplicate", exact: true }).click();
  await expect(page.getByTestId("element-serial-copy")).toBeVisible();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByTestId("element-serial-copy")).toHaveCount(0);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await page.getByTestId("element-serial").focus();
  await expect(page.getByLabel("Rotation", { exact: true })).toHaveValue("0");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(xField(page)).toHaveValue("4");
  expect(await blockingAxeViolations(page), "label studio accessibility").toEqual([]);
  await page.getByRole("button", { name: "Publish template", exact: true }).click();
  await expect(page.getByText("Template published")).toBeVisible();
});

test("drags an element with the mouse in one undo step and snaps to the grid", async ({ page }) => {
  await openStudio(page, compactLabel);
  const weight = page.getByTestId("element-weight");
  // Wait for the real bundle values and the fitted zoom, which both move the element.
  await page.waitForLoadState("networkidle");
  await weight.hover({ position: { x: 10, y: 10 } });
  const box = (await weight.boundingBox())!;
  await page.mouse.move(box.x + 10, box.y + 10);
  // Alt skips smart guides so the move lands on the 0.5 mm grid.
  await page.keyboard.down("Alt");
  await page.mouse.down();
  await page.mouse.move(box.x + 130, box.y + 50, { steps: 10 });
  await page.mouse.up();
  await page.keyboard.up("Alt");
  await expect.poll(async () => Number(await xField(page).inputValue())).toBeGreaterThan(8);
  const x = Number(await xField(page).inputValue());
  expect((x * 2) % 1, "snapped to 0.5 mm").toBe(0);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await page.getByTestId("element-weight").focus();
  await expect(xField(page)).toHaveValue("4");
});

test("adds a bundle field from the frozen catalog and shows its real value", async ({ page }) => {
  await openStudio(page, compactLabel);
  await page.getByRole("button", { name: "Add" }).click();
  await page.getByRole("menuitem", { name: "Bundle field" }).hover();
  await page.getByRole("menuitem", { name: "Cast", exact: true }).click();
  await expect(page.getByTestId("element-cast")).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Prints" })).toHaveValue("cast");
  await expect(page.getByRole("button", { name: "Save draft" })).toBeEnabled();
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText("Draft saved", { exact: true }).first()).toBeVisible();
});

test("print preview renders a real QR code and flags elements that run off the label", async ({ page }) => {
  await openStudio(page);
  await page.getByRole("button", { name: "Print preview" }).click();
  const preview = page.getByRole("img", { name: "Print preview" });
  await expect(preview).toBeVisible();
  // A real QR is hundreds of module squares in one path, not a placeholder box.
  expect((await preview.locator("path").first().getAttribute("d"))?.split("M").length ?? 0).toBeGreaterThan(200);
  await page.getByRole("button", { name: "Print preview" }).click();
  await page.getByTestId("element-total").focus();
  await xField(page).fill("95");
  await xField(page).press("Enter");
  await page.getByRole("tab", { name: /Checks/ }).click();
  await expect(page.getByRole("button", { name: "Total weight runs past the label edge" })).toBeVisible();
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
        gap_mm: 2,
        dpi: 203,
        elements: [
          { type: "text", x: 30, y: 30, font: "3", x_scale: 2, y_scale: 2, content: "{{serialNumber}}" },
          { type: "barcode", x: 30, y: 110, symbology: "128", height: 70, narrow: 2, wide: 2, content: "{{serialNumber}}" },
        ],
      },
      draftSchema: null,
      draftUpdatedAt: null,
      spoolTemplateId: null,
      spoolPushedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      deletedAt: null,
    };
    const procedures = decodeURIComponent(new URL(route.request().url()).pathname.split("/trpc/")[1] ?? "").split(",");
    if (Array.isArray(body)) {
      body[procedures.indexOf("spool.labelDocuments.get")] = { result: { data: legacy } };
      await route.fulfill({ response, json: body });
    } else {
      await route.fulfill({ response, json: { result: { data: legacy } } });
    }
  });
  await page.goto(`/printing/templates/${templateId}`);
  await expect(page.getByRole("heading", { level: 1, name: "Label Studio" })).toBeVisible();
  await expect(page.getByTestId("element-element-0")).toBeVisible();
  // The barcode encodes the bundle number into real bars.
  expect(await page.getByTestId("element-element-1").locator("rect").count()).toBeGreaterThan(20);
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

for (const width of [375, 820, 1280, 1440]) {
  test(`studio controls stay inside the screen at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await openStudio(page);
    await expect(page.getByRole("button", { name: "Publish template", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const outside = await page.evaluate(() =>
      [...document.querySelectorAll("main button, main [role='tab'], main select, main input")]
        .filter((element) => element.closest("[aria-label='Label canvas']") === null)
        .map((element) => ({ name: element.getAttribute("aria-label") ?? element.textContent?.trim() ?? element.tagName, box: element.getBoundingClientRect() }))
        .filter(({ box }) => box.width > 0 && (box.right > window.innerWidth + 0.5 || box.left < -0.5))
        .map(({ name }) => name),
    );
    expect(outside, "controls clipped off screen").toEqual([]);
  });
}

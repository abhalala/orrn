import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { signInViaApi } from "./helpers/accounts";
import { expectNoHorizontalScroll } from "../helpers/layout-guards";

/**
 * New label → Photo of a label. The test photo is the built-in "Operations dense" print preview
 * (the starter card's own SVG) drawn large, slightly turned, on a dark table, as a PNG. The import
 * must find the label, read its QR and text in this browser, bind fields through the captions, and
 * open the studio with the photo as a tracing underlay, without a single request leaving
 * localhost.
 */

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Every request the page makes to a host that is not this machine. */
function offsiteRequests(page: Page): string[] {
  const offsite: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if ((url.protocol === "http:" || url.protocol === "https:" || url.protocol === "ws:" || url.protocol === "wss:") && !LOCAL_HOSTS.has(url.hostname)) offsite.push(request.url());
  });
  return offsite;
}

/** PNG of the operations dense starter, photographed: turned 3°, on a dark surface. */
async function labelPhoto(page: Page): Promise<Buffer> {
  const dataUrl = await page.getByTestId("starter-operationsDense").locator("svg[role='img']").evaluate(async (svg) => {
    const clone = svg.cloneNode(true) as SVGSVGElement;
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("width", "1400");
    clone.setAttribute("height", String(Math.round((1400 * 76.2) / 102.25)));
    const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: "image/svg+xml" }));
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = 1800;
    canvas.height = 1400;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#3b3a36";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.translate(900, 700);
    context.rotate((3 * Math.PI) / 180);
    context.fillStyle = "#ffffff";
    context.fillRect(-700, -image.height / 2, 1400, image.height);
    context.drawImage(image, -700, -image.height / 2, 1400, image.height);
    URL.revokeObjectURL(url);
    return canvas.toDataURL("image/png");
  });
  return Buffer.from(dataUrl.split(",")[1]!, "base64");
}

async function blockingViolations(page: Page, include?: string) {
  let builder = new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .exclude(".TanStackRouterDevtools")
    .exclude("[class*='tsqd-']")
    .exclude("[data-sonner-toaster]")
    .exclude("[aria-label='Label canvas']");
  if (include) builder = builder.include(include);
  const results = await builder.analyze();
  return results.violations
    .filter((violation) => violation.impact === "serious" || violation.impact === "critical")
    .map((violation) => ({ id: violation.id, help: violation.help, targets: violation.nodes.slice(0, 5).map((node) => node.target.join(" ")) }));
}

for (const width of [375, 1280] as const) {
  test(`owner ${width}: a photo of a label becomes an editable design with a tracing underlay`, async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    const offsite = offsiteRequests(page);
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    await signInViaApi(page, "owner");
    await page.goto("/printing?tab=labels");
    await page.getByRole("button", { name: "New label" }).first().click();
    const dialog = page.getByRole("dialog", { name: "New label" });
    await expect(dialog).toBeVisible();
    const photo = await labelPhoto(page);
    await testInfo.attach("test-photo", { body: photo, contentType: "image/png" });

    await dialog.getByRole("radio", { name: "Photo of a label" }).click();
    await expect(dialog.getByTestId("new-label-name")).toHaveValue(/^Label from photo/);
    await expect(dialog.getByText("The photo stays on this device.", { exact: false })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Create and open studio" })).toBeDisabled();
    await dialog.getByTestId("photo-input").setInputFiles({ name: "label.png", mimeType: "image/png", buffer: photo });

    // Corners: found on the table, draggable and keyboard-movable.
    const topLeft = dialog.getByRole("button", { name: "Top left corner" });
    await expect(topLeft).toBeVisible();
    await expect(dialog.getByRole("img", { name: "Straightened label" })).toBeVisible();
    await expect(dialog.getByLabel("Label stock")).toHaveValue("102.25 × 76.2 mm (4 × 3 in)");
    expect(await blockingViolations(page, "[role='dialog']"), "crop step accessibility").toEqual([]);
    await expectNoHorizontalScroll(page);
    await page.screenshot({ path: testInfo.outputPath(`crop-${width}.png`) });

    await dialog.getByTestId("photo-read").click();
    const review = dialog.getByTestId("photo-review");
    await expect(review).toBeVisible({ timeout: 120_000 });

    // What was found, as the review list shows it.
    const found = await dialog.getByTestId("photo-items").locator("li").evaluateAll((rows) =>
      rows.map((row) => ({
        id: row.getAttribute("data-testid")!.replace("photo-item-", ""),
        text: row.querySelector("label span")?.textContent ?? "",
        binding: (row.querySelector("select") as HTMLSelectElement).value,
      })),
    );
    await testInfo.attach("found", { body: JSON.stringify(found, null, 2), contentType: "application/json" });
    const qr = found.find((item) => item.id.startsWith("qr"));
    expect(qr?.binding, "the QR is read and bound to the QR address").toBe("qr");
    expect(found.filter((item) => !item.id.startsWith("qr")).length, "several text lines are read").toBeGreaterThanOrEqual(8);
    const bindings = new Set(found.map((item) => item.binding).filter(Boolean));
    for (const field of ["serialNumber", "quantity", "length", "weight"]) expect(bindings, `binds ${field}`).toContain(field);
    expect(bindings.size, "binds most of the label's fields").toBeGreaterThanOrEqual(8);
    expect(found.filter((item) => item.binding === "").length, "keeps captions as fixed text").toBeGreaterThanOrEqual(5);
    await expect(dialog.getByRole("img", { name: "Label made from the photo" })).toBeVisible();
    await expect(dialog.getByTestId("photo-issues")).not.toBeEmpty();

    // A review choice changes the result: leave out one caption, then put it back.
    const caption = dialog.getByTestId("photo-items").locator("li").filter({ hasText: "Caption" }).first();
    const checkbox = caption.getByRole("checkbox");
    await checkbox.click();
    await expect(checkbox).not.toBeChecked();
    await checkbox.click();
    await expect(checkbox).toBeChecked();

    expect(await blockingViolations(page, "[role='dialog']"), "review step accessibility").toEqual([]);
    await expectNoHorizontalScroll(page);
    await page.screenshot({ path: testInfo.outputPath(`review-${width}.png`), fullPage: true });
    await review.screenshot({ path: testInfo.outputPath(`review-panel-${width}.png`) });

    const name = `Photo import ${width} ${crypto.randomUUID().slice(0, 8)}`;
    await dialog.getByTestId("new-label-name").fill(name);
    await dialog.getByRole("button", { name: "Create and open studio" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Label Studio" })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(name, { exact: false })).toBeVisible();
    expect(await page.locator("[data-testid^='element-']").count(), "the studio opens with the imported elements").toBeGreaterThanOrEqual(10);

    // The photo sits under the label while editing, toggles, and never shows in print preview.
    const underlay = page.getByRole("button", { name: "Photo underlay" });
    await expect(underlay).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("tracing-photo")).toHaveCount(1);
    await page.screenshot({ path: testInfo.outputPath(`studio-${width}.png`), fullPage: true });
    await underlay.click();
    await expect(underlay).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByTestId("tracing-photo")).toHaveCount(0);
    await underlay.click();
    await expect(page.getByTestId("tracing-photo")).toHaveCount(1);
    const opacity = page.getByLabel("Photo opacity");
    await expect(opacity).toHaveValue("50");
    await opacity.fill("80");
    await expect(page.getByTestId("tracing-photo")).toHaveAttribute("opacity", "0.8");
    await page.getByRole("button", { name: "Print preview" }).click();
    await expect(page.getByTestId("tracing-photo")).toHaveCount(0);
    await page.getByRole("button", { name: "Print preview" }).click();
    expect(await blockingViolations(page), "studio accessibility").toEqual([]);

    expect(offsite, "no request leaves this machine").toEqual([]);
  });
}

import AxeBuilder from "@axe-core/playwright";
import { GUIDE_SLUGS, getGuide, listGuides } from "@orrn/i18n/guides";
import { expect, test, type Page } from "@playwright/test";

import { expectNoClippedText, expectNoHorizontalScroll } from "../helpers/layout-guards";
import { signInViaApi, type LocalRole } from "./helpers/accounts";

/**
 * Guides (Task 26): the library at /guides and one guide at /guides/$slug, in
 * English and Hindi, at phone, iPad and laptop widths. The expected words come
 * from the same guide books the screen renders, so a reworded step doesn't
 * break the spec; the checks are that the page shows every step, switches
 * language, links only to screens the role can open, and fails honestly for a
 * slug that doesn't exist.
 */

const WIDTHS = [375, 820, 1280] as const;
type Locale = "en" | "hi";

async function open(page: Page, path: string, opts: { width: number; locale?: Locale; role?: LocalRole }) {
  await page.setViewportSize({ width: opts.width, height: 900 });
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.addInitScript((locale) => {
    try {
      localStorage.setItem("orrn.locale", locale);
    } catch {
      // Storage blocked: the page falls back to English and the assertion says so.
    }
  }, opts.locale ?? "en");
  await signInViaApi(page, opts.role ?? "owner");
  await page.goto(path);
  await expect(page.locator("[data-slot='app-shell']")).toBeVisible();
  await expect(page.locator("main#main h1").first()).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", opts.locale ?? "en");
}

async function seriousViolations(page: Page) {
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

async function expectClean(page: Page) {
  await expectNoHorizontalScroll(page);
  await expectNoClippedText(page, "main#main");
  expect(await seriousViolations(page)).toEqual([]);
}

for (const width of WIDTHS) {
  test.describe(`at ${width}px`, () => {
    test("the index lists every guide the owner can follow and opens one", async ({ page }) => {
      await open(page, "/guides", { width });
      const expected = listGuides("en", "owner");
      expect(expected.length).toBeGreaterThanOrEqual(10);
      await expect(page.locator("[data-guide-link]")).toHaveCount(expected.length);
      for (const g of expected) {
        await expect(page.locator(`[data-guide-link='${g.slug}']`)).toContainText(g.title);
      }
      // Guides written for orrn support staff are not on a plant owner's list.
      await expect(page.locator("[data-guide-link='approve-access-request']")).toHaveCount(0);
      await expectClean(page);

      await page.locator("[data-guide-link='pack-session']").click();
      await expect(page).toHaveURL(/\/guides\/pack-session$/);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(getGuide("pack-session", "en").title);
    });

    for (const locale of ["en", "hi"] as const) {
      test(`a guide shows its numbered steps in ${locale}`, async ({ page }) => {
        await open(page, "/guides/build-dispatch", { width, locale });
        const guide = getGuide("build-dispatch", locale);
        await expect(page.getByRole("heading", { level: 1 })).toHaveText(guide.title);
        const steps = page.locator("[data-slot='guide-step']");
        await expect(steps).toHaveCount(guide.steps.length);
        for (const [i, step] of guide.steps.entries()) {
          await expect(steps.nth(i)).toContainText(step.title);
          await expect(steps.nth(i)).toContainText(step.body);
          await expect(steps.nth(i)).toContainText(String(i + 1));
        }
        for (const p of guide.problems) await expect(page.getByText(p.title, { exact: true })).toBeVisible();
        await expect(page.locator("article")).toHaveAttribute("lang", locale);
        await expectClean(page);
      });
    }

    test("an unknown slug says so and offers the library", async ({ page }) => {
      await open(page, "/guides/no-such-guide", { width });
      await expect(page.getByText("We don't have that guide")).toBeVisible();
      await expect(page.locator("[data-slot='guide-step']")).toHaveCount(0);
      await expectClean(page);
      await page.getByRole("link", { name: "All guides" }).click();
      await expect(page).toHaveURL(/\/guides$/);
      await expect(page.locator("[data-guide-link]").first()).toBeVisible();
    });
  });
}

test.describe("content", () => {
  for (const locale of ["en", "hi"] as const) {
    test(`every guide renders its steps in ${locale}`, async ({ page }) => {
      await open(page, "/guides", { width: 390, locale });
      for (const slug of GUIDE_SLUGS) {
        const guide = getGuide(slug, locale);
        await page.goto(`/guides/${slug}`);
        await expect(page.getByRole("heading", { level: 1 })).toHaveText(guide.title);
        await expect(page.locator("[data-slot='guide-step']")).toHaveCount(guide.steps.length);
        await expect(page.locator("[data-slot='guide-step']").first()).toContainText(guide.steps[0]!.title);
      }
    });
  }

  test("the language toggle switches an open guide at once", async ({ page }) => {
    await open(page, "/guides/stock-count", { width: 390 });
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(getGuide("stock-count", "en").title);
    await page.getByRole("button", { name: "Account and more" }).click();
    await page.getByRole("dialog", { name: "More" }).getByRole("radio", { name: "हिंदी" }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", "hi");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(getGuide("stock-count", "hi").title);
    await page.evaluate(() => localStorage.removeItem("orrn.locale"));
  });

  test("a viewer's list holds only the guides their role can follow", async ({ page }) => {
    await open(page, "/guides", { width: 390, role: "viewer" });
    const expected = listGuides("en", "viewer");
    await expect(page.locator("[data-guide-link]")).toHaveCount(expected.length);
    expect(expected.length).toBeLessThan(listGuides("en", "owner").length);
  });

  test("related screens link out, and only to screens the role can open", async ({ page }) => {
    await open(page, "/guides/stock-by-die", { width: 1280 });
    const related = page.getByRole("region", { name: "Related screens" });
    await expect(related.getByRole("link", { name: "Stock", exact: true })).toBeVisible();
    await related.getByRole("link", { name: "Stock", exact: true }).click();
    await expect(page).toHaveURL(/\/stock$/);

    await page.goto("/guides/pack-session");
    await expect(page.getByRole("region", { name: "Related screens" }).getByRole("link", { name: "Pack", exact: true })).toBeVisible();
  });

  test("a viewer is not offered Pack on the pack guide", async ({ page }) => {
    await open(page, "/guides/pack-session", { width: 1280, role: "viewer" });
    const related = page.getByRole("region", { name: "Related screens" });
    await expect(related.getByRole("link", { name: "All bundles" })).toBeVisible();
    await expect(related.getByRole("link", { name: "Pack", exact: true })).toHaveCount(0);
  });

  test("a guide for orrn support staff opens by link but isn't listed for a plant owner", async ({ page }) => {
    await open(page, "/guides/approve-access-request", { width: 390 });
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(getGuide("approve-access-request", "en").title);
    await expect(page.getByText("orrn support staff")).toBeVisible();
    await expect(page.getByRole("region", { name: "Related screens" })).toHaveCount(0);
  });
});

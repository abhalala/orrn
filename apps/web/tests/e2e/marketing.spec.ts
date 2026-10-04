import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { MARKETING_BUDGET_GZIP, MARKETING_MARKER, measureRoute } from "../../scripts/route-budget";
import { collectClippedTextIssues, collectHorizontalScrollIssues } from "../helpers/layout-guards";
import { signInViaApi } from "./helpers/accounts";

/**
 * Marketing page `/` (C2 Task 18). Needs the local stack for the signed-in
 * redirect; everything else is public.
 */

const HEADLINE = "Every bundle, accounted for.";

async function setTheme(page: Page, theme: "light" | "dark") {
  await page.evaluate((t) => {
    document.documentElement.classList.remove("light", "dark");
    document.documentElement.classList.add(t);
    localStorage.setItem("orrn.theme", t);
  }, theme);
}

test.describe("marketing page", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.removeItem("orrn.locale"));
  });

  test("headline, one h1, and both CTAs go to request access and sign in", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(HEADLINE);
    await expect(page.locator("h1")).toHaveCount(1);

    const hero = page.locator("[data-marketing-hero]");
    await expect(hero.getByRole("link", { name: "Request access" })).toHaveAttribute("href", "/request-access");
    await expect(hero.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");

    const closing = page.locator("[data-marketing-cta]");
    await expect(closing.getByRole("link", { name: "Request access" })).toHaveAttribute("href", "/request-access");
    await expect(closing.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
  });

  test("Request access opens the request form, Sign in opens login", async ({ page }) => {
    await page.goto("/");
    await page.locator("[data-marketing-hero]").getByRole("link", { name: "Request access" }).click();
    await expect(page).toHaveURL(/\/request-access$/);
    await page.goto("/");
    await page.locator("[data-marketing-hero]").getByRole("link", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/login$/);
  });

  test("landmarks and section headings are in order", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("banner")).toHaveCount(1);
    await expect(page.getByRole("main")).toHaveCount(1);
    await expect(page.getByRole("contentinfo")).toHaveCount(1);
    const h2s = await page.locator("main h2").allTextContents();
    expect(h2s).toEqual([
      "Pack. Stock. Dispatch.",
      "Built for the floor",
      "For the office",
      "Your data stays yours",
      "Try it on your floor",
    ]);
  });

  test("demo visuals are hidden from screen readers and carry a visible Demo data label", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const visuals = page.locator("[data-demo-visual]");
    const count = await visuals.count();
    expect(count).toBeGreaterThanOrEqual(3);
    for (let i = 0; i < count; i++) {
      const visual = visuals.nth(i);
      await expect(visual).toHaveAttribute("aria-hidden", "true");
      await expect(visual.getByText("Demo data", { exact: true })).toBeVisible();
    }
  });

  test("one tap switches the page to Hindi and sets <html lang>", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("banner").getByRole("radio", { name: "हिंदी" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("हर bundle का पूरा हिसाब।");
    await expect(page.locator("html")).toHaveAttribute("lang", "hi");
    await page.getByRole("banner").getByRole("radio", { name: "English" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(HEADLINE);
  });

  test("reduced motion shows the final state with nothing hidden or moved", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const moved = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLElement>("[data-anim]"))
        .filter((el) => {
          const cs = getComputedStyle(el);
          return cs.opacity !== "1" || (cs.transform !== "none" && cs.transform !== "matrix(1, 0, 0, 1, 0, 0)");
        })
        .map((el) => el.dataset.anim),
    );
    expect(moved).toEqual([]);
  });

  test("with motion, the hero settles into the same final state", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    // The sequence runs about 2.5 s after the picture is in view; poll instead
    // of a fixed wait so a busy machine does not read it mid-flight.
    await expect
      .poll(
        () =>
          page.evaluate(() =>
            Array.from(document.querySelectorAll<HTMLElement>("[data-marketing-hero] [data-anim]"))
              .filter((el) => getComputedStyle(el).opacity !== "1")
              .map((el) => el.dataset.anim),
          ),
        { timeout: 10_000 },
      )
      .toEqual([]);
  });

  test("the flow demos play when scrolled into view", async ({ page }) => {
    await page.goto("/");
    const flow = page.locator("#flow");
    await flow.scrollIntoViewIfNeeded();
    await expect(flow).toHaveAttribute("data-played", "true", { timeout: 5000 });
  });

  for (const width of [375, 390, 820, 1280]) {
    test(`no sideways scroll or clipped text at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto("/");
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      expect(await collectHorizontalScrollIssues(page)).toEqual([]);
      expect(await collectClippedTextIssues(page)).toEqual([]);
    });
  }

  for (const theme of ["light", "dark"] as const) {
    for (const width of [390, 1280]) {
      test(`no serious or critical axe violations, ${theme} at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.emulateMedia({ reducedMotion: "reduce", colorScheme: theme });
        await page.goto("/");
        await setTheme(page, theme);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        const results = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
          .analyze();
        const blocking = results.violations
          .filter((v) => v.impact === "serious" || v.impact === "critical")
          .map((v) => ({ id: v.id, targets: v.nodes.slice(0, 5).map((n) => n.target.join(" ")) }));
        expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
      });
    }
  }

  test("keyboard: the skip link jumps past the header to the hero actions", async ({ page }) => {
    await page.goto("/");
    // The page renders after the route's session check: wait for it before tabbing.
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
    await page.keyboard.press("Enter");
    await page.keyboard.press("Tab");
    await expect(page.locator("[data-marketing-hero]").getByRole("link", { name: "Request access" })).toBeFocused();
  });
});

test.describe("signed in", () => {
  test("an owner opening / lands on /today", async ({ page }) => {
    await signInViaApi(page, "owner");
    await page.goto("/");
    await expect(page).toHaveURL(/\/today$/);
  });
});

test.describe("JS budget", () => {
  const dist = fileURLToPath(new URL("../../dist", import.meta.url));

  test("/ downloads under 250 kB of JS gzip (from the build output)", () => {
    test.skip(!existsSync(`${dist}/index.html`), "no build output: run `bun run build` in apps/web first");
    const result = measureRoute(dist, MARKETING_MARKER);
    expect(result.routeChunks.length, "marketing route chunk not found by its marker").toBeGreaterThan(0);
    expect(result.gzip).toBeLessThan(MARKETING_BUDGET_GZIP);
  });
});

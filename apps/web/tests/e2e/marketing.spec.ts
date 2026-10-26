import { existsSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { MARKETING_BUDGET_GZIP, MARKETING_MARKER, measureRoute } from "../../scripts/route-budget";
import { collectClippedTextIssues, collectHorizontalScrollIssues } from "../helpers/layout-guards";
import { signInViaApi } from "./helpers/accounts";

async function openMarketing(page: Page) {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
}

async function setTheme(page: Page, theme: "light" | "dark") {
  await page.evaluate((value) => {
    document.documentElement.classList.remove("light", "dark");
    document.documentElement.classList.add(value);
    localStorage.setItem("orrn.theme", value);
  }, theme);
}

async function openInHindi(page: Page) {
  await page.addInitScript(() => localStorage.setItem("orrn.locale", "hi"));
  await openMarketing(page);
  await expect(page.locator("html")).toHaveAttribute("lang", "hi");
}

// These assert public behavior, not the homepage's wording or illustration geometry.
test.describe("marketing page", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.removeItem("orrn.locale"));
  });

  test("one h1 and the two front-door actions in the hero and closing invitation", async ({ page }) => {
    await openMarketing(page);
    await expect(page.locator("h1")).toHaveCount(1);
    await expect(page.getByRole("heading", { level: 1 })).not.toBeEmpty();
    for (const selector of ["[data-marketing-hero]", "[data-marketing-cta]"]) {
      const section = page.locator(selector);
      await expect(section.getByRole("link", { name: "Request access" })).toHaveAttribute("href", "/request-access");
      await expect(section.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
    }
  });

  test("Request access opens the request form, Sign in opens login", async ({ page }) => {
    await openMarketing(page);
    await page.locator("[data-marketing-hero]").getByRole("link", { name: "Request access" }).click();
    await expect(page).toHaveURL(/\/request-access$/);
    await openMarketing(page);
    await page.locator("[data-marketing-hero]").getByRole("link", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/login$/);
  });

  test("landmarks, heading hierarchy and the ordered production chain are accessible", async ({ page }) => {
    await openMarketing(page);
    await expect(page.getByRole("banner")).toHaveCount(1);
    await expect(page.getByRole("main")).toHaveCount(1);
    await expect(page.getByRole("contentinfo")).toHaveCount(1);
    const levels = await page.locator("main h1, main h2, main h3").evaluateAll((headings) =>
      headings.map((heading) => Number(heading.tagName.slice(1))),
    );
    expect(levels.length).toBeGreaterThan(1);
    for (let i = 1; i < levels.length; i++) expect(levels[i]! - levels[i - 1]!).toBeLessThanOrEqual(1);
    const chain = page.locator("#flow").getByRole("list");
    await expect(chain.getByRole("listitem")).toHaveCount(7);
    await expect(page.getByRole("contentinfo").getByRole("link", { name: "Guides" })).toHaveAttribute("href", "/guides");
  });

  test("showcase technical plates, interactive press poses and seven plant roles render", async ({ page }) => {
    await openMarketing(page);
    const heroArt = page.locator("[data-marketing-hero] [data-extrusion-art]");
    await expect(heroArt).toBeVisible();
    await page.locator("[data-pose-pill=\"age\"]").click();
    await expect(page.locator("[data-marketing-hero] .marketing-iso-plate")).toHaveAttribute("data-pose", "age");
    await expect(page.locator("#floor article")).toHaveCount(7);
  });

  test("sample product data is hidden from screen readers and visibly labelled", async ({ page }) => {
    await openMarketing(page);
    const visuals = page.locator("[data-demo-visual]");
    expect(await visuals.count()).toBeGreaterThan(0);
    for (const visual of await visuals.all()) {
      await expect(visual).toHaveAttribute("aria-hidden", "true");
      await expect(visual.getByText("Demo data", { exact: true })).toBeVisible();
    }
  });

  test("one tap switches the page to Hindi and sets html lang", async ({ page }) => {
    await openMarketing(page);
    const heading = page.getByRole("heading", { level: 1 });
    const english = await heading.innerText();
    await page.getByRole("banner").getByRole("radio", { name: "हिंदी" }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", "hi");
    await expect(heading).not.toHaveText(english);
    await expect(heading).toContainText(/[\u0900-\u097f]/);
    await page.getByRole("banner").getByRole("radio", { name: "English" }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(heading).toHaveText(english);
  });

  test("English renders from public strings even when the full dictionary is unavailable", async ({ page }) => {
    let blocked = 0;
    await page.route(/\/packages\/i18n\/src\/en\.ts|\/assets\/en-[\w-]+\.js/, (route) => {
      blocked += 1;
      return route.abort();
    });
    await openMarketing(page);
    await expect.poll(() => blocked, { timeout: 8000 }).toBe(1);
    const rawKeys = await page.evaluate(() => {
      const text = `${document.body.innerText} ${document.title}`;
      return text.match(/\b(?:common|marketing|nav|pack|packingList|scan|status|units)\.[a-z]\w*(?:\.\w+)*/g) ?? [];
    });
    expect(rawKeys).toEqual([]);
  });

  test("Hindi loads on demand, not during the first English visit", async ({ page }) => {
    const hindi: string[] = [];
    page.on("request", (request) => {
      if (/\/packages\/i18n\/src\/hi\.ts|\/assets\/hi-[\w-]+\.js/.test(request.url())) hindi.push(request.url());
    });
    await openMarketing(page);
    expect(hindi).toEqual([]);
    await page.getByRole("banner").getByRole("radio", { name: "हिंदी" }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", "hi");
    expect(hindi.length).toBeGreaterThan(0);
  });

  test("the title and meta description follow the selected language", async ({ page }) => {
    await openMarketing(page);
    const englishTitle = await page.title();
    const description = page.locator('meta[name="description"]');
    const englishDescription = await description.getAttribute("content");
    expect(englishTitle.trim().length).toBeGreaterThan(0);
    expect(englishDescription?.trim().length).toBeGreaterThan(0);
    await page.getByRole("banner").getByRole("radio", { name: "हिंदी" }).click();
    await expect(page).not.toHaveTitle(englishTitle);
    await expect(description).not.toHaveAttribute("content", englishDescription!);
    await expect(description).toHaveAttribute("content", /[\u0900-\u097f]/);
    await page.getByRole("banner").getByRole("radio", { name: "English" }).click();
    await expect(page).toHaveTitle(englishTitle);
    await expect(description).toHaveAttribute("content", englishDescription!);
  });

  test("Hindi headings leave room for Devanagari marks", async ({ page }) => {
    await openInHindi(page);
    const tight = await page.locator("main h1, main h2, main h3").evaluateAll((headings) =>
      headings.filter((heading) => {
        const style = getComputedStyle(heading);
        const size = parseFloat(style.fontSize);
        const leading = style.lineHeight === "normal" ? size * 1.2 : parseFloat(style.lineHeight);
        const tracking = style.letterSpacing === "normal" ? 0 : parseFloat(style.letterSpacing);
        return leading < size * 1.2 - 0.5 || tracking < 0;
      }).map((heading) => heading.textContent),
    );
    expect(tight).toEqual([]);
    const heroLines = await page.locator(".marketing-hero h1").evaluate((heading) => {
      const style = getComputedStyle(heading);
      return heading.getBoundingClientRect().height / parseFloat(style.lineHeight);
    });
    expect(heroLines).toBeLessThanOrEqual(2.05);
  });

  test("reduced motion leaves all narrative content visible without running animations", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openMarketing(page);
    for (const heading of await page.locator("main h1, main h2, main h3").all()) await expect(heading).toBeVisible();
    const running = await page.getByRole("main").evaluate((main) =>
      main.getAnimations({ subtree: true }).filter((animation) => animation.playState === "running").length,
    );
    expect(running).toBe(0);
  });

  for (const locale of ["en", "hi"] as const) {
    for (const width of [375, 820, 1280]) {
      test(`no sideways scroll or clipped text at ${width}px in ${locale}`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.emulateMedia({ reducedMotion: "reduce" });
        if (locale === "hi") await openInHindi(page);
        else await openMarketing(page);
        expect(await collectHorizontalScrollIssues(page)).toEqual([]);
        expect(await collectClippedTextIssues(page)).toEqual([]);
        // A clipped header control can be hidden by page-level overflow without causing sideways scroll.
        for (const control of await page.getByRole("banner").getByRole("radio").all()) {
          const box = await control.boundingBox();
          expect(box).not.toBeNull();
          expect(box!.x).toBeGreaterThanOrEqual(0);
          expect(box!.x + box!.width).toBeLessThanOrEqual(width);
        }
      });
    }
  }

  test("footer links have at least 8px between touch targets", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 900 });
    await openMarketing(page);
    const boxes = await page.locator("footer nav a").evaluateAll((links) => links.map((link) => {
      const box = link.getBoundingClientRect();
      return { left: box.left, right: box.right, top: box.top, bottom: box.bottom };
    }));
    expect(boxes.length).toBeGreaterThan(1);
    for (let i = 1; i < boxes.length; i++) {
      const a = boxes[i - 1]!;
      const b = boxes[i]!;
      const sameRow = a.top < b.bottom && b.top < a.bottom;
      expect(Math.round(sameRow ? b.left - a.right : b.top - a.bottom)).toBeGreaterThanOrEqual(8);
    }
  });

  for (const theme of ["light", "dark"] as const) {
    for (const width of [375, 820, 1280]) {
      test(`no serious or critical axe violations, ${theme} preference at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.emulateMedia({ reducedMotion: "reduce", colorScheme: theme });
        await openMarketing(page);
        await setTheme(page, theme);
        const results = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
          .analyze();
        const blocking = results.violations
          .filter((violation) => violation.impact === "serious" || violation.impact === "critical")
          .map((violation) => ({ id: violation.id, targets: violation.nodes.slice(0, 5).map((node) => node.target.join(" ")) }));
        expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
      });
    }
  }

  test("keyboard skip link jumps past navigation to the hero actions", async ({ page }) => {
    await openMarketing(page);
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
    await page.keyboard.press("Enter");
    await page.keyboard.press("Tab");
    await expect(page.locator("[data-marketing-hero]").getByRole("link", { name: "Request access" })).toBeFocused();
  });
});

test.describe("legal pages", () => {
  test("footer opens Privacy and Terms", async ({ page }) => {
    await openMarketing(page);
    await page.getByRole("contentinfo").getByRole("link", { name: "Privacy" }).click();
    await expect(page).toHaveURL(/\/privacy$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Privacy policy");
    await page.getByRole("contentinfo").getByRole("link", { name: "Terms" }).click();
    await expect(page).toHaveURL(/\/terms$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Terms of service");
  });

  for (const path of ["/privacy", "/terms"]) {
    test(`${path} has a localized document, section navigation and working skip link`, async ({ page }) => {
      await page.goto(path);
      await expect(page.locator("main h1")).toHaveCount(1);
      await expect(page.locator("main article section")).toHaveCount(8);
      await page.keyboard.press("Tab");
      await page.keyboard.press("Enter");
      await page.keyboard.press("Tab");
      await expect(page.locator(".marketing-legal-nav a").first()).toBeFocused();
      await page.getByRole("banner").getByRole("radio", { name: "हिंदी" }).click();
      await expect(page.locator("html")).toHaveAttribute("lang", "hi");
      await expect(page.locator("main h1")).toContainText(/[\u0900-\u097f]/);
    });

    for (const locale of ["en", "hi"] as const) {
      for (const width of [375, 820, 1280]) {
        test(`${path} has no sideways scroll or clipped text at ${width}px in ${locale}`, async ({ page }) => {
          await page.setViewportSize({ width, height: 900 });
          if (locale === "hi") await page.addInitScript(() => localStorage.setItem("orrn.locale", "hi"));
          await page.goto(path);
          await expect(page.locator("main h1")).toBeVisible();
          expect(await collectHorizontalScrollIssues(page)).toEqual([]);
          expect(await collectClippedTextIssues(page)).toEqual([]);
        });
      }
    }

    test(`${path} has no serious or critical axe violations`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto(path);
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
        .analyze();
      const blocking = results.violations
        .filter((violation) => violation.impact === "serious" || violation.impact === "critical")
        .map((violation) => ({ id: violation.id, targets: violation.nodes.slice(0, 5).map((node) => node.target.join(" ")) }));
      expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
    });
  }
});

test.describe("session check", () => {
  test("an owner opening / lands on /today", async ({ page }) => {
    await signInViaApi(page, "owner");
    await page.goto("/");
    await expect(page).toHaveURL(/\/today$/);
  });

  test("a slow session check does not hold the page", async ({ page }) => {
    await page.route("**/trpc/auth.me**", async (route) => {
      await delay(20_000);
      await route.abort().catch(() => {});
    });
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 10_000 });
  });

  test("an owner still lands on /today when the session check answers late", async ({ page }) => {
    await signInViaApi(page, "owner");
    let delayed = false;
    await page.route("**/trpc/auth.me**", async (route) => {
      if (!delayed) {
        delayed = true;
        await delay(3500);
      }
      await route.continue().catch(() => {});
    });
    await page.goto("/");
    await expect(page).toHaveURL(/\/today$/, { timeout: 15_000 });
  });
});

test.describe("JS budget", () => {
  const dist = fileURLToPath(new URL("../../dist", import.meta.url));
  test("report: / downloads under 250kB of JS gzip in the dist on disk", () => {
    test.skip(!existsSync(`${dist}/index.html`), "no build output: run bun run build in apps/web first");
    const result = measureRoute(dist, MARKETING_MARKER);
    test.info().annotations.push({ type: "route-budget", description: `${(result.gzip / 1000).toFixed(1)} kB gzip` });
    expect(result.routeChunks.length, "marketing route chunk not found by its marker").toBeGreaterThan(0);
    expect(result.gzip).toBeLessThan(MARKETING_BUDGET_GZIP);
  });
});

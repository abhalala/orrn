import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { expectNoClippedText, expectNoHorizontalScroll } from "../helpers/layout-guards";

/**
 * The C2 component library, exercised on the dev-only kitchen sink at /__ui.
 * Every redesigned screen is built from these components, so this suite is the
 * floor they all stand on: no sideways scroll, touch-size targets, raw number
 * text (W9), table vs stacked list, axe clean in both themes, reduced motion.
 */

const WIDTHS = [390, 820, 1280, 1440] as const;
const SCHEMES = ["light", "dark"] as const;

async function openKit(page: Page, opts: { width: number; scheme?: "light" | "dark"; reducedMotion?: boolean }) {
  await page.setViewportSize({ width: opts.width, height: 900 });
  await page.emulateMedia({
    colorScheme: opts.scheme ?? "light",
    reducedMotion: opts.reducedMotion === false ? "no-preference" : "reduce",
  });
  await page.goto("/__ui");
  await expect(page.getByRole("heading", { level: 1, name: "Component kit" })).toBeVisible();
  await expect(page.locator("html")).toHaveClass(new RegExp(`\\b${opts.scheme ?? "light"}\\b`));
}

async function blockingAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .exclude(".TanStackRouterDevtools")
    .exclude("[class*='tsqd-']")
    .analyze();
  return results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => ({
      id: v.id,
      impact: v.impact,
      help: v.help,
      targets: v.nodes.slice(0, 5).map((n) => n.target.join(" ")),
    }));
}

test.describe("layout", () => {
  for (const width of WIDTHS) {
    for (const scheme of SCHEMES) {
      test(`no sideways scroll and no clipped text at ${width}px (${scheme})`, async ({ page }) => {
        await openKit(page, { width, scheme });
        await expectNoHorizontalScroll(page);
        await expectNoClippedText(page);
      });
    }
  }

  test("long text wraps or truncates with the full value on hover", async ({ page }) => {
    await openKit(page, { width: 390 });
    const section = page.locator("section[aria-labelledby='kit-long-text']");
    await expectNoClippedText(page, section);
    const name = section.getByText("KD Extrusion Private Limited, Rajkot", { exact: true });
    await expect(name).toHaveAttribute("title", "KD Extrusion Private Limited, Rajkot");
    // The status block title wraps by words: never one letter per line.
    const title = section.locator("[data-slot='status-block'] span").first();
    const lines = await title.evaluate((el) => {
      const lh = parseFloat(getComputedStyle(el).lineHeight);
      return Math.round(el.getBoundingClientRect().height / lh);
    });
    expect(lines).toBeLessThanOrEqual(4);
  });
});

test.describe("touch targets on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("every button is at least 44px and size lg at least 56px", async ({ page }) => {
    await openKit(page, { width: 390 });
    const sizes = await page.evaluate(() => {
      const selector = "button, [role='button'], [role='radio'], [role='tab'], a[data-slot='button']";
      return Array.from(document.querySelectorAll<HTMLElement>(selector))
        .filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden";
        })
        .map((el) => {
          const r = el.getBoundingClientRect();
          return {
            label: (el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 40),
            width: Math.round(r.width * 10) / 10,
            height: Math.round(r.height * 10) / 10,
            lg: el.dataset.size === "lg",
          };
        });
    });
    expect(sizes.length).toBeGreaterThan(10);
    const small = sizes.filter((s) => s.height < 44 || s.width < 44);
    expect(small, JSON.stringify(small, null, 2)).toEqual([]);
    const large = sizes.filter((s) => s.lg);
    expect(large.length).toBeGreaterThan(0);
    const shortLarge = large.filter((s) => s.height < 56);
    expect(shortLarge, JSON.stringify(shortLarge, null, 2)).toEqual([]);
  });
});

test.describe("NumberInput", () => {
  test("keeps the raw text while typing (W9)", async ({ page }) => {
    await openKit(page, { width: 1280 });
    const weight = page.getByLabel("Weight (kg)");
    await weight.fill("");
    await weight.pressSequentially("1.25");
    await expect(weight).toHaveValue("1.25");
    await expect(weight).toHaveAttribute("inputmode", "decimal");

    // A trailing dot and a trailing zero survive (no "1." -> "1" or "1.0" -> "1").
    await weight.fill("");
    await weight.pressSequentially("1.");
    await expect(weight).toHaveValue("1.");
    await weight.pressSequentially("0");
    await expect(weight).toHaveValue("1.0");

    // Letters, minus signs and a second dot are refused, not reformatted.
    await weight.pressSequentially("-a.5");
    await expect(weight).toHaveValue("1.05");
  });
});

test.describe("ResponsiveList", () => {
  test("is a real table with column headers at 1280px", async ({ page }) => {
    await openKit(page, { width: 1280 });
    const list = page.getByTestId("kit-list");
    await expect(list.locator("table")).toHaveCount(1);
    await expect(list.locator("th[scope='col']").first()).toBeVisible();
  });

  test("is a stacked list with no table at 390px", async ({ page }) => {
    await openKit(page, { width: 390 });
    const list = page.getByTestId("kit-list");
    await expect(list.locator("li").first()).toBeVisible();
    await expect(page.locator("table")).toHaveCount(0);
  });

  test("a control inside a linked row works and doesn't follow the row link", async ({ page }) => {
    await openKit(page, { width: 1280 });
    const list = page.getByTestId("kit-list");
    await list.getByRole("button", { name: "Print label BG-000318-B001" }).click();
    await expect(page.getByText("Label sent to printer: BG-000318-B001")).toBeVisible();
    await expect(page).toHaveURL(/\/__ui$/);
  });

  test("on a phone the row is one link and its control still works", async ({ page }) => {
    await openKit(page, { width: 390 });
    const list = page.getByTestId("kit-list");
    await expect(list.getByRole("link", { name: "BG-000318-B001" })).toHaveAttribute("href", "/b/BG-000318-B001");
    await list.getByRole("button", { name: "Print label BG-000318-B001" }).click();
    await expect(page.getByText("Label sent to printer: BG-000318-B001")).toBeVisible();
    await expect(page).toHaveURL(/\/__ui$/);
  });

  test("pages with Previous and Next", async ({ page }) => {
    await openKit(page, { width: 1280 });
    const list = page.getByTestId("kit-list");
    await expect(list.getByText("1-5 of 12")).toBeVisible();
    await list.getByRole("button", { name: "Next page" }).click();
    await expect(list.getByText("6-10 of 12")).toBeVisible();
    await expect(list.getByRole("button", { name: "Previous page" })).toBeEnabled();
  });
});

test.describe("ScanField", () => {
  test("Enter submits the scan and clears the field", async ({ page }) => {
    await openKit(page, { width: 1280 });
    const scan = page.getByLabel("Serial or label link");
    await scan.fill("  bg-000318-b007 ");
    await scan.press("Enter");
    await expect(scan).toHaveValue("");
    await expect(page.getByTestId("kit-scan-result")).toHaveText("Scanned bg-000318-b007");
    // No <form> of its own, so it can live inside another form.
    await expect(page.locator("[data-slot='scan-field'] form, form [data-slot='scan-field']")).toHaveCount(0);
    await expect(page.locator("[data-slot='scan-field']")).not.toHaveJSProperty("tagName", "FORM");
  });
});

test.describe("Combobox", () => {
  test("searches after typing and picks with the keyboard", async ({ page }) => {
    await openKit(page, { width: 1280 });
    const die = page.getByRole("combobox", { name: "Die" });
    await die.click();
    await die.pressSequentially("angle");
    const option = page.getByRole("option", { name: /^Angle 1" x 1"/ });
    await expect(option.first()).toBeVisible();
    await die.press("ArrowDown");
    await die.press("Enter");
    await expect(die).toHaveValue(/^Angle 1" x 1/);
    await expect(page.getByRole("listbox")).toHaveCount(0);
  });
});

test.describe("Combobox, stale results", () => {
  test("Enter can't pick an option from the previous query while a new one loads", async ({ page }) => {
    await openKit(page, { width: 1280 });
    const die = page.getByRole("combobox", { name: "Die" });
    await die.click();
    await die.pressSequentially("angle");
    await expect(page.getByRole("option").first()).toBeVisible();
    await die.pressSequentially("zz");
    await die.press("ArrowDown");
    await die.press("Enter");
    await expect(die).toHaveValue("anglezz");
    await expect(page.locator("[data-slot='combobox-popup'] p", { hasText: 'Nothing matches "anglezz"' })).toBeVisible();
  });
});

test.describe("Combobox inside a sheet", () => {
  for (const width of [390, 1280] as const) {
    test(`every option is visible and Escape closes the list first (${width}px)`, async ({ page }) => {
      await openKit(page, { width });
      await page.getByRole("button", { name: "Open sheet with picker" }).click();
      const sheet = page.getByRole("dialog", { name: "Change die" });
      await expect(sheet).toBeVisible();
      const die = sheet.getByRole("combobox", { name: "Die" });
      await die.click();
      await die.pressSequentially("1");
      const options = page.getByRole("option");
      await expect(options).toHaveCount(5);
      for (let i = 0; i < 5; i++) await expect(options.nth(i)).toBeInViewport({ ratio: 1 });
      // The list lives inside the dialog, so picking with the pointer works.
      await options.nth(1).click();
      await expect(die).toHaveValue('Angle 1" x 1"');
      await expect(sheet).toBeVisible();

      await die.fill("");
      await die.pressSequentially("1");
      await expect(options).toHaveCount(5);
      await page.keyboard.press("Escape");
      await expect(sheet.getByRole("listbox")).toBeHidden();
      await expect(sheet).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(sheet).toHaveCount(0);
    });
  }
});

test.describe("Sheet", () => {
  test("opens with a title, traps focus and closes on Escape", async ({ page }) => {
    await openKit(page, { width: 390 });
    const trigger = page.getByRole("button", { name: "Open sheet", exact: true });
    await trigger.click();
    const sheet = page.getByRole("dialog", { name: "Bundle 26I4086" });
    await expect(sheet).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });

  test("How to opens the guide for the screen", async ({ page }) => {
    await openKit(page, { width: 1280 });
    await page.getByRole("button", { name: "How to" }).first().click();
    const guide = page.getByRole("dialog", { name: "Pack a session and print labels" });
    await expect(guide).toBeVisible();
    await expect(guide.getByRole("list").first()).toBeVisible();
  });
});

test.describe("accessibility", () => {
  for (const width of [390, 1280] as const) {
    for (const scheme of SCHEMES) {
      test(`axe: no serious or critical violations at ${width}px (${scheme})`, async ({ page }) => {
        await openKit(page, { width, scheme });
        const blocking = await blockingAxeViolations(page);
        expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
      });
    }
  }

  test("axe: the open sheet is clean too", async ({ page }) => {
    await openKit(page, { width: 390, scheme: "dark" });
    await page.getByRole("button", { name: "Open sheet", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    const blocking = await blockingAxeViolations(page);
    expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
  });
});

test.describe("motion", () => {
  test("reduced motion: nothing is animating, even after a success pop", async ({ page }) => {
    await openKit(page, { width: 1280, reducedMotion: true });
    await page.getByRole("button", { name: "Play success" }).click();
    await page.getByRole("button", { name: "Open sheet", exact: true }).click();
    // Two frames: long enough for any 0.01ms fallback, far too short for real motion.
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const running = await page.evaluate(() =>
      document
        .getAnimations()
        .filter((a) => a.playState === "running")
        .map((a) => {
          const target = (a.effect as KeyframeEffect | null)?.target as Element | null;
          return `${(a as CSSAnimation).animationName ?? a.constructor.name} on ${target?.className ?? "?"}`;
        }),
    );
    expect(running).toEqual([]);
  });

  test("without reduced motion the success pop really animates", async ({ page }) => {
    await openKit(page, { width: 1280, reducedMotion: false });
    await page.getByRole("button", { name: "Play success" }).click();
    const names = await page.evaluate(() =>
      document.getAnimations().map((a) => (a as CSSAnimation).animationName),
    );
    expect(names).toContain("orrn-pop");
  });
});

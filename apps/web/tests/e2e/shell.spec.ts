import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { signInViaApi, type LocalRole } from "./helpers/accounts";
import { expectNoClippedText, expectNoHorizontalScroll } from "./helpers/layout-guards";

/**
 * The C2 app shell (Task 14): phone tab bar with a raised Scan, iPad icon
 * rail, laptop sidebar with "Scan or search ⌘K", the More sheet, language and
 * theme, landmarks and the command palette. Needs the local stack (API :3000,
 * web :3002, seeded accounts).
 */

const SEEDED_SERIAL = "BG-000001-B001";
// Bundle detail lives at /bundles/$id until the route map task moves it to /b/$serial.
const BUNDLE_URL = new RegExp(`/(b/${SEEDED_SERIAL}|bundles/[^/?#]+)$`);
const HOME = /\/(today|dashboard)$/;

type Scheme = "light" | "dark";

async function open(
  page: Page,
  opts: { role?: LocalRole; width: number; scheme?: Scheme; path?: string; height?: number },
) {
  await page.setViewportSize({ width: opts.width, height: opts.height ?? 900 });
  await page.emulateMedia({ colorScheme: opts.scheme ?? "light", reducedMotion: "reduce" });
  await signInViaApi(page, opts.role ?? "owner");
  await page.goto(opts.path ?? "/today");
  await expect(page.locator("[data-slot='app-shell']")).toBeVisible();
  await expect(page.locator("main#main h1").first()).toBeVisible();
}

/** The visible primary navigation: tab bar on phones, rail or sidebar from 768px. */
function mainNav(page: Page) {
  return page.getByRole("navigation", { name: "Main" });
}

/** Rewrites `auth.me` in every tRPC (batched) response so the company has these modules. */
async function withModules(page: Page, modules: string[]) {
  await page.route("**/trpc/**", async (route) => {
    const url = new URL(route.request().url());
    const procedures = decodeURIComponent(url.pathname.split("/trpc/")[1] ?? "").split(",");
    const index = procedures.indexOf("auth.me");
    if (index === -1) return route.continue();
    const response = await route.fetch();
    const body = await response.json();
    const entry = Array.isArray(body) ? body[index] : body;
    const data = entry?.result?.data;
    const me = data?.json ?? data;
    if (me?.company) me.company.modules = modules;
    await route.fulfill({ response, json: body });
  });
}

async function blockingAxeViolations(page: Page) {
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

test.describe("phone (390)", () => {
  test("tab bar has Today, Pack, Scan, Stock, Dispatch with Scan raised in the middle", async ({ page }) => {
    await open(page, { width: 390 });
    const nav = mainNav(page);
    await expect(nav).toBeVisible();
    const items = nav.locator("a, button");
    await expect(items).toHaveCount(5);
    await expect(items.nth(0)).toHaveAccessibleName("Today");
    await expect(items.nth(1)).toHaveAccessibleName("Pack");
    await expect(items.nth(2)).toHaveAccessibleName("Scan");
    await expect(items.nth(3)).toHaveAccessibleName("Stock");
    await expect(items.nth(4)).toHaveAccessibleName("Dispatch");
    // Scan is a button (it opens the scanner), everything else is a router link.
    await expect(items.nth(2)).toHaveJSProperty("tagName", "BUTTON");
    await expect(nav.getByRole("link", { name: "Today" })).toHaveAttribute("aria-current", "page");
    // Every tab is a comfortable thumb target.
    for (const box of await items.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().toJSON()))) {
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.width).toBeGreaterThanOrEqual(44);
    }
  });

  test("the avatar opens More with the office pages, language, theme and sign out", async ({ page }) => {
    await open(page, { width: 390 });
    await page.getByRole("button", { name: "Account and more" }).click();
    const sheet = page.getByRole("dialog", { name: "More" });
    await expect(sheet).toBeVisible();
    for (const name of ["Dies", "Customers", "Printing", "Guides", "Settings"]) {
      await expect(sheet.getByRole("link", { name })).toBeVisible();
    }
    await expect(sheet.getByRole("radiogroup", { name: "Language" })).toBeVisible();
    await expect(sheet.getByRole("radiogroup", { name: "Theme" })).toBeVisible();
    await expect(sheet.getByRole("button", { name: "Sign out" })).toBeVisible();
    await sheet.getByRole("link", { name: "Dies" }).click();
    await expect(page).toHaveURL(/\/dies$/);
    await expect(sheet).toBeHidden();
  });

  test("moving between tabs never reloads the page", async ({ page }) => {
    await open(page, { width: 390 });
    const boot = await page.evaluate(() => (window as unknown as { __orrnBoot?: number }).__orrnBoot);
    expect(boot).toBeTruthy();
    await mainNav(page).getByRole("link", { name: "Stock" }).click();
    await expect(page).toHaveURL(/\/stock(\?|$)/);
    await expect(mainNav(page).getByRole("link", { name: "Stock" })).toHaveAttribute("aria-current", "page");
    await mainNav(page).getByRole("link", { name: "Today" }).click();
    await expect(page).toHaveURL(HOME);
    expect(await page.evaluate(() => (window as unknown as { __orrnBoot?: number }).__orrnBoot)).toBe(boot);
  });

  test("the tab bar slides away on scroll down and comes back on scroll up", async ({ page }) => {
    await open(page, { width: 390, height: 700 });
    // Make the page tall enough to scroll, whatever the screen shows today.
    await page.evaluate(() => {
      const spacer = document.createElement("div");
      spacer.style.height = "3000px";
      document.querySelector("main#main")?.appendChild(spacer);
    });
    const bar = page.locator("[data-slot='tab-bar']");
    await expect(bar).toHaveAttribute("data-hidden", "false");
    await page.mouse.wheel(0, 600);
    await expect(bar).toHaveAttribute("data-hidden", "true");
    await page.mouse.wheel(0, -300);
    await expect(bar).toHaveAttribute("data-hidden", "false");
  });

  test("Scan opens the scanner and a typed serial opens that bundle", async ({ page }) => {
    await open(page, { width: 390 });
    await mainNav(page).getByRole("button", { name: "Scan" }).click();
    const sheet = page.getByRole("dialog", { name: "Scan" });
    await expect(sheet).toBeVisible();
    const field = sheet.getByLabel("Serial or label link");
    await expect(field).toBeFocused();
    await field.fill("bg-999999-z999");
    await field.press("Enter");
    await expect(sheet.getByText("Not found in this company")).toBeVisible();
    await field.fill(SEEDED_SERIAL.toLowerCase());
    await field.press("Enter");
    await expect(page).toHaveURL(BUNDLE_URL);
    await expect(sheet).toBeHidden();
    await expect(page.getByText(SEEDED_SERIAL).first()).toBeVisible();
  });

  test("Hindi switches the shell instantly and sticks after a reload", async ({ page }) => {
    await open(page, { width: 390 });
    await page.getByRole("button", { name: "Account and more" }).click();
    await page.getByRole("dialog", { name: "More" }).getByRole("radio", { name: "हिंदी" }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", "hi");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("navigation", { name: "मुख्य" }).getByRole("link", { name: "आज" })).toBeVisible();
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("lang", "hi");
    await expect(page.getByRole("navigation", { name: "मुख्य" }).getByRole("link", { name: "आज" })).toBeVisible();
    await page.evaluate(() => localStorage.removeItem("orrn.locale"));
  });

  test("the theme override in More is stored and wins over the device", async ({ page }) => {
    await open(page, { width: 390, scheme: "light" });
    await page.getByRole("button", { name: "Account and more" }).click();
    await page.getByRole("dialog", { name: "More" }).getByRole("radio", { name: "Dark" }).click();
    await expect(page.locator("html")).toHaveClass(/\bdark\b/);
    expect(await page.evaluate(() => localStorage.getItem("orrn.theme"))).toBe("dark");
    await page.reload();
    await expect(page.locator("html")).toHaveClass(/\bdark\b/);
  });
});

test.describe("roles and modules", () => {
  test("a viewer has no Pack tab but still sees Stock", async ({ page }) => {
    await open(page, { role: "viewer", width: 390 });
    const nav = mainNav(page);
    await expect(nav.getByRole("link", { name: "Stock" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Pack" })).toHaveCount(0);
  });

  test("a company with only the customers module hides Dies and Dispatch", async ({ page }) => {
    await withModules(page, ["customers"]);
    await open(page, { width: 1280 });
    const nav = mainNav(page);
    await expect(nav.getByRole("link", { name: "Customers" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Dies" })).toHaveCount(0);
    await expect(nav.getByRole("link", { name: "Dispatch" })).toHaveCount(0);
    await page.unrouteAll({ behavior: "ignoreErrors" });
  });
});

test.describe("iPad and laptop", () => {
  test("820: icon rail, no tab bar", async ({ page }) => {
    await open(page, { width: 820, height: 1180 });
    const nav = mainNav(page);
    await expect(nav).toBeVisible();
    const box = await nav.boundingBox();
    expect(box?.x).toBe(0);
    expect(box?.width).toBeLessThan(120);
    await expect(page.locator("[data-slot='tab-bar']")).toBeHidden();
    await expect(nav.getByRole("link", { name: "Stock" })).toBeVisible();
    await expect(nav.getByRole("button", { name: "Scan" })).toBeVisible();
  });

  test("1280: sidebar with labels, the More group and Scan or search ⌘K", async ({ page }) => {
    await open(page, { width: 1280 });
    const nav = mainNav(page);
    await expect(page.locator("[data-slot='tab-bar']")).toBeHidden();
    const search = page.getByRole("button", { name: /Scan or search/ });
    await expect(search).toBeVisible();
    await expect(search).toContainText(/⌘K|Ctrl K/);
    for (const name of ["Today", "Pack", "Stock", "Dispatch", "Dies", "Customers", "Printing", "Guides", "Settings"]) {
      await expect(nav.getByRole("link", { name })).toBeVisible();
    }
    const box = await nav.boundingBox();
    expect(box?.width).toBeGreaterThan(200);
  });

  test("landmarks: header, labelled nav, main with one h1", async ({ page }) => {
    await open(page, { width: 1280 });
    await expect(page.locator("main#main")).toHaveCount(1);
    await expect(page.locator("main#main h1")).toHaveCount(1);
    await expect(mainNav(page)).toHaveCount(1);
  });

  test("the skip link moves focus to main", async ({ page }) => {
    await open(page, { width: 1280 });
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Skip to content" });
    await expect(skip).toBeFocused();
    await expect(skip).toBeInViewport();
    await page.keyboard.press("Enter");
    expect(await page.evaluate(() => document.activeElement?.closest("main")?.id)).toBe("main");
  });

  test("a route change moves focus to the new page's heading", async ({ page }) => {
    await open(page, { width: 1280 });
    await mainNav(page).getByRole("link", { name: "Dies" }).focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/dies$/);
    await expect(page.locator("main#main h1")).toBeFocused();
  });

  test("⌘K with a serial and Enter opens that bundle", async ({ page }) => {
    await open(page, { width: 1280 });
    await page.keyboard.press("ControlOrMeta+k");
    const palette = page.getByRole("dialog", { name: "Scan or search" });
    await expect(palette).toBeVisible();
    const input = palette.getByRole("combobox");
    await expect(input).toBeFocused();
    await input.fill(SEEDED_SERIAL);
    await expect(palette.getByRole("option").first()).toContainText(SEEDED_SERIAL);
    await input.press("Enter");
    await expect(page).toHaveURL(BUNDLE_URL);
    await expect(palette).toBeHidden();
  });

  test("the palette finds pages and opens them with the keyboard", async ({ page }) => {
    await open(page, { width: 1280 });
    await page.getByRole("button", { name: /Scan or search/ }).click();
    const palette = page.getByRole("dialog", { name: "Scan or search" });
    const input = palette.getByRole("combobox");
    await input.fill("cust");
    const option = palette.getByRole("option", { name: /Customers/ }).first();
    await expect(option).toBeVisible();
    // Arrow to the page result, then Enter.
    for (let i = 0; i < 10; i += 1) {
      const active = await input.getAttribute("aria-activedescendant");
      if (active && (await palette.locator(`[id="${active}"]`).textContent())?.includes("Customers")) break;
      await input.press("ArrowDown");
    }
    await input.press("Enter");
    await expect(page).toHaveURL(/\/customers$/);
  });

  test("/ opens the palette when not typing", async ({ page }) => {
    await open(page, { width: 1280 });
    await page.locator("main#main h1").first().click();
    await page.keyboard.press("/");
    await expect(page.getByRole("dialog", { name: "Scan or search" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Scan or search" })).toBeHidden();
  });

  test("the account menu in the sidebar signs out", async ({ page }) => {
    await open(page, { width: 1280 });
    await page.getByRole("button", { name: /Local Owner/ }).click();
    await page.getByRole("menuitem", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/$/);
  });
});

test.describe("Godseye", () => {
  test("uses the violet tone and the admin nav", async ({ page }) => {
    await open(page, { role: "staff", width: 1280, path: "/admin" });
    const nav = mainNav(page);
    for (const name of ["Overview", "Companies", "Access requests", "Staff"]) {
      await expect(nav.getByRole("link", { name })).toBeVisible();
    }
    await expect(nav.getByRole("link", { name: "Today" })).toHaveCount(0);
    const active = nav.getByRole("link", { name: "Overview" });
    await expect(active).toHaveAttribute("aria-current", "page");
    const violet = await page.evaluate(() => {
      const probe = document.createElement("div");
      probe.style.color = "var(--tone-violet-from)";
      document.querySelector("[data-slot='app-shell']")?.appendChild(probe);
      const c = getComputedStyle(probe).color;
      probe.remove();
      return c;
    });
    const bg = await active.evaluate((el) => getComputedStyle(el).backgroundImage + getComputedStyle(el).backgroundColor);
    expect(bg).toContain(violet);
    await expect(page.locator("[data-slot='app-shell']")).toHaveAttribute("data-variant", "godseye");
  });

  test("phone: admin tabs, no Scan", async ({ page }) => {
    await open(page, { role: "staff", width: 390, path: "/admin" });
    const nav = mainNav(page);
    await expect(nav.getByRole("link", { name: "Companies" })).toBeVisible();
    await expect(nav.getByRole("button", { name: "Scan" })).toHaveCount(0);
  });
});

test.describe("layout and accessibility", () => {
  for (const width of [375, 390, 820, 1280, 1440]) {
    for (const scheme of ["light", "dark"] as const) {
      test(`no sideways scroll or clipped text at ${width}px (${scheme})`, async ({ page }) => {
        await open(page, { width, scheme });
        await expectNoHorizontalScroll(page);
        // The shell's own chrome (top bar, rail/sidebar, tab bar); screens have their own specs.
        const chrome = page.locator("[data-shell-chrome]");
        for (const part of await chrome.all()) {
          if (await part.isVisible()) await expectNoClippedText(page, part);
        }
      });
    }
  }

  // Axe runs on /guides: a C2 page, so findings are the shell's. Old screens
  // (the dashboard's inline links) are covered when their own tasks rebuild them.
  for (const width of [390, 1280]) {
    for (const scheme of ["light", "dark"] as const) {
      test(`axe: no serious or critical issues at ${width}px (${scheme})`, async ({ page }) => {
        await open(page, { width, scheme, path: "/guides" });
        expect(await blockingAxeViolations(page)).toEqual([]);
      });

      test(`axe: More and palette are clean at ${width}px (${scheme})`, async ({ page }) => {
        await open(page, { width, scheme, path: "/guides" });
        if (width < 1024) {
          await page.getByRole("button", { name: "Account and more" }).click();
          await expect(page.getByRole("dialog", { name: "More" })).toBeVisible();
        } else {
          await page.keyboard.press("ControlOrMeta+k");
          await page.getByRole("dialog", { name: "Scan or search" }).getByRole("combobox").fill("BG-0");
          await expect(page.getByRole("option").first()).toBeVisible();
        }
        expect(await blockingAxeViolations(page)).toEqual([]);
      });
    }
  }

  test("Godseye is clean at 390 and 1280", async ({ page }) => {
    for (const width of [390, 1280]) {
      await open(page, { role: "staff", width, path: "/admin" });
      await expectNoHorizontalScroll(page);
      expect(await blockingAxeViolations(page)).toEqual([]);
    }
  });
});

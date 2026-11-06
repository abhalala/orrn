import { appendFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { signInViaApi, type LocalRole } from "./helpers/accounts";

/**
 * Signed-in accessibility sweep (WCAG 2.2 AA via axe). `tests/visual/a11y.spec.ts` only covers three public pages;
 * this opens every screen reachable from the nav as the seeded plant roles, at desktop and at 375 px, in light and
 * dark, in English (plus Hindi for Today, Pack, Scan and Dispatch), with the shell overlays (palette, scanner, More,
 * account menu) opened too.
 *
 * - Every violation of every impact is appended to `test-results/a11y-app/results.jsonl`; run
 *   `bun scripts/axe-app-report.ts` afterwards to turn that into the grouped baseline report.
 * - A test FAILS on any serious or critical violation (same rule as the public-page check). Minor and moderate ones
 *   are collected, not asserted.
 * - Detail pages are found from their list page (first matching link), so the sweep follows the seed and not
 *   hard-coded ids.
 */

const OUT_DIR = resolve(import.meta.dirname, "../../test-results/a11y-app");
const OUT_FILE = resolve(OUT_DIR, "results.jsonl");

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

type Locale = "en" | "hi";
type Scheme = "light" | "dark";
type Overlay = "palette" | "scanner" | "more" | "account";

type Target = {
  /** Stable label; also the test title. */
  name: string;
  role?: LocalRole;
  /** Fixed path, or ... */
  path?: string;
  /** ... the first link on `from` whose href matches `re` (a detail page found from its list). */
  discover?: { from: string; re: RegExp };
  /** Open a shell overlay on `path` and check the page with it open. */
  overlay?: Overlay;
  /** Overlay only exists from this width (account menu is the sidebar footer) or up to this width. */
  minWidth?: number;
  maxWidth?: number;
  /** Also run in Hindi. */
  hi?: boolean;
};

const VIEWPORTS = [
  { name: "desktop", width: 1280, height: 900 },
  { name: "phone", width: 375, height: 812 },
] as const;

const TENANT: Target[] = [
  // Home and the floor.
  { name: "today", path: "/today", hi: true },
  { name: "pack", path: "/pack", hi: true },
  { name: "pack new", path: "/pack/new" },
  { name: "pack session", discover: { from: "/pack", re: /^\/pack\/(?!new)[^/]+$/ } },
  { name: "dispatch", path: "/dispatch", hi: true },
  { name: "dispatch new", path: "/dispatch/new" },
  { name: "dispatch detail", discover: { from: "/dispatch", re: /^\/dispatch\/(?!new)[^/]+$/ }, hi: true },
  { name: "dispatch completed", path: "/dispatch/dev-dispatch-done-1" },
  { name: "packing list", path: "/packing-lists/dev-pl-combined-1" },
  { name: "scan: scanner open", path: "/today", overlay: "scanner", maxWidth: 767, hi: true },
  { name: "scan: palette open", path: "/today", overlay: "palette", hi: true },
  { name: "shell: more sheet", path: "/today", overlay: "more", maxWidth: 767 },
  { name: "shell: account menu", path: "/today", overlay: "account", minWidth: 1024 },
  // Stock and bundles.
  { name: "stock", path: "/stock" },
  { name: "stock bundles", path: "/stock/bundles" },
  { name: "stock yards", path: "/stock/yards" },
  { name: "stock lengths", path: "/stock/lengths" },
  { name: "stock die", discover: { from: "/stock", re: /^\/stock\/(?!bundles|yards|lengths|count)[^/]+$/ } },
  { name: "stock count list", path: "/stock/count" },
  { name: "stock count", discover: { from: "/stock/count", re: /^\/stock\/count\/[^/]+$/ } },
  { name: "bundle (public serial route, signed in)", path: "/b/BG-000001-B001" },
  // Orders and the press.
  { name: "orders", path: "/orders" },
  { name: "orders new", path: "/orders/new" },
  { name: "order detail", discover: { from: "/orders", re: /^\/orders\/(?!new|plan)[^/]+$/ } },
  { name: "press plan board", path: "/orders/plan" },
  { name: "press plan", path: "/orders/plan/dev-plan-prod-1" },
  { name: "press", path: "/press" },
  { name: "press lines", path: "/press/lines" },
  { name: "press line", discover: { from: "/press", re: /^\/press\/lines\/[^/]+$/ } },
  { name: "press run", discover: { from: "/press", re: /^\/press\/runs\/[^/]+$/ } },
  { name: "press alerts", path: "/press/alerts" },
  { name: "press report", path: "/press/report" },
  { name: "press summary", path: "/press/summary" },
  // Foundry and ageing.
  { name: "casts", path: "/casts" },
  { name: "cast new", path: "/casts/new" },
  { name: "cast detail", discover: { from: "/casts", re: /^\/casts\/(?!new|inbox)[^/]+$/ } },
  { name: "cast melt", discover: { from: "/casts/dev-press-cast-1", re: /^\/casts\/[^/]+\/melt\/[^/]+$/ } },
  { name: "cast certificate", discover: { from: "/casts/dev-press-cast-1", re: /^\/casts\/[^/]+\/certificate$/ } },
  { name: "casts inbox", path: "/casts/inbox" },
  { name: "foundry stock", path: "/foundry/stock" },
  { name: "ageing", path: "/ageing" },
  { name: "ageing load", path: "/ageing/load" },
  { name: "ageing batch", discover: { from: "/ageing", re: /^\/ageing\/batch\/[^/]+$/ } },
  { name: "ageing history", path: "/ageing/history" },
  // Dies and customers.
  { name: "dies", path: "/dies" },
  { name: "die detail", discover: { from: "/dies", re: /^\/dies\/(?!copies|issues|makers)[^/]+$/ } },
  { name: "die copy", discover: { from: "/dies/dev-die-13090", re: /^\/dies\/copies\/[^/]+$/ } },
  { name: "die copy lift", path: "/dies/copies/dev-copy-14701-2/lift" },
  { name: "die issues", path: "/dies/issues" },
  { name: "die makers", path: "/dies/makers" },
  { name: "customers", path: "/customers" },
  { name: "customer detail", discover: { from: "/customers", re: /^\/customers\/[^/]+$/ } },
  // Purchase, store, approvals, audit.
  { name: "purchase", path: "/purchase" },
  { name: "purchase new", path: "/purchase/new" },
  { name: "purchase lot", discover: { from: "/purchase", re: /^\/purchase\/(?!new)[^/]+$/ } },
  { name: "vendors", path: "/vendors" },
  { name: "vendor detail", discover: { from: "/vendors", re: /^\/vendors\/[^/]+$/ } },
  { name: "store", path: "/store" },
  { name: "store items", path: "/store/items" },
  { name: "store item", discover: { from: "/store/items", re: /^\/store\/items\/[^/]+$/ } },
  { name: "store receive", path: "/store/receive" },
  { name: "store issue", path: "/store/issue" },
  { name: "store exchange", path: "/store/exchange" },
  { name: "approvals", path: "/approvals" },
  { name: "audit", path: "/audit" },
  // Reports and masters.
  { name: "reports", path: "/reports" },
  { name: "report: ageing", path: "/reports/ageing" },
  { name: "report: die life", path: "/reports/die-life" },
  { name: "report: foundry yield", path: "/reports/foundry-yield" },
  { name: "report: orders", path: "/reports/orders" },
  { name: "report: production", path: "/reports/production" },
  { name: "report: stock age", path: "/reports/stock-age" },
  { name: "masters", path: "/masters" },
  { name: "masters: alloys", path: "/masters/alloys" },
  { name: "masters: dies", path: "/masters/dies" },
  { name: "masters: furnaces", path: "/masters/furnaces" },
  { name: "masters: locations", path: "/masters/locations" },
  { name: "masters: ovens", path: "/masters/ovens" },
  { name: "masters: reasons", path: "/masters/reasons" },
  { name: "masters: recipes", path: "/masters/recipes" },
  { name: "masters: scrap", path: "/masters/scrap" },
  { name: "masters: trolleys", path: "/masters/trolleys" },
  // Printing, guides, settings.
  { name: "printing", path: "/printing" },
  { name: "printing template", discover: { from: "/printing?tab=printers", re: /^\/printing\/templates\/[^/]+$/ } },
  { name: "guides", path: "/guides" },
  { name: "guide", discover: { from: "/guides", re: /^\/guides\/[^/]+$/ } },
  ...["company", "shifts", "standards", "modules", "team", "devices", "backup", "support", "about", "printing", "data"].map(
    (tab): Target => ({ name: `settings: ${tab}`, path: tab === "company" ? "/settings" : `/settings?tab=${tab}` }),
  ),
  { name: "settings members (old url)", path: "/settings/members" },
  // Signed-in pages outside the shell's nav.
  { name: "welcome", path: "/welcome" },
];

const PLATFORM: Target[] = [
  { name: "platform: overview", role: "staff", path: "/admin" },
  { name: "platform: companies", role: "staff", path: "/admin/companies" },
  { name: "platform: company", role: "staff", discover: { from: "/admin/companies", re: /^\/admin\/companies\/[^/]+$/ } },
  { name: "platform: requests", role: "staff", path: "/admin/requests" },
  { name: "platform: staff", role: "staff", path: "/admin/staff" },
  { name: "platform: releases", role: "staff", path: "/admin/releases" },
  { name: "platform: backups", role: "staff", path: "/admin/backups" },
  { name: "platform: support", role: "staff", path: "/admin/support" },
  { name: "platform: waitlist", role: "staff", path: "/admin/waitlist" },
  { name: "platform: shell overlay (more)", role: "staff", path: "/admin", overlay: "more", maxWidth: 767 },
  { name: "platform: shell overlay (account)", role: "staff", path: "/admin", overlay: "account", minWidth: 1024 },
];

const PORTAL: Target[] = [
  { name: "portal: home", role: "party", path: "/portal" },
  { name: "portal: dispatches", role: "party", path: "/portal/dispatches" },
  { name: "portal: dispatch", role: "party", discover: { from: "/portal/dispatches", re: /^\/portal\/dispatches\/[^/]+$/ } },
  { name: "portal: certificate", role: "party", path: "/portal/certificate/dev-dispatch-done-1" },
  { name: "portal: orders", role: "party", path: "/portal/orders" },
  { name: "portal: order", role: "party", discover: { from: "/portal/orders", re: /^\/portal\/orders\/(?!new)[^/]+$/ } },
  { name: "portal: new order", role: "party", path: "/portal/orders/new" },
  { name: "portal: sections", role: "party", path: "/portal/dies" },
];

const TARGETS: Target[] = [...TENANT.map((t) => ({ role: "owner" as LocalRole, ...t })), ...PLATFORM, ...PORTAL];

/** Resolved detail URLs, per worker process. */
const discovered = new Map<string, string>();

async function settle(page: Page) {
  await expect(page.locator("main#main, main").first()).toBeVisible({ timeout: 15_000 });
  await page.waitForLoadState("networkidle", { timeout: 20_000 });
  // Skeletons and busy regions are loading states, not the screen. Their absence is the "loaded" signal.
  await expect(page.locator("[data-slot='skeleton'], [aria-busy='true']")).toHaveCount(0, { timeout: 15_000 });
  await page.evaluate(() => document.fonts.ready);
}

async function resolvePath(page: Page, target: Target): Promise<string | null> {
  if (target.path) return target.path;
  const { from, re } = target.discover!;
  const key = `${target.role}|${from}|${re.source}`;
  const known = discovered.get(key);
  if (known) return known;
  await page.goto(from);
  await settle(page);
  const hrefs = await page.locator("main a[href]").evaluateAll((els) => els.map((el) => el.getAttribute("href") ?? ""));
  const hit = hrefs.map((h) => h.split(/[?#]/)[0]!).find((h) => re.test(h));
  if (!hit) return null;
  discovered.set(key, hit);
  return hit;
}

async function openOverlay(page: Page, overlay: Overlay) {
  if (overlay === "palette") {
    await page.keyboard.press("ControlOrMeta+k");
    await expect(page.getByRole("dialog").first()).toBeVisible();
  } else if (overlay === "scanner") {
    // The Scan button is the tab bar's one button that is not More; its label follows the language.
    await page.locator("[data-slot='tab-bar'] button:not([data-slot='tab-more'])").click();
    await expect(page.getByRole("dialog").first()).toBeVisible();
  } else if (overlay === "more") {
    await page.getByRole("navigation", { name: "Main" }).locator("button").last().click();
    await expect(page.getByRole("dialog").first()).toBeVisible();
  } else {
    await page.locator("[data-slot='side-nav'] button").last().click();
    await expect(page.getByRole("menu")).toBeVisible();
  }
  // Open animations: let them finish so axe reads final colours.
  await page.waitForTimeout(400);
}

/** Where a violating node lives, so the report can group by source folder. */
async function describeNodes(page: Page, targets: string[]) {
  return page.evaluate((selectors) => {
    return selectors.map((sel) => {
      let el: Element | null = null;
      try {
        el = document.querySelector(sel);
      } catch {
        el = null;
      }
      if (!el) return { region: "unknown", slots: [] as string[], tag: "", classes: "" };
      const slots: string[] = [];
      for (let n: Element | null = el; n && slots.length < 5; n = n.parentElement) {
        const s = n.getAttribute("data-slot");
        if (s) slots.push(s);
      }
      let region = "other";
      if (el.closest("[data-sonner-toaster]")) region = "toast";
      else if (el.closest("[role='dialog'], [role='menu'], [data-radix-popper-content-wrapper], [data-slot='command-dialog']")) region = "overlay";
      else if (el.closest("[data-slot='side-nav'], [data-slot='tab-bar'], header, [data-slot='tab-more']")) region = "shell";
      else if (el.closest("main")) region = "main";
      else if (el.closest("a[href='#main']")) region = "shell";
      return {
        region,
        slots,
        tag: el.tagName.toLowerCase(),
        classes: (el.getAttribute("class") ?? "").slice(0, 160),
      };
    });
  }, targets);
}

/** Structure axe's wcag tags do not cover: one main and one h1, heading order, named landmarks and tables, alt text. */
async function structureOf(page: Page) {
  return page.evaluate(() => {
    const shown = (el: Element) => el instanceof HTMLElement && !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    const levels = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")].filter(shown).map((e) => Number(e.tagName[1]));
    const skips: string[] = [];
    let prev = 0;
    for (const l of levels) {
      if (prev && l > prev + 1) skips.push(`h${prev}>h${l}`);
      prev = l;
    }
    const navs = [...document.querySelectorAll("nav,[role='navigation']")].filter(shown);
    const tables = [...document.querySelectorAll("table")].filter(shown);
    return {
      mains: [...document.querySelectorAll("main")].filter(shown).length,
      h1: levels.filter((l) => l === 1).length,
      headingSkips: skips,
      unnamedNav: navs.length > 1 ? navs.filter((n) => !n.getAttribute("aria-label") && !n.getAttribute("aria-labelledby")).length : 0,
      unnamedTables: tables.filter((t) => !t.querySelector("caption") && !t.getAttribute("aria-label") && !t.getAttribute("aria-labelledby")).length,
      tablesNoHeaders: tables.filter((t) => !t.querySelector("th")).length,
      imgsNoAlt: document.querySelectorAll("img:not([alt])").length,
      htmlLang: document.documentElement.lang,
      textLen: (document.querySelector("main")?.textContent ?? "").trim().length,
    };
  });
}

async function sweep(page: Page, meta: Record<string, unknown>) {
  const results = await new AxeBuilder({ page })
    .withTags(TAGS)
    // Dev-only overlays (TanStack/React Query devtools) are not product UI.
    .exclude(".TanStackRouterDevtools")
    .exclude(".tsqd-parent-container")
    .exclude("[class*='tsqd-']")
    .analyze();
  mkdirSync(OUT_DIR, { recursive: true });
  const out = [];
  for (const v of results.violations) {
    const nodes = v.nodes.slice(0, 12);
    const where = await describeNodes(
      page,
      nodes.map((n) => n.target.join(" ")),
    );
    out.push({
      id: v.id,
      impact: v.impact ?? "minor",
      help: v.help,
      helpUrl: v.helpUrl,
      nodeCount: v.nodes.length,
      nodes: nodes.map((n, i) => ({
        target: n.target.join(" "),
        html: n.html.slice(0, 240),
        summary: (n.failureSummary ?? "").split("\n").slice(0, 3).join(" | ").slice(0, 300),
        ...where[i]!,
      })),
    });
  }
  const structure = meta.scheme === "light" ? await structureOf(page) : null;
  appendFileSync(OUT_FILE, `${JSON.stringify({ ...meta, structure, url: new URL(page.url()).pathname + new URL(page.url()).search, violations: out })}\n`);
  return out;
}

async function applyScheme(page: Page, scheme: Scheme) {
  await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
  await expect(page.locator("html")).toHaveClass(new RegExp(`\\b${scheme}\\b`));
}

test.describe.configure({ mode: "parallel" });

for (const target of TARGETS) {
  for (const vp of VIEWPORTS) {
    if (target.minWidth && vp.width < target.minWidth) continue;
    if (target.maxWidth && vp.width > target.maxWidth) continue;
    const locales: Locale[] = target.hi ? ["en", "hi"] : ["en"];
    for (const locale of locales) {
      test(`${target.name} @ ${vp.name} ${locale}: no serious or critical axe violations`, async ({ page }) => {
        test.setTimeout(90_000);
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
        if (locale !== "en") {
          await page.addInitScript((l) => localStorage.setItem("orrn.locale", l), locale);
        }
        await signInViaApi(page, target.role!);

        const path = await resolvePath(page, target);
        expect(path, `${target.name}: no link matching ${target.discover?.re} on ${target.discover?.from}`).not.toBeNull();
        await page.goto(path!);
        await settle(page);
        if (locale !== "en") await expect(page.locator("html")).toHaveAttribute("lang", locale);
        if (target.overlay) await openOverlay(page, target.overlay);

        const blocking: unknown[] = [];
        for (const scheme of ["light", "dark"] as const) {
          await applyScheme(page, scheme);
          const found = await sweep(page, {
            target: target.name,
            role: target.role,
            requested: path,
            viewport: vp.name,
            width: vp.width,
            locale,
            scheme,
            overlay: target.overlay ?? null,
          });
          for (const v of found) {
            if (v.impact === "serious" || v.impact === "critical") {
              blocking.push({ scheme, id: v.id, impact: v.impact, help: v.help, count: v.nodeCount, targets: v.nodes.slice(0, 4).map((n) => n.target) });
            }
          }
        }
        expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
      });
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Shell behaviour the scanner cannot see: language, landmarks, keyboard       */
/* -------------------------------------------------------------------------- */

async function openToday(page: Page, width: number) {
  await page.setViewportSize({ width, height: 900 });
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await signInViaApi(page, "owner");
  await page.goto("/today");
  await settle(page);
}

test.describe("shell semantics and keyboard", () => {
  test("html lang follows the chosen language (en, hi, gu) and survives a reload", async ({ page }) => {
    await openToday(page, 1280);
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    for (const lang of ["hi", "gu", "en"] as const) {
      await page.locator("[data-slot='side-nav'] button").last().click();
      await page.locator(`[role='menuitemradio'][lang='${lang}']`).click();
      await expect(page.locator("html")).toHaveAttribute("lang", lang);
    }
    await page.locator("[data-slot='side-nav'] button").last().click();
    await page.locator("[role='menuitemradio'][lang='hi']").click();
    await expect(page.locator("html")).toHaveAttribute("lang", "hi");
    await page.reload();
    await settle(page);
    await expect(page.locator("html")).toHaveAttribute("lang", "hi");
  });

  test("one main, one h1, one named Main nav, aria-current on the current page", async ({ page }) => {
    await openToday(page, 1280);
    await expect(page.locator("main")).toHaveCount(1);
    await expect(page.locator("main h1")).toHaveCount(1);
    await expect(page.getByRole("navigation", { name: "Main" })).toHaveCount(1);
    await expect(page.getByRole("navigation", { name: "Main" }).locator("[aria-current='page']")).toHaveCount(1);
  });

  test("skip link is the first stop and moves focus into main", async ({ page }) => {
    await openToday(page, 1280);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press("Tab");
    const skip = page.locator("a[href='#main']");
    await expect(skip).toBeFocused();
    await expect(skip).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page.locator("main#main")).toBeFocused();
  });

  test("palette: opens focused on its combobox, Escape closes it and returns focus", async ({ page }) => {
    await openToday(page, 1280);
    const opener = page.getByRole("navigation", { name: "Main" }).getByRole("link").first();
    await opener.focus();
    await page.keyboard.press("ControlOrMeta+k");
    const palette = page.getByRole("dialog", { name: "Scan or search" });
    await expect(palette.getByRole("combobox")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(palette).toBeHidden();
    await expect(opener).toBeFocused();
  });

  test("account menu: Escape closes it and focus returns to the trigger", async ({ page }) => {
    await openToday(page, 1280);
    const trigger = page.locator("[data-slot='side-nav'] button").last();
    await trigger.click();
    await expect(page.getByRole("menu")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test("account menu: a click outside closes it and does not reach the page", async ({ page }) => {
    await openToday(page, 1280);
    const url = page.url();
    const trigger = page.locator("[data-slot='side-nav'] button").last();
    await trigger.click();
    await expect(page.getByRole("menu")).toBeVisible();
    // Click where a Today link sits: the backdrop must take the click.
    const target = page.locator("main a[href]").first();
    await expect(target).toBeVisible();
    const box = (await target.boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(page.getByRole("menu")).toBeHidden();
    await expect(page.locator("[data-menu-backdrop]")).toHaveCount(0);
    expect(page.url()).toBe(url);
  });

  test("phone More sheet: focus moves in, stays in on Tab, Escape returns it to More", async ({ page }) => {
    await openToday(page, 375);
    const more = page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: "More", exact: true });
    await more.focus();
    await page.keyboard.press("Enter");
    const sheet = page.getByRole("dialog", { name: "More" });
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText("Owner");
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press("Tab");
      const inside = await sheet.evaluate((el) => el.contains(document.activeElement));
      expect(inside, `Tab ${i + 1} left the sheet`).toBe(true);
    }
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    await expect(more).toBeFocused();
  });

  test("phone scanner sheet is a named dialog and Escape returns focus to Scan", async ({ page }) => {
    await openToday(page, 375);
    const scan = page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: "Scan", exact: true });
    await scan.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog").first();
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAccessibleName(/.+/);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(scan).toBeFocused();
  });
});

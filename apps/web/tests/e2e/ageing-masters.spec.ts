import AxeBuilder from "@axe-core/playwright";
import { expect, request as pwRequest, type Browser, type BrowserContext, type Page } from "@playwright/test";

import { test } from "./helpers/test";
import { expectNoClippedText, expectNoHorizontalScroll } from "../helpers/layout-guards";
import { localPassword, signInViaApi, type LocalRole } from "./helpers/accounts";
import { API_URL, WEB_ORIGIN } from "./helpers/ports";

/**
 * The ageing masters (W3-AG-W): `/masters/ovens`, `/masters/trolleys`, `/masters/recipes` and Settings → Standards'
 * ageing card. The manager (masters.publish) adds and activates; the operator reads; the viewer is turned away.
 * Each width adds its own oven, trolley and recipe under a code of its own and takes them out of service or
 * archives them afterwards. The dispatch switch (`requireAgeing`) is shown and explained here but never turned on
 * (other specs dispatch un-aged bundles in parallel); the server test covers the flip.
 */

const API = API_URL;
const ORIGIN = WEB_ORIGIN;
const WIDTHS = [375, 820, 1280] as const;

type Api = { q<T>(path: string, input?: unknown): Promise<T>; m<T>(path: string, input?: unknown): Promise<T>; dispose(): Promise<void> };

async function apiAs(role: LocalRole): Promise<Api> {
  const ctx = await pwRequest.newContext({ extraHTTPHeaders: { origin: ORIGIN } });
  const login = await ctx.post(`${API}/api/auth/sign-in/email`, { data: { email: `${role}@orrn.local`, password: localPassword() } });
  expect(login.ok(), `sign-in as ${role} returned ${login.status()}`).toBe(true);
  return {
    async q<T>(path: string, input?: unknown) {
      const res = await ctx.get(`${API}/trpc/${path}${input === undefined ? "" : `?input=${encodeURIComponent(JSON.stringify(input))}`}`);
      expect(res.ok(), `${path} returned ${res.status()}: ${await res.text()}`).toBe(true);
      return (await res.json()).result.data as T;
    },
    async m<T>(path: string, input?: unknown) {
      const res = await ctx.post(`${API}/trpc/${path}`, { data: input ?? {} });
      expect(res.ok(), `${path} returned ${res.status()}: ${await res.text()}`).toBe(true);
      return (await res.json()).result.data as T;
    },
    dispose: () => ctx.dispose(),
  };
}

async function openAs(browser: Browser, role: LocalRole, width: number, path: string): Promise<{ page: Page; context: BrowserContext }> {
  const context = await browser.newContext({ viewport: { width, height: width < 600 ? 800 : 900 }, colorScheme: "light", reducedMotion: "reduce" });
  const page = await context.newPage();
  await signInViaApi(page, role);
  await page.goto(path);
  await expect(page.locator("main#main h1").first()).toBeVisible({ timeout: 25_000 });
  return { page, context };
}

async function clean(page: Page) {
  await expectNoHorizontalScroll(page);
  await expectNoClippedText(page, "main#main");
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .exclude(".TanStackRouterDevtools")
    .exclude("[class*='tsqd-']")
    .exclude("[data-sonner-toaster]")
    .analyze();
  expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => ({ id: v.id, targets: v.nodes.slice(0, 3).map((n) => n.target.join(" ")) }))).toEqual([]);
}

for (const width of WIDTHS) {
  test.describe(`ageing masters at ${width}px`, () => {
    test.describe.configure({ mode: "serial" });
    const tag = `${width}${Math.random().toString(36).slice(2, 5)}`.toUpperCase();
    const ovenCode = `MO${tag}`.slice(0, 12);
    const trolleyCode = `MT${tag}`.slice(0, 12);
    const temper = `T${Math.random().toString(36).slice(2, 5).toUpperCase()}`.slice(0, 6);

    test.afterAll(async () => {
      const owner = await apiAs("owner");
      try {
        const ovens = await owner.q<{ items: { id: string; code: string }[] }>("ageing.ovens.list", { includeInactive: true });
        for (const o of ovens.items.filter((x) => x.code === ovenCode)) await owner.m("ageing.ovens.save", { id: o.id, code: o.code, status: "out_of_service" }).catch(() => undefined);
        const rack = await owner.q<{ items: { id: string; code: string }[] }>("ageing.trolleys.list", { includeInactive: true });
        for (const r of rack.items.filter((x) => x.code === trolleyCode)) await owner.m("ageing.trolleys.save", { id: r.id, code: r.code, status: "out_of_service" }).catch(() => undefined);
        const recipes = await owner.q<{ items: { id: string; alloy: string; temper: string; kind: string; targetTempX10: number; toleranceX10: number; soakMin: number; hardnessMinX10: number }[] }>("ageing.recipes.list", { includeInactive: true });
        for (const r of recipes.items.filter((x) => x.temper === temper)) await owner.m("ageing.recipes.save", { id: r.id, alloy: r.alloy, temper: r.temper, kind: r.kind, targetTempX10: r.targetTempX10, toleranceX10: r.toleranceX10, soakMin: r.soakMin, hardnessMinX10: r.hardnessMinX10, status: "archived" }).catch(() => undefined);
      } finally {
        await owner.dispose();
      }
    });

    test("the manager adds an oven and a trolley and takes the oven into service", async ({ browser }) => {
      const { page, context } = await openAs(browser, "manager", width, "/masters");
      // The hub lists the three ageing masters with a count.
      for (const name of ["Ageing ovens", "Trolleys", "Cycle recipes"]) await expect(page.getByRole("link", { name: new RegExp(name) }).first()).toBeVisible({ timeout: 15_000 });
      await page.goto("/masters/ovens");
      await expect(page.getByRole("heading", { level: 1, name: "Ovens" })).toBeVisible();
      await page.getByTestId("add-oven").click();
      const form = page.getByTestId("oven-form");
      // A blank code is asked for, not sent.
      await page.getByTestId("oven-form-submit").click();
      await expect(form).toContainText("Type a value");
      await form.getByTestId("master-code").fill(ovenCode);
      await form.getByTestId("master-capacity").fill("1500");
      await form.getByTestId("master-status").selectOption("active");
      await page.getByTestId("oven-form-submit").click();
      await expect(page.getByTestId("oven-form")).toBeHidden({ timeout: 15_000 });
      await expect(page.getByRole("button", { name: `Edit ${ovenCode}` })).toBeVisible({ timeout: 15_000 });
      await expect(page.locator("main#main")).toContainText("1,500.0");
      // The same code twice is refused in words.
      await page.getByTestId("add-oven").click();
      await page.getByTestId("oven-form").getByTestId("master-code").fill(ovenCode);
      await page.getByTestId("oven-form-submit").click();
      await expect(page.getByTestId("ageing-refusal")).toContainText("already used");
      await page.keyboard.press("Escape");
      await clean(page);

      await page.goto("/masters/trolleys");
      await page.getByTestId("add-trolley").click();
      await page.getByTestId("trolley-form").getByTestId("master-code").fill(trolleyCode);
      await page.getByTestId("trolley-form").getByTestId("master-status").selectOption("active");
      await page.getByTestId("trolley-form-submit").click();
      await expect(page.getByRole("button", { name: `Edit ${trolleyCode}` })).toBeVisible({ timeout: 15_000 });
      await clean(page);
      await context.close();
    });

    test("a recipe: one active per alloy, temper and cycle; an active recipe is copied, not edited", async ({ browser }) => {
      const { page, context } = await openAs(browser, "manager", width, "/masters/recipes");
      await expect(page.getByRole("heading", { level: 1, name: "Cycle recipes" })).toBeVisible();
      await expect(page.locator("main#main")).toContainText("6063");
      await page.getByTestId("add-recipe").click();
      const form = page.getByTestId("recipe-form");
      await form.getByTestId("recipe-alloy").fill("6061");
      await form.getByTestId("recipe-temper").fill(temper);
      await form.getByTestId("recipe-target").fill("175");
      await form.getByTestId("recipe-soak").fill("480");
      await form.getByTestId("recipe-hmin").fill("9");
      await form.getByTestId("master-status").selectOption("active");
      await page.getByTestId("recipe-form-submit").click();
      await expect(page.getByTestId("recipe-form")).toBeHidden({ timeout: 15_000 });
      const edit = page.getByRole("button", { name: `Edit 6061 ${temper}` });
      await expect(edit).toBeVisible({ timeout: 15_000 });
      await expect(page.locator("main#main")).toContainText("175.0");
      // Open it: the numbers are locked, the way on is a copy.
      await edit.click();
      await expect(page.getByTestId("recipe-form").getByTestId("recipe-target")).toBeDisabled();
      await expect(page.getByTestId("recipe-copy")).toBeVisible();
      await page.getByTestId("recipe-copy").click();
      await expect(page.getByTestId("recipe-form").getByTestId("recipe-target")).toBeEnabled();
      await expect(page.getByTestId("recipe-form").getByTestId("recipe-target")).toHaveValue("175");
      await page.keyboard.press("Escape");
      await clean(page);
      await context.close();
    });

    test("the operator reads the masters and cannot add; the viewer is turned away; Settings explains the dispatch switch", async ({ browser }) => {
      const op = await openAs(browser, "operator", width, "/masters/ovens");
      await expect(op.page.locator("main#main")).toContainText(ovenCode, { timeout: 15_000 });
      await expect(op.page.getByTestId("add-oven")).toHaveCount(0);
      await expect(op.page.getByRole("button", { name: `Edit ${ovenCode}` })).toHaveCount(0);
      await op.context.close();

      const viewer = await openAs(browser, "viewer", width, "/masters/recipes");
      await expect(viewer.page.getByTestId("add-recipe")).toHaveCount(0);
      await expect(viewer.page.locator("main#main")).not.toContainText("6063");
      await viewer.context.close();

      const owner = await openAs(browser, "owner", width, "/settings?tab=standards");
      const card = owner.page.getByTestId("settings-ageing");
      await expect(card).toBeVisible({ timeout: 15_000 });
      await expect(card).toContainText("Dispatch aged metal only");
      await expect(card.getByTestId("require-ageing-since")).toContainText("starts today");
      // Splitting lengths is harmless to other specs: flip it and back.
      const split = card.getByTestId("ageing-switch-split");
      const was = await split.getAttribute("aria-checked");
      await split.click();
      await expect(split).toHaveAttribute("aria-checked", was === "true" ? "false" : "true", { timeout: 15_000 });
      await split.click();
      await expect(split).toHaveAttribute("aria-checked", was ?? "false", { timeout: 15_000 });
      await clean(owner.page);
      await owner.context.close();
    });
  });
}

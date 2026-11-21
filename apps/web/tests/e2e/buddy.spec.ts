import AxeBuilder from "@axe-core/playwright";
import { expect, request, test, type Page } from "@playwright/test";

import { expectNoClippedText, expectNoHorizontalScroll } from "../helpers/layout-guards";
import { signInViaApi } from "./helpers/accounts";
import { API_URL } from "./helpers/ports";
import { apiAs, ownerApi } from "./helpers/owner-api";

/**
 * orrn buddy (design 2026-11-18 §4.5, §7, §12.2, §13) against the fake Hermes (`apps/server/scripts/fake-hermes.ts`).
 * The API must run with `BUDDY_FAKE_HERMES_PORT` set (buddy on for the demo plant, fake values only) and the fake on
 * that port; without them `buddy.status.available` is false and the spec stops at its first check.
 *
 * The grant belongs to `buddy-owner@orrn.local`, a second owner of the demo plant that no other spec signs in as (S12):
 * other owner specs never see the floating button, whatever runs beside this file. The spec runs serially and
 * disconnects Hermes in `afterAll` (and before it starts, after a run that died half way).
 */

/** Same rule as playwright.config.ts: the fake listens on the API port + 150. */
const API_PORT = Number(new URL(API_URL).port);
const FAKE_HERMES = `http://127.0.0.1:${Number(process.env.BUDDY_FAKE_HERMES_PORT) || API_PORT + 150}`;
const SIZES = [
  { name: "phone", width: 375, height: 812 },
  { name: "tablet", width: 820, height: 1180 },
  { name: "desktop", width: 1280, height: 800 },
] as const;

type Status = { available: boolean; listed: boolean; connected: { grantId: string } | null };
type Locale = "en" | "hi" | "gu";

test.describe.configure({ mode: "serial" });

/** The one account with a Hermes link in e2e. */
const BUDDY_OWNER = "buddy-owner" as const;
const buddyOwnerApi = () => apiAs(`${BUDDY_OWNER}@orrn.local`);

async function disconnect() {
  const api = await buddyOwnerApi();
  try {
    const status = await api.query<Status>("buddy.status", undefined);
    if (status.connected) await api.mutate("buddy.grant.revoke", { grantId: status.connected.grantId });
  } finally {
    await api.dispose();
  }
}

async function blockingAxe(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .exclude(".TanStackRouterDevtools")
    .exclude("[class*='tsqd-']")
    .exclude("[data-sonner-toaster]")
    .analyze();
  return results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => ({ id: v.id, targets: v.nodes.slice(0, 3).map((n) => n.target.join(" ")) }));
}

async function bothSchemesClean(page: Page, what: string) {
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await expect(page.locator("html")).toHaveClass(new RegExp(`\\b${scheme}\\b`));
    expect(await blockingAxe(page), `${what} ${scheme}`).toEqual([]);
  }
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
}

async function setFakeToken(token: string) {
  const api = await request.newContext();
  try {
    const res = await api.post(`${FAKE_HERMES}/__fake/token`, { data: { token } });
    expect(res.ok(), `fake Hermes token returned ${res.status()}`).toBe(true);
  } finally {
    await api.dispose();
  }
}

async function openOwner(page: Page, path: string, locale: Locale = "en", width = 1280, height = 800) {
  await page.setViewportSize({ width, height });
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  if (locale !== "en") await page.addInitScript((l) => localStorage.setItem("orrn.locale", l), locale);
  await signInViaApi(page, BUDDY_OWNER);
  await page.goto(path);
  await expect(page.locator("h1").first()).toBeVisible({ timeout: 20_000 });
  if (locale !== "en") await expect(page.locator("html")).toHaveAttribute("lang", locale);
}

const panel = (page: Page) => page.getByRole("dialog", { name: "Buddy" });

async function openBubble(page: Page) {
  const launcher = page.getByTestId("buddy-launcher");
  await expect(launcher).toBeVisible({ timeout: 20_000 });
  await launcher.click();
  await expect(page.getByTestId("buddy-panel")).toBeVisible({ timeout: 20_000 });
}

async function say(page: Page, text: string) {
  const box = page.getByTestId("buddy-input");
  await box.fill(text);
  await box.press("Enter");
}

test.beforeAll(async () => {
  await disconnect();
});

test.afterAll(async () => {
  await disconnect();
});

test("the stage has the buddy on for the demo plant", async () => {
  const api = await buddyOwnerApi();
  try {
    const status = await api.query<Status>("buddy.status", undefined);
    expect(status, "start the API with BUDDY_FAKE_HERMES_PORT and the fake Hermes on that port").toMatchObject({ available: true, listed: true });
  } finally {
    await api.dispose();
  }
});

test("no button before Hermes is connected", async ({ page }) => {
  await openOwner(page, "/today");
  await expect(page.getByTestId("buddy-launcher")).toHaveCount(0);
});

test("Settings > Buddy: Connect Hermes shows the key once; it is gone after I have copied it", async ({ page }) => {
  await openOwner(page, "/settings?tab=buddy");
  await expect(page.getByRole("tab", { name: "Buddy" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("buddy-connection")).toContainText("Hermes is not connected.");
  await page.getByTestId("buddy-connect").click();
  const key = page.getByTestId("buddy-key-value");
  await expect(key).toBeVisible();
  await expect(page.getByTestId("buddy-key-once")).toHaveText("This key is shown only once. Copy it now and keep it safe. orrn cannot show it again.");
  const token = await key.inputValue();
  expect(token).toMatch(/^orrnb_/);
  await setFakeToken(token);
  await bothSchemesClean(page, "settings with the key");
  await page.getByTestId("buddy-key-done").click();
  await expect(page.getByTestId("buddy-key")).toHaveCount(0);
  await expect(page.getByTestId("buddy-last-used")).toHaveText("Not used yet");
  // The key is nowhere on the page any more, and connecting turned the button on.
  expect(await page.content()).not.toContain(token);
  await expect(page.getByTestId("buddy-launcher")).toBeVisible();
});

test("S12: the demo owner, who has no link, never sees the button while buddy-owner is connected", async ({ page }) => {
  // The other owner specs sign in as `owner`: this is what they see while this file runs beside them.
  await page.setViewportSize({ width: 390, height: 844 });
  await signInViaApi(page, "owner");
  await page.goto("/today");
  await expect(page.locator("h1").first()).toBeVisible({ timeout: 20_000 });
  const api = await buddyOwnerApi();
  try {
    expect((await api.query<Status>("buddy.status", undefined)).connected, "buddy-owner is connected for this check").not.toBeNull();
  } finally {
    await api.dispose();
  }
  await expect(page.getByTestId("buddy-launcher")).toHaveCount(0);
});

test("Settings > Buddy: Renew gives 30 more days from now", async ({ page }) => {
  await openOwner(page, "/settings?tab=buddy");
  await expect(page.getByTestId("buddy-renew")).toBeVisible();
  await page.getByTestId("buddy-renew").click();
  await expect(page.getByTestId("buddy-renewed-on")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("buddy-fresh-sign-in")).toHaveCount(0);
});

for (const locale of ["en", "hi", "gu"] as const) {
  for (const size of SIZES) {
    test(`Settings > Buddy @ ${size.name} ${locale}: axe and layout`, async ({ page }) => {
      await openOwner(page, "/settings?tab=buddy", locale, size.width, size.height);
      await expect(page.getByTestId("buddy-connection")).toBeVisible();
      await expectNoHorizontalScroll(page);
      await expectNoClippedText(page, "[data-testid='settings-buddy']");
      await bothSchemesClean(page, `settings ${size.name} ${locale}`);
    });
  }
}

test("N8: opened by a click that does not focus the button (Safari), Escape still brings focus back to the button", async ({ page }) => {
  await openOwner(page, "/today");
  const launcher = page.getByTestId("buddy-launcher");
  await expect(launcher).toBeVisible({ timeout: 20_000 });
  // A click event with no focus, as Safari does it for buttons.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await launcher.dispatchEvent("click");
  await expect(page.getByTestId("buddy-panel")).toBeVisible({ timeout: 20_000 });
  await page.keyboard.press("Escape");
  await expect(panel(page)).toHaveCount(0);
  await expect(launcher).toBeFocused();
});

const inDialog = (page: Page, name = "Buddy") =>
  page.evaluate((name) => {
    const dialog = document.activeElement?.closest("[role='dialog']");
    return !!dialog && document.getElementById(dialog.getAttribute("aria-labelledby") ?? "")?.textContent === name;
  }, name);

test("phone: the bubble is a modal sheet: focus goes in and stays, Escape closes it and focus comes back to the button", async ({ page }) => {
  await openOwner(page, "/today", "en", 375, 812);
  await openBubble(page);
  const dialog = panel(page);
  await expect(dialog).toHaveAttribute("aria-modal", "true");
  await expect(page.locator("[data-slot='sheet-overlay']")).toBeVisible();
  // A phone keeps its keyboard down (N7): focus is on the dialog, not the box.
  expect(await inDialog(page)).toBe(true);
  // Tab never leaves the dialog.
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press("Tab");
    expect(await inDialog(page)).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId("buddy-launcher")).toBeFocused();
});

// Was "the bubble is a dialog … Tab never leaves the dialog" at 1280 (the modal desktop sheet). Review N9 made it a
// non-modal dialog beside the page; delta S5 docks it as a column at the right from 1024 px (768 to 1023 is modal again).
test("desktop: the bubble is a non-modal dialog beside the page: no overlay, Tab and clicks reach the page, ⌘K works, the button takes focus back in, Escape closes it", async ({ page }) => {
  await openOwner(page, "/today");
  await openBubble(page);
  const dialog = panel(page);
  await expect(dialog).toHaveAttribute("aria-modal", "false");
  await expect(page.locator("[data-slot='sheet-overlay']")).toHaveCount(0);
  await expect(page.getByTestId("buddy-input")).toBeFocused();
  // Nothing on the page is hidden from screen readers or inert.
  expect(await page.evaluate(() => !!document.querySelector("main")?.closest("[aria-hidden='true'], [inert]"))).toBe(false);
  // Tab is not trapped: it moves on past the panel's last control.
  let left = false;
  for (let i = 0; i < 12 && !left; i++) {
    await page.keyboard.press("Tab");
    left = !(await inDialog(page));
  }
  expect(left, "Tab leaves the panel").toBe(true);
  await expect(dialog).toBeVisible();
  // The page stays in use: a click on it leaves the panel open, and ⌘K opens the palette over both.
  await page.locator("main h1").first().click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press("ControlOrMeta+k");
  const palette = page.getByRole("dialog", { name: "Scan or search" });
  await expect(palette).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(palette).toBeHidden();
  await expect(dialog).toBeVisible();
  // Escape on the page is the page's own: the panel stays.
  await page.locator("main h1").first().focus();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  // The way back in: the Buddy button, which stays in sight left of the docked panel.
  const launcher = page.getByTestId("buddy-launcher");
  await expect(launcher).toBeVisible();
  await launcher.click();
  await expect(page.getByTestId("buddy-input")).toBeFocused();
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(launcher).toBeFocused();
});

test("a question: the tool chip, the streamed answer, and the live region says the finished answer", async ({ page }) => {
  await openOwner(page, "/stock");
  await openBubble(page);
  await say(page, "how much 12170 is in the yard");
  const turn = page.getByTestId("buddy-turn").last();
  await expect(turn).toHaveAttribute("data-phase", "done", { timeout: 30_000 });
  await expect(turn.getByTestId("buddy-tool").first()).toContainText("Used orrn: ");
  const reply = (await turn.getByTestId("buddy-reply").textContent()) ?? "";
  expect(reply.length).toBeGreaterThan(0);
  await expect(page.getByTestId("buddy-live")).toContainText(reply.replace(/^Buddy: /, "").trim().slice(0, 20));
  // What orrn sent Hermes: the screen path, never a token.
  const api = await request.newContext();
  try {
    const last = await (await api.get(`${FAKE_HERMES}/__fake/last`)).text();
    expect(last).toContain("/stock");
    expect(last).not.toContain("orrnb_");
  } finally {
    await api.dispose();
  }
});

test("a change comes back as a draft card; Reject and Confirm each decide it, and the panel survives a route change", async ({ page }) => {
  const name = `Buddy Party ${Date.now().toString(36)}`;
  // Start on /stock and move to /today in the app, so Back later is a route change inside the app.
  await openOwner(page, "/stock");
  await page.evaluate(() => {
    window.history.pushState({}, "", "/today");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  await expect(page).toHaveURL(/\/today$/);
  await openBubble(page);

  await say(page, `/draft customer.create {"name":"${name} R"}`);
  const first = page.getByTestId("buddy-draft").last();
  await expect(first).toHaveAttribute("data-status", "pending", { timeout: 30_000 });
  await first.getByTestId("buddy-draft-reject").click();
  await expect(first).toHaveAttribute("data-status", "rejected");

  await say(page, `/draft customer.create {"name":"${name} C"}`);
  const second = page.getByTestId("buddy-draft").last();
  await expect(second).toHaveAttribute("data-status", "pending", { timeout: 30_000 });
  // The server told Hermes about the rejected draft with this turn (decision 7): the real final state.
  {
    const api = await request.newContext();
    try {
      expect(await (await api.get(`${FAKE_HERMES}/__fake/last`)).text()).toContain("rejected");
    } finally {
      await api.dispose();
    }
  }
  await second.getByTestId("buddy-draft-confirm").click();
  await expect(second).toHaveAttribute("data-status", "confirmed", { timeout: 20_000 });

  // The server tells Hermes the real final state with the next turn (decision 7); the browser sends no notes.
  const sent: string[] = [];
  page.on("request", (r) => {
    if (r.url().endsWith("/buddy/chat")) sent.push(r.postData() ?? "");
  });
  await say(page, "thanks");
  await expect(page.getByTestId("buddy-turn").last()).toHaveAttribute("data-phase", "done", { timeout: 30_000 });
  const api = await request.newContext();
  try {
    const last = await (await api.get(`${FAKE_HERMES}/__fake/last`)).text();
    expect(last).toContain("confirmed");
    // Each final state goes to Hermes once: the reject was told on the turn before.
    expect(last).not.toContain("rejected");
  } finally {
    await api.dispose();
  }
  expect(sent.length).toBe(1);
  expect(Object.keys(JSON.parse(sent[0]!)).sort()).toEqual(["conversationId", "message", "screen"]);

  // The confirmed change is a real customer.
  const owner = await ownerApi();
  try {
    const list = await owner.query<{ items: { name: string }[] }>("customer.list", { search: name, limit: 10 });
    expect(list.items.map((c) => c.name)).toContain(`${name} C`);
    expect(list.items.map((c) => c.name)).not.toContain(`${name} R`);
  } finally {
    await owner.dispose();
  }

  // The panel and its conversation stay across a route change (Back to /stock, no reload).
  await page.goBack();
  await expect(page).toHaveURL(/\/stock$/);
  await expect(panel(page)).toBeVisible();
  await expect(page.getByTestId("buddy-turn")).toHaveCount(3);
});

test("offline: one line, Try again is the person's, nothing retries on its own", async ({ page }) => {
  await openOwner(page, "/today");
  await openBubble(page);
  let chats = 0;
  page.on("request", (r) => {
    if (r.url().endsWith("/buddy/chat")) chats++;
  });
  await say(page, "/offline are you there");
  await expect(page.getByTestId("buddy-offline")).toHaveText("Buddy is offline. Try again later.", { timeout: 30_000 });
  await page.waitForTimeout(2000);
  expect(chats).toBe(1);
  await expect(page.getByTestId("buddy-retry")).toBeVisible();
});

test("Add a file opens the normal import upload and steps the panel aside", async ({ page }) => {
  await openOwner(page, "/today");
  await openBubble(page);
  await page.getByTestId("buddy-add-file").click();
  await expect(page).toHaveURL(/\/ingest$/);
  await expect(panel(page)).toHaveCount(0);
  await expect(page.getByTestId("buddy-launcher")).toBeVisible();
});

for (const locale of ["en", "hi", "gu"] as const) {
  for (const size of SIZES) {
    test(`the open bubble @ ${size.name} ${locale}: axe, no sideways scroll, nothing clipped`, async ({ page }) => {
      await openOwner(page, "/today", locale, size.width, size.height);
      // The closed button is clear of the phone tab bar.
      if (size.width < 768) {
        const button = await page.getByTestId("buddy-launcher").boundingBox();
        const tabBar = await page.locator("[data-slot='tab-bar']").boundingBox();
        expect(button && tabBar && button.y + button.height <= tabBar.y).toBe(true);
      }
      await openBubble(page);
      await say(page, "hello");
      await expect(page.getByTestId("buddy-turn").last()).toHaveAttribute("data-phase", "done", { timeout: 30_000 });
      const box = await page.getByTestId("buddy-panel").locator("xpath=ancestor::*[@role='dialog']").boundingBox();
      if (size.width < 768) {
        expect(box?.width).toBe(size.width);
        await expect(panel(page)).toHaveAttribute("aria-modal", "true");
      } else if (size.width < 1024) {
        // Delta S5: 768 to 1023 px is the floating modal sheet (it was non-modal beside the page under N9): over a
        // dimmed page, the button below it, the page heading clear of it.
        expect(box!.width).toBeLessThanOrEqual(400);
        await expect(panel(page)).toHaveAttribute("aria-modal", "true");
        await expect(page.locator("[data-slot='sheet-overlay']")).toBeVisible();
        const button = (await page.getByTestId("buddy-launcher").boundingBox())!;
        expect(box!.y + box!.height, "panel ends above the button").toBeLessThanOrEqual(button.y);
        const heading = (await page.locator("main h1").first().boundingBox())!;
        expect(box!.y, "panel starts below the page heading").toBeGreaterThanOrEqual(heading.y + heading.height);
      } else {
        // Delta S5: docked beside the page, not over it: no overlay, a full-height 400 px column at the right edge,
        // and the button and the page heading both left of it (it used to float above the button, below the heading).
        expect(box!.width).toBeLessThanOrEqual(400);
        await expect(panel(page)).toHaveAttribute("aria-modal", "false");
        await expect(page.locator("[data-slot='sheet-overlay']")).toHaveCount(0);
        expect(Math.round(box!.x + box!.width), "panel at the right edge").toBe(size.width);
        expect(Math.round(box!.height), "panel is full height").toBe(size.height);
        const button = (await page.getByTestId("buddy-launcher").boundingBox())!;
        expect(button.x + button.width, "button left of the panel").toBeLessThanOrEqual(box!.x);
        const heading = (await page.locator("main h1").first().boundingBox())!;
        expect(heading.x + heading.width, "page heading left of the panel").toBeLessThanOrEqual(box!.x);
      }
      await expectNoHorizontalScroll(page);
      await expectNoClippedText(page, "[role='dialog']");
      await bothSchemesClean(page, `bubble ${size.name} ${locale}`);
    });
  }
}

/**
 * S9: on a phone the closed button must sit clear of every pinned action bar (FormActions and the screens' own bars,
 * marked `data-sticky-bar`), at the top of the page and scrolled to its end. Checked at 390 px on each screen review S9
 * listed that the buddy-owner can open. The admin pages are Godseye (`_platform`), where the button is not mounted.
 */
async function barsUnderLauncher(page: Page, withFormRows = false): Promise<{ bars: number; overlaps: string[] }> {
  return page.evaluate((withFormRows) => {
    const button = document.querySelector<HTMLElement>("[data-testid='buddy-launcher']");
    if (!button) return { bars: -1, overlaps: ["no launcher"] };
    const b = button.getBoundingClientRect();
    // At the end of the page the in-flow form rows count too: the last button must scroll clear of the button.
    const selector = withFormRows ? "[data-sticky-bar], [data-slot='form-actions']" : "[data-sticky-bar]";
    const bars = Array.from(document.querySelectorAll<HTMLElement>(selector)).filter((el) => {
      const s = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return s.display !== "none" && s.visibility !== "hidden" && r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < window.innerHeight;
    });
    const overlaps = bars
      .map((el) => el.getBoundingClientRect())
      .filter((r) => !(b.bottom <= r.top || b.top >= r.bottom || b.right <= r.left || b.left >= r.right))
      .map((r) => `button ${Math.round(b.top)}-${Math.round(b.bottom)} over bar ${Math.round(r.top)}-${Math.round(r.bottom)}`);
    return { bars: bars.length, overlaps };
  }, withFormRows);
}

async function scrollAllToEnd(page: Page) {
  await page.evaluate(() => {
    window.scrollTo(0, document.documentElement.scrollHeight);
    for (const el of Array.from(document.querySelectorAll<HTMLElement>("*"))) {
      const s = getComputedStyle(el);
      if ((s.overflowY === "auto" || s.overflowY === "scroll") && el.scrollHeight > el.clientHeight) el.scrollTop = el.scrollHeight;
    }
  });
}

async function firstLotId(): Promise<string | null> {
  const api = await buddyOwnerApi();
  try {
    const lots = await api.query<{ items: { id: string; status: string }[] }>("purchase.lots.list", { limit: 20 });
    return lots.items.find((l) => l.status !== "closed" && l.status !== "cancelled")?.id ?? lots.items[0]?.id ?? null;
  } finally {
    await api.dispose();
  }
}

test.describe("S9: the closed button is clear of sticky bars at 390 px", () => {
  const SCREENS: { name: string; path: string | (() => Promise<string | null>); needsBar?: boolean; noLauncher?: boolean }[] = [
    // Company and Units keep their Save rows in the flow (sticky={false}): checked at the end of the page.
    { name: "settings company", path: "/settings?tab=company" },
    { name: "settings units", path: "/settings?tab=units" },
    { name: "settings shifts", path: "/settings?tab=shifts" },
    { name: "settings standards (cast book, thresholds)", path: "/settings?tab=standards" },
    { name: "settings modules", path: "/settings?tab=modules" },
    { name: "settings team", path: "/settings?tab=team" },
    { name: "settings support", path: "/settings?tab=support" },
    { name: "settings about", path: "/settings?tab=about" },
    { name: "settings printing", path: "/settings?tab=printing" },
    { name: "purchase new lot", path: "/purchase/new", needsBar: true },
    {
      name: "purchase lot detail",
      path: async () => {
        const id = await firstLotId();
        return id ? `/purchase/${id}` : null;
      },
    },
    // The bundle page renders in its own TenantFrame, outside `_tenant`: no button there to cover its bar.
    { name: "bundle (add to dispatch)", path: "/b/BG-000001-B001", noLauncher: true },
    { name: "die copy lift panel", path: "/dies/copies/dev-copy-14701-2/lift" },
  ];
  for (const screen of SCREENS) {
    test(screen.name, async ({ page }) => {
      const path = typeof screen.path === "string" ? screen.path : await screen.path();
      test.skip(path === null, "no seeded row for this screen");
      await openOwner(page, path!, "en", 390, 844);
      if (screen.noLauncher) {
        await expect(page.getByTestId("buddy-launcher")).toHaveCount(0);
        return;
      }
      await expect(page.getByTestId("buddy-launcher")).toBeVisible({ timeout: 20_000 });
      // The lift is measured after layout and on scroll (one frame): wait for the answer, never sleep.
      await expect.poll(async () => (await barsUnderLauncher(page)).overlaps, { timeout: 10_000 }).toEqual([]);
      const atTop = await barsUnderLauncher(page);
      if (screen.needsBar) expect(atTop.bars, `${screen.name} shows a pinned bar`).toBeGreaterThan(0);
      await scrollAllToEnd(page);
      await expect.poll(async () => (await barsUnderLauncher(page, true)).overlaps, { timeout: 10_000 }).toEqual([]);
    });
  }
});

/**
 * S5 (delta brief decision 6): from 1024 px the open panel is a full-height column at the right and the page moves left
 * by `--orrn-buddy-inset`, so no button, link or heading of the page (or of a sticky bar) is ever under it. 768 to 1023
 * px is the modal sheet. Self-contained: it connects the buddy-owner itself when run alone with `--grep`.
 */
/** Screenshots for the review, only when asked: `BUDDY_SHOTS_DIR=<dir>` (files `dock-<page>-<w>x<h>.png`). */
const SHOTS = process.env.BUDDY_SHOTS_DIR;
const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/dock-${name}.png` });
};
const DOCK_SIZES = [
  { width: 1280, height: 720 },
  { width: 1366, height: 768 },
  { width: 1440, height: 900 },
  // The first docked width; the narrowest page column (1024 - 272 sidebar - 400 panel = 352 px).
  { width: 1024, height: 768 },
] as const;

async function ensureConnected() {
  const api = await buddyOwnerApi();
  try {
    const status = await api.query<Status>("buddy.status", undefined);
    if (status.connected) return;
    const created = await api.mutate<{ token: string }>("buddy.grant.create", {});
    await setFakeToken(created.token);
  } finally {
    await api.dispose();
  }
}

const dialogBox = (page: Page) => page.getByTestId("buddy-panel").locator("xpath=ancestor::*[@role='dialog']").boundingBox();
const insetVar = (page: Page) => page.evaluate(() => document.documentElement.style.getPropertyValue("--orrn-buddy-inset"));

/**
 * Every visible button, link and heading of `main` and of the sticky bars, clipped to the viewport and to any ancestor
 * that clips its overflow (a table scroller), and which of them overlap the open panel's box.
 */
async function underPanel(page: Page): Promise<{ checked: number; under: string[] }> {
  return page.evaluate(() => {
    const dialog = document.querySelector("[data-testid='buddy-panel']")?.closest("[role='dialog']");
    if (!dialog) return { checked: -1, under: ["no panel"] };
    const p = dialog.getBoundingClientRect();
    const selector = [
      "main button",
      "main a[href]",
      "main h1",
      "main h2",
      "main h3",
      "main [role='button']",
      "[data-sticky-bar] button",
      "[data-sticky-bar] a[href]",
      "[data-slot='form-actions'] button",
      "[data-slot='pack-bar'] button",
      "[data-slot='ingest-bar'] button",
    ].join(", ");
    let checked = 0;
    const under: string[] = [];
    for (const el of new Set(document.querySelectorAll<HTMLElement>(selector))) {
      if (dialog.contains(el)) continue;
      const s = getComputedStyle(el);
      if (s.display === "none" || s.visibility === "hidden") continue;
      const r = el.getBoundingClientRect();
      if (r.width <= 1 || r.height <= 1) continue; // sr-only
      let left = Math.max(r.left, 0);
      let right = Math.min(r.right, window.innerWidth);
      let top = Math.max(r.top, 0);
      let bottom = Math.min(r.bottom, window.innerHeight);
      for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
        const as = getComputedStyle(a);
        const ar = a.getBoundingClientRect();
        if (as.overflowX !== "visible") {
          left = Math.max(left, ar.left);
          right = Math.min(right, ar.right);
        }
        if (as.overflowY !== "visible") {
          top = Math.max(top, ar.top);
          bottom = Math.min(bottom, ar.bottom);
        }
      }
      if (right - left < 1 || bottom - top < 1) continue; // off screen or scrolled out of its box
      checked++;
      if (right > p.left && left < p.right && bottom > p.top && top < p.bottom) {
        const name = (el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 40);
        under.push(`${el.tagName.toLowerCase()} "${name}" ${Math.round(left)}-${Math.round(right)} x ${Math.round(top)}-${Math.round(bottom)} under panel from ${Math.round(p.left)}`);
      }
    }
    return { checked, under };
  });
}

async function expectDocked(page: Page, width: number, height: number) {
  const dialog = panel(page);
  await expect(dialog).toHaveAttribute("aria-modal", "false");
  await expect(page.locator("[data-slot='sheet-overlay']")).toHaveCount(0);
  await expect.poll(() => insetVar(page)).toBe("400px");
  // A full-height column at the right edge (there is no top bar from 768 px: the phone header is `md:hidden`).
  await expect
    .poll(async () => {
      const b = await dialogBox(page);
      return b && { right: Math.round(b.x + b.width), top: Math.round(b.y), bottom: Math.round(b.y + b.height), width: Math.round(b.width) };
    })
    .toEqual({ right: width, top: 0, bottom: height, width: 400 });
}

/** A small die sheet of the buddy-owner's own, read into one import; returns its review path. */
async function ownCandidate(page: Page): Promise<string> {
  const stamp = Date.now().toString(36).toUpperCase().slice(-6);
  const fileName = `buddy-dock-${stamp}.csv`;
  const csv = [
    "Series,Section code,Min weight (kg/12ft),Max weight (kg/12ft),Name,Width (mm),Thickness (mm),Leg (mm),Status,Notes",
    `BD${stamp},BD${stamp}1,1.1,1.4,Dock test ${stamp},30,1.5,,active,`,
    `BD${stamp},BD${stamp}2,1.2,1.5,Dock test ${stamp},30,1.5,,active,`,
  ].join("\n");
  await openOwner(page, "/ingest", "en", 1280, 800);
  await page.locator("input[type='file']").setInputFiles({ name: fileName, mimeType: "text/csv", buffer: Buffer.from(csv) });
  await page.getByRole("button", { name: /^Add \d+ files?$/ }).click();
  const group = page.locator("[data-testid='ingest-file-group']", { hasText: fileName });
  const link = page.locator("tbody", { has: group }).locator("tr:not(:has(> td[colspan]))").first().getByRole("link").first();
  await expect(async () => {
    for (const name of ["Needs you", "Ready"]) {
      await page.getByRole("radio", { name: new RegExp(`^${name} `) }).click();
      if (await link.isVisible()) return;
    }
    throw new Error(`${fileName} is in neither Needs you nor Ready yet`);
  }).toPass({ timeout: 120_000 });
  await link.click();
  await expect(page).toHaveURL(/\/ingest\/review\//);
  await expect(page.getByTestId("decision-bar")).toBeVisible({ timeout: 30_000 });
  return new URL(page.url()).pathname;
}

async function discardCandidate(path: string) {
  const candidateId = path.split("/").pop()!;
  const api = await buddyOwnerApi();
  try {
    const detail = await api.query<{ serverSeq: number; state: string }>("ingest.candidate.get", { candidateId });
    if (detail.state !== "discarded" && detail.state !== "merged") await api.mutate("ingest.candidate.discard", { candidateId, expectSeq: detail.serverSeq });
  } catch {
    // Best effort: the import is the spec's own and harmless if it stays.
  } finally {
    await api.dispose();
  }
}

/** Shows a toast through the page's own sonner (the same module instance the Toaster listens to, by its dev URL). */
async function showToast(page: Page, text: string) {
  await page.evaluate(async (text) => {
    const url = performance
      .getEntriesByType("resource")
      .map((e) => e.name)
      .find((n) => /\/deps\/sonner\.js/.test(n));
    if (!url) throw new Error("the sonner module was not loaded by the page");
    const mod = (await import(/* @vite-ignore */ url)) as { toast: (t: string, o?: { duration?: number }) => void };
    mod.toast(text, { duration: 60_000 });
  }, text);
}

test.describe("S5: from 1024 px the panel docks beside the page and covers nothing of it", () => {
  let reviewPath: string | null = null;

  test.beforeAll(async () => {
    await ensureConnected();
  });

  test.afterAll(async () => {
    if (reviewPath) await discardCandidate(reviewPath);
  });

  const PAGES: { name: string; path: string | null; bar?: string; prepare?: (page: Page) => Promise<void> }[] = [
    { name: "today", path: "/today" },
    { name: "purchase-new", path: "/purchase/new" },
    { name: "import-review", path: null },
    // Two forms whose action bar stays pinned at the bottom on a laptop too.
    // The pack form shows its bar once a die is chosen (a local draft only; nothing is saved).
    {
      name: "pack-new",
      path: "/pack/new",
      bar: "[data-slot='pack-bar']",
      prepare: async (page) => {
        // The draft is kept in the browser, so after the first size the die is already chosen.
        const bar = page.locator("[data-slot='pack-bar']").first();
        const die = page.locator("main button[data-die]").first();
        await expect(bar.or(die).first()).toBeVisible({ timeout: 20_000 });
        if (!(await bar.isVisible())) await die.click();
      },
    },
    { name: "ageing-load", path: "/ageing/load", bar: "[data-slot='pack-bar']" },
  ];

  for (const screen of PAGES) {
    test(`${screen.name}: docked at ${DOCK_SIZES.map((s) => `${s.width}x${s.height}`).join(", ")}`, async ({ page }) => {
      test.setTimeout(240_000);
      let path = screen.path;
      if (path === null) {
        reviewPath = await ownCandidate(page);
        path = reviewPath;
      }
      for (const { width, height } of DOCK_SIZES) {
        await openOwner(page, path, "en", width, height);
        await screen.prepare?.(page);
        if (screen.bar) await expect(page.locator(screen.bar).first(), `${screen.name} shows its sticky bar`).toBeVisible({ timeout: 20_000 });
        await openBubble(page);
        await expectDocked(page, width, height);
        await expect.poll(async () => (await underPanel(page)).under, { timeout: 10_000 }).toEqual([]);
        const atTop = await underPanel(page);
        expect(atTop.checked, `${screen.name} ${width}x${height}: elements checked`).toBeGreaterThan(0);
        // The launcher and the page heading are clear of the panel too.
        const box = (await dialogBox(page))!;
        for (const el of [page.getByTestId("buddy-launcher"), page.locator("main h1").first()]) {
          const b = (await el.boundingBox())!;
          expect(b.x + b.width, `${screen.name} ${width}x${height}: left of the panel`).toBeLessThanOrEqual(box.x);
        }
        await expectNoHorizontalScroll(page);
        await shot(page, `${screen.name}-${width}x${height}`);
        await scrollAllToEnd(page);
        await expect.poll(async () => (await underPanel(page)).under, { timeout: 10_000 }).toEqual([]);
        // Closing gives the page its width back.
        await page.getByTestId("buddy-input").press("Escape");
        await expect(panel(page)).toHaveCount(0);
        await expect.poll(() => insetVar(page)).toBe("");
        await expect(page.getByTestId("buddy-launcher")).toBeFocused();
      }
    });
  }

  test("900 px: the modal sheet, the page is not moved", async ({ page }) => {
    await openOwner(page, "/today", "en", 900, 720);
    await openBubble(page);
    await expect(panel(page)).toHaveAttribute("aria-modal", "true");
    await expect(page.locator("[data-slot='sheet-overlay']")).toBeVisible();
    expect(await insetVar(page)).toBe("");
    const box = (await dialogBox(page))!;
    expect(box.width).toBeLessThanOrEqual(400);
    await shot(page, "today-modal-900x720");
    await page.keyboard.press("Escape");
    await expect(panel(page)).toHaveCount(0);
    await expect(page.getByTestId("buddy-launcher")).toBeFocused();
  });

  test("N10: the mode is read when the panel opens; a resize while open does not switch it", async ({ page }) => {
    await openOwner(page, "/today", "en", 1280, 800);
    await openBubble(page);
    await expectDocked(page, 1280, 800);
    await page.setViewportSize({ width: 900, height: 800 });
    await expect(panel(page)).toHaveAttribute("aria-modal", "false");
    await expect(page.locator("[data-slot='sheet-overlay']")).toHaveCount(0);
    await page.getByTestId("buddy-input").press("Escape");
    await expect(panel(page)).toHaveCount(0);
    // Opened again at 900 px it is the modal sheet.
    await openBubble(page);
    await expect(panel(page)).toHaveAttribute("aria-modal", "true");
  });

  test("N9: a toast never overlaps the open panel, from 768 to 1440 px", async ({ page }) => {
    for (const [width, height] of [
      [768, 1024],
      [820, 1180],
      [900, 720],
      [1023, 768],
      [1024, 768],
      [1280, 720],
      [1440, 900],
    ] as const) {
      await openOwner(page, "/today", "en", width, height);
      await openBubble(page);
      await showToast(page, `Dock toast ${width}`);
      const toast = page.locator("[data-sonner-toast]", { hasText: `Dock toast ${width}` });
      await expect(toast).toBeVisible();
      await expect
        .poll(async () => {
          const t = await toast.boundingBox();
          const p = await dialogBox(page);
          if (!t || !p) return "missing";
          const overlap = t.x + t.width > p.x && t.x < p.x + p.width && t.y + t.height > p.y && t.y < p.y + p.height;
          return overlap ? `toast ${Math.round(t.x)}-${Math.round(t.x + t.width)} over panel ${Math.round(p.x)}-${Math.round(p.x + p.width)}` : "clear";
        }, { timeout: 10_000, message: `${width}x${height}` })
        .toBe("clear");
      const t = (await toast.boundingBox())!;
      expect(t.x, `${width}: the toast stays on screen`).toBeGreaterThanOrEqual(0);
      await page.keyboard.press("Escape");
    }
  });
});

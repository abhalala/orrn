import AxeBuilder from "@axe-core/playwright";
import { expect, request, test, type Page } from "@playwright/test";

import { expectNoClippedText, expectNoHorizontalScroll } from "../helpers/layout-guards";
import { signInViaApi } from "./helpers/accounts";
import { API_URL } from "./helpers/ports";
import { ownerApi } from "./helpers/owner-api";

/**
 * orrn buddy (design 2026-11-18 §4.5, §7, §12.2, §13) against the fake Hermes (`apps/server/scripts/fake-hermes.ts`).
 * The API must run with `BUDDY_FAKE_HERMES_PORT` set (buddy on for the demo plant, fake values only) and the fake on
 * that port; without them `buddy.status.available` is false and the spec stops at its first check.
 *
 * The grant is the demo owner's, so the spec runs serially and disconnects Hermes in `afterAll` (and before it starts,
 * after a run that died half way): the floating button shows for the owner only while this file runs.
 */

/** Same rule as playwright.config.ts: the fake listens on the API port + 80. */
const API_PORT = Number(new URL(API_URL).port);
const FAKE_HERMES = `http://127.0.0.1:${Number(process.env.BUDDY_FAKE_HERMES_PORT) || API_PORT + 80}`;
const SIZES = [
  { name: "phone", width: 375, height: 812 },
  { name: "tablet", width: 820, height: 1180 },
  { name: "desktop", width: 1280, height: 800 },
] as const;

type Status = { available: boolean; listed: boolean; connected: { grantId: string } | null };

test.describe.configure({ mode: "serial" });

async function disconnect() {
  const api = await ownerApi();
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

async function openOwner(page: Page, path: string, locale: "en" | "hi" = "en", width = 1280, height = 800) {
  await page.setViewportSize({ width, height });
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  if (locale !== "en") await page.addInitScript((l) => localStorage.setItem("orrn.locale", l), locale);
  await signInViaApi(page, "owner");
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
  const api = await ownerApi();
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

for (const locale of ["en", "hi"] as const) {
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

test("the bubble is a dialog: focus goes in, Escape closes it and focus comes back to the button", async ({ page }) => {
  await openOwner(page, "/today");
  await openBubble(page);
  const dialog = panel(page);
  await expect(dialog).toHaveAttribute("aria-modal", "true");
  await expect(page.getByTestId("buddy-input")).toBeFocused();
  // Tab never leaves the dialog.
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => !!document.activeElement?.closest("[role='dialog']"))).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId("buddy-launcher")).toBeFocused();
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
  await second.getByTestId("buddy-draft-confirm").click();
  await expect(second).toHaveAttribute("data-status", "confirmed", { timeout: 20_000 });

  // The note about the decision rides on the next turn.
  await say(page, "thanks");
  await expect(page.getByTestId("buddy-turn").last()).toHaveAttribute("data-phase", "done", { timeout: 30_000 });
  const api = await request.newContext();
  try {
    const last = await (await api.get(`${FAKE_HERMES}/__fake/last`)).text();
    expect(last).toContain("confirmed");
  } finally {
    await api.dispose();
  }

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

for (const locale of ["en", "hi"] as const) {
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
      if (size.width < 768) expect(box?.width).toBe(size.width);
      else expect(box!.width).toBeLessThanOrEqual(400);
      await expectNoHorizontalScroll(page);
      await expectNoClippedText(page, "[role='dialog']");
      await bothSchemesClean(page, `bubble ${size.name} ${locale}`);
    });
  }
}

import AxeBuilder from "@axe-core/playwright";
import { expect, request, test, type APIRequestContext, type Page } from "@playwright/test";

import { expectNoClippedText, expectNoHorizontalScroll } from "../helpers/layout-guards";
import { API_URL, WEB_ORIGIN } from "./helpers/ports";

/**
 * The sign-in page's three ways in (plan 2026-11-18, Task 4; owner ruling R5: passkey, Google and email
 * + password stand level). A browser without WebAuthn shows no passkey button; a cancelled passkey sheet
 * is an inline message and the form still works; a refused Google sign-in comes back as an inline
 * message; Google's return runs the usual finish, so a person in two plants lands on the picker.
 * "Passkey sign-in end to end" (register in Settings, sign in with it) is Task 5's.
 */

const PLANT_CHOSEN_KEY = "orrn.plantChosen";

async function blockingAxe(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .exclude(".TanStackRouterDevtools")
    .exclude("[class*='tsqd-']")
    .exclude("[data-sonner-toaster]")
    .analyze();
  return results.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id);
}

async function openLogin(page: Page, path = "/login", width = 375) {
  await page.setViewportSize({ width, height: 900 });
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.goto(path);
  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible({ timeout: 20_000 });
}

/** Answers `auth.methods` as a stage with Google configured (the local stack has no Google secrets). */
async function withGoogleConfigured(page: Page) {
  await page.route("**/trpc/**", async (route) => {
    const url = new URL(route.request().url());
    const procedures = url.pathname.split("/trpc/")[1]?.split(",") ?? [];
    const index = procedures.indexOf("auth.methods");
    if (index === -1) return route.fallback();
    const response = await route.fetch();
    const body = await response.json();
    const entry = Array.isArray(body) ? body[index] : body;
    const data = entry?.result?.data;
    if (data) (data.json ?? data).google = true;
    await route.fulfill({ response, json: body });
  });
}

const tag = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

async function ok(res: Awaited<ReturnType<APIRequestContext["post"]>>, what: string) {
  expect(res.ok(), `${what} returned ${res.status()}: ${await res.text()}`).toBe(true);
  return res;
}

/** A person with accepted invites into two fresh plants (local `/dev/invite`), signed in to neither. */
async function personInTwoPlants() {
  const t = tag();
  const email = `methods-${t}@orrn.local`;
  const password = `Methods-${crypto.randomUUID().slice(0, 12)}`;
  const api = await request.newContext({ extraHTTPHeaders: { origin: WEB_ORIGIN } });
  try {
    const invite = async (companyName: string, role: "owner" | "admin") =>
      ((await (await ok(await api.post(`${API_URL}/dev/invite`, { data: { email, role, companyName } }), "/dev/invite")).json()) as { token: string })
        .token;
    const first = await invite(`Methods One ${t}`, "owner");
    await ok(await api.post(`${API_URL}/api/auth/sign-up/email`, { data: { name: "Nirav Patel", email, password, inviteToken: first } }), "sign-up");
    await ok(await api.post(`${API_URL}/api/auth/sign-in/email`, { data: { email, password } }), "sign-in");
    await ok(await api.post(`${API_URL}/trpc/invite.acceptByToken`, { data: { token: first } }), "accept the first invite");
    const second = await invite(`Methods Two ${t}`, "admin");
    await ok(await api.post(`${API_URL}/trpc/invite.acceptByToken`, { data: { token: second } }), "accept the second invite");
    return { email, password };
  } finally {
    await api.dispose();
  }
}

test.describe("sign-in methods", () => {
  test("no passkey button without PublicKeyCredential: the password form is the way in", async ({ page }) => {
    await page.addInitScript(() => {
      delete (window as { PublicKeyCredential?: unknown }).PublicKeyCredential;
    });
    await openLogin(page);
    expect(await page.evaluate(() => typeof (window as { PublicKeyCredential?: unknown }).PublicKeyCredential)).toBe("undefined");

    await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
    await expect(page.getByTestId("sign-in-passkey")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Sign in with a passkey" })).toHaveCount(0);
    await expectNoHorizontalScroll(page);
    expect(await blockingAxe(page)).toEqual([]);
  });

  test("cancelled passkey shows an inline message; the form still works and nothing pops up", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    // A virtual authenticator with no passkeys on it: the browser's request ends NotAllowedError, as
    // when a person closes the Face ID / Touch ID sheet.
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("WebAuthn.enable");
    await cdp.send("WebAuthn.addVirtualAuthenticator", {
      options: {
        protocol: "ctap2",
        transport: "internal",
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true,
      },
    });
    await openLogin(page);
    // Saved passkeys are offered from the email field's autofill.
    await expect(page.getByLabel("Email", { exact: true })).toHaveAttribute("autocomplete", "username webauthn");

    const passkey = page.getByRole("button", { name: "Sign in with a passkey" });
    await expect(passkey).toBeVisible();
    await passkey.click();

    const alert = page.getByRole("alert");
    await expect(alert).toHaveText("Passkey sign-in was cancelled. Try again, or sign in another way.");
    await expect(page.locator("[data-sonner-toast]")).toHaveCount(0);
    await expect(page).toHaveURL(/\/login$/);
    // The browser's own refusal, not an origin or relying party mismatch that reads the same in the UI.
    expect(consoleErrors.some((text) => text.includes("NotAllowedError"))).toBe(true);
    expect(consoleErrors.some((text) => text.includes("SecurityError"))).toBe(false);

    // The form is still usable: a wrong password gets the password message and the passkey one goes.
    await page.getByLabel("Email", { exact: true }).fill(`nobody-${tag()}@orrn.local`);
    await page.getByLabel("Password", { exact: true }).fill("not-the-password");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByRole("alert")).toHaveText("Email or password is wrong. Check both and try again.");
    await expect(page.getByTestId("alt-sign-in-error")).toHaveCount(0);
    await expect(passkey).toBeEnabled();
    expect(await blockingAxe(page)).toEqual([]);
  });

  test("google error from the callback shows inline, and the address text itself is never shown", async ({ page }) => {
    await openLogin(page, "/login?error=GOOGLE_NOT_INVITED");
    await expect(page.getByRole("alert")).toHaveText(
      "This Google account has no orrn invite. Ask your admin to invite this email, or sign in another way.",
    );
    // Above the form, where a 375 px phone shows it without scrolling.
    const alertBox = await page.getByRole("alert").boundingBox();
    const emailBox = await page.getByLabel("Email", { exact: true }).boundingBox();
    expect(alertBox!.y).toBeLessThan(emailBox!.y);
    expect(alertBox!.y + alertBox!.height).toBeLessThan(667);
    await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeEnabled();
    await expectNoClippedText(page, "main#main");
    expect(await blockingAxe(page)).toEqual([]);

    await openLogin(page, "/login?error=GOOGLE_EMAIL_NOT_VERIFIED");
    await expect(page.getByRole("alert")).toHaveText("Google hasn't verified this email address. Sign in another way.");

    await openLogin(page, "/login?error=GOOGLE_NOT_FOR_STAFF");
    await expect(page.getByRole("alert")).toHaveText(
      "Godseye staff accounts can't use Google. Sign in with a passkey, or with your password and code.",
    );

    // Better Auth's own codes (and anything else) read as the generic message, never the code.
    await openLogin(page, "/login?error=access_denied&error_description=Injected%20text");
    await expect(page.getByRole("alert")).toHaveText("Sign-in didn't finish. Try again, or sign in another way.");
    await expect(page.getByText("access_denied")).toHaveCount(0);
    await expect(page.getByText("Injected text")).toHaveCount(0);

    // A callback that lost its OAuth state comes back as ?state=state_not_found, not ?error=.
    await openLogin(page, "/login?state=state_not_found");
    await expect(page.getByRole("alert")).toHaveText("Sign-in didn't finish. Try again, or sign in another way.");
  });

  test("Continue with Google forgets this tab's plant pick and sends the sign-in page as the way back", async ({ page }) => {
    await withGoogleConfigured(page);
    const sent: Record<string, unknown>[] = [];
    // Google itself is not reachable from a test: answer the start as a refusal would come back.
    // The API is another origin, so the stand-in answer carries the CORS headers the real one would.
    const cors = {
      "access-control-allow-origin": WEB_ORIGIN,
      "access-control-allow-credentials": "true",
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "content-type",
    };
    await page.route("**/api/auth/sign-in/social", async (route) => {
      if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
      sent.push(route.request().postDataJSON() as Record<string, unknown>);
      await route.fulfill({
        headers: cors,
        json: { url: `${WEB_ORIGIN}/login?next=%2Fstock&error=GOOGLE_NOT_INVITED`, redirect: true },
      });
    });
    await openLogin(page, "/login?next=/stock");
    await page.evaluate((key) => sessionStorage.setItem(key, "1"), PLANT_CHOSEN_KEY);

    const google = page.getByRole("button", { name: "Continue with Google" });
    await expect(google).toBeVisible();
    await google.click();

    await expect(page.getByRole("alert")).toHaveText(
      "This Google account has no orrn invite. Ask your admin to invite this email, or sign in another way.",
    );
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      provider: "google",
      callbackURL: `${WEB_ORIGIN}/login?via=google&next=%2Fstock`,
      errorCallbackURL: `${WEB_ORIGIN}/login?next=%2Fstock`,
    });
    expect(await page.evaluate((key) => sessionStorage.getItem(key), PLANT_CHOSEN_KEY)).toBeNull();
    await expectNoHorizontalScroll(page);
    expect(await blockingAxe(page)).toEqual([]);
  });

  test("Google's way back runs the usual finish: a person in two plants lands on the picker with next kept", async ({ page }) => {
    const who = await personInTwoPlants();
    await page.setViewportSize({ width: 1280, height: 900 });
    await openLogin(page, "/login", 1280);
    await page.getByLabel("Email", { exact: true }).fill(who.email);
    await page.getByLabel("Password", { exact: true }).fill(who.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/choose-plant$/);
    await page.getByTestId("choose-plant-item").first().click();
    await expect(page).not.toHaveURL(/\/choose-plant/);
    expect(await page.evaluate((key) => sessionStorage.getItem(key), PLANT_CHOSEN_KEY)).toBe("1");

    // The session cookie stands in for the one Google's callback sets; the page is what Google returns to.
    await page.goto("/login?via=google&next=/stock");
    await expect(page).toHaveURL(/\/choose-plant\?next=%2Fstock$/);
    await expect(page.getByRole("heading", { level: 1, name: "Choose a plant" })).toBeVisible();
  });
});

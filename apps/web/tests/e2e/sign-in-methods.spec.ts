import { mkdirSync } from "node:fs";
import { join } from "node:path";

import AxeBuilder from "@axe-core/playwright";
import { expect, request, test, type APIRequestContext, type Page } from "@playwright/test";

import { expectNoClippedText, expectNoHorizontalScroll } from "../helpers/layout-guards";
import { API_URL, WEB_ORIGIN } from "./helpers/ports";
import { totp } from "./helpers/totp";

/**
 * The sign-in page's three ways in (plan 2026-11-18, Task 4; owner ruling R5: passkey, Google and email
 * + password stand level). A browser without WebAuthn shows no passkey button; a cancelled passkey sheet
 * is an inline message and the form still works; a refused Google sign-in comes back as an inline
 * message; Google's return runs the usual finish, so a person in two plants lands on the picker.
 * Task 5: passkey sign-in end to end (register in Settings > Sign-in, sign out, sign in with it, no code
 * asked), and a member of a plant that requires secure sign-in adding a passkey on "Secure your sign-in".
 * Both use a CDP virtual authenticator (one per page: the passkey lives on that page's session).
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

/** A platform authenticator that holds passkeys and says yes at once (Touch ID with a finger on it). */
async function virtualAuthenticator(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  return {
    credentials: async () => (await cdp.send("WebAuthn.getCredentials", { authenticatorId })).credentials,
  };
}

/** The owner of one fresh plant, set up, with the authenticator app on (so a code would be asked) unless told not to. */
async function ownerWithAuthenticator({ authenticator = true }: { authenticator?: boolean } = {}) {
  const t = tag();
  const email = `passkey-${t}@orrn.local`;
  const password = `Passkey-${crypto.randomUUID().slice(0, 12)}`;
  const companyName = `Passkey Works ${t}`;
  const api = await request.newContext({ extraHTTPHeaders: { origin: WEB_ORIGIN } });
  try {
    const { token } = (await (await ok(await api.post(`${API_URL}/dev/invite`, { data: { email, role: "owner", companyName } }), "/dev/invite")).json()) as {
      token: string;
    };
    await ok(await api.post(`${API_URL}/api/auth/sign-up/email`, { data: { name: "Kiran Shah", email, password, inviteToken: token } }), "sign-up");
    await ok(await api.post(`${API_URL}/api/auth/sign-in/email`, { data: { email, password } }), "sign-in");
    await ok(await api.post(`${API_URL}/trpc/invite.acceptByToken`, { data: { token } }), "accept the invite");
    await ok(
      await api.post(`${API_URL}/trpc/auth.completeOnboarding`, {
        data: { facilityLocation: "Testpur", primaryContact: "+91 90000 00000", timezone: "Asia/Kolkata", pressCount: 1 },
      }),
      "auth.completeOnboarding",
    );
    if (!authenticator) return { email, password, secret: "", companyName };
    const enabled = (await (await ok(await api.post(`${API_URL}/api/auth/two-factor/enable`, { data: { password } }), "two-factor enable")).json()) as {
      totpURI: string;
    };
    const secret = new URL(enabled.totpURI).searchParams.get("secret")!;
    await ok(await api.post(`${API_URL}/api/auth/two-factor/verify-totp`, { data: { code: totp(secret) } }), "two-factor verify");
    return { email, password, secret, companyName };
  } finally {
    await api.dispose();
  }
}

/** A packer in a plant that requires secure sign-in, with only a password (owner and member made over the API). */
async function strictPlantMember() {
  const t = tag();
  const ownerEmail = `strict-owner-${t}@orrn.local`;
  const memberEmail = `strict-member-${t}@orrn.local`;
  const password = `Strict-${crypto.randomUUID().slice(0, 12)}`;
  const companyName = `Strict Plant ${t}`;
  const owner = await request.newContext({ extraHTTPHeaders: { origin: WEB_ORIGIN } });
  const member = await request.newContext({ extraHTTPHeaders: { origin: WEB_ORIGIN } });
  try {
    const first = (await (await ok(await owner.post(`${API_URL}/dev/invite`, { data: { email: ownerEmail, role: "owner", companyName } }), "/dev/invite")).json()) as {
      token: string;
      companyId: string;
    };
    await ok(await owner.post(`${API_URL}/api/auth/sign-up/email`, { data: { name: "Mehul Joshi", email: ownerEmail, password, inviteToken: first.token } }), "owner sign-up");
    await ok(await owner.post(`${API_URL}/api/auth/sign-in/email`, { data: { email: ownerEmail, password } }), "owner sign-in");
    await ok(await owner.post(`${API_URL}/trpc/invite.acceptByToken`, { data: { token: first.token } }), "owner accepts");
    await ok(await owner.post(`${API_URL}/trpc/company.updateSettings`, { data: { requireStrongSignIn: true } }), "require secure sign-in");
    const second = (await (
      await ok(await member.post(`${API_URL}/dev/invite`, { data: { email: memberEmail, role: "packer", companyId: first.companyId } }), "/dev/invite member")
    ).json()) as { token: string };
    await ok(await member.post(`${API_URL}/api/auth/sign-up/email`, { data: { name: "Asha Rana", email: memberEmail, password, inviteToken: second.token } }), "member sign-up");
    await ok(await member.post(`${API_URL}/api/auth/sign-in/email`, { data: { email: memberEmail, password } }), "member sign-in");
    await ok(await member.post(`${API_URL}/trpc/invite.acceptByToken`, { data: { token: second.token } }), "member accepts");
    return { memberEmail, password, companyName };
  } finally {
    await owner.dispose();
    await member.dispose();
  }
}

/** A full-page picture for the visual check when SIGN_IN_SHOTS names a folder; nothing otherwise. */
async function shot(page: Page, name: string) {
  const dir = process.env.SIGN_IN_SHOTS;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: join(dir, `${name}.png`), fullPage: true });
}

/** Each width, in English then Hindi: no sideways scroll, no clipped text, no serious axe issue. */
async function checkWidths(page: Page, name: string, ready: () => Promise<void>) {
  for (const locale of ["en", "hi"] as const) {
    await page.evaluate((l) => localStorage.setItem("orrn.locale", l), locale);
    for (const width of [375, 820, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await page.reload();
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      await ready();
      await expectNoHorizontalScroll(page);
      await expectNoClippedText(page, "main#main");
      expect(await blockingAxe(page), `${name} ${locale} ${width}`).toEqual([]);
      await shot(page, `${name}-${locale}-${width}`);
    }
  }
  await page.evaluate(() => localStorage.setItem("orrn.locale", "en"));
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await ready();
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

  test("passkey sign-in end to end: add one in Settings > Sign-in, sign out, sign in with it, Today with no code asked", async ({ page }) => {
    test.slow();
    const who = await ownerWithAuthenticator();
    const authenticator = await virtualAuthenticator(page);
    // The virtual authenticator answers at once, so the email field's autofill request (conditional
    // mediation) would sign in by itself before the button is pressed. Off until the test turns it on.
    await page.addInitScript(() => {
      if (localStorage.getItem("e2e.autofill") === "on") return;
      const ctor = (window as { PublicKeyCredential?: { isConditionalMediationAvailable?: () => Promise<boolean> } }).PublicKeyCredential;
      if (ctor) Object.defineProperty(ctor, "isConditionalMediationAvailable", { value: async () => false, configurable: true });
    });
    await page.setViewportSize({ width: 375, height: 900 });
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });

    // In with the password and the code, as today.
    await page.goto("/login");
    await page.getByLabel("Email", { exact: true }).fill(who.email);
    await page.getByLabel("Password", { exact: true }).fill(who.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Enter your code" })).toBeVisible();
    await page.getByLabel("6-digit code").fill(totp(who.secret));
    await expect(page).toHaveURL(/\/today$/);

    await page.goto("/settings?tab=sign-in");
    const tab = page.getByTestId("settings-sign-in");
    await expect(tab.getByRole("heading", { level: 2, name: "Your sign-in" })).toBeVisible();
    const passkeys = page.getByTestId("sign-in-passkeys");
    await expect(passkeys.getByText("No passkeys yet.")).toBeVisible();
    await expect(page.getByTestId("sign-in-authenticator").getByText("On", { exact: true })).toBeVisible();
    await expect(page.getByTestId("sign-in-password").getByText("Set", { exact: true })).toBeVisible();
    await expectNoHorizontalScroll(page);
    expect(await blockingAxe(page)).toEqual([]);

    await passkeys.getByRole("button", { name: "Add a passkey" }).click();
    await expect(passkeys.getByTestId("passkey-row")).toHaveCount(1);
    await expect(passkeys.getByTestId("passkey-row")).toContainText(/Added /);
    await expect(passkeys.getByText("Last used")).toHaveCount(0);
    expect(await authenticator.credentials()).toHaveLength(1);
    // A password is still a way in, and no plant requires secure sign-in: the passkey can be removed.
    await expect(passkeys.getByRole("button", { name: /^Remove/ })).toBeEnabled();
    await expect(page.getByTestId("method-error")).toHaveCount(0);
    expect(await blockingAxe(page)).toEqual([]);

    // Rename it.
    await passkeys.getByRole("button", { name: /^Rename/ }).click();
    const rename = page.getByRole("dialog", { name: "Rename passkey" });
    await rename.getByLabel("Name").fill("Office laptop");
    await rename.getByRole("button", { name: "Save" }).click();
    await expect(rename).toHaveCount(0);
    await expect(passkeys.getByTestId("passkey-row")).toContainText("Office laptop");

    // Sign out.
    await page.getByRole("button", { name: "Account and more" }).click();
    await page.getByRole("dialog", { name: "More" }).getByRole("button", { name: "Sign out" }).click();
    await expect(page).not.toHaveURL(/\/settings/);

    // In with the passkey button: no code, straight to Today.
    await page.goto("/login");
    await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: "Sign in with a passkey" }).click();
    await expect(page).toHaveURL(/\/today$/);
    await expect(page.getByRole("heading", { level: 1, name: "Enter your code" })).toHaveCount(0);

    // And from the email field's autofill: the saved passkey signs in on its own, again with no code.
    await page.getByRole("button", { name: "Account and more" }).click();
    await page.getByRole("dialog", { name: "More" }).getByRole("button", { name: "Sign out" }).click();
    await expect(page).not.toHaveURL(/\/today/);
    await page.evaluate(() => localStorage.setItem("e2e.autofill", "on"));
    await page.goto("/login");
    await expect(page).toHaveURL(/\/today$/, { timeout: 20_000 });
    await expect(page.getByRole("heading", { level: 1, name: "Enter your code" })).toHaveCount(0);
  });

  test("a plant that requires secure sign-in: a member with only a password adds a passkey on Secure your sign-in and gets in", async ({ page }) => {
    test.slow();
    const { memberEmail, password, companyName } = await strictPlantMember();
    const authenticator = await virtualAuthenticator(page);
    await page.setViewportSize({ width: 820, height: 1000 });
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    await page.goto("/login");
    await page.getByLabel("Email", { exact: true }).fill(memberEmail);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/welcome$/);

    // Leaving for Today does not skip it.
    await page.goto("/today");
    await expect(page).toHaveURL(/\/welcome$/);
    await expect(page.getByRole("heading", { level: 1, name: "Secure your sign-in" })).toBeVisible();
    await expect(page.getByTestId("secure-sign-in-lead")).toContainText(companyName);
    // A passkey first, the authenticator app second.
    const choices = page.getByTestId("secure-sign-in-choices").getByRole("button");
    await expect(choices.nth(0)).toHaveText("Add a passkey");
    await expect(choices.nth(1)).toHaveText("Use an authenticator app");
    await expectNoHorizontalScroll(page);
    expect(await blockingAxe(page)).toEqual([]);

    await page.getByRole("button", { name: "Add a passkey" }).click();
    // The passkey satisfies the plant: on to the closing screen, which offers no second passkey.
    await expect(page.getByRole("heading", { level: 1, name: "You're set up" })).toBeVisible();
    await expect(page.getByTestId("done-passkey-offer")).toHaveCount(0);
    expect(await authenticator.credentials()).toHaveLength(1);
    await page.getByRole("button", { name: "Go to Today" }).click();
    await expect(page).toHaveURL(/\/today$/);
  });

  test("Secure your sign-in and Settings > Sign-in fit at 375, 820 and 1280 in English and Hindi; the plant's rule shows beside Remove", async ({ page }) => {
    test.slow();
    const { memberEmail, password } = await strictPlantMember();
    await virtualAuthenticator(page);
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    const res = await page.context().request.post(`${API_URL}/api/auth/sign-in/email`, { headers: { origin: WEB_ORIGIN }, data: { email: memberEmail, password } });
    expect(res.ok()).toBe(true);
    await page.goto("/welcome");
    await checkWidths(page, "secure-sign-in", async () => {
      await expect(page.getByTestId("secure-sign-in-choices")).toBeVisible();
    });

    await page.getByTestId("secure-passkey").click();
    await expect(page.getByRole("heading", { level: 1, name: "You're set up" })).toBeVisible();
    await page.getByRole("button", { name: "Go to Today" }).click();
    await expect(page).toHaveURL(/\/today$/);

    await page.goto("/settings?tab=sign-in");
    const passkeys = page.getByTestId("sign-in-passkeys");
    await expect(passkeys.getByTestId("passkey-row")).toHaveCount(1);
    // The plant requires secure sign-in and this is the only strong method: Remove waits, with the reason.
    await expect(passkeys.getByRole("button", { name: /^Remove/ })).toBeDisabled();
    await expect(page.getByTestId("passkey-remove-reason")).toHaveText(
      "A plant you belong to requires secure sign-in. Keep a passkey, Google or the authenticator app, or add another one first.",
    );
    await checkWidths(page, "settings-sign-in", async () => {
      await expect(page.getByTestId("passkey-row")).toHaveCount(1);
    });
  });

  test("the closing screen offers an optional passkey under Go to Today; skipping it is fine, adding it says so", async ({ page }) => {
    test.slow();
    const t = tag();
    const email = `joined-${t}@orrn.local`;
    const password = `Joined-${crypto.randomUUID().slice(0, 12)}`;
    const companyName = `Joined Plant ${t}`;
    const api = page.context().request;
    const { token } = (await (
      await ok(await api.post(`${API_URL}/dev/invite`, { headers: { origin: WEB_ORIGIN }, data: { email, role: "packer", companyName } }), "/dev/invite")
    ).json()) as { token: string };
    await ok(await api.post(`${API_URL}/api/auth/sign-up/email`, { headers: { origin: WEB_ORIGIN }, data: { name: "Vipul Mehta", email, password, inviteToken: token } }), "sign-up");
    await ok(await api.post(`${API_URL}/api/auth/sign-in/email`, { headers: { origin: WEB_ORIGIN }, data: { email, password } }), "sign-in");
    await ok(await api.post(`${API_URL}/trpc/invite.acceptByToken`, { headers: { origin: WEB_ORIGIN }, data: { token } }), "accept");

    const authenticator = await virtualAuthenticator(page);
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    await page.goto("/welcome");
    const offer = page.getByTestId("done-passkey-offer");
    await checkWidths(page, "done-offer", async () => {
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(offer).toBeVisible();
    });
    await expect(page.getByRole("heading", { level: 1, name: `Welcome to ${companyName}` })).toBeVisible();
    // The way in comes first; the offer sits under it.
    const go = await page.getByRole("button", { name: "Go to Today" }).boundingBox();
    const card = await offer.boundingBox();
    expect(card!.y).toBeGreaterThan(go!.y);

    await offer.getByRole("button", { name: "Add a passkey" }).click();
    await expect(offer.getByRole("status")).toHaveText("Passkey added. Next time, sign in with it.");
    expect(await authenticator.credentials()).toHaveLength(1);
    await page.getByRole("button", { name: "Go to Today" }).click();
    await expect(page).toHaveURL(/\/today$/);
  });

  test("Settings > Sign-in: the authenticator app on (codes survive a refetch) and off, and a passkey removed", async ({ page }) => {
    test.slow();
    const who = await ownerWithAuthenticator({ authenticator: false });
    await virtualAuthenticator(page);
    await page.setViewportSize({ width: 820, height: 1000 });
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    const res = await page.context().request.post(`${API_URL}/api/auth/sign-in/email`, { headers: { origin: WEB_ORIGIN }, data: { email: who.email, password: who.password } });
    expect(res.ok()).toBe(true);
    await page.goto("/settings?tab=sign-in");
    const card = page.getByTestId("sign-in-authenticator");
    await expect(card.getByText("Off", { exact: true })).toBeVisible();

    // On: the welcome flow inline, under its own h3.
    await card.getByRole("button", { name: "Turn on" }).click();
    await expect(card.getByRole("heading", { level: 3, name: "Turn on two-factor" })).toBeVisible();
    await card.getByLabel("Your password", { exact: true }).fill(who.password);
    await card.getByRole("button", { name: "Show QR code" }).click();
    const key = card.locator("[data-slot='totp-key']");
    await expect(key).toBeVisible();
    const secret = (await key.innerText()).replace(/\s/g, "");
    await card.getByLabel("6-digit code").fill(totp(secret));
    const codes = card.getByRole("list", { name: "Backup codes" });
    await expect(codes).toBeVisible();
    // The server says "on" now; a refetch (coming back to the tab) must not take the codes away.
    const refetched = page.waitForResponse((r) => r.url().includes("auth.signInMethods"));
    // React Query refetches on "visibilitychange" (its focus manager listens on window).
    await page.evaluate(() => window.dispatchEvent(new Event("visibilitychange")));
    await refetched;
    await expect(codes).toBeVisible();
    await expect(codes.getByRole("listitem").first()).toBeVisible();
    await card.getByRole("button", { name: "I saved them, continue" }).click();
    await expect(card.getByText("On", { exact: true })).toBeVisible();
    expect(await blockingAxe(page)).toEqual([]);

    // Off: a wrong password is said by the field; the right one turns it off.
    await card.getByRole("button", { name: "Turn off" }).click();
    const off = page.getByRole("dialog", { name: "Authenticator app" });
    await off.getByLabel("Your password", { exact: true }).fill(`${who.password}-typo`);
    await off.getByRole("button", { name: "Turn off" }).click();
    await expect(off.getByText("That password is wrong. Type the password you sign in with.")).toBeVisible();
    await off.getByLabel("Your password", { exact: true }).fill(who.password);
    await off.getByRole("button", { name: "Turn off" }).click();
    await expect(off).toHaveCount(0);
    await expect(card.getByText("Off", { exact: true })).toBeVisible();

    // A passkey added, then removed through its dialog (a password stays, no plant policy).
    const passkeys = page.getByTestId("sign-in-passkeys");
    await passkeys.getByRole("button", { name: "Add a passkey" }).click();
    await expect(passkeys.getByTestId("passkey-row")).toHaveCount(1);
    await passkeys.getByRole("button", { name: /^Remove/ }).click();
    const remove = page.getByRole("dialog", { name: "Remove this passkey?" });
    await expect(remove).toBeVisible();
    expect(await blockingAxe(page)).toEqual([]);
    await remove.getByRole("button", { name: "Remove" }).click();
    await expect(remove).toHaveCount(0);
    await expect(passkeys.getByText("No passkeys yet.")).toBeVisible();
  });
});

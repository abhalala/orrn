import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";

import { expectNoHorizontalScroll } from "../helpers/layout-guards";
import { localPassword, signInViaApi, signInViaForm } from "./helpers/accounts";
import { API_URL as API, WEB_ORIGIN as ORIGIN } from "./helpers/ports";

/**
 * Front door (plan Task 17): sign in, request access, invite, welcome,
 * no-access. Needs the local stack and the seeded accounts.
 */

function unique(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}@orrn.local`;
}

/** A platform staff login with a temporary password (`mustChangePassword`), made by the seeded super admin. */
async function createTempPasswordStaff(browser: Browser) {
  const email = unique("temp");
  const password = `Temp-${crypto.randomUUID().slice(0, 12)}`;
  const ctx = await browser.newContext();
  try {
    const signIn = await ctx.request.post(`${API}/api/auth/sign-in/email`, {
      headers: { origin: ORIGIN },
      data: { email: "staff@orrn.local", password: localPassword() },
    });
    expect(signIn.ok(), `staff sign-in returned ${signIn.status()}`).toBe(true);
    const res = await ctx.request.post(`${API}/trpc/platform.staffCreate`, {
      headers: { origin: ORIGIN },
      data: { name: "Hetal Desai", email, password, role: "support" },
    });
    expect(res.ok(), `staffCreate returned ${res.status()}: ${await res.text()}`).toBe(true);
  } finally {
    await ctx.close();
  }
  return { email, password };
}

async function expectNoSeriousAxe(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .exclude(".TanStackRouterDevtools")
    .exclude("[class*='tsqd-']")
    .analyze();
  const blocking = results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => ({ id: v.id, help: v.help, targets: v.nodes.slice(0, 5).map((n) => n.target.join(" ")) }));
  expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
}

test.beforeEach(async ({ page }) => {
  // Final colours for axe and stable layout: no entrance motion.
  await page.emulateMedia({ reducedMotion: "reduce" });
});

test.describe("sign in", () => {
  test("a wrong password shows an inline error and stays on the form", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email", { exact: true }).fill("owner@orrn.local");
    await page.getByLabel("Password", { exact: true }).fill("definitely-not-it");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByRole("alert")).toHaveText("Email or password is wrong. Check both and try again.");
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByLabel("Email", { exact: true })).toHaveAttribute("aria-invalid", "true");
  });

  test("empty fields say what to fill in, without calling the server", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByText("Enter your email.")).toBeVisible();
    await expect(page.getByText("Enter your password.")).toBeVisible();
    await expect(page.getByLabel("Email", { exact: true })).toBeFocused();
  });

  test("next is honoured after signing in", async ({ page }) => {
    await page.goto("/login?next=%2Fdispatch");
    await signInViaForm(page, "owner");
    await expect(page).toHaveURL(/\/dispatch$/);
  });

  test("the password can be shown and hidden", async ({ page }) => {
    await page.goto("/login");
    const field = page.getByLabel("Password", { exact: true });
    await field.fill("secret-words");
    await expect(field).toHaveAttribute("type", "password");
    await page.getByRole("button", { name: "Show password" }).click();
    await expect(field).toHaveAttribute("type", "text");
    await page.getByRole("button", { name: "Hide password" }).click();
    await expect(field).toHaveAttribute("type", "password");
  });

  test("one tap switches the screen to Hindi", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("radio", { name: "हिंदी" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("साइन इन करें");
    await expect(page.locator("html")).toHaveAttribute("lang", "hi");
    await page.getByRole("radio", { name: "English" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Sign in");
  });

  test("errors already on screen follow a language switch", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByText("Enter your email.")).toBeVisible();
    await page.getByRole("radio", { name: "हिंदी" }).click();
    await expect(page.getByText("अपना ईमेल डालें।")).toBeVisible();
    await expect(page.getByText("अपना पासवर्ड डालें।")).toBeVisible();
    await expect(page.getByText("Enter your email.")).toHaveCount(0);
    await page.getByRole("radio", { name: "English" }).click();

    await page.goto("/request-access");
    await page.getByRole("button", { name: "Send request" }).click();
    await expect(page.getByText("Enter your company's name.")).toBeVisible();
    await page.getByRole("radio", { name: "हिंदी" }).click();
    await expect(page.getByText("अपनी कंपनी का नाम डालें।")).toBeVisible();
    await page.getByRole("radio", { name: "English" }).click();
  });

  test("laptop shows the brand panel, phone the colour strip, neither scrolls sideways", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/login");
    await expect(page.getByRole("complementary", { name: "How orrn works" })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await page.setViewportSize({ width: 375, height: 812 });
    await expect(page.getByRole("complementary", { name: "How orrn works" })).toBeHidden();
    await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeInViewport();
    await expectNoHorizontalScroll(page);
  });
});

test.describe("request access", () => {
  test("missing fields are flagged inline, then the request is sent", async ({ page }) => {
    await page.goto("/request-access?mode=demo");
    await page.getByRole("button", { name: "Send request" }).click();
    await expect(page.getByText("Enter your company's name.")).toBeVisible();
    await expect(page.getByText("Enter your name.")).toBeVisible();
    await expect(page.getByLabel("Company name")).toBeFocused();

    const email = unique("lead");
    await page.getByLabel("Company name").fill("Shree Ganesh Extrusions");
    await page.getByLabel("Your name").fill("Mehul Vaghasiya");
    await page.getByLabel("Work email").fill(email);
    await page.getByLabel("Extrusion lines").fill("3");
    await page.getByLabel("Anything else we should know").fill("Two presses on day shift.");
    await page.getByRole("button", { name: "Send request" }).click();

    await expect(page.getByRole("heading", { level: 1, name: "Request sent" })).toBeVisible();
    await expect(page.getByText(`We'll reply to ${email}.`)).toBeVisible();
    await expect(page.getByRole("link", { name: "Back to home" })).toBeVisible();
  });
});

test.describe("invite", () => {
  test("an email that already has an account switches to sign-in, and a bad link says so", async ({ page }) => {
    await page.goto("/invite/not-a-real-token");
    await expect(page.getByRole("heading", { level: 1, name: "Join your team on orrn" })).toBeVisible();
    await page.getByLabel("Your name").fill("Local Owner");
    await page.getByLabel("Email", { exact: true }).fill("owner@orrn.local");
    await page.getByLabel("Password", { exact: true }).fill(localPassword());
    await page.getByRole("button", { name: "Create account and join" }).click();

    await expect(page.getByText("This email already has an account. Sign in to join.")).toBeVisible();
    await expect(page.getByLabel("Email", { exact: true })).toHaveValue("owner@orrn.local");
    await page.getByLabel("Password", { exact: true }).fill(localPassword());
    await page.getByRole("button", { name: "Sign in and join" }).click();

    await expect(page.getByRole("heading", { level: 1, name: "This invite link doesn't work" })).toBeVisible();
    await page.getByRole("link", { name: "Go to sign in" }).click();
    await expect(page).toHaveURL(/\/login$/);
  });

  test("a signed-in visitor can join with the current account", async ({ page }) => {
    await signInViaApi(page, "owner");
    await page.goto("/invite/not-a-real-token");
    await expect(page.getByText("You're signed in as owner@orrn.local.")).toBeVisible();
    await page.getByRole("button", { name: "Join with this account" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "This invite link doesn't work" })).toBeVisible();
  });
});

test.describe("welcome", () => {
  test("a temp-password account sees only the password step, then goes home", async ({ page, browser }) => {
    const { email, password } = await createTempPasswordStaff(browser);

    await page.goto("/login");
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/welcome$/);

    await expect(page.getByRole("heading", { level: 1, name: "Set your password" })).toBeVisible();
    const stepper = page.locator("[data-slot='stepper']");
    await expect(stepper.getByRole("listitem")).toHaveCount(2);
    await expect(stepper).toContainText("Password");
    await expect(stepper).not.toContainText("Two-factor");
    await expect(stepper).not.toContainText("Company details");

    // Old change-password links land on the same step.
    await page.goto("/change-password");
    await expect(page).toHaveURL(/\/welcome$/);
    await expect(page.getByRole("heading", { level: 1, name: "Set your password" })).toBeVisible();

    await page.getByLabel("New password", { exact: true }).fill("short");
    await page.getByRole("button", { name: "Save password" }).click();
    await expect(page.getByText("Use at least 8 characters.")).toBeVisible();

    const next = `Mine-${crypto.randomUUID().slice(0, 12)}`;
    await page.getByLabel("New password", { exact: true }).fill(next);
    await page.getByLabel("Type it again", { exact: true }).fill(`${next}x`);
    await page.getByRole("button", { name: "Save password" }).click();
    await expect(page.getByText("The two passwords don't match.")).toBeVisible();

    await page.getByLabel("Type it again", { exact: true }).fill(next);
    await page.getByRole("button", { name: "Save password" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "You're set up" })).toBeVisible();
    await expectNoSeriousAxe(page);
    await page.getByRole("button", { name: "Open Godseye" }).click();
    await expect(page).toHaveURL(/\/admin$/);
  });
});

test.describe("no access", () => {
  test("an account in no company sees its email and can switch accounts", async ({ page }) => {
    const email = unique("nobody");
    const res = await page.context().request.post(`${API}/api/auth/sign-up/email`, {
      headers: { origin: ORIGIN },
      data: { name: "Kiran Shah", email, password: `Kiran-${crypto.randomUUID().slice(0, 12)}` },
    });
    expect(res.ok(), `sign-up returned ${res.status()}`).toBe(true);

    await page.goto("/today");
    await expect(page).toHaveURL(/\/no-access$/);
    await expect(page.getByRole("heading", { level: 1, name: "Your account isn't in a company yet" })).toBeVisible();
    await expect(page.getByText(email)).toBeVisible();
    await expectNoSeriousAxe(page);
    await page.getByRole("button", { name: "Sign out and use another account" }).click();
    await expect(page).toHaveURL(/\/login$/);
  });

  test("a member opening /no-access goes home", async ({ page }) => {
    await signInViaApi(page, "owner");
    await page.goto("/no-access");
    await expect(page).toHaveURL(/\/today$/);
  });
});

test.describe("accessibility", () => {
  for (const scheme of ["light", "dark"] as const) {
    for (const width of [390, 1280]) {
      test(`login, request access and invite have no serious axe issues at ${width} ${scheme}`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
        await page.setViewportSize({ width, height: 844 });
        for (const path of ["/login", "/request-access", "/invite/not-a-real-token"]) {
          await page.goto(path);
          await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
          await expect(page.locator("html")).toHaveClass(new RegExp(`\\b${scheme}\\b`));
          await expectNoSeriousAxe(page);
          await expectNoHorizontalScroll(page);
        }
      });
    }
  }
});

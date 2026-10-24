import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";

import { expectNoHorizontalScroll } from "../helpers/layout-guards";
import { localPassword, signInViaApi, signInViaForm } from "./helpers/accounts";
import { approvedOwnerMagicLink, devInvite, uniqueEmail } from "./helpers/front-door";
import { API_URL as API, WEB_ORIGIN as ORIGIN } from "./helpers/ports";
import { totp } from "./helpers/totp";

/**
 * Front door (plan Task 17): sign in, request access, invite, welcome,
 * no-access. Needs the local stack and the seeded accounts.
 */

const unique = uniqueEmail;

/** An account in no company yet, made through the public sign-up. */
async function createLooseAccount(browser: Browser, name: string) {
  const email = unique("loose");
  const password = `Loose-${crypto.randomUUID().slice(0, 12)}`;
  const ctx = await browser.newContext();
  try {
    const res = await ctx.request.post(`${API}/api/auth/sign-up/email`, {
      headers: { origin: ORIGIN },
      data: { name, email, password },
    });
    expect(res.ok(), `sign-up returned ${res.status()}`).toBe(true);
  } finally {
    await ctx.close();
  }
  return { email, password };
}

function h1(page: Page, name: string | RegExp) {
  return page.getByRole("heading", { level: 1, name });
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
    // The alert can't tell which one is wrong, so both fields say so.
    await expect(page.getByLabel("Email", { exact: true })).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute("aria-invalid", "true");
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
    // A toggle keeps its name; aria-pressed carries the state.
    const toggle = page.getByRole("button", { name: "Show password" });
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await toggle.click();
    await expect(field).toHaveAttribute("type", "text");
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await toggle.click();
    await expect(field).toHaveAttribute("type", "password");
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
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
  test("an invited operator makes an account, is welcomed into the company and lands on Today", async ({ page }) => {
    const email = unique("op");
    const { path, companyName } = await devInvite(page.context().request, { email, role: "operator" });
    await page.goto(path);
    await expect(h1(page, "Join your team on orrn")).toBeVisible();
    await page.getByLabel("Your name").fill("Suresh Rathod");
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Password", { exact: true }).fill(`Suresh-${crypto.randomUUID().slice(0, 10)}`);
    await page.getByRole("button", { name: "Create account and join" }).click();

    await expect(page).toHaveURL(/\/welcome$/);
    await expect(h1(page, `Welcome to ${companyName}`)).toBeVisible();
    // The title already names the company: the line says only the role.
    await expect(page.getByText("You're in as Operator.")).toBeVisible();
    await expect(page.locator("[data-slot='stepper']")).toHaveCount(0);
    await expectNoSeriousAxe(page);
    await page.getByRole("button", { name: "Go to Today" }).click();
    await expect(page).toHaveURL(/\/today$/);

    // "Go to Today" closed their onboarding: /welcome has nothing left and sends them home.
    await page.goto("/welcome");
    await expect(page).toHaveURL(/\/today$/);
  });

  test("an invited admin fills in company details on the way in", async ({ page }) => {
    const email = unique("admin");
    const { path, companyName } = await devInvite(page.context().request, { email, role: "admin" });
    await page.goto(path);
    await page.getByLabel("Your name").fill("Nisha Joshi");
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Password", { exact: true }).fill(`Nisha-${crypto.randomUUID().slice(0, 10)}`);
    await page.getByRole("button", { name: "Create account and join" }).click();

    await expect(page).toHaveURL(/\/welcome$/);
    await expect(h1(page, "Company details")).toBeVisible();
    const stepper = page.locator("[data-slot='stepper']");
    await expect(stepper.getByRole("listitem")).toHaveCount(2);
    await expect(stepper).not.toContainText("Two-factor");

    await page.getByRole("button", { name: "Save and continue" }).click();
    await expect(page.getByText("Fill this in.")).toHaveCount(3);
    await expect(page.getByText("Tick the box to agree before you continue.")).toBeVisible();
    await expect(page.getByLabel("Location")).toBeFocused();

    await page.getByLabel("Location").fill("Pandesara, Surat");
    await page.getByLabel("Contact phone").fill("+91 98250 41177");
    await page.getByLabel("Number of presses").fill("600");
    await page.getByLabel("I agree to the orrn terms of service").check();
    await page.getByRole("button", { name: "Save and continue" }).click();
    // The server takes up to 500: say so on the field instead of "Something went wrong".
    await expect(page.getByText("Up to 500 presses.")).toBeVisible();
    await expect(page.getByLabel("Number of presses")).toBeFocused();

    await page.getByLabel("Number of presses").fill("3");
    await page.getByRole("button", { name: "Save and continue" }).click();
    await expect(h1(page, "You're set up")).toBeVisible();
    await expect(page.getByText(`You're in ${companyName} as Admin.`)).toBeVisible();
    await page.getByRole("button", { name: "Go to Today" }).click();
    await expect(page).toHaveURL(/\/today$/);
    await page.goto("/welcome");
    await expect(page).toHaveURL(/\/today$/);
  });

  test("an email that already has an account signs in to join", async ({ page, browser }) => {
    const { email, password } = await createLooseAccount(browser, "Kiran Shah");
    const { path, companyName } = await devInvite(page.context().request, { email, role: "viewer" });
    await page.goto(path);
    await page.getByLabel("Your name").fill("Kiran Shah");
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Create account and join" }).click();

    await expect(page.getByText("This email already has an account. Sign in to join.")).toBeVisible();
    await expect(page.getByLabel("Email", { exact: true })).toHaveValue(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in and join" }).click();

    await expect(page).toHaveURL(/\/welcome$/);
    await expect(h1(page, `Welcome to ${companyName}`)).toBeVisible();
    await expect(page.getByText("You're in as Viewer.")).toBeVisible();
  });

  test("a dead link says so before anyone makes an account", async ({ page }) => {
    const { path } = await devInvite(page.context().request, { email: unique("late"), role: "viewer", expired: true });
    for (const link of [path, "/invite/not-a-real-token"]) {
      await page.goto(link);
      await expect(h1(page, "This invite link doesn't work")).toBeVisible();
      await expect(page.getByRole("button", { name: "Create account and join" })).toHaveCount(0);
    }
    await page.getByRole("link", { name: "Go to sign in" }).click();
    await expect(page).toHaveURL(/\/login$/);
  });

  test("a signed-in member with a dead link is offered their home, not the sign-in form", async ({ page }) => {
    await signInViaApi(page, "owner");
    await page.goto("/invite/not-a-real-token");
    await expect(page.getByText("You're signed in as owner@orrn.local.")).toBeVisible();
    await page.getByRole("button", { name: "Join with this account" }).click();
    await expect(h1(page, "This invite link doesn't work")).toBeVisible();
    await expect(page.getByRole("link", { name: "Go to sign in" })).toHaveCount(0);
    await page.getByRole("link", { name: "Go to Today" }).click();
    await expect(page).toHaveURL(/\/today$/);
  });
});

test.describe("welcome: waitlist-approved owner (magic link)", () => {
  test("password, a reload mid-setup, two-factor, company details, then a sign-in with an authenticator code", async ({
    page,
    browser,
  }) => {
    test.slow();
    const companyName = `Shree Ganesh Extrusions ${Math.random().toString(36).slice(2, 6)}`;
    const { email, url } = await approvedOwnerMagicLink(browser, companyName);
    const stepper = page.locator("[data-slot='stepper']");
    const key = page.locator("[data-slot='totp-key']");

    // The emailed link signs in and lands on the old /setup-credentials, which opens the stepper.
    await page.goto(url);
    await expect(page).toHaveURL(/\/welcome$/);
    await expect(h1(page, "Set your password")).toBeVisible();
    await expect(stepper.getByRole("listitem")).toHaveCount(4);
    // No way to end the session while there is no password: the link was single-use.
    await expect(page.getByRole("button", { name: "Sign out" })).toHaveCount(0);
    await expectNoSeriousAxe(page);

    // Leaving before the password (typing /today) does not skip it: the steps come from the account.
    await page.goto("/today");
    await expect(page).toHaveURL(/\/welcome$/);
    await expect(h1(page, "Set your password")).toBeVisible();

    const first = `First-${crypto.randomUUID().slice(0, 10)}`;
    await page.getByLabel("New password", { exact: true }).fill(first);
    await page.getByLabel("Type it again", { exact: true }).fill(first);
    await page.getByRole("button", { name: "Save password" }).click();

    await expect(h1(page, "Turn on two-factor")).toBeVisible();
    await expect(key).toBeVisible();
    // The QR replaced the form: the keyboard goes to the code field.
    await expect(page.getByLabel("6-digit code")).toBeFocused();
    // The password exists now, so Sign out is back.
    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
    await expectNoSeriousAxe(page);
    const firstKey = (await key.innerText()).replace(/\s/g, "");

    // The phone drops the tab while the owner copies the key into the authenticator app.
    await page.reload();
    await expect(h1(page, "Turn on two-factor")).toBeVisible();
    await expect(h1(page, "Set your password")).toHaveCount(0);
    await expect(stepper.getByRole("listitem")).toHaveCount(3);

    await page.getByLabel("Your password", { exact: true }).fill(`${first}-typo`);
    await page.getByRole("button", { name: "Show QR code" }).click();
    await expect(page.getByText("That password is wrong. Type the password you sign in with.")).toBeVisible();
    // The password set before the reload is the one that works.
    await page.getByLabel("Your password", { exact: true }).fill(first);
    await page.getByRole("button", { name: "Show QR code" }).click();
    await expect(key).toBeVisible();
    const secret = (await key.innerText()).replace(/\s/g, "");
    expect(secret).not.toBe(firstKey);
    await expect(page.getByText("This is a new QR code. A code you added to your app before won't work, so scan this one.")).toBeVisible();

    await page.getByLabel("6-digit code").fill(totp(secret));
    await expect(h1(page, "Backup codes")).toBeVisible();
    await expectNoSeriousAxe(page);
    const backupCode = (await page.getByRole("list", { name: "Backup codes" }).getByRole("listitem").first().innerText()).trim();
    await page.getByRole("button", { name: "I saved them, continue" }).click();

    await expect(h1(page, "Company details")).toBeVisible();
    await expectNoSeriousAxe(page);
    await page.getByLabel("Location").fill("Sachin GIDC, Surat");
    await page.getByLabel("Contact phone").fill("+91 98250 41177");
    await page.getByLabel("Number of presses").fill("4");
    await page.getByLabel("I agree to the orrn terms of service").check();
    await page.getByRole("button", { name: "Save and continue" }).click();

    await expect(h1(page, "You're set up")).toBeVisible();
    await expect(page.getByText(`You're in ${companyName} as Owner.`)).toBeVisible();
    await page.getByRole("button", { name: "Go to Today" }).click();
    await expect(page).toHaveURL(/\/today$/);

    // The next day: signed out, then the password and the authenticator code.
    await page.context().clearCookies();
    await page.goto("/login");
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Password", { exact: true }).fill(first);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(h1(page, "Enter your code")).toBeVisible();
    await page.getByLabel("6-digit code").fill(totp(secret));
    await expect(page).toHaveURL(/\/today$/);

    // Lost phone: a backup code gets in, once.
    await page.context().clearCookies();
    await page.goto("/login");
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Password", { exact: true }).fill(first);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(h1(page, "Enter your code")).toBeVisible();
    await page.getByRole("button", { name: "Use a backup code instead" }).click();
    await expect(h1(page, "Enter a backup code")).toBeVisible();
    await page.getByLabel("Backup code").fill(backupCode);
    await page.getByRole("button", { name: "Verify", exact: true }).click();
    await expect(page).toHaveURL(/\/today$/);
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
        const invite = await devInvite(page.context().request, { email: unique("axe"), role: "viewer" });
        for (const path of ["/login", "/request-access", invite.path]) {
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

test.describe("widths", () => {
  test("login, request access, welcome and no-access fit at 375, 820 and 1280", async ({ page, browser }) => {
    const { email, password } = await createTempPasswordStaff(browser);
    for (const width of [375, 820, 1280]) {
      await page.context().clearCookies();
      await page.setViewportSize({ width, height: 800 });
      for (const [path, name] of [
        ["/login", "Sign in"],
        ["/request-access", "Request access"],
      ] as const) {
        await page.goto(path);
        await expect(h1(page, name)).toBeVisible();
        await expectNoHorizontalScroll(page);
      }
      await page.goto("/login");
      await page.getByLabel("Email", { exact: true }).fill(email);
      await page.getByLabel("Password", { exact: true }).fill(password);
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await expect(h1(page, "Set your password")).toBeVisible();
      await expectNoHorizontalScroll(page);
      await expect(page.getByRole("button", { name: "Save password" })).toBeVisible();
    }
  });
});

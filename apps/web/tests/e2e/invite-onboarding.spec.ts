import AxeBuilder from "@axe-core/playwright";
import { expect, request, test, type APIRequestContext, type Page } from "@playwright/test";

import { expectNoHorizontalScroll } from "../helpers/layout-guards";
import { approvedOwnerMagicLink, clearInviteThrottle, devInvite, uniqueEmail } from "./helpers/front-door";
import { API_URL as API, WEB_ORIGIN as ORIGIN } from "./helpers/ports";

/**
 * Onboarding repair (plan 2026-11-18, Task 8). Prod evidence: an account made by a magic-link
 * approval had no password, so its invite page offered "Create account" (account exists) and "Sign in"
 * (no password) and nothing else. Now `invite.status` picks the view: the no-password account emails
 * itself a link to set a password, the link comes back to the invite, and the person signs in and
 * joins. An inviter can resend a pending (even expired) invite and copy the new link. The page never
 * joins on load, so a chat app's link preview is harmless.
 */

function h1(page: Page, name: string | RegExp) {
  return page.getByRole("heading", { level: 1, name });
}

async function ok(res: Awaited<ReturnType<APIRequestContext["post"]>>, what: string) {
  expect(res.ok(), `${what} returned ${res.status()}: ${await res.text()}`).toBe(true);
  return res;
}

async function expectNoSeriousAxe(page: Page) {
  // A dialog that is still fading in reads as low contrast: let every running animation end first.
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))));
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const bad = axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(bad.map((v) => `${v.id}: ${v.nodes.map((n) => `${n.target.join(" ")} ${n.failureSummary ?? ""}`).join(" | ")}`)).toEqual([]);
}

/** Counts `invite.acceptByToken` calls the page makes. */
function countAccepts(page: Page) {
  const seen = { n: 0 };
  page.on("request", (req) => {
    if (req.url().includes("invite.acceptByToken")) seen.n += 1;
  });
  return seen;
}

/** An owner of a fresh, set-up plant, with a password; returns the email, password and plant. */
async function plantOwner() {
  const email = uniqueEmail("t8owner");
  const password = `Owner-${crypto.randomUUID().slice(0, 12)}`;
  const api = await request.newContext({ extraHTTPHeaders: { origin: ORIGIN } });
  try {
    const plant = (await (await ok(await api.post(`${API}/dev/invite`, { data: { email, role: "owner", companyName: `Resend Works ${email.slice(8, 14)}` } }), "/dev/invite")).json()) as {
      token: string;
      companyId: string;
      companyName: string;
    };
    await ok(await api.post(`${API}/api/auth/sign-up/email`, { data: { name: "Bhavesh Patel", email, password, inviteToken: plant.token } }), "sign-up");
    await ok(await api.post(`${API}/api/auth/sign-in/email`, { data: { email, password } }), "sign-in");
    await ok(await api.post(`${API}/trpc/invite.acceptByToken`, { data: { token: plant.token } }), "accept");
    await ok(
      await api.post(`${API}/trpc/auth.completeOnboarding`, {
        data: { facilityLocation: "Surat", primaryContact: "+91 90000 00000", timezone: "Asia/Kolkata", pressCount: 1 },
      }),
      "auth.completeOnboarding",
    );
    return { email, password, companyId: plant.companyId, companyName: plant.companyName };
  } finally {
    await api.dispose();
  }
}

test.describe("invite onboarding", () => {
  test("an account with no password emails itself a link, sets a password, comes back to the invite and joins", async ({ page, browser }) => {
    test.slow();
    // A waitlist-approved owner who never opened the sign-in link: an account with no password (Dad's case).
    const { email } = await approvedOwnerMagicLink(browser, `Shree Laxmi ${Math.random().toString(36).slice(2, 6)}`);
    const invite = await devInvite(page.context().request, { email, role: "viewer" });
    const accepts = countAccepts(page);

    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto(invite.path);
    await expect(h1(page, "Join your team on orrn")).toBeVisible();
    await expect(page.getByTestId("invite-no-password")).toContainText("Your account doesn't have a password yet.");
    await expect(page.getByRole("button", { name: "Create account and join" })).toHaveCount(0);
    await expectNoHorizontalScroll(page);
    await expectNoSeriousAxe(page);

    // Another email gets the same answer and no link.
    await page.getByTestId("set-password-email").fill(uniqueEmail("someone-else"));
    await page.getByTestId("set-password-submit").click();
    await expect(page.getByTestId("set-password-sent")).toBeVisible();
    // The reset request runs after the answer (waitUntil): give a wrongly sent one time to land first.
    await page.waitForTimeout(1_500);
    const none = await page.context().request.post(`${API}/dev/reset-token`, { data: { email } });
    expect(((await none.json()) as { token: string | null }).token).toBeNull();

    // The invite's own email: the link is emailed.
    await page.reload();
    await page.getByTestId("set-password-email").fill(email.toUpperCase());
    await page.getByTestId("set-password-submit").click();
    await expect(page.getByTestId("set-password-sent")).toContainText("If that's the email this invite was sent to");
    // Sent after the answer (waitUntil), so wait for it.
    const readToken = async () =>
      ((await (await ok(await page.context().request.post(`${API}/dev/reset-token`, { data: { email } }), "/dev/reset-token")).json()) as { token: string | null }).token;
    await expect.poll(readToken, { timeout: 10_000 }).toBeTruthy();
    const token = await readToken();

    // The emailed link: Better Auth checks the token and sends the person to the reset page, keeping next.
    const callback = `${ORIGIN}/reset-password?next=${encodeURIComponent(invite.path)}`;
    await page.goto(`${API}/api/auth/reset-password/${token}?callbackURL=${encodeURIComponent(callback)}`);
    await expect(page).toHaveURL(/\/reset-password\?/);
    const password = `Dad-${crypto.randomUUID().slice(0, 12)}`;
    await page.getByLabel("New password", { exact: true }).fill(password);
    await page.getByLabel("Type it again", { exact: true }).fill(password);
    await page.getByTestId("reset-submit").click();
    await expect(page.getByTestId("reset-done")).toBeVisible();
    await page.getByRole("link", { name: "Back to your invite" }).click();

    // Back on the invite: the account has a password now, so the sign-in view.
    await expect(page).toHaveURL(new RegExp(`${invite.path}$`));
    await expect(page.getByText("This email already has an account. Sign in to join.")).toBeVisible();
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in and join" }).click();

    // Two plants now (the approved one and the invite's): the picker lists the new one.
    await expect(page).toHaveURL(/\/choose-plant$/);
    await expect(page.getByTestId("choose-plant-item").filter({ hasText: invite.companyName })).toContainText("Viewer");
    // Only the tap on "Sign in and join" accepted the invite.
    expect(accepts.n).toBe(1);
  });

  test("the page never joins on load, signed out or signed in (chat link previews are harmless)", async ({ page }) => {
    const owner = await plantOwner();
    const email = uniqueEmail("t8look");
    const { path } = await devInvite(page.context().request, { email, role: "viewer", companyId: owner.companyId });
    const accepts = countAccepts(page);

    await page.goto(path);
    await expect(page.getByRole("button", { name: "Create account and join" })).toBeVisible();
    expect(accepts.n).toBe(0);

    // Signed in as the invited email (an account made from another plant's invite): Join waits for a tap.
    const password = `Look-${crypto.randomUUID().slice(0, 12)}`;
    const other = await devInvite(page.context().request, { email, role: "viewer" });
    await ok(
      await page.context().request.post(`${API}/api/auth/sign-up/email`, {
        headers: { origin: ORIGIN },
        data: { name: "Lalu Patel", email, password, inviteToken: other.token },
      }),
      "sign-up",
    );
    await ok(await page.context().request.post(`${API}/api/auth/sign-in/email`, { headers: { origin: ORIGIN }, data: { email, password } }), "sign-in");
    await page.goto(path);
    await expect(page.getByRole("button", { name: "Join with this account" })).toBeVisible();
    await page.waitForLoadState("networkidle");
    expect(accepts.n).toBe(0);
  });

  test("an owner resends an expired invite: a new link to copy, the email status, the old link dead and the new one live", async ({ page }) => {
    const owner = await plantOwner();
    const invitee = uniqueEmail("t8lalu");
    const old = await devInvite(page.context().request, { email: invitee, role: "operator", companyId: owner.companyId, expired: true });

    await page.setViewportSize({ width: 820, height: 1000 });
    await page.goto("/login");
    await page.getByLabel("Email", { exact: true }).fill(owner.email);
    await page.getByLabel("Password", { exact: true }).fill(owner.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/today$/);

    await page.goto("/settings?tab=team");
    const pending = page.locator("section[aria-labelledby='pending-invites']");
    await expect(pending).toContainText(invitee);
    await expect(pending).toContainText("Expired");
    await pending.getByRole("button", { name: `Resend: ${invitee}` }).first().click();

    const dialog = page.getByTestId("member-invite-link");
    await expect(dialog).toBeVisible();
    await expect(page.getByRole("dialog")).toContainText(`New invite link for ${invitee}`);
    // Local stacks send no email: the dialog says so plainly.
    await expect(dialog).toContainText("the email did not go");
    await expect(dialog).toContainText("The old link no longer works.");
    await expect(dialog).toContainText("WhatsApp");
    await expect(dialog.getByRole("button", { name: "Copy link" })).toBeVisible();
    const link = (await page.getByTestId("member-invite-url").textContent())!.trim();
    expect(link).toContain("/invite/");
    await expectNoSeriousAxe(page);
    await page.getByRole("button", { name: "Done" }).click();
    await expect(pending).not.toContainText("Expired");

    // The Team tab and the dialog at every width, in English and Hindi. Each Resend makes another link.
    let newest = link;
    for (const locale of ["en", "hi"] as const) {
      await page.evaluate((l) => localStorage.setItem("orrn.locale", l), locale);
      for (const width of [375, 820, 1280]) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto("/settings?tab=team");
        await expect(page.locator("html")).toHaveAttribute("lang", locale);
        await expectNoHorizontalScroll(page);
        await pending.getByTestId("invite-resend").filter({ visible: true }).first().click();
        await expect(page.getByTestId("member-invite-link")).toBeVisible();
        await expect(page.getByTestId("member-invite-url")).not.toHaveText(newest);
        newest = (await page.getByTestId("member-invite-url").textContent())!.trim();
        await expectNoSeriousAxe(page);
        await page.screenshot({ path: test.info().outputPath(`resend-${locale}-${width}.png`) });
        await page.keyboard.press("Escape");
        await expect(page.getByTestId("member-invite-link")).toHaveCount(0);
      }
    }
    await page.evaluate(() => localStorage.setItem("orrn.locale", "en"));
    const fresh = await page.context().browser()!.newContext();
    try {
      const visitor = await fresh.newPage();
      await visitor.goto(old.path);
      await expect(h1(visitor, "This invite link doesn't work")).toBeVisible();
      // Each resend replaces the link: the first resend's link is dead now too, the newest is live.
      await visitor.goto(new URL(link).pathname);
      await expect(h1(visitor, "This invite link doesn't work")).toBeVisible();
      await visitor.goto(new URL(newest).pathname);
      await expect(visitor.getByRole("button", { name: "Create account and join" })).toBeVisible();
    } finally {
      await fresh.close();
    }
  });

  test("the no-password, create and sign-in views fit at 375, 820 and 1280 in English and Hindi, with no serious axe issues", async ({ page, browser }) => {
    test.slow();
    const { email: noPassword } = await approvedOwnerMagicLink(browser, `Visual ${Math.random().toString(36).slice(2, 6)}`);
    const owner = await plantOwner();
    const views = {
      noPassword: (await devInvite(page.context().request, { email: noPassword, role: "viewer" })).path,
      create: (await devInvite(page.context().request, { email: uniqueEmail("t8new"), role: "viewer" })).path,
      signIn: (await devInvite(page.context().request, { email: owner.email, role: "viewer" })).path,
    };
    for (const locale of ["en", "hi"] as const) {
      await page.addInitScript((l) => localStorage.setItem("orrn.locale", l), locale);
      for (const width of [375, 820, 1280]) {
        // 18 page loads read the status from one local IP: keep under the 30-per-10-minutes limit.
        await clearInviteThrottle(page.context().request);
        await page.setViewportSize({ width, height: 900 });
        await page.goto(views.noPassword);
        await expect(page.getByTestId("invite-no-password")).toBeVisible();
        await expect(page.locator("html")).toHaveAttribute("lang", locale);
        await expectNoHorizontalScroll(page);
        await expectNoSeriousAxe(page);
        await page.screenshot({ path: test.info().outputPath(`no-password-${locale}-${width}.png`), fullPage: true });

        await page.goto(views.create);
        await expect(page.getByTestId("invite-no-password")).toHaveCount(0);
        await expect(page.locator("form")).toBeVisible();
        await expectNoHorizontalScroll(page);
        await expectNoSeriousAxe(page);

        // The sign-in view after a wrong password offers the emailed set-a-password link.
        await page.goto(views.signIn);
        await page.locator("input[name='email']").fill(owner.email);
        await page.locator("input[name='password']").fill("not-the-password");
        await page.locator("form button[type='submit']").click();
        await expect(page.getByTestId("password-link")).toBeVisible();
        await expectNoHorizontalScroll(page);
        await expectNoSeriousAxe(page);
        await page.screenshot({ path: test.info().outputPath(`sign-in-wrong-${locale}-${width}.png`), fullPage: true });
      }
    }
  });
});

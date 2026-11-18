import AxeBuilder from "@axe-core/playwright";
import { expect, request, test, type APIRequestContext, type Page } from "@playwright/test";

import { expectNoHorizontalScroll } from "../helpers/layout-guards";
import { API_URL, WEB_ORIGIN } from "./helpers/ports";

/**
 * The plant picker and per-plant onboarding (plan 2026-11-18, Task 9; owner amendment items 4 and 5).
 * A person set up in one plant and newly invited to another signs in: "Choose a plant" lists both, the
 * new one "Setup pending"; picking it opens that plant's company step, then Today; switching back to
 * the first plant shows no welcome. The spec makes its own two plants and person (local `/dev/invite`).
 */

const tag = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

async function ok(res: Awaited<ReturnType<APIRequestContext["post"]>>, what: string) {
  expect(res.ok(), `${what} returned ${res.status()}: ${await res.text()}`).toBe(true);
  return res;
}

type TwoPlants = { email: string; password: string; setUp: string; fresh: string };

/** Owner of a plant that is set up, then invited as admin to a second plant (accepted, setup not done). */
async function personInTwoPlants(): Promise<TwoPlants> {
  const t = tag();
  const email = `picker-${t}@orrn.local`;
  const password = `Picker-${crypto.randomUUID().slice(0, 12)}`;
  const setUp = `Picker Set Up ${t}`;
  const fresh = `Picker New ${t}`;
  const api = await request.newContext({ extraHTTPHeaders: { origin: WEB_ORIGIN } });
  try {
    const first = (await (await ok(await api.post(`${API_URL}/dev/invite`, { data: { email, role: "owner", companyName: setUp } }), "/dev/invite")).json()) as {
      token: string;
    };
    await ok(await api.post(`${API_URL}/api/auth/sign-up/email`, { data: { name: "Hetal Desai", email, password, inviteToken: first.token } }), "sign-up");
    await ok(await api.post(`${API_URL}/api/auth/sign-in/email`, { data: { email, password } }), "sign-in");
    await ok(await api.post(`${API_URL}/trpc/invite.acceptByToken`, { data: { token: first.token } }), "accept the first invite");
    // The first plant is set up before the second invite is accepted.
    await ok(
      await api.post(`${API_URL}/trpc/auth.completeOnboarding`, {
        data: { facilityLocation: "Testpur", primaryContact: "+91 90000 00000", timezone: "Asia/Kolkata", pressCount: 1 },
      }),
      "auth.completeOnboarding",
    );
    const second = (await (await ok(await api.post(`${API_URL}/dev/invite`, { data: { email, role: "admin", companyName: fresh } }), "/dev/invite")).json()) as {
      token: string;
    };
    await ok(await api.post(`${API_URL}/trpc/invite.acceptByToken`, { data: { token: second.token } }), "accept the second invite");
    return { email, password, setUp, fresh };
  } finally {
    await api.dispose();
  }
}

function h1(page: Page, name: string | RegExp) {
  return page.getByRole("heading", { level: 1, name });
}

async function signInWithForm(page: Page, who: TwoPlants) {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(who.email);
  await page.getByLabel("Password", { exact: true }).fill(who.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

const item = (page: Page, name: string) => page.getByTestId("choose-plant-item").filter({ hasText: name });

test.describe("plant picker after sign-in", () => {
  test("lists both plants, the new one Setup pending; picking it runs its company step, then Today; the other plant has no welcome", async ({ page }) => {
    const who = await personInTwoPlants();
    await page.setViewportSize({ width: 1280, height: 900 });
    await signInWithForm(page, who);

    await expect(page).toHaveURL(/\/choose-plant$/);
    await expect(h1(page, "Choose a plant")).toBeVisible();
    await expect(page.getByTestId("choose-plant-item")).toHaveCount(2);
    await expect(item(page, who.fresh)).toContainText("Admin");
    await expect(item(page, who.fresh).getByTestId("choose-plant-pending")).toHaveText("Setup pending");
    await expect(item(page, who.setUp)).toContainText("Owner");
    await expect(item(page, who.setUp).getByTestId("choose-plant-pending")).toHaveCount(0);
    const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);

    await item(page, who.fresh).click();
    await expect(page).toHaveURL(/\/welcome$/);
    await expect(h1(page, "Company details")).toBeVisible();
    await page.getByLabel("Location").fill("Vapi GIDC");
    await page.getByLabel("Contact phone").fill("+91 98250 41177");
    await page.getByLabel("Number of presses").fill("2");
    await page.getByLabel("I agree to the orrn terms of service").check();
    await page.getByRole("button", { name: "Save and continue" }).click();
    await expect(h1(page, "You're set up")).toBeVisible();
    await expect(page.getByText(`You're in ${who.fresh} as Admin.`)).toBeVisible();
    await page.getByRole("button", { name: "Go to Today" }).click();
    await expect(page).toHaveURL(/\/today$/);

    // Switch to the plant that was set up all along: no welcome.
    const trigger = page.getByTestId("plant-switcher").filter({ visible: true }).first();
    await expect(trigger).toContainText(who.fresh);
    await trigger.click();
    await page.getByRole("menuitemradio", { name: new RegExp(who.setUp) }).click();
    await expect(page).toHaveURL(/\/today$/);
    await expect(page.getByTestId("plant-switcher").filter({ visible: true }).first()).toContainText(who.setUp);
    await page.goto("/welcome");
    await expect(page).toHaveURL(/\/today$/);

    // And back to the new plant: its setup is done, so no welcome there either.
    await page.getByTestId("plant-switcher").filter({ visible: true }).first().click();
    await page.getByRole("menuitemradio", { name: new RegExp(who.fresh) }).click();
    await expect(page.getByTestId("plant-switcher").filter({ visible: true }).first()).toContainText(who.fresh);
    await expect(page).toHaveURL(/\/today$/);
  });

  test("a set-up plant opens Today; the picker comes back after the next sign-in only", async ({ page }) => {
    const who = await personInTwoPlants();
    await page.setViewportSize({ width: 375, height: 800 });
    await signInWithForm(page, who);
    await expect(page).toHaveURL(/\/choose-plant$/);
    await expectNoHorizontalScroll(page);
    await item(page, who.setUp).click();
    await expect(page).toHaveURL(/\/today$/);
    // Picked in this tab: a home redirect does not ask again.
    await page.goto("/");
    await expect(page).toHaveURL(/\/today$/);

    // The session ends (no sign-out in this tab) and they sign in again: asked again, since every
    // sign-in forgets the earlier pick.
    await page.context().clearCookies();
    await signInWithForm(page, who);
    await expect(page).toHaveURL(/\/choose-plant$/);
  });
});

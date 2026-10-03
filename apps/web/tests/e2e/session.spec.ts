import { expect, test, type Page } from "@playwright/test";

import { signInViaApi, signInViaForm } from "./helpers/accounts";

/**
 * Session, guards and loading hygiene (audit W2, W3, W4, W11, W12, W13).
 * Needs the local stack: this worktree's API + web ports, seeded accounts.
 */

const IMPERSONATION_KEY = "orrn:impersonate-company-id";
const HOME = /\/today$/;

async function setStoredImpersonation(page: Page, value: string) {
  await page.addInitScript(
    ([key, v]) => {
      // Only seed once per tab so a later clear by the app sticks across reloads.
      if (!sessionStorage.getItem("__seeded")) {
        sessionStorage.setItem(key!, v!);
        sessionStorage.setItem("__seeded", "1");
      }
    },
    [IMPERSONATION_KEY, value],
  );
}

test.describe("sign-in redirects", () => {
  test("signed-out /today goes to login with next, and sign-in returns to it", async ({ page }) => {
    await page.goto("/today");
    await expect(page).toHaveURL(/\/login\?next=%2Ftoday$/);
    await signInViaForm(page, "owner");
    await expect(page).toHaveURL(HOME);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  test("an open-redirect next value is ignored (W4)", async ({ page }) => {
    await page.goto("/login?next=//evil.com/phish");
    await signInViaForm(page, "owner");
    await expect(page).toHaveURL(HOME);
    expect(new URL(page.url()).host).toBe(new URL(test.info().project.use.baseURL!).host);
  });

  test("staff land on the console, not no-access (W13)", async ({ page }) => {
    await page.goto("/login");
    await signInViaForm(page, "staff");
    await expect(page).toHaveURL(/\/admin$/);
  });

  test("signed-out staff route goes to login with next (W13)", async ({ page }) => {
    await page.goto("/admin/companies");
    await expect(page).toHaveURL(/\/login\?next=%2Fadmin%2Fcompanies(%3F.*)?$/);
  });

  test("signed-in staff opening a tenant route are sent to the console", async ({ page }) => {
    await signInViaApi(page, "staff");
    await page.goto("/today");
    await expect(page).toHaveURL(/\/admin$/);
  });
});

test.describe("impersonation grant hygiene (W2)", () => {
  test("a corrupt stored value does not trap the app", async ({ page }) => {
    await signInViaApi(page, "owner");
    await setStoredImpersonation(page, "{not json");
    await page.goto("/today");
    await expect(page).toHaveURL(HOME);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(await page.evaluate((k) => sessionStorage.getItem(k), IMPERSONATION_KEY)).toBeNull();
  });

  test("an expired stored grant is dropped before any request", async ({ page }) => {
    await signInViaApi(page, "owner");
    const sent: string[] = [];
    page.on("request", (r) => {
      const h = r.headers()["x-orrn-impersonate-company"];
      if (h) sent.push(h);
    });
    await setStoredImpersonation(page, JSON.stringify({ companyId: "co_gone", expiresAt: Date.now() - 60_000 }));
    await page.goto("/today");
    await expect(page).toHaveURL(HOME);
    expect(sent).toEqual([]);
  });

  test("a grant the server rejects is cleared and the app recovers without a loop", async ({ page }) => {
    await signInViaApi(page, "owner");
    // Looks live on the client, but the server has no such grant: every call is FORBIDDEN.
    await setStoredImpersonation(
      page,
      JSON.stringify({ companyId: "co_revoked", expiresAt: Date.now() + 3_600_000 }),
    );
    let navigations = 0;
    page.on("framenavigated", (f) => {
      if (f === page.mainFrame()) navigations += 1;
    });
    await page.goto("/today");
    await expect(page).toHaveURL(HOME);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(await page.evaluate((k) => sessionStorage.getItem(k), IMPERSONATION_KEY)).toBeNull();
    expect(navigations).toBeLessThan(8);
  });

  test("sign-out clears a stored grant", async ({ page }) => {
    await signInViaApi(page, "owner");
    await page.goto("/today");
    await expect(page).toHaveURL(HOME);
    await page.evaluate(
      (k) => sessionStorage.setItem(k, JSON.stringify({ companyId: "co_x", expiresAt: Date.now() + 3_600_000 })),
      IMPERSONATION_KEY,
    );
    await page.getByRole("button", { name: "Local Owner" }).click();
    await page.getByRole("menuitem", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/$/);
    expect(await page.evaluate((k) => sessionStorage.getItem(k), IMPERSONATION_KEY)).toBeNull();
  });
});

test.describe("session expiry mid-use (W11)", () => {
  test("a dead session on a guarded page lands on login with next", async ({ page, context }) => {
    await signInViaApi(page, "owner");
    await page.goto("/dies");
    await expect(page).toHaveURL(/\/dies$/);
    await context.clearCookies();
    // The guard re-checks auth.me once its 30 s freshness window has passed;
    // a full load is the same code path with a cold cache.
    await page.goto("/dies");
    await expect(page).toHaveURL(/\/login\?next=%2Fdies$/);
  });

  test("an expired session while a page is open redirects on the next refetch", async ({ page, context }) => {
    await signInViaApi(page, "owner");
    await page.goto("/dies");
    await expect(page).toHaveURL(/\/dies$/);
    await context.clearCookies();
    // Refocusing the tab refetches the mounted auth.me query.
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await expect(page).toHaveURL(/\/login\?next=%2Fdies$/);
  });
});

test.describe("auth.me failures during navigation (W11)", () => {
  /**
   * Signed in with a cached `me`, then past its 30 s freshness window, so the
   * next navigation makes the guard revalidate. `/dies` is visited first so its
   * route chunk is already loaded when the network is cut.
   */
  async function signedInWithStaleMe(page: Page) {
    await signInViaApi(page, "owner");
    await page.clock.install();
    await page.goto("/dies");
    await expect(page).toHaveURL(/\/dies$/);
    await page.goto("/today");
    await expect(page.getByRole("heading", { level: 1, name: "Today" })).toBeVisible();
    await page.waitForLoadState("networkidle");
    await page.clock.fastForward(45_000);
  }

  test("a 500 from auth.me keeps the signed-in user on the page", async ({ page }) => {
    await signedInWithStaleMe(page);
    let hits = 0;
    await page.route("**/trpc/auth.me*", async (route) => {
      hits += 1;
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify([
          { error: { message: "boom", code: -32603, data: { code: "INTERNAL_SERVER_ERROR", httpStatus: 500 } } },
        ]),
      });
    });
    await page.getByRole("link", { name: "Dies", exact: true }).first().dispatchEvent("click");
    // The Dies screen itself must render (the URL alone can change before the guard resolves).
    await expect(page.getByRole("heading", { level: 1, name: "Dies" })).toBeVisible({ timeout: 3_000 });
    await expect(page).toHaveURL(/\/dies$/);
    expect(hits).toBeGreaterThan(0);
  });

  test("navigating offline with a cached me does not hang or sign out", async ({ page }) => {
    await signedInWithStaleMe(page);
    // context.setOffline would also cut Vite's HMR socket (the dev server then
    // reloads the page), so cut only the API and tell React Query it is offline.
    await page.route("**/trpc/**", (route) => route.abort("internetdisconnected"));
    await page.evaluate(() => window.dispatchEvent(new Event("offline")));
    await page.getByRole("link", { name: "Dies", exact: true }).first().dispatchEvent("click");
    // The Dies screen itself must render (the URL alone can change before the guard resolves).
    await expect(page.getByRole("heading", { level: 1, name: "Dies" })).toBeVisible({ timeout: 3_000 });
    await expect(page).toHaveURL(/\/dies$/);
  });

  test("a 401 from the background revalidation still sends the user to login", async ({ page, context }) => {
    await signedInWithStaleMe(page);
    await context.clearCookies();
    await page.getByRole("link", { name: "Dies", exact: true }).first().dispatchEvent("click");
    await expect(page).toHaveURL(/\/login\?next=%2Fdies$/, { timeout: 5_000 });
  });
});

test.describe("loading hygiene (W3)", () => {
  const HEAVY = /pdf-export|react-pdf|packingListPdf|xlsx/i;

  test("the PDF renderer is not requested on / or after sign-in", async ({ page }) => {
    const urls: string[] = [];
    page.on("request", (r) => urls.push(r.url()));
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    expect(urls.filter((u) => HEAVY.test(u))).toEqual([]);

    await page.goto("/login");
    await signInViaForm(page, "owner");
    await expect(page).toHaveURL(HOME);
    await page.waitForLoadState("networkidle");
    expect(urls.filter((u) => HEAVY.test(u))).toEqual([]);
  });
});

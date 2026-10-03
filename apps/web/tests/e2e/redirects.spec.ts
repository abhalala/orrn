import { expect, test, type Page } from "@playwright/test";

import { signInViaApi } from "./helpers/accounts";

/**
 * Route map (Task 15): every pre-C2 URL lands on its new home with the query
 * kept. Needs the local stack (API :3000, web :3002, seeded accounts).
 */

const SEEDED_SERIAL = "BG-000001-B001";
const API = process.env.E2E_API_URL ?? "http://localhost:3000";

/** One tRPC GET as the signed-in user (same cookie jar as the page). */
async function trpcGet<T>(page: Page, path: string, input: unknown): Promise<T> {
  const res = await page.context().request.get(`${API}/trpc/${path}?input=${encodeURIComponent(JSON.stringify(input))}`);
  expect(res.ok(), `${path} returned ${res.status()}`).toBe(true);
  return ((await res.json()) as { result: { data: T } }).result.data;
}

test.describe("old URLs redirect", () => {
  test.beforeEach(async ({ page }) => {
    await signInViaApi(page, "owner");
  });

  const rows: readonly (readonly [old: string, next: RegExp])[] = [
    ["/dashboard", /\/today$/],
    ["/receipts", /\/pack$/],
    ["/receipts/new", /\/pack\/new$/],
    ["/receipts/abc", /\/pack\/abc$/],
    ["/bundles?status=void", /\/stock\/bundles\?status=void$/],
    ["/dispatches", /\/dispatch$/],
    ["/dispatches/new", /\/dispatch\/new$/],
    ["/dispatches/xyz", /\/dispatch\/xyz$/],
    ["/spool", /\/printing$/],
    ["/settings/members", /\/settings\?tab=team$/],
    ["/onboarding", /\/welcome$/],
    ["/change-password", /\/welcome$/],
    ["/setup-credentials", /\/welcome\?magic=1$/],
    ["/waitlist?mode=demo", /\/request-access\?mode=demo$/],
  ];

  for (const [old, next] of rows) {
    test(`${old} lands on ${next.source}`, async ({ page }) => {
      await page.goto(old);
      await expect(page).toHaveURL(next);
      await expect(page.locator("h1").first()).toBeVisible();
    });
  }

  test("/bundles/$id resolves the id to the serial", async ({ page }) => {
    const { bundle } = await trpcGet<{ bundle: { id: string } }>(page, "bundle.getBySerial", { serial: SEEDED_SERIAL });
    await page.goto(`/bundles/${bundle.id}`);
    await expect(page).toHaveURL(new RegExp(`/b/${SEEDED_SERIAL}$`));
    await expect(page.getByRole("heading", { level: 1, name: new RegExp(SEEDED_SERIAL) })).toBeVisible();
  });

  test("/bundles/$id for an unknown id says not found", async ({ page }) => {
    await page.goto("/bundles/does-not-exist");
    await expect(page).toHaveURL(/\/bundles\/does-not-exist$/);
    await expect(page.getByText("Not found in this company")).toBeVisible();
  });

  test("/packing-lists/$id resolves to its dispatch", async ({ page }) => {
    const { items } = await trpcGet<{ items: { id: string; dispatchId: string }[] }>(page, "packingList.list", { limit: 1 });
    const first = items[0];
    test.skip(!first, "the seed has no packing list");
    await page.goto(`/packing-lists/${first!.id}`);
    await expect(page).toHaveURL(new RegExp(`/dispatch/${first!.dispatchId}$`));
  });

  test("/packing-lists/$id for an unknown id says not found", async ({ page }) => {
    await page.goto("/packing-lists/does-not-exist");
    await expect(page.getByText("Not found in this company")).toBeVisible();
  });
});

test.describe("/b/$serial", () => {
  test.beforeEach(async ({ page }) => {
    await signInViaApi(page, "owner");
  });

  test("shows the bundle summary", async ({ page }) => {
    await page.goto(`/b/${SEEDED_SERIAL}`);
    await expect(page).toHaveURL(new RegExp(`/b/${SEEDED_SERIAL}$`));
    await expect(page.getByRole("heading", { level: 1, name: new RegExp(SEEDED_SERIAL) })).toBeVisible();
    await expect(page.getByText("Weight", { exact: true })).toBeVisible();
  });

  test("a lower-case or typed code is replaced by the bundle's own number", async ({ page }) => {
    await page.goto(`/b/${SEEDED_SERIAL.toLowerCase()}`);
    await expect(page).toHaveURL(new RegExp(`/b/${SEEDED_SERIAL}$`));
  });

  test("an unknown code says not found", async ({ page }) => {
    await page.goto("/b/26X9999999");
    await expect(page.getByText("Not found in this company")).toBeVisible();
  });

  test("a signed-out visit goes to login and returns", async ({ page }) => {
    await page.context().clearCookies();
    await page.goto(`/b/${SEEDED_SERIAL}`);
    await expect(page).toHaveURL(new RegExp(`/login\\?next=%2Fb%2F${SEEDED_SERIAL}$`));
  });
});

test.describe("new routes exist", () => {
  test.beforeEach(async ({ page }) => {
    await signInViaApi(page, "owner");
  });

  for (const path of ["/today", "/pack", "/pack/new", "/stock", "/stock/bundles", "/dispatch", "/dispatch/new", "/printing", "/guides", "/settings"]) {
    test(`${path} renders a page title inside the shell`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveURL(new RegExp(`${path}$`));
      await expect(page.locator("[data-slot='app-shell']")).toBeVisible();
      await expect(page.locator("main#main h1").first()).toBeVisible();
    });
  }

  test("/welcome renders for a signed-in user", async ({ page }) => {
    await page.goto("/welcome");
    await expect(page).toHaveURL(/\/welcome$/);
    await expect(page.locator("h1").first()).toBeVisible();
  });
});

test("staff: /admin/waitlist and /admin/spool land on the new pages", async ({ page }) => {
  await signInViaApi(page, "staff");
  await page.goto("/admin/waitlist");
  await expect(page).toHaveURL(/\/admin\/requests$/);
  await page.goto("/admin/spool");
  // The companies list adds its own default filter to the URL.
  await expect(page).toHaveURL(/\/admin\/companies(\?|$)/);
});

test("signed-out old URLs go to login and come back to the new page", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login\?next=%2Fdashboard$/);
});

test("/request-access is public", async ({ page }) => {
  await page.goto("/request-access");
  await expect(page).toHaveURL(/\/request-access$/);
  await expect(page.locator("h1").first()).toBeVisible();
});

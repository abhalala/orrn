import { expect, test, type Page } from "@playwright/test";

import { signInViaApi, signInViaForm } from "./helpers/accounts";
import { API_URL, WEB_HOST } from "./helpers/ports";

/**
 * Route map (Task 15): every pre-C2 URL lands on its new home with the query
 * kept. Needs the local stack (this worktree's API + web ports, seeded accounts).
 */

const SEEDED_SERIAL = "BG-000001-B001";
const API = API_URL;

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
    // The welcome stepper sends a fully set-up owner (this suite's user) on
    // home; front-door.spec.ts covers these for an account with open steps.
    ["/onboarding", /\/today$/],
    ["/change-password", /\/today$/],
    ["/setup-credentials", /\/today$/],
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

  test("canonicalising a code keeps the query", async ({ page }) => {
    await page.goto(`/b/${SEEDED_SERIAL.toLowerCase()}?from=qr&c=orrn-demo`);
    await expect(page).toHaveURL(new RegExp(`/b/${SEEDED_SERIAL}\\?from=qr&c=orrn-demo$`));
  });
});

/**
 * Signed-out label scans (plant spec P8): the public view, not a login wall.
 * The API only knows a company by its host (`<slug>.orrn.in`), which local
 * dev doesn't have, so the public lookup is answered here; what the page does
 * with the answer and the request it makes are real.
 */
test.describe("/b/$serial signed out", () => {
  async function stubPublicBundle(page: Page) {
    const urls: string[] = [];
    await page.route("**/trpc/resolve.publicBundle*", async (route) => {
      urls.push(route.request().url());
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([{ result: { data: { number: "26I4086", section: "ZP 9015" } } }]),
      });
    });
    return urls;
  }

  test("shows the number and section with a sign-in button, no login wall", async ({ page }) => {
    const urls = await stubPublicBundle(page);
    await page.goto("/b/26I4086");
    await expect(page).toHaveURL(/\/b\/26I4086$/);
    await expect(page.getByTestId("public-number")).toHaveText("26I4086");
    await expect(page.getByTestId("public-section")).toHaveText("ZP 9015");
    await expect(page.getByRole("link", { name: "Sign in to see stock details" })).toBeVisible();
    // No stock facts, no app shell.
    await expect(page.getByText("Weight", { exact: true })).toHaveCount(0);
    await expect(page.locator("[data-slot='app-shell']")).toHaveCount(0);
    // The request names the code and the host the QR was scanned on.
    const input = new URL(urls[0]!).searchParams.get("input") ?? "";
    expect(input).toContain("26I4086");
    expect(input).toContain(WEB_HOST);
  });

  test("sign-in keeps the page and returns to the tenant summary", async ({ page }) => {
    await stubPublicBundle(page);
    await page.goto(`/b/${SEEDED_SERIAL}`);
    const link = page.getByRole("link", { name: "Sign in to see stock details" });
    await expect(link).toHaveAttribute("href", new RegExp(`/login\\?next=%2Fb%2F${SEEDED_SERIAL}$`));
    await link.click();
    await expect(page).toHaveURL(new RegExp(`/login\\?next=%2Fb%2F${SEEDED_SERIAL}$`));
    await signInViaForm(page, "owner");
    await expect(page).toHaveURL(new RegExp(`/b/${SEEDED_SERIAL}$`));
    await expect(page.locator("[data-slot='app-shell']")).toBeVisible();
    await expect(page.getByText("Weight", { exact: true })).toBeVisible();
  });

  test("?c= names the company (real server, demo company), and sign-in keeps it", async ({ page }) => {
    const sent: string[] = [];
    page.on("request", (req) => {
      if (req.url().includes("resolve.publicBundle")) sent.push(decodeURIComponent(req.url()));
    });
    await page.goto(`/b/${SEEDED_SERIAL}?c=orrn-demo`);
    await expect(page.getByTestId("public-number")).toHaveText(SEEDED_SERIAL);
    await expect(page.getByTestId("public-section")).not.toBeEmpty();
    expect(sent.join(" ")).toContain('"companyHost":"orrn-demo"');
    await expect(page.getByRole("link", { name: "Sign in to see stock details" })).toHaveAttribute(
      "href",
      new RegExp(`/login\\?next=%2Fb%2F${SEEDED_SERIAL}%3Fc%3Dorrn-demo$`),
    );
    // Quantity and status stay behind a membership.
    await expect(page.getByText("Weight", { exact: true })).toHaveCount(0);
  });

  test("a ?c= that isn't a slug is ignored and the host is used", async ({ page }) => {
    const sent: string[] = [];
    page.on("request", (req) => {
      if (req.url().includes("resolve.publicBundle")) sent.push(decodeURIComponent(req.url()));
    });
    await page.goto("/b/26I4086?c=Not%20A%20Slug");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(sent.join(" ")).toContain(`"companyHost":"${WEB_HOST}"`);
  });

  test("an unknown code (here: no company on this host) says not found, with sign-in", async ({ page }) => {
    await page.goto("/b/26X9999999");
    await expect(page.getByRole("heading", { level: 1, name: "Not found" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Sign in to see stock details" })).toBeVisible();
  });

  test("staff without a company see the public view and no sign-in button", async ({ page }) => {
    await signInViaApi(page, "staff");
    await stubPublicBundle(page);
    await page.goto("/b/26I4086");
    await expect(page.getByTestId("public-number")).toHaveText("26I4086");
    await expect(page.getByRole("link", { name: "Sign in to see stock details" })).toHaveCount(0);
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

  test("/welcome sends a fully set-up user home", async ({ page }) => {
    await page.goto("/welcome");
    await expect(page).toHaveURL(/\/today$/);
    await expect(page.locator("main#main h1").first()).toBeVisible();
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

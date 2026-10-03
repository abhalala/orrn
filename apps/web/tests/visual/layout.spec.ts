import fs from "node:fs";

import { expect, test, type Page } from "@playwright/test";

import {
  collectClippedTextIssues,
  collectHorizontalScrollIssues,
  type LayoutIssue,
} from "./layout-guards";

/**
 * Layout guard sweep: every route, at phone, tablet and desktop widths, in the
 * project's colour scheme (light and dark projects). Fails on sideways scroll,
 * clipped text, text under a chip, wrapped slugs/codes, squeezed columns or
 * ellipsised key values.
 *
 * Public pages run without a session. Signed-in routes need a running API and
 * two local test accounts (a company owner and a Godseye staff user), given as
 *   LAYOUT_OWNER_EMAIL / LAYOUT_OWNER_PASSWORD
 *   LAYOUT_STAFF_EMAIL / LAYOUT_STAFF_PASSWORD
 * or as LAYOUT_ACCOUNTS_FILE pointing at a KEY=value file outside the repo
 * (OWNER_EMAIL, OWNER_PASSWORD, STAFF_EMAIL, STAFF_PASSWORD).
 * The API origin comes from VITE_SERVER_URL (the same value the web app uses).
 * Without credentials the signed-in suites are skipped, not failed.
 */

const API_URL = process.env.VITE_SERVER_URL ?? "http://127.0.0.1:8787";

function loadAccounts() {
  const fromFile: Record<string, string> = {};
  const file = process.env.LAYOUT_ACCOUNTS_FILE;
  if (file && fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
      const idx = line.indexOf("=");
      if (idx > 0) fromFile[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    }
  }
  return {
    owner: {
      email: process.env.LAYOUT_OWNER_EMAIL ?? fromFile.OWNER_EMAIL,
      password: process.env.LAYOUT_OWNER_PASSWORD ?? fromFile.OWNER_PASSWORD,
    },
    staff: {
      email: process.env.LAYOUT_STAFF_EMAIL ?? fromFile.STAFF_EMAIL,
      password: process.env.LAYOUT_STAFF_PASSWORD ?? fromFile.STAFF_PASSWORD,
    },
  };
}

const ACCOUNTS = loadAccounts();

/** Phone projects check phone widths (with touch); desktop projects the rest. */
function widthsFor(projectName: string): number[] {
  return projectName.startsWith("mobile") ? [375, 390] : [820, 1280, 1440, 1920];
}

const PUBLIC_ROUTES = ["/", "/login", "/waitlist", "/invite/not-a-real-token"];

/** Static tenant routes; detail routes are discovered from the first list row. */
const OWNER_ROUTES = [
  "/dashboard",
  "/customers",
  "/dies",
  "/receipts",
  "/receipts/new",
  "/bundles",
  "/stock",
  "/dispatches",
  "/dispatches/new",
  "/spool",
  "/settings/members",
  // /change-password only renders for accounts flagged must-change-password;
  // everyone else is redirected, so it is not part of this sweep.
];
const OWNER_DETAILS: { list: string; pattern: RegExp }[] = [
  { list: "/customers", pattern: /^\/customers\/(?!new)[^/]+$/ },
  { list: "/dies", pattern: /^\/dies\/(?!new)[^/]+$/ },
  { list: "/receipts", pattern: /^\/receipts\/(?!new)[^/]+$/ },
  { list: "/bundles", pattern: /^\/bundles\/[^/]+$/ },
  { list: "/dispatches", pattern: /^\/dispatches\/(?!new)[^/]+$/ },
];

const STAFF_ROUTES = ["/admin", "/admin/companies", "/admin/waitlist", "/admin/staff", "/admin/spool"];
const STAFF_DETAILS = [{ list: "/admin/companies", pattern: /^\/admin\/companies\/[^/]+$/ }];

async function settle(page: Page) {
  await page.waitForLoadState("networkidle").catch(() => {});
  // Let skeletons resolve and fonts apply.
  await page.waitForTimeout(250);
}

async function signIn(page: Page, who: "owner" | "staff") {
  const account = ACCOUNTS[who];
  const res = await page.request.post(`${API_URL}/api/auth/sign-in/email`, {
    headers: { Origin: new URL(test.info().project.use.baseURL ?? "http://127.0.0.1:3001").origin },
    data: { email: account.email, password: account.password },
  });
  expect(res.ok(), `sign-in for ${who} failed with ${res.status()}`).toBe(true);
}

async function discover(page: Page, details: { list: string; pattern: RegExp }[]): Promise<string[]> {
  const found: string[] = [];
  for (const { list, pattern } of details) {
    await page.goto(list);
    await settle(page);
    const hrefs = await page
      .locator("main a[href]")
      .evaluateAll((els) => els.map((el) => new URL((el as HTMLAnchorElement).href).pathname));
    const match = hrefs.find((h) => pattern.test(h));
    // Every list must link to at least one detail page, or that detail
    // route silently drops out of the sweep.
    expect(match, `no detail link matching ${pattern} on ${list}`).toBeTruthy();
    if (match) found.push(match);
  }
  return found;
}

/** A packing list lives under a completed dispatch: find one through the list. */
async function discoverPackingList(page: Page): Promise<string> {
  await page.goto("/dispatches?status=completed");
  await settle(page);
  const dispatches = await page
    .locator("main a[href]")
    .evaluateAll((els) => els.map((el) => new URL((el as HTMLAnchorElement).href).pathname));
  for (const href of [...new Set(dispatches.filter((h) => /^\/dispatches\/(?!new)[^/]+$/.test(h)))]) {
    await page.goto(href);
    await settle(page);
    const pl = await page
      .locator("main a[href*='/packing-lists/']")
      .evaluateAll((els) => els.map((el) => new URL((el as HTMLAnchorElement).href).pathname));
    if (pl[0]) return pl[0];
  }
  throw new Error("no completed dispatch with a packing list; complete one in the local data");
}

async function sweep(page: Page, routes: string[], widths: number[]) {
  const failures: string[] = [];
  for (const width of widths) {
    await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
    for (const route of routes) {
      await page.goto(route);
      await settle(page);
      // A guard redirect (login, onboarding, no-access) would sweep the wrong
      // page and pass for the wrong reason.
      const landed = new URL(page.url()).pathname;
      if (landed !== route) {
        failures.push(`${route} @ ${width}px: redirected to ${landed}`);
        continue;
      }
      const issues: LayoutIssue[] = [
        ...(await collectHorizontalScrollIssues(page)),
        ...(await collectClippedTextIssues(page)),
      ];
      if (issues.length > 0) {
        failures.push(
          `${route} @ ${width}px [${test.info().project.name}]\n${issues
            .map((i) => `  [${i.kind}] ${i.path}\n      "${i.text}" (${i.detail})`)
            .join("\n")}`,
        );
      }
    }
  }
  expect(failures, failures.join("\n\n")).toEqual([]);
}

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
});

test("public routes keep text and layout intact", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  await sweep(page, PUBLIC_ROUTES, widthsFor(testInfo.project.name));
});

test.describe("signed in", () => {
  test.skip(
    !ACCOUNTS.owner.email || !ACCOUNTS.staff.email,
    "Set LAYOUT_OWNER_* and LAYOUT_STAFF_* (or LAYOUT_ACCOUNTS_FILE) to run signed-in layout checks.",
  );

  test("company routes keep text and layout intact", async ({ page }, testInfo) => {
    test.setTimeout(600_000);
    await signIn(page, "owner");
    const details = await discover(page, OWNER_DETAILS);
    const packingList = await discoverPackingList(page);
    await sweep(page, [...OWNER_ROUTES, ...details, packingList], widthsFor(testInfo.project.name));
  });

  test("Godseye routes keep text and layout intact", async ({ page }, testInfo) => {
    test.setTimeout(300_000);
    await signIn(page, "staff");
    const details = await discover(page, STAFF_DETAILS);
    await sweep(page, [...STAFF_ROUTES, ...details], widthsFor(testInfo.project.name));
  });
});

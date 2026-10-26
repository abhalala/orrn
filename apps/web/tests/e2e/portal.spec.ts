import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";

import { signInViaApi, signInViaForm, localPassword, type LocalRole } from "./helpers/accounts";
import { API_URL as API, WEB_ORIGIN as ORIGIN } from "./helpers/ports";
import { expectNoClippedText, expectNoHorizontalScroll } from "../helpers/layout-guards";

/**
 * Customer portal (W3-PORTAL-W, FP-PF-01..04). Seed (apps/server/src/dev-seed-portal.ts): KD
 * Extrusion's login party@orrn.local with sections 14701 and 13090 granted, 12230 owned by KD, one
 * portal booking (SO-4) and a test certificate for KD's completed dispatch (chemistry pending).
 * The party sees a frame of its own (no plant navigation); a plant member opening /portal gets Not found.
 */

const SHOTS = process.env.W3_PORTAL_W_SHOTS_DIR;
const WIDTHS = [375, 820, 1280] as const;

async function openAs(page: Page, opts: { role: LocalRole; width: number; path: string; height?: number }) {
  await page.setViewportSize({ width: opts.width, height: opts.height ?? 900 });
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await signInViaApi(page, opts.role);
  await page.goto(opts.path);
}

async function openPortal(page: Page, width: number, path = "/portal") {
  await openAs(page, { role: "party", width, path });
  await expect(page.locator("[data-slot='portal-shell']")).toBeVisible();
  await expect(page.locator("main#main h1").first()).toBeVisible();
}

async function settled(page: Page) {
  await expect(page.locator("main#main [aria-busy='true']")).toHaveCount(0, { timeout: 15_000 });
}

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

async function newPage(browser: Browser, width = 1280) {
  const context = await browser.newContext({ baseURL: ORIGIN, viewport: { width, height: 900 } });
  return context.newPage();
}

async function trpcQuery<T>(page: Page, path: string, input?: unknown): Promise<T> {
  const url = `${API}/trpc/${path}${input === undefined ? "" : `?input=${encodeURIComponent(JSON.stringify(input))}`}`;
  const res = await page.context().request.get(url, { headers: { origin: ORIGIN } });
  expect(res.ok(), `${path} returned ${res.status()}: ${await res.text()}`).toBe(true);
  return (await res.json()).result.data as T;
}

async function trpcMutate<T>(page: Page, path: string, input: unknown): Promise<T> {
  const res = await page.context().request.post(`${API}/trpc/${path}`, { headers: { origin: ORIGIN, "content-type": "application/json" }, data: input });
  expect(res.ok(), `${path} returned ${res.status()}: ${await res.text()}`).toBe(true);
  return (await res.json()).result.data as T;
}

/** A call that is expected to be refused: the status and the server's sentence. */
async function trpcRefused(page: Page, path: string, input: unknown): Promise<{ status: number; message: string }> {
  const res = await page.context().request.post(`${API}/trpc/${path}`, { headers: { origin: ORIGIN, "content-type": "application/json" }, data: input });
  const body = (await res.json()) as { error?: { message?: string } };
  return { status: res.status(), message: body.error?.message ?? "" };
}

/** Runs `work` as the plant owner in a context of its own, then closes it (cleanup that must not depend on the test's pages). */
async function asOwner<T>(browser: Browser, work: (owner: Page) => Promise<T>): Promise<T> {
  const owner = await newPage(browser);
  try {
    await signInViaApi(owner, "owner");
    return await work(owner);
  } finally {
    await owner.context().close();
  }
}

/** Cleanup never fails a test: it reports and moves on. */
async function tidy(what: string, work: () => Promise<unknown>) {
  try {
    await work();
  } catch (error) {
    console.warn(`portal.spec cleanup (${what}) did not finish:`, error instanceof Error ? error.message : error);
  }
}

/**
 * A completed dispatch to KD Extrusion whose one bundle names a real cast (a new open cast with a
 * melt, no spectro result), and its issued test certificate. The seed's own dispatch has no casts.
 */
async function dispatchWithCast(browser: Browser): Promise<{ dispatchId: string; castNo: string }> {
  return asOwner(browser, async (owner) => {
    // The plant's cast rule is "automatic" in the seed: on once any melt is locked (FP-FD-16). This
    // melt would turn it on for every spec packing without a cast after it (stock, scan, pack), so
    // the rule is set Off explicitly first; this bundle names its cast anyway. The seed resets it.
    await trpcMutate(owner, "company.updateSettings", { requireCastOnBundle: false });
    const cast = await trpcMutate<{ id: string; number: string }>(owner, "foundry.casts.open", { alloy: "6063" });
    const streams = await trpcQuery<{ items: { id: string; code: string }[] }>(owner, "foundry.returnStreams.list");
    const scrap = streams.items.find((x) => x.code === "PLANT-SCRAP")!;
    const now = Date.now();
    const min = 60_000;
    // The melt a bundle's cast must have: 1 kg of the seed's plant scrap (PR-8's ends and rejects)
    // charged back, 0.98 kg of logs out. It is locked on create, so it passes the lock gates (W2-FD-S r1):
    // logs out, a balance inside 3 %, and the reason there is no spectro result.
    await trpcMutate(owner, "foundry.melts.create", {
      castId: cast.id,
      timestamps: { preheatStart: now - 300 * min, chargingStart: now - 240 * min, chargingEnd: now - 200 * min, castingStart: now - 150 * min, castingEnd: now - 60 * min },
      ldoTenthIn: { start: 300, end: 250 },
      spectroReason: "Certificate test melt; no sample",
      inputs: [{ kind: "return_stream", ref: scrap.id, kgG: 1000 }],
      outputs: { logs: { pcs: 1, lengthMm: 600, kgG: 980 }, drossG: 0, feG: 0, returns: [] },
    });
    const dies = await trpcQuery<{ items: { id: string; sectionCode: string }[] }>(owner, "die.list", { search: "14701", limit: 5 });
    const die = dies.items.find((d) => d.sectionCode === "14701")!;
    const places = await trpcQuery<{ items: { id: string; code: string }[] }>(owner, "stock.locations.list", {});
    const customers = await trpcQuery<{ items: { id: string; name: string }[] }>(owner, "customer.list", { search: "KD", limit: 5 });
    const kd = customers.items.find((c) => /^KD/.test(c.name))!;
    const receipt = await trpcMutate<{ bundles: { serial: string }[] }>(owner, "bundle.createReceipt", {
      dieId: die.id,
      unit: "inch",
      castId: cast.id,
      locationId: places.items.find((l) => l.code === "Y1")!.id,
      rows: [{ quantity: 10, weightG: 30_000, lengthMm: 3658 }],
    });
    const made = await trpcMutate<{ id: string }>(owner, "dispatch.create", { customerId: kd.id });
    await trpcMutate(owner, "dispatch.addBundlesBySerial", { id: made.id, serials: receipt.bundles.map((b) => b.serial), allowUnassigned: true });
    await trpcMutate(owner, "dispatch.reserve", { id: made.id });
    await trpcMutate(owner, "dispatch.complete", { id: made.id });
    await trpcMutate(owner, "portal.certificates.issue", { dispatchId: made.id });
    return { dispatchId: made.id, castNo: cast.number };
  });
}

/** Closes the grant of a die to a customer when it is open (idempotent), so a failed run never leaves it behind. */
async function closeGrant(page: Page, customerId: string, sectionCode: string) {
  const grants = await trpcQuery<{ id: string; sectionCode: string }[]>(page, "portal.sections.list", { customerId });
  for (const g of grants.filter((x) => x.sectionCode === sectionCode)) await trpcMutate(page, "portal.sections.revoke", { id: g.id });
}

async function blockingAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .exclude(".TanStackRouterDevtools")
    .exclude("[class*='tsqd-']")
    .exclude("[data-sonner-toaster]")
    .analyze();
  return results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => ({ id: v.id, help: v.help, targets: v.nodes.slice(0, 5).map((n) => n.target.join(" ")) }));
}

async function clean(page: Page, name: string) {
  await settled(page);
  await expectNoHorizontalScroll(page);
  await expectNoClippedText(page, "main#main");
  expect(await blockingAxeViolations(page)).toEqual([]);
  await shot(page, name);
}

const main = (page: Page) => page.locator("main#main");

test.describe("party today", () => {
  for (const width of WIDTHS) {
    test(`shows open orders, baki and the way to order, with no plant navigation at ${width}`, async ({ page }) => {
      await openPortal(page, width);
      await expect(main(page).getByRole("heading", { level: 1 })).toHaveText("Today");
      const today = page.getByTestId("portal-today");
      await expect(today).toContainText("Open orders");
      await expect(today).toContainText("Baki");
      await expect(today).toContainText("Last dispatch");
      // The seed's baki: the open SO-1 / SO-4 lines have kg still to dispatch.
      const baki = await trpcQuery<{ bakiG: number; openOrders: number }>(page, "portal.today");
      expect(baki.openOrders).toBeGreaterThan(0);
      expect(baki.bakiG).toBeGreaterThan(0);
      await expect(today).toContainText((baki.bakiG / 1000).toLocaleString("en-IN", { minimumFractionDigits: 3, maximumFractionDigits: 3 }));
      await expect(page.getByRole("link", { name: "Place an order" })).toBeVisible();
      // A party has no plant navigation: no app shell, no Pack / Stock / Scan.
      await expect(page.locator("[data-slot='app-shell']")).toHaveCount(0);
      await expect(page.getByRole("link", { name: /^(Pack|Stock|Scan)$/ })).toHaveCount(0);
      await clean(page, `today-${width}`);
    });
  }

  test("signing in with the form lands on the portal, and the plant's /today is not for a party", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto("/login");
    await page.getByLabel("Email", { exact: true }).fill("party@orrn.local");
    await page.getByLabel("Password", { exact: true }).fill(localPassword());
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/portal\/?$/);
    await expect(main(page).getByRole("heading", { level: 1 })).toHaveText("Today");
    await page.goto("/today");
    await expect(page).not.toHaveURL(/\/today$/);
  });
});

test.describe("party dies", () => {
  for (const width of WIDTHS) {
    test(`granted 14701 and 13090, owned 12230, and nothing else at ${width}`, async ({ page }) => {
      await openPortal(page, width, "/portal/dies");
      const list = page.getByTestId("portal-dies");
      await expect(list.locator("[data-section]")).toHaveCount(3);
      const codes = await list.locator("[data-section]").evaluateAll((els) => els.map((e) => e.getAttribute("data-section")));
      expect(codes.sort()).toEqual(["12230", "13090", "14701"]);
      await expect(list.locator("[data-section='14701']")).toContainText("Opened for you");
      await expect(list.locator("[data-section='13090']")).toContainText("Opened for you");
      await expect(list.locator("[data-section='12230']")).toContainText("Yours");
      // Other sections of the plant never show.
      for (const hidden of ["11250", "12212"]) await expect(list.locator(`[data-section='${hidden}']`)).toHaveCount(0);
      await clean(page, `dies-${width}`);
    });
  }
});

test.describe("book and confirm", () => {
  test.describe.configure({ mode: "serial" });

  test("a booking reaches the office as a booking; once confirmed the party sees it confirmed", async ({ page, browser }) => {
    test.setTimeout(150_000);
    // The booking lives in the shared plant: the office cancels it when the test is over, pass or fail.
    let bookedId: string | null = null;
    try {
      await bookAndConfirm();
    } finally {
      if (bookedId) {
        const id = bookedId;
        await tidy("booked order", () => asOwner(browser, (owner) => trpcMutate(owner, "orders.cancel", { id, reason: "e2e cleanup" })));
      }
    }

    async function bookAndConfirm() {
    await openPortal(page, 375, "/portal/orders/new");
    await expect(main(page).getByRole("heading", { level: 1 })).toHaveText("New order");
    // Only the dies opened for this party can be picked.
    await expect(page.getByLabel("Die", { exact: true }).locator("option", { hasText: "14701" })).toHaveCount(1);
    const options = await page.getByLabel("Die", { exact: true }).locator("option").allTextContents();
    expect(options.join("|")).toContain("14701");
    expect(options.join("|")).not.toContain("11250");

    // Nothing is sent while the line is incomplete.
    await page.getByRole("button", { name: "Place order" }).click();
    await expect(main(page).getByText("Pick a die.")).toBeVisible();
    await expect(main(page).getByText("Enter the cut length.")).toBeVisible();
    await shot(page, "new-errors-375");

    const po = `PORTAL-${Date.now()}`;
    await page.getByRole("textbox", { name: "Your PO number" }).fill(po);
    await page.getByLabel("Die", { exact: true }).selectOption({ label: options.find((o) => o.includes("14701"))! });
    await page.getByRole("textbox", { name: "Feet" }).fill("12");
    await page.getByRole("textbox", { name: "Pieces", exact: true }).fill("25");
    // No rate field exists on the form.
    await expect(page.getByLabel(/rate|price/i)).toHaveCount(0);
    await expect(main(page)).toContainText("The plant sets the rate");
    await shot(page, "new-filled-375");
    await page.getByRole("button", { name: "Place order" }).click();

    const booked = page.getByTestId("portal-booked");
    await expect(booked).toContainText("Your booking is with the office");
    await expect(booked).toBeVisible();
    await expectNoHorizontalScroll(page);
    await shot(page, "booked-375");
    const viewHref = await booked.getByRole("link", { name: "View order" }).getAttribute("href");
    const id = viewHref!.split("/").pop()!;
    bookedId = id;
    await booked.getByRole("link", { name: "View order" }).click();
    await expect(main(page).getByRole("heading", { level: 1 })).toContainText(/SO-\d+/);
    await expect(main(page).getByText("Booking", { exact: true })).toBeVisible();
    await expect(main(page)).toContainText(po);
    const line = page.getByTestId("portal-order-lines").locator("[data-line='1']");
    await expect(line).toContainText("14701");
    await expect(line).toContainText("25 pcs");
    await expect(main(page)).not.toContainText(/rate|₹|paise/i);
    await clean(page, "order-booking-375");

    // The office sees it as a booking from the portal, and confirms.
    const office = await newPage(browser);
    await signInViaApi(office, "owner");
    await office.goto(`/orders/${id}`);
    await expect(office.getByRole("heading", { level: 1 })).toContainText(/SO-\d+/);
    await expect(office.getByText("Booking", { exact: true })).toBeVisible();
    await expect(office.locator("[data-timeline='portal.order.create']")).toContainText("Booked by the party from the portal");
    // The office picks the die copy (the party never does), then confirms.
    await expect(office.locator("[data-confirm-checklist]")).toContainText("pick a copy or a tier");
    await office.getByRole("button", { name: "Edit lines" }).click();
    const editor = office.locator("[data-lines-editor]");
    await editor.locator("[data-line='1']").getByLabel("Die copy").selectOption({ label: "Tier 1 or better" });
    await editor.getByRole("button", { name: "Save lines" }).click();
    await expect(office.locator("[data-lines-editor]")).toHaveCount(0);
    await office.getByRole("button", { name: "Confirm order" }).click();
    await expect(office.getByText("Confirmed", { exact: true })).toBeVisible();
    await office.context().close();

    // The party sees it confirmed.
    await page.reload();
    await expect(main(page).getByText("Confirmed", { exact: true })).toBeVisible();
    await page.goto("/portal/orders");
    await expect(main(page).getByRole("link", { name: /SO-\d+/ }).first()).toBeVisible();
    // "Baki" is explained once on the orders screens.
    await expect(page.getByTestId("portal-baki-hint")).toContainText("Baki = still to deliver");
    await clean(page, "orders-375");
    }
  });

  test("a party cannot read another party's order, and a rate is refused", async ({ page, browser }) => {
    const office = await newPage(browser);
    await signInViaApi(office, "owner");
    const others = await trpcQuery<{ items: { id: string; customerName: string }[] }>(office, "orders.list", { limit: 50 });
    const foreign = others.items.find((o) => !/KD/.test(o.customerName));
    expect(foreign).toBeTruthy();
    await office.context().close();
    await openPortal(page, 820, `/portal/orders/${foreign!.id}`);
    await expect(page.getByRole("alert")).toContainText("Not found");

    // A rate sent by hand is refused by the server, and nothing is booked.
    const dies = await trpcQuery<{ id: string }[]>(page, "portal.sections.visible");
    const refused = await trpcRefused(page, "portal.orders.create", { lines: [{ sectionId: dies[0]!.id, cutLengthMm: 3658, pcs: 1, ratePaise: 100 }] });
    expect(refused.status).toBe(400);
    expect(refused.message).toContain("The plant sets the rate");
  });
});

test.describe("dispatches, packing list and certificate", () => {
  for (const width of WIDTHS) {
    test(`only this party's dispatches; the packing list has no cast; the certificate says which bundles have no cast number at ${width}`, async ({ page, browser }) => {
      test.setTimeout(90_000);
      const office = await newPage(browser);
      await signInViaApi(office, "owner");
      const all = await trpcQuery<{ items: { id: string; code: string; status: string; customerName?: string }[] }>(office, "dispatch.listDispatches", { status: "completed", limit: 100 });
      await office.context().close();

      await openPortal(page, width, "/portal/dispatches");
      await settled(page);
      const links = await main(page).locator("a[href^='/portal/dispatches/']").evaluateAll((els) => [...new Set(els.map((e) => e.getAttribute("href")!))]);
      expect(links.length).toBeGreaterThan(0);
      const mine = new Set(links.map((l) => l.split("/").pop()));
      const foreign = all.items.find((d) => d.status === "completed" && !mine.has(d.id));
      expect(foreign, "the seed has a completed dispatch of another party").toBeTruthy();
      await clean(page, `dispatches-${width}`);

      // Detail: the packing list without a cast column.
      await page.goto("/portal/dispatches/dev-dispatch-done-1");
      await expect(main(page).getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.getByTestId("portal-dispatch-totals")).toContainText("bundles");
      await expect(page.locator("[data-slot='packing-list'], #portal-pl").first()).toBeVisible();
      await expect(main(page).getByTestId(width >= 1024 ? "packing-list-table" : "packing-list-total-kg").first()).toBeVisible();
      await expect(main(page)).not.toContainText(/cast/i);
      await expect(main(page).getByRole("columnheader", { name: /cast/i })).toHaveCount(0);
      await expect(main(page).getByRole("button", { name: "Download packing list" })).toBeVisible();
      await clean(page, `dispatch-${width}`);

      // Another party's dispatch is Not found.
      await page.goto(`/portal/dispatches/${foreign!.id}`);
      await expect(page.getByRole("alert")).toContainText("Not found");

      // The certificate: the seed's bundles name no cast, and it says that (never "not tested yet"); not a tax document.
      await page.goto("/portal/dispatches/dev-dispatch-done-1");
      await main(page).getByRole("link", { name: "Test certificate" }).click();
      await expect(main(page).getByRole("heading", { level: 1 })).toHaveText("Test certificate");
      await expect(page.getByTestId("cert-chemistry-note")).toContainText(/\d+ bundles have no cast number/);
      await expect(page.getByTestId("cert-chemistry-note")).not.toContainText("not tested yet");
      await expect(page.getByTestId("cert-casts")).toHaveCount(0);
      await expect(page.getByTestId("portal-certificate")).toContainText("Quality document. Not a tax invoice.");
      await expect(page.getByTestId("portal-certificate")).toContainText(/TC\/\d{4}-\d{2}\/\d+/);
      await expect(main(page)).not.toContainText(/₹|rate/i);
      await clean(page, `certificate-${width}`);
    });
  }
});

test.describe("certificate with a cast", () => {
  for (const width of [375, 1280] as const) {
    test(`a bundle with a cast puts that cast on the certificate, pending until the lab result, at ${width}`, async ({ page, browser }) => {
      test.setTimeout(120_000);
      const { dispatchId, castNo } = await dispatchWithCast(browser);
      await openPortal(page, width, `/portal/dispatches/${dispatchId}`);
      await main(page).getByRole("link", { name: "Test certificate" }).click();
      await expect(main(page).getByRole("heading", { level: 1 })).toHaveText("Test certificate");
      const block = page.getByTestId("cert-casts").locator(`[data-cast='${castNo}']`);
      await expect(block).toBeVisible();
      await expect(block).toHaveAttribute("data-cast-state", "pending");
      await expect(block).toContainText("Chemistry pending");
      await expect(block).toContainText("14701");
      // The bundle names a cast, so the note is about testing, not about a missing cast number.
      const note = page.getByTestId("cert-chemistry-note");
      await expect(note).toContainText("Chemistry pending");
      await expect(note).not.toContainText("no cast number");
      await clean(page, `certificate-cast-${width}`);
    });
  }
});

test.describe("who may open the portal", () => {
  test("a plant member hitting /portal gets Not found", async ({ page }) => {
    await openAs(page, { role: "owner", width: 1280, path: "/portal" });
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Not found");
    await expect(page.locator("[data-slot='portal-shell']")).toHaveCount(0);
    await page.goto("/portal/dies");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Not found");
  });

  test("a signed-out visitor is sent to sign in", async ({ page }) => {
    await page.goto("/portal");
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe("party in Hindi", () => {
  test("the portal switches to Hindi at 375 with no sideways scroll", async ({ page }) => {
    await openPortal(page, 375);
    await page.getByRole("button", { name: "Open account menu" }).click();
    await page.getByRole("radio", { name: "हिंदी" }).check();
    await page.keyboard.press("Escape");
    await expect(main(page).getByRole("heading", { level: 1 })).toHaveText("आज");
    await expect(main(page)).toContainText("खुले ऑर्डर");
    await expectNoHorizontalScroll(page);
    await shot(page, "today-hi-375");
    await page.goto("/portal/orders/new");
    await expect(main(page).getByRole("heading", { level: 1 })).toHaveText("नया ऑर्डर");
    await expectNoHorizontalScroll(page);
    await expectNoClippedText(page, "main#main");
    expect(await blockingAxeViolations(page)).toEqual([]);
    await shot(page, "new-hi-375");
    // Back to English so a retry starts clean.
    await page.getByRole("button", { name: "खाता मेन्यू खोलें" }).click();
    await page.getByRole("radio", { name: "English" }).check();
  });
});

test.describe("plant side: logins, grants and certificates", () => {
  test.describe.configure({ mode: "serial" });

  test("Team: give a party a login, copy the link, the party signs up and lands on the portal, then the office turns it off", async ({ page, browser }) => {
    test.setTimeout(150_000);
    const email = `royal-${Date.now()}@orrn.local`;
    // The login lives in the shared plant: it is turned off at the end of the test even when an assertion fails.
    try {
      await giveAndUse();
    } finally {
      await tidy("royal login", () =>
        asOwner(browser, async (owner) => {
          const logins = await trpcQuery<{ id: string; email: string; status: string }[]>(owner, "portal.users.list", {});
          for (const l of logins.filter((x) => x.email === email && x.status !== "revoked")) await trpcMutate(owner, "portal.users.revoke", { id: l.id });
        }),
      );
    }

    async function giveAndUse() {
    await openAs(page, { role: "owner", width: 1280, path: "/settings?tab=team" });
    const portal = page.getByTestId("team-portal");
    await expect(portal).toBeVisible();
    await expect(portal).toContainText("party@orrn.local");
    await portal.getByRole("button", { name: "Give a login" }).click();
    const sheet = page.getByRole("dialog");
    await sheet.getByRole("combobox", { name: "Customer" }).fill("Royal");
    await page.getByRole("option", { name: /Royal Aluminium/ }).click();
    await sheet.getByTestId("portal-grant-email").fill(email);
    await sheet.getByRole("button", { name: "Give login" }).click();
    const url = await page.getByTestId("portal-invite-url").innerText();
    expect(url).toMatch(/\/invite\/[0-9a-f-]{36}\?kind=portal$/);
    await expect(page.getByRole("button", { name: "Copy link" })).toBeVisible();
    await shot(page, "team-link-1280");
    await page.getByRole("dialog").getByRole("button", { name: "Done" }).click();
    await expect(portal.getByRole("row", { name: new RegExp(email) })).toBeVisible();
    await expect(portal.getByText("Invited").first()).toBeVisible();

    // The party opens the link, makes a password account and lands on the portal.
    const party = await newPage(browser, 375);
    await party.goto(url.replace(/^https?:\/\/[^/]+/, ""));
    await expect(party.getByRole("heading", { level: 1 })).toHaveText("Your party login");
    await party.getByLabel("Your name", { exact: true }).fill("Royal Buyer");
    await party.getByLabel("Email", { exact: true }).fill(email);
    await party.getByLabel("Password", { exact: true }).fill("a-long-party-password-1");
    await party.getByRole("button", { name: /Create|Join|Accept/ }).click();
    await expect(party).toHaveURL(/\/portal\/?$/);
    await expect(party.getByRole("heading", { level: 1 })).toHaveText("Today");
    // No die opened yet: no order button, the plain explanation instead.
    await expect(party.getByRole("link", { name: "Place an order" })).toHaveCount(0);
    await expect(party.locator("main#main")).toContainText("The plant has not opened any die for you yet.");
    await shot(party, "new-party-375");

    // The office turns the login off; the party's next call is refused.
    await page.reload();
    await expect(portal.getByText("Active").first()).toBeVisible();
    await portal.getByRole("button", { name: `Turn off: ${email}` }).click();
    await expect(portal.getByText("Off").first()).toBeVisible();
    await party.reload();
    // No active party login and no plant: the plain no-access page, never the portal.
    await expect(party).toHaveURL(/\/no-access/);
    await expect(party.locator("[data-slot='portal-shell']")).toHaveCount(0);
    await party.context().close();
    }
  });

  test("Customer page: open a die, and a die another party owns is flagged", async ({ page }) => {
    await openAs(page, { role: "owner", width: 820, path: "/customers" });
    const customers = await trpcQuery<{ items: { id: string; name: string }[] }>(page, "customer.list", { search: "Tejura", limit: 5 });
    const id = customers.items[0]!.id;
    // A grant left by an earlier failed run would answer "already open": close it first, and again at the end.
    await closeGrant(page, id, "12230");
    try {
      await openAndFlag(id);
    } finally {
      await tidy("12230 grant", () => closeGrant(page, id, "12230"));
    }

    async function openAndFlag(id: string) {
    await page.goto(`/customers/${id}`);
    const card = page.getByTestId("customer-portal-card");
    await expect(card).toBeVisible();
    await expect(card).toContainText("Portal access");
    // 12230 is owned by KD: granting it to Tejura is allowed, the card says the party will not see it.
    await card.getByRole("combobox", { name: "Open a die" }).fill("12230");
    await page.getByRole("option", { name: /12230/ }).first().click();
    await expect(page.getByTestId("portal-owned-warning")).toContainText("Another party owns this die");
    await expect(card.getByTestId("portal-grants").locator("[data-grant='12230']")).toContainText("Another party owns this die");
    await shot(page, "customer-card-820");
    await card.getByRole("button", { name: "Close: 12230" }).click();
    await expect(card.locator("[data-grant='12230']")).toHaveCount(0);
    }
  });

  test("Dispatch page: the office issues the party's certificate again as the next revision", async ({ page }) => {
    await openAs(page, { role: "owner", width: 1280, path: "/dispatch/dev-dispatch-done-1" });
    const box = page.getByTestId("issue-certificate");
    await expect(box).toBeVisible();
    await expect(box).toContainText("Chemistry pending");
    const before = await trpcQuery<{ number: string; revision: number } | null>(page, "portal.certificates.forDispatch", { dispatchId: "dev-dispatch-done-1" });
    await box.getByRole("button", { name: "Issue again" }).click();
    await expect(box).toContainText(`revision ${(before?.revision ?? 0) + 1}`);
    await shot(page, "dispatch-issue-1280");
  });

  test("a viewer cannot see the portal controls", async ({ page }) => {
    await openAs(page, { role: "viewer", width: 1280, path: "/settings?tab=team" });
    await expect(page.getByTestId("settings-team")).toBeVisible();
    await expect(page.getByTestId("team-portal")).toHaveCount(0);
  });
});

import { expect, request, test, type Browser, type Page } from "@playwright/test";

import { signInViaApi, type LocalRole } from "./helpers/accounts";
import { ownerApi } from "./helpers/owner-api";
import { expectNoClippedText, expectNoHorizontalScroll } from "../helpers/layout-guards";

/**
 * Die share link (FP-DR-20): the die room makes a link for a section's press drawing, a party opens it
 * in a browser with NO session and sees the section number, the drawing, the weight band and nothing
 * about stock, costs or customers, then the die room revokes it and the same address answers with the
 * neutral "This link is no longer available". Every width owns the section it shares (a die made here,
 * with a PDF drawing uploaded through the same three steps the card uses), so widths can run in parallel.
 */
const WIDTHS = [375, 1280] as const;

test.setTimeout(120_000);

async function openAs(page: Page, path: string, role: LocalRole, width: number) {
  await page.setViewportSize({ width, height: 900 });
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await signInViaApi(page, role);
  await page.goto(path);
  await expect(page.locator("[data-slot='app-shell']")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("main#main h1")).toBeVisible({ timeout: 30_000 });
}

/** A section of its own with a PDF as its press drawing (owner API: create, begin, PUT, commit). */
async function sectionWithDrawing(tag: string, opts: { copy?: boolean } = {}) {
  const api = await ownerApi();
  const code = `${tag}${Math.floor(Math.random() * 90_000 + 10_000)}`;
  const { id } = await api.mutate<{ id: string }>("die.create", { series: "Share", sectionCode: code, name: "Share test", weightMinG: 5_900, weightMaxG: 6_200, thicknessMm: 1.2 });
  const body = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
  const begun = await api.mutate<{ uploadUrl: string; uploadId: string; headers?: Record<string, string> }>("dieInstance.files.beginUpload", {
    sectionId: id,
    kind: "pdf",
    name: `${code}.pdf`,
    size: body.byteLength,
    mime: "application/pdf",
    pressDrawing: true,
  });
  const put = await request.newContext();
  const res = await put.put(begun.uploadUrl, { data: body, headers: { "content-type": "application/pdf", ...(begun.headers ?? {}) } });
  expect(res.ok(), `PUT returned ${res.status()}`).toBe(true);
  await put.dispose();
  await api.mutate("dieInstance.files.commit", { uploadId: begun.uploadId });
  // A copy only when the test needs one: die-room.spec counts every live copy of the plant in its picker.
  const copy = opts.copy ? await api.mutate<{ id: string; code: string }>("dieInstance.create", { sectionId: id }) : null;
  await api.dispose();
  return { id, code, copyId: copy?.id ?? "" };
}

/** Retire the copy a test made, so the plant's live copy count is what the other specs expect. */
async function retireCopy(copyId: string) {
  const api = await ownerApi();
  await api.mutate("dieInstance.update", { id: copyId, status: "retired" });
  await api.dispose();
}

/** A browser with no session at all: what the party has. */
async function stranger(browser: Browser, width: number, locale?: "hi") {
  const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: "light", reducedMotion: "reduce" });
  if (locale) await context.addInitScript(() => localStorage.setItem("orrn.locale", "hi"));
  return { context, page: await context.newPage() };
}

for (const width of WIDTHS) {
  test.describe(`die share link at ${width}`, () => {
    test("create, open without a session, see the drawing and no stock, revoke, then the neutral page", async ({ page, browser }) => {
      const section = await sectionWithDrawing(`SH${width}`);
      await openAs(page, `/dies/${section.id}`, "dieroom", width);

      // The Share sheet: nothing sent yet, then a link that is shown once.
      await page.getByTestId("section-share").click();
      const sheet = page.getByTestId("share-sheet");
      await expect(sheet).toBeVisible();
      await expect(sheet.getByTestId("share-empty")).toBeVisible();
      // M4 (final fixes 5): a double click makes ONE link.
      const creates: string[] = [];
      page.on("request", (r) => {
        if (r.method() === "POST" && r.url().includes("die.share.create")) creates.push("create");
      });
      await page.getByTestId("share-create").dblclick();
      const linkBox = sheet.getByTestId("share-link");
      await expect(linkBox).toBeVisible();
      const link = (await linkBox.innerText()).trim();
      expect(link).toMatch(/\/share\/die\/[A-Za-z0-9_-]{43}$/);
      expect(creates).toEqual(["create"]);
      await expect(sheet.getByTestId("share-list").locator("li")).toHaveCount(1);
      await expect(sheet.getByTestId("share-copy")).toBeVisible();
      const row = sheet.getByTestId("share-list").locator("li").first();
      await expect(row).toContainText("Open");
      await expect(row).toContainText("Not opened yet");
      await expectNoHorizontalScroll(page);

      // The party: a browser with no session.
      const party = await stranger(browser, width);
      const shared = party.page;
      await shared.goto(link);
      await expect(shared.getByTestId("share-section")).toHaveText(section.code, { timeout: 30_000 });
      await expect(shared.getByTestId("share-series")).toContainText("Share");
      await expect(shared.getByTestId("share-weight")).toContainText("5.900 to 6.200");
      await expect(shared.getByTestId("share-facts")).toContainText("1.2 mm");
      await expect(shared.getByText("Not to scale")).toBeVisible();
      await expect(shared.locator("[data-slot='app-shell']")).toHaveCount(0);
      const body = (await shared.locator("body").innerText()).toLowerCase();
      for (const word of ["stock", "price", "cost", "bundle", "customer", "dispatch", "order"]) expect(body, word).not.toContain(word);
      await expectNoHorizontalScroll(shared);
      await expectNoClippedText(shared, "main");
      // The drawing opens from a signed address, with no session.
      const href = await shared.getByTestId("share-drawing").getAttribute("href");
      expect(href).toContain("/files/dies?key=");
      const drawing = await party.context.request.get(href!);
      expect(drawing.status()).toBe(200);
      expect((await drawing.body()).subarray(0, 5).toString()).toBe("%PDF-");
      // The robots meta keeps the link out of search engines.
      await expect(shared.locator("meta[name='robots']")).toHaveAttribute("content", /noindex/);

      // The list now says it was opened.
      await page.reload();
      await page.getByTestId("section-share").click();
      await expect(page.getByTestId("share-list").locator("li").first()).toContainText("Opened once");

      // Revoke from the list: the same address now answers with the neutral page.
      await page.getByTestId("share-list").locator("li").first().getByRole("button", { name: "Revoke" }).click();
      await page.getByTestId("share-revoke-confirm").click();
      await expect(page.getByText("Link revoked")).toBeVisible();
      await expect(page.getByTestId("share-list").locator("li").first()).toContainText("Revoked");
      await shared.reload();
      await expect(shared.getByTestId("share-gone")).toContainText("This link is no longer available");
      await expect(shared.getByTestId("share-section")).toHaveCount(0);
      await expect(shared.getByTestId("share-drawing")).toHaveCount(0);
      await expectNoHorizontalScroll(shared);
      await party.context.close();
    });

    test("an address that never existed answers the same page, in Hindi too", async ({ browser }) => {
      const party = await stranger(browser, width);
      await party.page.goto(`/share/die/${"a".repeat(43)}`);
      await expect(party.page.getByTestId("share-gone")).toContainText("This link is no longer available");
      await expect(party.page.getByTestId("share-gone")).toContainText("Ask the sender for a new link");
      await party.context.close();
      const hi = await stranger(browser, width, "hi");
      await hi.page.goto(`/share/die/${"b".repeat(43)}`);
      await expect(hi.page.getByTestId("share-gone")).toContainText("यह लिंक अब उपलब्ध नहीं है");
      await hi.context.close();
    });

    test("the die card has Share in its menu and opens the same sheet", async ({ page }) => {
      const section = await sectionWithDrawing(`SC${width}`, { copy: true });
      try {
        await openAs(page, `/dies/copies/${section.copyId}`, "dieroom", width);
        await page.getByRole("button", { name: "More actions" }).click();
        await page.getByRole("menuitem", { name: "Share" }).click();
        const sheet = page.getByTestId("share-sheet");
        await expect(sheet).toBeVisible();
        await expect(page.getByRole("dialog")).toContainText(section.code);
        await expect(page.getByTestId("share-create")).toBeEnabled();
        await expectNoHorizontalScroll(page);
      } finally {
        await retireCopy(section.copyId);
      }
    });

    test("who sees Share: the die room does, the office does not", async ({ page }) => {
      const section = await sectionWithDrawing(`SW${width}`);
      await openAs(page, `/dies/${section.id}`, "dieroom", width);
      await expect(page.getByTestId("section-share")).toBeVisible();
      await openAs(page, `/dies/${section.id}`, "office", width);
      await expect(page.getByTestId("section-share")).toHaveCount(0);
    });
  });
}

test("1280: a section with no press drawing says so in the sheet and creates nothing", async ({ page }) => {
  const api = await ownerApi();
  const code = `SN${Math.floor(Math.random() * 90_000 + 10_000)}`;
  const { id } = await api.mutate<{ id: string }>("die.create", { series: "Share", sectionCode: code, weightMinG: 5_900, weightMaxG: 6_200 });
  await api.dispose();
  await openAs(page, `/dies/${id}`, "dieroom", 1280);
  await page.getByTestId("section-share").click();
  await expect(page.getByTestId("share-sheet")).toContainText("no press drawing yet");
  await expect(page.getByTestId("share-create")).toBeDisabled();
});

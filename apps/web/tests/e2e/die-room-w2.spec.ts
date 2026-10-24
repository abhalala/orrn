import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page, type Route } from "@playwright/test";

import { signInViaApi, type LocalRole } from "./helpers/accounts";
import { API_URL, WEB_ORIGIN } from "./helpers/ports";
import { expectNoClippedText, expectNoHorizontalScroll } from "../helpers/layout-guards";

/**
 * Die room, Wave 2 additions (W2-DR2): a copy on trial (FP-DR-17), drawings attached in bulk by file
 * name (FP-DR-19), the board's tiles / filters / sort, maker numbers on the card and the A4 print,
 * and the 3,000-row import in 2,000-row calls.
 *
 * Tests run in parallel (fullyParallel), so each width owns what it changes. The seed gives Tee 13090
 * nine copies on trial (13090-11..19) and three die trial runs (PR-5..7 on plan PP-2):
 *   A  issued to the width's own trial run and taken back      11 / 12 / 13
 *   B  released by the owner with a reason                     14 / 15 / 16
 *   C  maker numbers and a bulk file; the Hindi and viewer reads (stays on trial)   17 / 18 / 19
 * and three sections no other spec reads for the bulk run (Round Tube 15204, Square Tube 15310,
 * Angle 11280). The seed is reset at the start of each run.
 */

const WIDTHS = [375, 820, 1280] as const;
type Width = (typeof WIDTHS)[number];

const PLAN: Record<Width, { a: string; b: string; c: string; run: string; section: string }> = {
  375: { a: "13090-11", b: "13090-14", c: "13090-17", run: "PR-5", section: "15204" },
  820: { a: "13090-12", b: "13090-15", c: "13090-18", run: "PR-6", section: "15310" },
  1280: { a: "13090-13", b: "13090-16", c: "13090-19", run: "PR-7", section: "11280" },
};

const copyId = (code: string) => `dev-copy-${code}`;

async function open(page: Page, path: string, opts: { role: LocalRole; width: number; locale?: "hi" }) {
  await page.setViewportSize({ width: opts.width, height: 900 });
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  if (opts.locale) await page.addInitScript(() => localStorage.setItem("orrn.locale", "hi"));
  await signInViaApi(page, opts.role);
  await page.goto(path);
  await expect(page.locator("[data-slot='app-shell']")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("main#main h1")).toBeVisible({ timeout: 30_000 });
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

/** Wait for page and sheet crossfades to finish (finite animations only), so a capture or an axe run never sees one mid-way. */
async function settle(page: Page) {
  await page.evaluate(async () => {
    const finite = document.getAnimations().filter((a) => a.effect?.getComputedTiming().iterations !== Infinity);
    await Promise.all(finite.map((a) => a.finished.catch(() => undefined)));
  });
}

/** DR_SHOTS=<dir> keeps a full-page capture of every screen the checks visit. */
async function shot(page: Page, tag: string) {
  const dir = process.env.DR_SHOTS;
  if (!dir) return;
  const hi = (await page.locator("html").getAttribute("lang")) === "hi" ? "-hi" : "";
  await page.screenshot({ path: `${dir}/w2__${page.viewportSize()?.width ?? 0}${hi}__${tag}.png`, fullPage: true, animations: "disabled" });
}

async function expectClean(page: Page, tag: string) {
  await settle(page);
  await shot(page, tag);
  await expectNoHorizontalScroll(page);
  await expectNoClippedText(page, "main#main");
  expect(await blockingAxeViolations(page)).toEqual([]);
}

async function pickFromSearch(page: Page, scope: Locator, name: string, text: string, option: string | RegExp = text) {
  const box = scope.getByRole("combobox", { name, exact: true });
  await box.click();
  await box.fill(text);
  await page.getByRole("option", { name: option }).click();
}

async function trpcQuery<T>(page: Page, path: string, input: unknown): Promise<T> {
  const res = await page.context().request.get(`${API_URL}/trpc/${path}?input=${encodeURIComponent(JSON.stringify(input))}`, { headers: { origin: WEB_ORIGIN } });
  expect(res.ok(), `${path} returned ${res.status()}`).toBe(true);
  return (await res.json()).result.data as T;
}

async function trpcMutate(page: Page, path: string, input: unknown) {
  const res = await page.context().request.post(`${API_URL}/trpc/${path}`, { headers: { origin: WEB_ORIGIN }, data: input });
  return { status: res.status(), body: await res.json() };
}

type Reply = { data: unknown } | { error: string; status: number; code: string };

/** Answers one tRPC procedure in the browser (batched or not) and records every input it was sent. */
async function answer(page: Page, procedure: string, reply: (input: unknown, call: number) => Reply | Promise<Reply>) {
  const inputs: unknown[] = [];
  await page.route(`**/trpc/${procedure}**`, async (route: Route) => {
    const req = route.request();
    if (req.method() !== "POST") return route.continue();
    const batched = new URL(req.url()).searchParams.get("batch") === "1";
    const body = req.postDataJSON() as Record<string, unknown>;
    const input = batched ? body["0"] : body;
    inputs.push(input);
    const out = await reply(input, inputs.length - 1);
    const entry = "data" in out ? { result: { data: out.data } } : { error: { message: out.error, code: -32600, data: { code: out.code, httpStatus: out.status } } };
    await route.fulfill({ status: "data" in out ? 200 : out.status, contentType: "application/json", body: JSON.stringify(batched ? [entry] : entry) });
  });
  return inputs;
}

/** A tiny but real file: the bytes are what the PUT carries, the name is what matters. */
const file = (name: string, mimeType: string, size = 4096) => ({ name, mimeType, buffer: Buffer.alloc(size, 7) });

test.setTimeout(150_000);
test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

for (const width of WIDTHS) {
  const plan = PLAN[width];

  test.describe(`board at ${width}`, () => {
    test("tiles count copies by state; a tile, the filters and the sort narrow the list", async ({ page }) => {
      await open(page, "/dies", { role: "dieroom", width });
      const tiles = page.getByTestId("board-tiles");
      await expect(tiles).toBeVisible();
      for (const name of ["On trial", "In rack", "On press", "At nitriding", "At die maker", "Dies without copies"]) {
        await expect(tiles.getByRole("button", { name: new RegExp(name) })).toBeVisible();
      }
      // The seed puts nine Tee copies on trial; other tests release or issue some, so only "some" is stable.
      const trialTile = page.getByTestId("tile-on_trial");
      await expect(trialTile).toContainText(/^\d+/);
      await expectClean(page, "board");

      await trialTile.click();
      await expect(trialTile).toHaveAttribute("aria-pressed", "true");
      await expect(page).toHaveURL(/tile=on_trial/);
      await expect(page.getByRole("link", { name: /13090/ }).first()).toBeVisible();
      // Channel 12230 has no copy on trial.
      await expect(page.getByText("12230")).toHaveCount(0);
      await expectClean(page, "board_trial_tile");

      // Pressing it again clears it.
      await trialTile.click();
      await expect(trialTile).toHaveAttribute("aria-pressed", "false");
      await expect(page).not.toHaveURL(/tile=/);

      // Sort: most copies first puts Tee (22 copies) first.
      await page.getByRole("combobox", { name: "Sort by" }).click();
      await page.getByRole("option", { name: "Most copies first" }).click();
      await expect(page).toHaveURL(/sort=copies/);
      await expect(page.getByRole("link").filter({ hasText: "13090" }).first()).toBeVisible();
      const firstRow = page.locator("[data-slot='responsive-list'] a, main#main ul a, main#main table a").filter({ hasText: /\d{5}/ }).first();
      await expect(firstRow).toContainText("13090");

      // Series and section: Angle 11250 comes first.
      await page.getByRole("combobox", { name: "Sort by" }).click();
      await page.getByRole("option", { name: "Series and section" }).click();
      await expect(page).toHaveURL(/sort=code/);
      await expect(page.locator("main#main").getByText("11250").first()).toBeVisible();

      // A filter nothing matches says so and offers to clear (no seeded section is a semi hollow shape).
      await page.getByRole("combobox", { name: "Shape" }).click();
      await page.getByRole("option", { name: "Semi hollow" }).click();
      await expect(page).toHaveURL(/kind=semi/);
      await expect(page.getByText("No die matches")).toBeVisible();
      await page.getByRole("button", { name: "Clear filters" }).first().click();
      await expect(page).not.toHaveURL(/kind=|sort=|tile=/);
      await expect(page.getByRole("link", { name: /13090/ }).first()).toBeVisible();
    });
  });

  test.describe(`copy on trial at ${width}`, () => {
    test(`${plan.a}: a production run refuses it; the die room issues it to ${plan.run} and takes it back on trial`, async ({ page }) => {
      await open(page, `/dies/copies/${copyId(plan.a)}`, { role: "dieroom", width });
      await expect(page.locator("main#main h1")).toHaveText(plan.a);
      const panel = page.getByTestId("trial-panel");
      await expect(panel).toContainText("On trial");
      await expect(panel).toContainText("goes only to a die trial run");
      // The die room cannot waive the trial: only a manager can.
      await expect(page.getByRole("button", { name: "Release without a trial" })).toHaveCount(0);
      await expectClean(page, `${plan.a}_trial`);

      // The server refuses a production run (PR-2 is a production run of Tee) and changes nothing.
      const refused = await trpcMutate(page, "dieInstance.issues.issue", {
        dieInstanceId: copyId(plan.a),
        pressLineId: "dev-press-line-1",
        pressRunId: "dev-run-13090-queued",
      });
      expect(refused.status).toBe(400);
      expect(JSON.stringify(refused.body)).toContain("is on trial");

      // The issue form offers a copy on trial only the trial run.
      await page.goto("/dies/issues");
      await expect(page.locator("main#main h1")).toHaveText("Issue and return");
      const form = page.getByTestId("issue-form");
      await pickFromSearch(page, form, "Copy", plan.a);
      await expect(page.getByTestId("trial-note")).toContainText("goes only to a die trial run");
      await form.getByRole("combobox", { name: "Press run" }).click();
      const options = page.getByRole("option");
      await expect(options).toHaveCount(3);
      await expect(page.getByRole("option", { name: new RegExp(`${plan.run} .* Die trial`) })).toBeVisible();
      await expect(page.getByRole("option", { name: /PR-2/ })).toHaveCount(0);
      await page.getByRole("option", { name: new RegExp(plan.run) }).click();
      await expectClean(page, `${plan.a}_issue_form`);
      await form.getByRole("button", { name: "Issue", exact: true }).click();

      const mine = page.getByTestId("open-issues").getByTestId(`issue-${plan.a}`);
      await expect(mine).toContainText("Issued to P1");
      await expect(mine).toContainText(plan.run);

      // Back from the press it is on trial again, not in the rack.
      await mine.getByRole("button", { name: "Take back" }).click();
      await expect(page.getByTestId("open-issues").getByTestId(`issue-${plan.a}`)).toHaveCount(0);
      await page.goto(`/dies/copies/${copyId(plan.a)}`);
      await expect(page.getByTestId("trial-panel")).toBeVisible();
      await expect(page.locator("main#main").getByText("On trial").first()).toBeVisible();
    });

    test(`${plan.b}: the owner releases it without a trial, with a reason that is kept`, async ({ page }) => {
      await open(page, `/dies/copies/${copyId(plan.b)}`, { role: "owner", width });
      await expect(page.locator("main#main h1")).toHaveText(plan.b);
      await page.getByRole("button", { name: "Release without a trial" }).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toContainText(`Release ${plan.b} without a trial?`);
      await expectClean(page, `${plan.b}_release`);

      // A reason is needed.
      await dialog.getByRole("button", { name: "Release", exact: true }).click();
      await expect(dialog.getByRole("alert")).toContainText("Write why");
      await expect(page.getByTestId("trial-panel")).toBeVisible();

      const reason = `Same die as 13090-1, trialled at the maker (${width})`;
      await dialog.getByLabel("Reason").fill(reason);
      await dialog.getByRole("button", { name: "Release", exact: true }).click();
      await expect(page.getByText(`${plan.b} is available`)).toBeVisible();
      await expect(page.getByTestId("trial-panel")).toHaveCount(0);
      await expect(page.locator("main#main").getByText("In rack").first()).toBeVisible();

      // The reason and who released it are in the audit trail.
      const history = await trpcQuery<{ items: { action: string; meta: Record<string, unknown> }[] }>(page, "audit.forSubject", {
        subjectType: "die_instance",
        subjectId: copyId(plan.b),
      });
      const release = history.items.find((i) => i.action === "die_trial.release");
      expect(release?.meta).toMatchObject({ reason, from: "on_trial", to: "available" });

      // Now a production run takes it (the API accepts it; nothing else stops it).
      const card = await trpcQuery<{ instance: { status: string } }>(page, "dieInstance.get", { id: copyId(plan.b) });
      expect(card.instance.status).toBe("available");
    });

    test(`${plan.c}: a viewer and the die room see no way to waive the trial`, async ({ page }) => {
      await open(page, `/dies/copies/${copyId(plan.c)}`, { role: "viewer", width });
      await expect(page.getByTestId("trial-panel")).toBeVisible();
      await expect(page.getByRole("button", { name: /Release without a trial|Issue to a trial run/ })).toHaveCount(0);
      await expect(page.getByRole("link", { name: "Issue to a trial run" })).toHaveCount(0);
      await page.goto("/dies");
      await expect(page.getByTestId("tile-on_trial")).toBeVisible();
      await expect(page.getByRole("button", { name: "More actions" })).toHaveCount(0);
      await expect(page.getByTestId("trial-setting")).toHaveCount(0);
      // The server agrees: a viewer cannot release.
      const res = await trpcMutate(page, "dieInstance.trialPass", { id: copyId(plan.c), reason: "I want it" });
      expect(res.status).toBe(403);
    });
  });

  test.describe(`maker numbers at ${width}`, () => {
    test(`${plan.c}: the maker's numbers are saved, shown on the card, printed on the A4 sheet and can be cleared`, async ({ page }) => {
      await open(page, `/dies/copies/${copyId(plan.c)}`, { role: "dieroom", width });
      await expect(page.locator("main#main h1")).toHaveText(plan.c);
      const dieNo = `MD-22${width}`;
      const projectNo = `PRJ/26/${width}`;

      await page.getByRole("button", { name: "More actions" }).click();
      await page.getByRole("menuitem", { name: "Edit card" }).click();
      const sheet = page.getByRole("dialog");
      await sheet.getByLabel("Maker die no.").fill(dieNo);
      await sheet.getByLabel("Maker project no.").fill(projectNo);
      await expectClean(page, `${plan.c}_edit`);
      await sheet.getByRole("button", { name: "Save", exact: true }).click();
      await expect(page.getByText("Card saved")).toBeVisible();

      // On the card.
      const card = page.locator("main#main");
      await expect(card.getByText(dieNo, { exact: true }).first()).toBeVisible();
      await expect(card.getByText(projectNo, { exact: true }).first()).toBeVisible();

      // Round trip: a fresh load of the card reads them from the server, and the edit sheet opens with them.
      await page.reload();
      await expect(page.locator("main#main h1")).toHaveText(plan.c);
      await expect(page.locator("main#main").getByText(dieNo, { exact: true }).first()).toBeVisible();
      await page.getByRole("button", { name: "More actions" }).click();
      await page.getByRole("menuitem", { name: "Edit card" }).click();
      await expect(page.getByRole("dialog").getByLabel("Maker die no.")).toHaveValue(dieNo);
      await expect(page.getByRole("dialog").getByLabel("Maker project no.")).toHaveValue(projectNo);
      await page.getByRole("dialog").getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);

      // The A4 sheet carries both.
      await page.evaluate(() => document.documentElement.setAttribute("data-die-print", ""));
      await page.emulateMedia({ media: "print", colorScheme: "light", reducedMotion: "reduce" });
      const sheetA4 = page.getByTestId("print-card");
      await expect(sheetA4).toBeVisible();
      await expect(sheetA4).toContainText(dieNo);
      await expect(sheetA4).toContainText(projectNo);
      await expect(sheetA4).toContainText("Maker die no.");
      await shot(page, `${plan.c}_print`);
      await page.emulateMedia({ media: "screen", colorScheme: "light", reducedMotion: "reduce" });
      await page.evaluate(() => document.documentElement.removeAttribute("data-die-print"));

      // Clearing both fields clears them on the server.
      await page.getByRole("button", { name: "More actions" }).click();
      await page.getByRole("menuitem", { name: "Edit card" }).click();
      await page.getByRole("dialog").getByLabel("Maker die no.").fill("");
      await page.getByRole("dialog").getByLabel("Maker project no.").fill("");
      await page.getByRole("dialog").getByRole("button", { name: "Save", exact: true }).click();
      await expect(page.getByText("Card saved")).toBeVisible();
      const after = await trpcQuery<{ instance: { makerDieNo: string | null; makerProjectNo: string | null } }>(page, "dieInstance.get", { id: copyId(plan.c) });
      expect(after.instance.makerDieNo).toBeNull();
      expect(after.instance.makerProjectNo).toBeNull();
    });
  });

  test.describe(`bulk drawings at ${width}`, () => {
    test(`${plan.section}.pdf, ${plan.c}.cdr and one name that matches nothing`, async ({ page }) => {
      await open(page, "/dies", { role: "dieroom", width });
      await page.getByRole("button", { name: "More actions" }).click();
      await page.getByRole("menuitem", { name: "Attach drawings by file name" }).click();
      const sheet = page.getByTestId("bulk-sheet");
      await expect(sheet).toBeVisible();
      await expect(sheet).toContainText(`12170.pdf goes to die 12170.`);
      await expectClean(page, "bulk_pick");

      await page.getByTestId("bulk-input").setInputFiles([
        file(`${plan.section}.pdf`, "application/pdf"),
        file(`${plan.c}.cdr`, "application/octet-stream"),
        file("00000.pdf", "application/pdf"),
      ]);
      // The server read the names: two go up, one is listed and never guessed.
      await expect(sheet.getByTestId("bulk-upload")).toBeVisible();
      await expect(sheet.getByTestId(`bulk-file-${plan.section}.pdf`)).toContainText("Press drawing");
      await expect(sheet.getByTestId(`bulk-file-${plan.c}.cdr`)).toContainText(`Copy ${plan.c}`);
      await expect(sheet.getByTestId("bulk-unmatched")).toContainText("00000.pdf");
      await expect(sheet.getByTestId("bulk-unmatched")).toContainText("No die or copy has this code");
      await expect(sheet.getByRole("heading", { name: "To attach (2)" })).toBeVisible();
      await expect(sheet.getByRole("heading", { name: "Not attached (1)" })).toBeVisible();
      await expectClean(page, "bulk_ready");

      await page.getByTestId("bulk-start").click();
      await expect(sheet.getByTestId("bulk-summary")).toContainText("2 saved, 0 failed, 0 already there, 1 not matched.");
      await expect(sheet.getByTestId("bulk-progress-text")).toHaveText("2 of 2 files");
      await expect(sheet.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
      await expect(sheet.getByTestId(`bulk-file-${plan.section}.pdf`)).toContainText("Saved");
      await expect(sheet.getByTestId(`bulk-file-${plan.c}.cdr`)).toContainText("Saved");
      await expectClean(page, "bulk_done");

      // What the server holds: the PDF is the section's press drawing, the CDR is on the copy.
      const section = await trpcQuery<{ files: { filename: string; pressDrawing: boolean; dieInstanceId: string | null }[] }>(page, "die.get", {
        id: await sectionId(page, plan.section),
      });
      expect(section.files.find((f) => f.filename === `${plan.section}.pdf`)).toMatchObject({ pressDrawing: true, dieInstanceId: null });
      const copy = await trpcQuery<{ files: { filename: string; kind: string; dieInstanceId: string | null }[] }>(page, "dieInstance.get", { id: copyId(plan.c) });
      expect(copy.files.find((f) => f.filename === `${plan.c}.cdr`)).toMatchObject({ kind: "cdr", dieInstanceId: copyId(plan.c) });

      // The same pick again adds nothing twice.
      await page.getByRole("dialog").getByRole("button", { name: "Close" }).last().click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await page.getByRole("button", { name: "More actions" }).click();
      await page.getByRole("menuitem", { name: "Attach drawings by file name" }).click();
      await page.getByTestId("bulk-input").setInputFiles([file(`${plan.section}.pdf`, "application/pdf"), file(`${plan.c}.cdr`, "application/octet-stream")]);
      await expect(page.getByTestId("bulk-already")).toContainText(`${plan.section}.pdf`);
      await expect(page.getByRole("heading", { name: "Already there (2)" })).toBeVisible();
      await expect(page.getByTestId("bulk-start")).toBeDisabled();
    });
  });
}

/** The section id behind a section code (the board lists it; `die.list` search finds it). */
async function sectionId(page: Page, code: string): Promise<string> {
  const res = await trpcQuery<{ items: { id: string; sectionCode: string }[] }>(page, "die.list", { search: code, limit: 10 });
  const hit = res.items.find((d) => d.sectionCode === code);
  expect(hit, `section ${code}`).toBeTruthy();
  return hit!.id;
}

test.describe("bulk attach reports a refused file on its own row", () => {
  test("375: a 26 MB PDF shows the server's size message; the other file still goes", async ({ page }) => {
    await open(page, "/dies", { role: "dieroom", width: 375 });
    await page.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: "Attach drawings by file name" }).click();
    await page.getByTestId("bulk-input").setInputFiles([
      { name: "12212.pdf", mimeType: "application/pdf", buffer: Buffer.alloc(26 * 1024 * 1024, 1) },
      file("12212-note.png", "image/png"),
    ]);
    const sheet = page.getByTestId("bulk-sheet");
    // 12212-note.png names no copy or section: listed, never guessed.
    await expect(sheet.getByTestId("bulk-unmatched")).toContainText("12212-note.png");
    await expect(sheet.getByRole("heading", { name: "To attach (1)" })).toBeVisible();
    await page.getByTestId("bulk-start").click();
    const row = sheet.getByTestId("bulk-file-12212.pdf");
    await expect(row).toContainText("Failed");
    await expect(row.getByRole("alert")).toContainText("larger than 25 MB");
    await expect(sheet.getByTestId("bulk-summary")).toContainText("0 saved, 1 failed");
    await expect(page.getByTestId("bulk-retry")).toBeVisible();
    await expectClean(page, "bulk_failed");
  });
});

test.describe("a 3,000-row die sheet goes in two calls", () => {
  test("1280: 2,000 rows then 1,000, with progress and one request id each; the board refreshes after", async ({ page }) => {
    await open(page, "/dies", { role: "owner", width: 1280 });
    // The check call is real (it reads the plant's dies, 2,000 rows at a time); the save is answered in the
    // browser so the local plant does not fill with 3,000 dies.
    const sent = await answer(page, "die.processImport", async (input, call) => {
      const i = input as { newRows: unknown[]; updatedRows: unknown[] };
      // Hold the first call so the progress bar is seen between the two.
      if (call === 0) await new Promise((r) => setTimeout(r, 600));
      return { data: { success: true, count: i.newRows.length + i.updatedRows.length, replayed: false } };
    });

    const rows: (string | number)[][] = [["Series", "Section code", "Name", "Min weight (kg/12ft)", "Max weight (kg/12ft)"]];
    for (let i = 0; i < 3000; i++) rows.push(["BULK", `B${String(i).padStart(5, "0")}`, `Bulk ${i}`, 2.0, 2.2]);
    await page.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: "Import CSV" }).click();
    const sheet = page.getByRole("dialog");
    await expect(sheet).toBeVisible();
    await page.locator("[data-slot='import-sheet'] input[type='file']").setInputFiles({
      name: "dies-3000.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(rows.map((r) => r.join(",")).join("\n")),
    });
    await expect(page.locator("[data-slot='import-sheet']")).toHaveAttribute("data-stage", "review", { timeout: 60_000 });
    await expect(sheet.locator("[data-slot='status-block']").first()).toContainText("3,000");
    await expectClean(page, "import_review");
    await sheet.getByRole("button", { name: "Import 3,000 rows" }).click();

    // Progress between the calls: 2,000 of 3,000.
    await expect(sheet.getByRole("progressbar")).toBeVisible();
    await expect(page.locator("[data-slot='import-sheet']")).toHaveAttribute("data-stage", "done", { timeout: 60_000 });
    await expect(sheet.locator("[data-slot='status-block']")).toContainText("3,000");

    const calls = sent as { newRows: unknown[]; clientRequestId: string }[];
    expect(calls.map((c) => c.newRows.length)).toEqual([2000, 1000]);
    expect(new Set(calls.map((c) => c.clientRequestId)).size).toBe(2);
  });
});

test.describe("Hindi on a phone", () => {
  test("375: the board tiles, the copy on trial and the bulk sheet read in Hindi", async ({ page }) => {
    const plan = PLAN[375];
    await open(page, "/dies", { role: "dieroom", width: 375, locale: "hi" });
    const tiles = page.getByTestId("board-tiles");
    await expect(tiles).toContainText("ट्रायल पर");
    await expect(tiles).toContainText("बिना कॉपी वाले die");
    await expect(page.getByRole("combobox", { name: "इस क्रम में" })).toBeVisible();
    await expectClean(page, "board");

    await page.goto(`/dies/copies/${copyId(plan.c)}`);
    await expect(page.locator("main#main h1")).toHaveText(plan.c);
    const panel = page.getByTestId("trial-panel");
    await expect(panel).toContainText("ट्रायल पर");
    await expect(panel).toContainText("सिर्फ़ die ट्रायल रन पर जाती है");
    await expectClean(page, "trial_card");

    await page.goto("/dies");
    await page.getByRole("button", { name: "और विकल्प" }).click();
    await page.getByRole("menuitem", { name: "फ़ाइल के नाम से ड्रॉइंग जोड़ें" }).click();
    await expect(page.getByRole("dialog")).toContainText("फ़ाइल का नाम बताता है");
    await expect(page.getByTestId("bulk-sheet")).toContainText("12170.pdf, die 12170 में जाती है।");
    await expectClean(page, "bulk");
  });
});

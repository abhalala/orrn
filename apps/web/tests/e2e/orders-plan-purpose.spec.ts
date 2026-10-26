import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

import { test } from "./helpers/test";
import { signInViaApi, type LocalRole } from "./helpers/accounts";
import { ownPress, type OwnPress } from "./helpers/own-press";
import { API_URL, WEB_ORIGIN } from "./helpers/ports";
import { expectNoClippedText, expectNoHorizontalScroll } from "../helpers/layout-guards";

/**
 * Plan purpose on the plan board (BACKLOG 61, FP-PR-23): an order.plan holder drafts a die trial and a
 * sample plan on `/orders/plan` (a die, a copy, a planned kg, no order lines), releases them, and the
 * queued runs behave as trial / sample runs: the station shows the banner, the die room issues a copy
 * on trial only to the die trial run. Each width runs on a press line of its own (D29).
 */
const WIDTHS = [820, 1280] as const;
const SECTION = "dev-die-13090";

async function open(page: Page, role: LocalRole, width: number, path: string) {
  await page.setViewportSize({ width, height: 900 });
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await signInViaApi(page, role);
  await page.goto(path);
  await expect(page.locator("[data-slot='app-shell']")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("main#main h1").first()).toBeVisible({ timeout: 30_000 });
}

async function axeSerious(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .exclude(".TanStackRouterDevtools")
    .exclude("[class*='tsqd-']")
    .exclude("[data-sonner-toaster]")
    .analyze();
  return results.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => ({ id: v.id, targets: v.nodes.slice(0, 5).map((n) => n.target.join(" ")) }));
}

async function trpcMutate(page: Page, path: string, input: unknown) {
  const res = await page.context().request.post(`${API_URL}/trpc/${path}`, { headers: { origin: WEB_ORIGIN }, data: input });
  return { status: res.status(), body: await res.json() };
}

/** Draft a non-production plan on the board and release it; returns the plan id and its run. */
async function draftAndRelease(page: Page, own: OwnPress, opts: { purpose: "Die trial" | "Sample"; copyCode?: string; kg?: string }) {
  await page.goto("/orders/plan");
  await expect(page.getByTestId("plan-purpose")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("plan-purpose")).toHaveValue("production");
  await expect(page.getByRole("heading", { name: "Open lines", level: 3 })).toBeVisible();
  await page.getByTestId("plan-purpose").selectOption({ label: opts.purpose });
  // No order lines: the open-lines board gives way to the die / copy form.
  await expect(page.getByRole("heading", { name: "Open lines", level: 3 })).toHaveCount(0);
  const form = page.locator("[data-trial-form]");
  await expect(form).toBeVisible();
  const save = page.getByRole("button", { name: "Save draft plan" });
  await expect(save).toBeDisabled();

  await page.getByRole("combobox", { name: "Press", exact: true }).waitFor();
  await page.getByRole("combobox", { name: "Press", exact: true }).selectOption({ label: `${own.lineCode} · Test press ${own.lineCode}` });

  const dieBox = form.getByRole("combobox", { name: "Die", exact: true });
  await dieBox.click();
  await dieBox.fill("13090");
  await page.getByRole("option", { name: /^13090/ }).first().click();
  await expect(save).toBeEnabled();

  if (opts.copyCode) {
    const copyBox = form.getByRole("combobox", { name: "Die copy", exact: true });
    await copyBox.click();
    await copyBox.fill(opts.copyCode);
    await page.getByRole("option", { name: opts.copyCode }).first().click();
  }
  if (opts.kg) await form.getByLabel("Planned kg").fill(opts.kg);
  await save.click();

  await expect(page).toHaveURL(/\/orders\/plan\/[^/]+$/, { timeout: 20_000 });
  const planId = page.url().split("/").pop()!;
  await expect(page.locator("[data-plan-status='draft']")).toBeVisible();
  await expect(page.locator(`[data-plan-purpose='${opts.purpose === "Die trial" ? "die_trial" : "sample"}']`)).toHaveText(opts.purpose);
  if (opts.copyCode) await expect(page.locator("[data-plan-note]")).toContainText(opts.copyCode);
  if (opts.kg) await expect(page.locator("[data-plan-note]")).toContainText(`${opts.kg} kg`);
  // No order line to add: the other-lines list is for production plans only.
  await expect(page.locator("[data-other-lines]")).toHaveCount(0);

  await page.getByRole("button", { name: "Release to press" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Release to press" }).click();
  await expect(page.locator("[data-plan-status='released']")).toBeVisible({ timeout: 20_000 });
  const run = page.locator("[data-run]").first();
  await expect(run).toContainText("Queued");
  const runNumber = (await run.getAttribute("data-run"))!;
  const got = await own.api.query<{ runs: { id: string; number: string }[] }>("plans.get", { id: planId });
  const runId = got.runs.find((r) => r.number === runNumber)!.id;
  return { planId, runNumber, runId };
}

for (const width of WIDTHS) {
  test.describe(`plan purpose at ${width}`, () => {
    let own: OwnPress | null = null;
    const copies: string[] = [];
    test.afterEach(async () => {
      try {
        for (const id of copies.splice(0)) {
          await own?.api.mutate("dieInstance.update", { id, status: "retired" }).catch(() => undefined);
        }
      } finally {
        await own?.cleanup();
        own = null;
      }
    });

    test("a die trial and a sample plan are drafted on the board, released, and the runs behave as such", async ({ page }) => {
      test.setTimeout(240_000);
      own = await ownPress({ sectionId: SECTION, purpose: "die_trial", tag: `P${width}`, runs: 0 });
      const trialCopy = await own.api.mutate<{ id: string; code: string; status: string }>("dieInstance.create", { sectionId: SECTION });
      const secondTrialCopy = await own.api.mutate<{ id: string; code: string; status: string }>("dieInstance.create", { sectionId: SECTION });
      copies.push(trialCopy.id, secondTrialCopy.id);
      expect(trialCopy.status).toBe("on_trial");

      await open(page, "office", width, "/orders/plan");
      const trial = await draftAndRelease(page, own, { purpose: "Die trial", copyCode: trialCopy.code, kg: "500" });
      expect(await axeSerious(page)).toEqual([]);
      const sample = await draftAndRelease(page, own, { purpose: "Sample" });

      // The board lists both with their purpose chip.
      await page.goto("/orders/plan");
      await expect(page.locator("[data-plan-purpose='die_trial']").first()).toHaveText("Die trial");
      await expect(page.locator("[data-plan-purpose='sample']").first()).toHaveText("Sample");
      await expectNoHorizontalScroll(page);
      await expectNoClippedText(page, "main#main");
      expect(await axeSerious(page)).toEqual([]);

      // The server holds them as trial and sample plans, with no order line.
      const got = await own.api.query<{ plan: { purpose: string; note: string | null }; lines: unknown[] }>("plans.get", { id: trial.planId });
      expect(got.plan.purpose).toBe("die_trial");
      expect(got.plan.note).toContain(trialCopy.code);
      expect(got.lines).toHaveLength(0);

      // Station: the die trial run shows the trial banner, the sample run does not.
      await open(page, "press", width, `/press/runs/${trial.runId}`);
      await expect(page.getByText("Die trial. Say whether it passed or failed when you log it.")).toBeVisible({ timeout: 20_000 });
      await page.goto(`/press/runs/${sample.runId}`);
      await expect(page.locator("main#main h1").first()).toBeVisible();
      await expect(page.getByText("Die trial. Say whether it passed")).toHaveCount(0);

      // Die room: the copy on trial is offered the die trial run only, never the sample run.
      await open(page, "dieroom", width, "/dies/issues");
      const refused = await trpcMutate(page, "dieInstance.issues.issue", { dieInstanceId: secondTrialCopy.id, pressLineId: own.lineId, pressRunId: sample.runId });
      expect(refused.status).toBe(400);
      expect(JSON.stringify(refused.body)).toContain("is on trial");

      const form = page.getByTestId("issue-form");
      const copyBox = form.getByRole("combobox", { name: "Copy", exact: true });
      await copyBox.click();
      await copyBox.fill(trialCopy.code);
      await page.getByRole("option", { name: trialCopy.code }).first().click();
      await form.getByRole("combobox", { name: "Press run" }).click();
      await expect(page.getByRole("option", { name: new RegExp(`^${trial.runNumber} .* Die trial`) })).toBeVisible();
      await expect(page.getByRole("option", { name: new RegExp(`^${sample.runNumber} `) })).toHaveCount(0);
      await page.getByRole("option", { name: new RegExp(`^${trial.runNumber} `) }).click();
      await form.getByRole("button", { name: "Issue", exact: true }).click();
      const mine = page.getByTestId("open-issues").getByTestId(`issue-${trialCopy.code}`);
      await expect(mine).toContainText(`Issued to ${own.lineCode}`);
      await expect(mine).toContainText(trial.runNumber);
    });
  });
}

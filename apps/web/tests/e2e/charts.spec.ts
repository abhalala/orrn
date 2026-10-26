import AxeBuilder from "@axe-core/playwright";
import { expect, type Locator, type Page } from "@playwright/test";

import { expectEventually } from "./helpers/resilient";
import { test } from "./helpers/test";
import { expectNoClippedText, expectNoHorizontalScroll } from "../helpers/layout-guards";

/**
 * The chart kit (`@orrn/ui/charts`) on the dev-only /__ui page, Charts
 * section. Every analytics screen is built from these, so the rules live
 * here: a table view with the same numbers, tooltips by keyboard and
 * pointer, a legend for two or more series, nothing identified by colour
 * alone, axe clean, no motion under reduced motion, layout guards.
 */

const SCHEMES = ["light", "dark"] as const;

/** Every card with a plot and a table, the edge cases included. */
const PLOTTED = [
  "chart-volume",
  "chart-leaders",
  "chart-trend",
  "chart-ageing",
  "chart-presses",
  "chart-edge-converge",
  "chart-edge-peak",
  "chart-edge-first-day",
  "chart-edge-area",
] as const;

async function openCharts(
  page: Page,
  opts: { width: number; scheme?: "light" | "dark"; reducedMotion?: boolean } = { width: 1280 },
) {
  await page.setViewportSize({ width: opts.width, height: 900 });
  await page.emulateMedia({
    colorScheme: opts.scheme ?? "light",
    reducedMotion: opts.reducedMotion === false ? "no-preference" : "reduce",
  });
  await page.goto("/__ui");
  await expect(page.locator("html")).toHaveClass(new RegExp(`\\b${opts.scheme ?? "light"}\\b`));
  const section = page.locator("section[aria-labelledby='kit-charts']");
  await section.scrollIntoViewIfNeeded();
  // Lazy section: wait for its plots to measure and draw.
  await expect(section.locator("[data-testid='chart-trend'] svg [data-slot='chart-point']").first()).toBeAttached();
  return section;
}

const card = (section: Locator, id: string) => section.getByTestId(id);
const tooltip = (c: Locator) => c.locator("[data-slot='chart-tooltip']");

async function tableCells(c: Locator) {
  await c.getByRole("button", { name: "Show table" }).click();
  const table = c.getByRole("table");
  await expect(table).toBeVisible();
  return table;
}

test.describe("table view", () => {
  test("every chart card has a Show table toggle that swaps to a real table and back", async ({ page }) => {
    const section = await openCharts(page);
    for (const id of PLOTTED) {
      const c = card(section, id);
      const toggle = c.getByRole("button", { name: "Show table" });
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
      await toggle.click();
      const hide = c.getByRole("button", { name: "Hide table" });
      await expect(hide).toHaveAttribute("aria-expanded", "true");
      const table = c.getByRole("table");
      await expect(table.locator("th[scope='col']").first()).toBeVisible();
      await expect(table.locator("tbody tr").first()).toBeVisible();
      await hide.click();
      await expect(c.getByRole("table")).toHaveCount(0);
    }
  });

  test("bar chart: the tooltip and the table show the same number", async ({ page }) => {
    const section = await openCharts(page);
    const c = card(section, "chart-volume");
    const bar = c.locator("[data-slot='chart-bar']").nth(3);
    const label = (await bar.getAttribute("aria-label")) ?? "";
    await bar.hover();
    const tip = tooltip(c);
    await expect(tip).toBeVisible();
    const [month, value] = label.split(": ");
    expect(month && value).toBeTruthy();
    await expect(tip).toContainText(month!);
    await expect(tip).toContainText(value!);
    const table = await tableCells(c);
    const row = table.locator("tbody tr", { hasText: month! });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText(value!.replace(/ kg$/, ""));
  });

  test("time series: every series value in the tooltip is in the table row for that day", async ({ page }) => {
    const section = await openCharts(page);
    const c = card(section, "chart-trend");
    const point = c.locator("[data-slot='chart-point'][tabindex='0']");
    await point.focus();
    const tip = tooltip(c);
    await expect(tip).toBeVisible();
    const date = (await tip.locator("[data-slot='chart-tooltip-title']").textContent())!.trim();
    const values = await tip.locator("[data-slot='chart-tooltip-value']").allTextContents();
    expect(values).toHaveLength(2);
    const table = await tableCells(c);
    const row = table.locator("tbody tr", { has: page.locator("th", { hasText: new RegExp(`^${date}$`) }) });
    await expect(row).toHaveCount(1);
    for (const v of values) await expect(row).toContainText(v.replace(/ kg$/, "").trim());
  });

  test("ranked bars: the direct labels are the table's numbers", async ({ page }) => {
    const section = await openCharts(page);
    const c = card(section, "chart-leaders");
    const first = c.locator("[data-slot='ranked-row']").first();
    const name = (await first.locator("[data-slot='ranked-label']").textContent())!.trim();
    const value = (await first.locator("[data-slot='ranked-value']").textContent())!.trim();
    const table = await tableCells(c);
    const row = table.locator("tbody tr", { hasText: name });
    await expect(row).toContainText(value);
    // Other is folded in, never a ninth colour.
    await expect(table.locator("tbody tr").last()).toContainText("Other");
  });
});

test.describe("tooltips", () => {
  test("time series: Tab lands on the chart, arrows move the crosshair, Home and End jump", async ({ page }) => {
    const section = await openCharts(page);
    const c = card(section, "chart-trend");
    const points = c.locator("[data-slot='chart-point']");
    const count = await points.count();
    expect(count).toBeGreaterThan(30);
    // One tab stop for the whole plot (roving tabindex).
    await expect(c.locator("[data-slot='chart-point'][tabindex='0']")).toHaveCount(1);
    // The range control sits above the plot, so the plot is the next tab stop.
    await c.getByRole("radio", { name: "Last 90 days" }).focus();
    await page.keyboard.press("Tab");
    await expect(c.locator("[data-slot='chart-point']:focus")).toHaveCount(1);
    const tip = tooltip(c);
    await expect(tip).toBeVisible();
    const before = await tip.locator("[data-slot='chart-tooltip-title']").textContent();
    await page.keyboard.press("ArrowLeft");
    await expect(tip.locator("[data-slot='chart-tooltip-title']")).not.toHaveText(before!);
    await page.keyboard.press("Home");
    await expect(points.first()).toBeFocused();
    await page.keyboard.press("End");
    await expect(points.last()).toBeFocused();
    // The focused point's accessible name says the same as the tooltip.
    const name = await points.last().getAttribute("aria-label");
    const title = (await tip.locator("[data-slot='chart-tooltip-title']").textContent())!.trim();
    expect(name).toContain(title);
    await page.keyboard.press("Escape");
    await expect(tip).toBeHidden();
  });

  test("time series: the pointer snaps the crosshair to the nearest day anywhere on the plot", async ({ page }) => {
    const section = await openCharts(page);
    const c = card(section, "chart-trend");
    const plot = c.locator("svg[data-slot='chart-plot']");
    await plot.scrollIntoViewIfNeeded();
    const box = (await plot.boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.5, box.y + 12);
    const tip = tooltip(c);
    await expect(tip).toBeVisible();
    // A vertical hairline has no width, so check it is drawn rather than "visible".
    await expect(c.locator("[data-slot='chart-crosshair']")).toHaveCount(1);
    await expect(tip.locator("[data-slot='chart-tooltip-value']")).toHaveCount(2);
    await page.mouse.move(box.x + box.width + 40, box.y - 40);
    await expect(tip).toBeHidden();
  });

  test("bar chart: each bar is focusable and shows its own tooltip", async ({ page }) => {
    const section = await openCharts(page);
    const c = card(section, "chart-volume");
    const bars = c.locator("[data-slot='chart-bar']");
    await expect(bars).toHaveCount(13);
    await expect(c.locator("[data-slot='chart-bar'][tabindex='0']")).toHaveCount(1);
    await bars.first().focus();
    await expect(tooltip(c)).toContainText((await bars.first().getAttribute("aria-label"))!.split(": ")[0]!);
    await page.keyboard.press("ArrowRight");
    await expect(bars.nth(1)).toBeFocused();
    await expect(tooltip(c)).toContainText((await bars.nth(1).getAttribute("aria-label"))!.split(": ")[0]!);
  });
});

test.describe("identity is never colour alone", () => {
  test("two series get a legend with words; single series get none", async ({ page }) => {
    const section = await openCharts(page);
    const legend = card(section, "chart-trend").getByRole("list", { name: "Legend" });
    await expect(legend.getByRole("listitem")).toHaveText(["Packed", "Dispatched"]);
    for (const id of ["chart-volume", "chart-leaders", "chart-ageing"]) {
      await expect(card(section, id).getByRole("list", { name: "Legend" })).toHaveCount(0);
    }
  });

  test("lines are direct-labelled at their ends and every mark has a text name", async ({ page }) => {
    const section = await openCharts(page);
    const trend = card(section, "chart-trend");
    await expect(trend.locator("[data-slot='chart-end-label']")).toHaveText(["Packed, so far", "Dispatched, so far"]);
    for (const id of ["chart-volume", "chart-ageing"]) {
      const names = await card(section, id).locator("[data-slot='chart-bar']").evaluateAll((els) =>
        els.map((e) => e.getAttribute("aria-label") ?? ""),
      );
      expect(names.every((n) => /\S+: \S+/.test(n))).toBe(true);
    }
  });

  test("rank movement is written in words, not only an arrow or a colour", async ({ page }) => {
    const section = await openCharts(page);
    const chips = card(section, "chart-leaders").locator("[data-slot='rank-movement']");
    await expectEventually(() => chips.count()).toBeGreaterThan(3);
    for (const text of await chips.allInnerTexts()) expect(text.trim()).toMatch(/^(Up \d+|Down \d+|Same|New)$/);
  });

  test("the sparkline tile names its trend for screen readers", async ({ page }) => {
    const section = await openCharts(page);
    const spark = card(section, "chart-spark").getByRole("img");
    await expect(spark).toHaveAttribute("aria-label", /Dispatched, last 12 months: .+ kg to .+ kg, high .+ kg, low .+ kg/);
  });
});

test.describe("states", () => {
  test("loading, empty and error cards say what is happening", async ({ page }) => {
    const section = await openCharts(page);
    await expect(card(section, "chart-loading")).toHaveAttribute("aria-busy", "true");
    await expect(card(section, "chart-empty")).toContainText("No data for this period");
    const error = card(section, "chart-error");
    await expect(error).toContainText("This chart didn't load");
    await expect(error.getByRole("button", { name: "Try again" })).toBeVisible();
    for (const id of ["chart-loading", "chart-empty", "chart-error"]) {
      await expect(card(section, id).getByRole("button", { name: "Show table" })).toHaveCount(0);
    }
  });
});

test.describe("accessibility", () => {
  for (const width of [375, 1280] as const) {
    for (const scheme of SCHEMES) {
      test(`axe: charts and their tables clean at ${width}px (${scheme})`, async ({ page }) => {
        const section = await openCharts(page, { width, scheme });
        await card(section, "chart-trend").getByRole("button", { name: "Show table" }).click();
        await card(section, "chart-volume").locator("[data-slot='chart-bar']").first().focus();
        const results = await new AxeBuilder({ page })
          .include("section[aria-labelledby='kit-charts']")
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
          .analyze();
        const blocking = results.violations
          .filter((v) => v.impact === "serious" || v.impact === "critical")
          .map((v) => ({ id: v.id, help: v.help, targets: v.nodes.slice(0, 5).map((n) => n.target.join(" ")) }));
        expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
      });
    }
  }
});

test.describe("motion", () => {
  const chartAnimations = (page: Page) =>
    page.evaluate(() =>
      document
        .getAnimations()
        .filter((a) => {
          const target = (a.effect as KeyframeEffect | null)?.target as Element | null;
          return !!target?.closest("section[aria-labelledby='kit-charts']");
        })
        .filter((a) => a.playState === "running")
        .map((a) => (a as CSSAnimation).animationName ?? a.constructor.name),
    );

  test("reduced motion: nothing in the charts animates", async ({ page }) => {
    await openCharts(page, { width: 1280, reducedMotion: true });
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    expect(await chartAnimations(page)).toEqual([]);
  });

  test("without reduced motion the marks reveal once", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.goto("/__ui");
    const section = page.locator("section[aria-labelledby='kit-charts']");
    await section.scrollIntoViewIfNeeded();
    await expect(section.locator("[data-slot='chart-point']").first()).toBeAttached();
    const names = await page.evaluate(() => document.getAnimations().map((a) => (a as CSSAnimation).animationName));
    expect(names).toContain("orrn-chart-in");
  });
});

test.describe("layout", () => {
  for (const width of [375, 820, 1280] as const) {
    for (const scheme of SCHEMES) {
      test(`no sideways scroll and no clipped text at ${width}px (${scheme})`, async ({ page }) => {
        const section = await openCharts(page, { width, scheme });
        await expectNoHorizontalScroll(page);
        await expectNoClippedText(page, section);
        // With every table open too.
        for (const id of PLOTTED) {
          await card(section, id).getByRole("button", { name: "Show table" }).click();
        }
        await expectNoHorizontalScroll(page);
        await expectNoClippedText(page, section);
      });
    }
  }

  test("plots stay inside their cards and axis labels don't overlap at 375px", async ({ page }) => {
    const section = await openCharts(page, { width: 375 });
    for (const id of PLOTTED.filter((id) => id !== "chart-leaders")) {
      const c = card(section, id);
      const cb = (await c.boundingBox())!;
      const pb = (await c.locator("svg[data-slot='chart-plot']").boundingBox())!;
      expect(pb.x).toBeGreaterThanOrEqual(cb.x);
      expect(pb.x + pb.width).toBeLessThanOrEqual(cb.x + cb.width + 0.5);
      const boxes = await c.locator("svg [data-slot='chart-x-tick']").evaluateAll((els) =>
        els.map((e) => {
          const r = e.getBoundingClientRect();
          return { left: r.left, right: r.right };
        }),
      );
      for (let i = 1; i < boxes.length; i++) expect(boxes[i]!.left).toBeGreaterThanOrEqual(boxes[i - 1]!.right);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Review round 1: correctness, not just presence                             */
/* -------------------------------------------------------------------------- */

test.describe("review round 1", () => {
  for (const width of [375, 1280] as const) {
    test(`ranked bars are on one scale: every track is the same width and bars are proportional (${width}px)`, async ({
      page,
    }) => {
      const section = await openCharts(page, { width });
      const c = card(section, "chart-leaders");
      await expectEventually(() => c.locator("[data-slot='ranked-row']").count()).toBe(9); // top 8 + Other, once the chart has drawn
      const rows = await c.locator("[data-slot='ranked-row']").evaluateAll((els) =>
        els.map((el) => ({
          value: Number(el.getAttribute("data-value")),
          bar: el.querySelector<HTMLElement>("[data-slot='ranked-bar']")!.getBoundingClientRect().width,
          track: el.querySelector<HTMLElement>("[data-slot='ranked-track']")!.getBoundingClientRect().width,
        })),
      );
      expect(rows.length).toBe(9); // top 8 + Other
      const track = rows[0]!.track;
      const peak = Math.max(...rows.map((r) => r.value));
      for (const r of rows) {
        expect(Math.abs(r.track - track)).toBeLessThanOrEqual(0.5);
        expect(Math.abs(r.bar - (r.value / peak) * track)).toBeLessThanOrEqual(1);
      }
    });
  }

  test("every y axis uses one unit: all non-zero ticks share a suffix", async ({ page }) => {
    const section = await openCharts(page);
    for (const id of PLOTTED.filter((id) => id !== "chart-leaders")) {
      const ticks = (await card(section, id).locator("[data-slot='chart-y-tick']").allTextContents()).filter((t) => t !== "0");
      expect(ticks.length).toBeGreaterThan(1);
      const suffixes = new Set(ticks.map((t) => t.replace(/^[\d.,-]+/, "")));
      expect([...suffixes], `${id}: ${ticks.join(" ")}`).toHaveLength(1);
    }
    await expect(card(section, "chart-volume").locator("[data-slot='chart-y-tick']")).toHaveText(["0", "0.5L", "1L", "1.5L", "2L"]);
  });

  test("tables have one row per mark and every mark's value is in its row", async ({ page }) => {
    const section = await openCharts(page);
    for (const id of ["chart-volume", "chart-ageing"]) {
      const c = card(section, id);
      const names = await c.locator("[data-slot='chart-bar']").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")!));
      const table = await tableCells(c);
      await expect(table.locator("tbody tr")).toHaveCount(names.length);
      for (const [i, name] of names.entries()) {
        const [label, value] = name.split(": ");
        await expect(table.locator("tbody tr").nth(i)).toContainText(label!);
        await expect(table.locator("tbody tr").nth(i)).toContainText(value!);
      }
    }
    const trend = card(section, "chart-trend");
    const points = await trend.locator("[data-slot='chart-point']").count();
    await expect((await tableCells(trend)).locator("tbody tr")).toHaveCount(points);
    const leaders = card(section, "chart-leaders");
    const ranked = await leaders.locator("[data-slot='ranked-row']").count();
    await expect((await tableCells(leaders)).locator("tbody tr")).toHaveCount(ranked);
  });

  test("a missing movement reads No data in the table, never Same", async ({ page }) => {
    const section = await openCharts(page);
    const c = card(section, "chart-leaders");
    const row = c.locator("[data-slot='ranked-row']", { hasText: "Kutch Facade Systems" });
    await expect(row.locator("[data-slot='rank-movement']")).toHaveCount(0);
    const table = await tableCells(c);
    await expect(table.locator("tbody tr", { hasText: "Kutch Facade Systems" })).toContainText("No data");
    await expect(table.locator("tbody tr", { hasText: "Kutch Facade Systems" })).not.toContainText("Same");
  });

  test("ranked bars: share has words for screen readers, Other is outside the list, ranks aren't read twice", async ({ page }) => {
    const section = await openCharts(page);
    const c = card(section, "chart-leaders");
    await expect(c.getByRole("listitem")).toHaveCount(8);
    await expect(c.getByText("Other customers", { exact: true })).toBeVisible();
    await expect(c.getByText(/^\d+(\.\d)?% of total$/).first()).toBeAttached();
    const rank = c.locator("[data-slot='ranked-rank']").first();
    await expect(rank).toHaveAttribute("aria-hidden", "true");
  });

  test("the partial last day is drawn as provisional and says so far everywhere", async ({ page }) => {
    const section = await openCharts(page);
    const c = card(section, "chart-trend");
    const dashed = c.locator("[data-slot='chart-partial-segment']");
    await expect(dashed).toHaveCount(2);
    for (const d of await dashed.all()) expect(await d.getAttribute("stroke-dasharray")).toBeTruthy();
    const hollow = c.locator("[data-slot='chart-end-dot'][data-partial]");
    await expect(hollow).toHaveCount(2);
    for (const h of await hollow.all()) expect(await h.getAttribute("fill")).toBe("var(--card)");
    const last = c.locator("[data-slot='chart-point']").last();
    await expect(last).toHaveAttribute("aria-label", /so far/);
    await last.focus();
    await expect(tooltip(c).locator("[data-slot='chart-tooltip-title']")).toContainText("so far");
    const table = await tableCells(c);
    await expect(table.locator("tbody tr").last()).toContainText("so far");

    const vol = card(section, "chart-volume");
    const bar = vol.locator("[data-slot='chart-bar-mark'][data-partial]");
    await expect(bar).toHaveCount(1);
    expect(Number(await bar.getAttribute("fill-opacity"))).toBeLessThan(1);
    expect(await bar.getAttribute("stroke-width")).toBe("2");
    await expect(vol.locator("[data-slot='chart-bar']").last()).toHaveAttribute("aria-label", /so far/);
  });

  test("legend swatches match their lines by key, also after a series is filtered out", async ({ page }) => {
    const section = await openCharts(page);
    const c = card(section, "chart-presses");
    const check = async (keys: string[]) => {
      await expect(c.locator("[data-slot='legend-swatch']")).toHaveCount(keys.length);
      for (const key of keys) {
        const swatch = await c.locator(`[data-slot='legend-swatch'][data-series='${key}']`).evaluate((e) => getComputedStyle(e).backgroundColor);
        const stroke = await c.locator(`[data-series='${key}'] [data-slot='chart-line']`).evaluate((e) => getComputedStyle(e).stroke);
        expect(swatch, key).toBe(stroke);
      }
    };
    await check(["press-1", "press-2", "press-3"]);
    const press2 = await c.locator("[data-series='press-2'] [data-slot='chart-line']").evaluate((e) => getComputedStyle(e).stroke);
    await section.getByTestId("presses-demo").getByRole("radio", { name: "Presses 2 and 3" }).click();
    await check(["press-2", "press-3"]);
    // The survivor keeps its colour.
    expect(await c.locator("[data-series='press-2'] [data-slot='chart-line']").evaluate((e) => getComputedStyle(e).stroke)).toBe(press2);
  });

  test("keyboard is the same in both charts: newest first, Left and Right in x order, Home and End", async ({ page }) => {
    const section = await openCharts(page);
    for (const [id, slot] of [
      ["chart-volume", "chart-bar"],
      ["chart-trend", "chart-point"],
    ] as const) {
      const c = card(section, id);
      const marks = c.locator(`[data-slot='${slot}']`);
      const n = await marks.count();
      await expect(marks.nth(n - 1)).toHaveAttribute("tabindex", "0");
      await marks.nth(n - 1).focus();
      await page.keyboard.press("ArrowLeft");
      await expect(marks.nth(n - 2)).toBeFocused();
      await page.keyboard.press("ArrowRight");
      await expect(marks.nth(n - 1)).toBeFocused();
      await page.keyboard.press("Home");
      await expect(marks.first()).toBeFocused();
      await page.keyboard.press("End");
      await expect(marks.last()).toBeFocused();
    }
  });

  test("at 375px tooltips never cover the y ticks or the peak value label", async ({ page }) => {
    const section = await openCharts(page, { width: 375 });
    const overlaps = (a: DOMRect, b: DOMRect) =>
      Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5;
    for (const [id, slot] of [
      ["chart-volume", "chart-bar"],
      ["chart-trend", "chart-point"],
      ["chart-ageing", "chart-bar"],
    ] as const) {
      const c = card(section, id);
      const marks = c.locator(`[data-slot='${slot}']`);
      const n = await marks.count();
      for (const i of [0, Math.floor(n / 2), n - 1]) {
        await marks.nth(i).focus();
        const tip = (await tooltip(c).boundingBox())!;
        const avoid = await c
          .locator("[data-slot='chart-y-tick'], [data-slot='chart-cap-label']")
          .evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON()));
        const t = { left: tip.x, right: tip.x + tip.width, top: tip.y, bottom: tip.y + tip.height } as DOMRect;
        for (const a of avoid) expect(overlaps(t, a as DOMRect), `${id} mark ${i}: ${JSON.stringify({ t, a })}`).toBe(false);
      }
    }
  });

  test("bar focus ring is rounded and stays inside the plot, clear of the x labels", async ({ page }) => {
    const section = await openCharts(page, { width: 375 });
    const c = card(section, "chart-volume");
    await c.locator("[data-slot='chart-bar']").last().focus();
    await page.keyboard.press("ArrowLeft");
    const ring = c.locator("[data-slot='chart-focus-ring']");
    await expect(ring).toHaveCount(1);
    expect(Number(await ring.getAttribute("rx"))).toBeGreaterThanOrEqual(8);
    const rb = (await ring.boundingBox())!;
    const tickTop = Math.min(...(await c.locator("[data-slot='chart-x-tick']").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().top))));
    expect(rb.y + rb.height).toBeLessThanOrEqual(tickTop);
  });

  test("end labels don't sit on the other line", async ({ page }) => {
    const section = await openCharts(page);
    const hits = await card(section, "chart-trend").evaluate((root) => {
      const labels = Array.from(root.querySelectorAll<SVGTextElement>("[data-slot='chart-end-label']"));
      const lines = Array.from(root.querySelectorAll<SVGPathElement>("[data-slot='chart-line'], [data-slot='chart-partial-segment']"));
      const svg = root.querySelector("svg")!;
      const out: string[] = [];
      for (const label of labels) {
        const b = label.getBBox();
        for (const line of lines) {
          for (let i = 0; i <= 20; i++)
            for (let j = 0; j <= 4; j++) {
              const p = svg.createSVGPoint();
              p.x = b.x + (b.width * i) / 20;
              p.y = b.y + (b.height * j) / 4;
              if (line.isPointInStroke(p)) out.push(`${label.textContent} on ${line.closest("[data-series]")?.getAttribute("data-series")}`);
            }
        }
      }
      return [...new Set(out)];
    });
    expect(hits).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* Re-review round 1: attribution, focus, shrinking data, labels vs ticks      */
/* -------------------------------------------------------------------------- */

type Rect = { left: number; right: number; top: number; bottom: number };
const rects = (l: Locator) =>
  l.evaluateAll((els) =>
    els.map((e) => {
      const r = e.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    }),
  );
/** Do two boxes come closer than `gap` px on both axes? (SVG text boxes leave out the 2px halo.) */
const tooClose = (a: Rect, b: Rect, gap = 0) =>
  a.left < b.right + gap && b.left < a.right + gap && a.top < b.bottom + gap && b.top < a.bottom + gap;

/** The range control's data lands late (as with `placeholderData`); wait for it. */
async function switchRangeByKeyboard(c: Locator, page: Page, from: string) {
  await c.getByRole("radio", { name: from }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(c).toHaveAttribute("aria-busy", "true");
}

function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && /RangeError|TypeError|Invalid time value|undefined/.test(m.text())) errors.push(m.text());
  });
  return errors;
}

/** Each end label's distance to its own end dot and to the other end dots. */
function endLabelReach(c: Locator) {
  return c.evaluate((root) => {
    const dots = Array.from(root.querySelectorAll("[data-slot='chart-end-dot']")).map((d) => {
      const r = d.getBoundingClientRect();
      return { key: d.getAttribute("data-series"), x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    return Array.from(root.querySelectorAll("[data-slot='chart-end-label']")).map((label) => {
      const b = label.getBoundingClientRect();
      const reach = (p: { x: number; y: number }) =>
        Math.hypot(Math.max(b.left - p.x, 0, p.x - b.right), Math.max(b.top - p.y, 0, p.y - b.bottom));
      const key = label.getAttribute("data-series");
      const own = dots.find((d) => d.key === key);
      return {
        text: label.textContent,
        own: own ? reach(own) : Number.POSITIVE_INFINITY,
        others: dots.filter((d) => d.key !== key).map(reach),
      };
    });
  });
}

test.describe("re-review round 1", () => {
  test("end labels sit beside their own dot, and give way to the legend when the line ends meet", async ({ page }) => {
    const section = await openCharts(page);
    // Separate ends: both labelled, each next to its own dot and clear of the other.
    const trend = await endLabelReach(card(section, "chart-trend"));
    expect(trend).toHaveLength(2);
    for (const l of trend) {
      expect(l.own, JSON.stringify(l)).toBeLessThanOrEqual(16);
      for (const o of l.others) expect(o, JSON.stringify(l)).toBeGreaterThanOrEqual(l.own + 6);
    }
    // Ends 3px apart (7,050.6 vs 6,900 kg): no label could be told apart, so none are drawn.
    const converge = card(section, "chart-edge-converge");
    expect(Number(await converge.locator("svg[data-slot='chart-plot']").getAttribute("width"))).toBeGreaterThan(420);
    const labels = await endLabelReach(converge);
    for (const l of labels) {
      expect(l.own, JSON.stringify(labels)).toBeLessThanOrEqual(16);
      for (const o of l.others) expect(o, JSON.stringify(labels)).toBeGreaterThanOrEqual(l.own + 6);
    }
    expect(labels).toHaveLength(0);
    await expect(converge.getByRole("list", { name: "Legend" }).getByRole("listitem")).toHaveText(["Packed", "Dispatched"]);
  });

  test("bar focus ring stays on the focused bar after Escape and while the pointer is elsewhere", async ({ page }) => {
    const section = await openCharts(page);
    const c = card(section, "chart-volume");
    const bars = c.locator("[data-slot='chart-bar']");
    const ring = c.locator("[data-slot='chart-focus-ring']");
    const n = await bars.count();
    const ringOn = async (i: number) => {
      const rb = (await ring.boundingBox())!;
      const bb = (await bars.nth(i).boundingBox())!;
      expect(Math.abs(rb.x + rb.width / 2 - (bb.x + bb.width / 2))).toBeLessThanOrEqual(1);
    };
    await c.getByRole("radio", { name: "12 months" }).focus();
    await page.keyboard.press("Tab");
    await expect(bars.nth(n - 1)).toBeFocused();
    await expect(ring).toHaveCount(1);
    // Escape hides the tooltip, never the focus indicator.
    await page.keyboard.press("Escape");
    await expect(tooltip(c)).toBeHidden();
    await expect(bars.nth(n - 1)).toBeFocused();
    await expect(ring).toHaveCount(1);
    await ringOn(n - 1);
    await page.keyboard.press("ArrowLeft");
    await expect(bars.nth(n - 2)).toBeFocused();
    await expect(tooltip(c)).toBeVisible();
    // The pointer over another bar moves the tooltip, not the ring.
    await bars.nth(2).hover();
    await expect(tooltip(c)).toContainText((await bars.nth(2).getAttribute("aria-label"))!.split(": ")[0]!);
    await expect(ring).toHaveCount(1);
    await ringOn(n - 2);
    const box = (await c.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, Math.max(1, box.y - 30));
    await expect(tooltip(c)).toBeHidden();
    await expect(bars.nth(n - 2)).toBeFocused();
    await expect(ring).toHaveCount(1);
    await ringOn(n - 2);
  });

  test("the bar focus ring never runs through a value label (375px)", async ({ page }) => {
    const section = await openCharts(page, { width: 375 });
    const c = card(section, "chart-volume");
    const bars = c.locator("[data-slot='chart-bar']");
    const n = await bars.count();
    await c.getByRole("radio", { name: "12 months" }).focus();
    await page.keyboard.press("Tab");
    // The newest bar, then the September peak with its value label.
    for (const i of [n - 1, n - 2]) {
      if (i !== n - 1) await page.keyboard.press("ArrowLeft");
      await expect(bars.nth(i)).toBeFocused();
      const ring = (await rects(c.locator("[data-slot='chart-focus-ring']")))[0]!;
      for (const cap of await rects(c.locator("[data-slot='chart-cap-label']"))) {
        const across = cap.left < ring.right && ring.left < cap.right;
        if (across) expect(ring.top, `bar ${i}`).toBeGreaterThanOrEqual(cap.bottom);
      }
    }
  });

  test("hovering a late day, then switching 90 to 30 days, never crashes the chart", async ({ page }) => {
    const errors = collectErrors(page);
    const section = await openCharts(page);
    const c = card(section, "chart-trend");
    await c.scrollIntoViewIfNeeded();
    const box = (await c.locator("svg[data-slot='chart-plot']").boundingBox())!;
    // Day 54 of 90 is not in the last 30 days.
    await page.mouse.move(box.x + box.width * 0.6, box.y + box.height / 2);
    await expect(tooltip(c)).toBeVisible();
    await switchRangeByKeyboard(c, page, "Last 90 days");
    await expect(c).not.toHaveAttribute("aria-busy", "true");
    await expect(c.locator("[data-slot='chart-point']")).toHaveCount(30);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    expect(errors).toEqual([]);
    await expect(c.locator("svg[data-slot='chart-plot']")).toBeVisible();
    // Hidden, or re-snapped to a day that is on the chart now.
    if (await tooltip(c).isVisible()) {
      const title = (await tooltip(c).locator("[data-slot='chart-tooltip-title']").textContent())!.trim();
      const names = await c.locator("[data-slot='chart-point']").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label") ?? ""));
      expect(names.some((n) => n.startsWith(`${title}:`))).toBe(true);
    }
  });

  test("focusing the newest day while 30 days load keeps focus, ring and tooltip on that day", async ({ page }) => {
    const errors = collectErrors(page);
    const section = await openCharts(page);
    const c = card(section, "chart-trend");
    await switchRangeByKeyboard(c, page, "Last 90 days");
    // Tab from the range control into the plot before the new points land.
    await page.keyboard.press("Tab");
    const points = c.locator("[data-slot='chart-point']");
    await expect(points).toHaveCount(90);
    await expect(points.last()).toBeFocused();
    await expect(c).toHaveAttribute("aria-busy", "true");
    await expect(c).not.toHaveAttribute("aria-busy", "true");
    await expect(points).toHaveCount(30);
    await expect(points.last()).toBeFocused();
    expect(errors).toEqual([]);
    const name = (await points.last().getAttribute("aria-label"))!;
    await expect(tooltip(c).locator("[data-slot='chart-tooltip-title']")).toHaveText(name.split(": ")[0]!);
    await expect(tooltip(c).locator("[data-slot='chart-tooltip-title']")).toContainText("so far");
  });

  test("hovering a late month, then switching 12 to 6 months, never crashes the bar chart", async ({ page }) => {
    const errors = collectErrors(page);
    const section = await openCharts(page);
    const c = card(section, "chart-volume");
    const bars = c.locator("[data-slot='chart-bar']");
    await expect(bars).toHaveCount(13);
    await bars.nth(10).hover();
    await expect(tooltip(c)).toBeVisible();
    await switchRangeByKeyboard(c, page, "12 months");
    await expect(c).not.toHaveAttribute("aria-busy", "true");
    await expect(bars).toHaveCount(7);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    expect(errors).toEqual([]);
    await expect(c.locator("svg[data-slot='chart-plot']")).toBeVisible();
  });

  for (const width of [375, 1280] as const) {
    test(`value labels on bars never touch the y-axis ticks, also when the first bar is the peak (${width}px)`, async ({
      page,
    }) => {
      const section = await openCharts(page, { width });
      for (const id of ["chart-edge-peak", "chart-volume", "chart-ageing", "chart-edge-first-day"]) {
        const c = card(section, id);
        const caps = await rects(c.locator("[data-slot='chart-cap-label']"));
        expect(caps.length, id).toBeGreaterThan(0);
        const ticks = await rects(c.locator("[data-slot='chart-y-tick']"));
        for (const cap of caps)
          for (const tick of ticks) expect(tooClose(cap, tick, 3), `${id}: ${JSON.stringify({ cap, tick })}`).toBe(false);
      }
    });
  }

  test("the peak value label goes on the tallest complete bar, never on a taller open month", async ({ page }) => {
    const section = await openCharts(page);
    const c = card(section, "chart-edge-peak");
    const caps = c.locator("[data-slot='chart-cap-label']");
    await expect(caps).toHaveText(["1,96,320.5 kg"]);
    const marks = await rects(c.locator("[data-slot='chart-bar-mark']"));
    const cap = (await rects(caps))[0]!;
    // Over the first (oldest) bar, not the open October bar at the end.
    expect(cap.left).toBeLessThanOrEqual(marks[0]!.left + 0.5);
    expect(cap.right).toBeGreaterThan(marks[0]!.right);
    expect(cap.right).toBeLessThan(marks.at(-1)!.left);
  });

  test("an open month on its first day is still drawn (a sliver, never nothing)", async ({ page }) => {
    const section = await openCharts(page);
    const c = card(section, "chart-edge-first-day");
    const partial = c.locator("[data-slot='chart-bar-mark'][data-partial]");
    await expect(partial).toHaveCount(1);
    expect(await partial.getAttribute("d")).toBeTruthy();
    const b = (await partial.boundingBox())!;
    expect(b.height).toBeGreaterThanOrEqual(2);
  });

  test("the provisional span is never drawn as settled: no solid line or area wash under it", async ({ page }) => {
    const section = await openCharts(page);
    for (const id of ["chart-trend", "chart-edge-area"]) {
      const c = card(section, id);
      const series = await c.locator("[data-series]:has([data-slot='chart-line'])").evaluateAll((groups) =>
        groups.map((g) => g.getAttribute("data-series")!),
      );
      expect(series.length, id).toBeGreaterThan(0);
      for (const key of series) {
        const dot = (await c.locator(`[data-slot='chart-end-dot'][data-partial][data-series='${key}']`).boundingBox())!;
        const dotX = dot.x + dot.width / 2;
        const line = (await c.locator(`[data-series='${key}'] [data-slot='chart-line']`).boundingBox())!;
        expect(line.x + line.width, `${id} ${key} solid line`).toBeLessThan(dotX - 1);
        const area = c.locator(`[data-series='${key}'] [data-slot='chart-area']`);
        if (id === "chart-edge-area") {
          const ab = (await area.boundingBox())!;
          expect(ab.x + ab.width, `${id} ${key} area`).toBeLessThan(dotX - 1);
        }
      }
    }
  });

  for (const width of [375, 1280] as const) {
    test(`a month axis that crosses a new year says which year (${width}px)`, async ({ page }) => {
      const section = await openCharts(page, { width });
      for (const id of ["chart-volume", "chart-edge-area"]) {
        const ticks = await card(section, id).locator("[data-slot='chart-x-tick']").allTextContents();
        expect(ticks[0], `${id}: ${ticks.join(" ")}`).toBe("Oct 25");
        expect(ticks.at(-1), `${id}: ${ticks.join(" ")}`).toBe("Oct");
        const withYear = ticks.filter((t) => /\d/.test(t));
        expect(withYear, `${id}: ${ticks.join(" ")}`).toHaveLength(2);
        expect(withYear[1]).toMatch(/^[A-Z][a-z]+ 26$/);
      }
      // A range inside one year carries none.
      const first = await card(section, "chart-edge-first-day").locator("[data-slot='chart-x-tick']").allTextContents();
      expect(first.some((t) => /\d/.test(t)), first.join(" ")).toBe(false);
    });
  }

  test("legend and ranked list keep list semantics in WebKit (role=list)", async ({ page }) => {
    const section = await openCharts(page);
    await expect(card(section, "chart-trend").locator("ul[aria-label='Legend']")).toHaveAttribute("role", "list");
    await expect(card(section, "chart-leaders").locator("ol")).toHaveAttribute("role", "list");
  });

  test("the sparkline summary reads full figures, not compact ones", async ({ page }) => {
    const section = await openCharts(page);
    await expect(card(section, "chart-spark").getByRole("img")).toHaveAttribute(
      "aria-label",
      "Dispatched, last 12 months: 1,48,320.5 kg to 1,92,370.8 kg, high 1,92,370.8 kg, low 1,39,480.2 kg",
    );
  });
});

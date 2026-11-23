import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { I18nProvider } from "@orrn/i18n";

const { BreakdownWorkOrderView, reconcileMade } = await import("./station-breakdown");
const { StillOpenList, openAge } = await import("./report-parts");

const view = (known: Parameters<typeof BreakdownWorkOrderView>[0]["known"]) =>
  renderToStaticMarkup(
    <I18nProvider locale="en">
      <BreakdownWorkOrderView known={known} downtimeId="d1" online made={null} pending={false} onMake={() => {}} />
    </I18nProvider>,
  );

describe("press station breakdown button", () => {
  test("a plant with no maintenance assets sees nothing new: no button, no hint", () => {
    expect(view({ hasAssets: false, items: [{ id: "d1", workOrderId: null, workOrderNumber: null, assetId: null }] })).toBe("");
    expect(view(undefined)).toBe("");
  });
  test("with assets: the hint when no asset points at this press, else the button or the work order", () => {
    expect(view({ hasAssets: true, items: [{ id: "d1", workOrderId: null, workOrderNumber: null, assetId: null }] })).toContain("Add this press to the assets first");
    expect(view({ hasAssets: true, items: [{ id: "d1", workOrderId: null, workOrderNumber: null, assetId: "a1" }] })).toContain("Make work order");
    expect(view({ hasAssets: true, items: [{ id: "d1", workOrderId: "w1", workOrderNumber: "WO-4", assetId: "a1" }] })).toContain("/maintenance/work-orders/w1");
  });
});

describe("report: breakdowns still open", () => {
  const row = (stillOpen: { startMs: number; ageMin: number; workOrderId: string | null; workOrderNumber: string | null }[]) => ({
    asset: { id: "a1", code: "CMP-1", name: "Compressor", kind: "compressor", criticality: "C" },
    stillOpen,
    months: [],
    total: { failures: 0, downtimeMin: 0, mttrMin: null, mtbfMin: null, labourMin: 0, sparesEntries: 0, labourPaise: null },
  });
  test("listed apart with their age; nothing when none is open", () => {
    const html = renderToStaticMarkup(
      <I18nProvider locale="en">
        <StillOpenList rows={[row([{ startMs: 0, ageMin: 3 * 24 * 60 + 5, workOrderId: "w1", workOrderNumber: "WO-7" }, { startMs: 1, ageMin: 90, workOrderId: null, workOrderNumber: null }])]} />
      </I18nProvider>,
    );
    expect(html).toContain("Still open");
    expect(html).toContain("WO-7");
    expect(html).toContain("Open for 3 days");
    expect(html).toContain("Open for 1:30");
    expect(html).toContain("Downtime entry");
    expect(renderToStaticMarkup(<I18nProvider locale="en"><StillOpenList rows={[row([])]} /></I18nProvider>)).toBe("");
  });
  test("age words", () => {
    expect(openAge(59)).toEqual({ key: "maint.reports.openFor", vars: { time: "0:59" } });
    expect(openAge(2 * 24 * 60)).toEqual({ key: "maint.reports.openForDays", vars: { n: 2 } });
  });
});

describe("breakdown link after creating a work order here", () => {
  const made = { id: "w9", number: "WO-9" };
  test("shown until the list is read again", () => {
    expect(reconcileMade(made, 1000, undefined, 500)).toBe(made);
    expect(reconcileMade(made, 1000, { workOrderId: null }, 900)).toBe(made);
  });
  test("kept when the refreshed list links the same order", () => {
    expect(reconcileMade(made, 1000, { workOrderId: "w9" }, 2000)).toBe(made);
  });
  test("dropped when the refreshed list no longer links it (cancelled elsewhere), so Make work order returns", () => {
    expect(reconcileMade(made, 1000, { workOrderId: null }, 2000)).toBeNull();
    expect(reconcileMade(made, 1000, { workOrderId: "w10" }, 2000)).toBeNull();
    expect(reconcileMade(null, 1000, undefined, 2000)).toBeNull();
    const html = view({ hasAssets: true, items: [{ id: "d1", workOrderId: null, workOrderNumber: null, assetId: "a1" }] });
    expect(html).toContain("Make work order");
  });
});

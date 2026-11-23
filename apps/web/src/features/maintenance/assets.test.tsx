import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { I18nProvider } from "@orrn/i18n";

import {
  addMonths,
  assetPayload,
  defaultRange,
  emptyAssetForm,
  emptyKindForm,
  emptyPlanForm,
  hoursFromMinutes,
  kindPayload,
  kindProblem,
  monthsBetween,
  paiseToRupeesText,
  planIntervalWords,
  planPayload,
  planProblem,
  rangeProblem,
  rupeesToPaise,
  splitLink,
  warrantyState,
} from "./asset-model";

const { AssetFields } = await import("./asset-form");
const { PlanCard } = await import("./asset-plans");
const { HistoryTable, SparesTable, WarrantyLine } = await import("./asset-parts");
const { MonthsTable, TotalsTable } = await import("./report-parts");

function render(node: React.ReactNode, locale: "en" | "hi" = "en") {
  return renderToStaticMarkup(<I18nProvider locale={locale}>{node}</I18nProvider>);
}

describe("asset form payload", () => {
  test("empty text becomes null and the link splits into kind and id", () => {
    const f = { ...emptyAssetForm(), code: " P1 ", name: "Press 1", link: "press:abc", warrantyUntil: "2027-03-01" };
    expect(assetPayload(f)).toEqual({
      code: "P1",
      name: "Press 1",
      kind: "press",
      linkKind: "press",
      linkId: "abc",
      make: null,
      serialNo: null,
      purchasedOn: null,
      warrantyUntil: "2027-03-01",
      location: null,
      criticality: "B",
      status: "running",
      note: null,
    });
    expect(splitLink("")).toEqual({ linkKind: null, linkId: null });
    expect(splitLink("crane:1")).toEqual({ linkKind: null, linkId: null });
  });
});

describe("warranty", () => {
  test("valid through its last day", () => {
    expect(warrantyState("2026-11-22", "2026-11-22")).toEqual({ state: "under", day: "2026-11-22" });
    expect(warrantyState("2026-11-21", "2026-11-22")?.state).toBe("ended");
    expect(warrantyState(null, "2026-11-22")).toBeNull();
  });
});

describe("plans", () => {
  test("interval words by days, hours or both", () => {
    expect(planIntervalWords(30, null)?.key).toBe("maint.assets.plans.everyDays");
    expect(planIntervalWords(null, 500)?.key).toBe("maint.assets.plans.everyHours");
    expect(planIntervalWords(30, 500)?.vars).toEqual({ days: 30, hours: 500 });
    expect(planIntervalWords(null, null)).toBeNull();
  });
  test("run hours are dropped without a link", () => {
    const f = { ...emptyPlanForm(), title: "Grease", days: "30", hours: "500" };
    expect(planPayload(f, false).intervalHours).toBeNull();
    expect(planPayload(f, true).intervalHours).toBe(500);
    expect(planProblem({ ...f, days: "" }, false)).toBe("interval");
    expect(planProblem({ ...f, title: " " }, true)).toBe("title");
    expect(planProblem(f, true)).toBeNull();
  });
});

describe("reading kinds", () => {
  test("limits are typed as decimals and sent in thousandths", () => {
    const f = { ...emptyKindForm(), name: "Oil", unit: "bar", low: "1.5", high: "" };
    expect(kindPayload(f)).toEqual({ name: "Oil", unit: "bar", minMilli: 1500, maxMilli: null });
    expect(kindProblem({ ...f, high: "x" })).toBe("limit");
    expect(kindProblem({ ...f, unit: "" })).toBe("name");
  });
});

describe("report range", () => {
  test("defaults to the last three months ending this month", () => {
    expect(defaultRange("2026-11-22")).toEqual({ from: "2026-09", to: "2026-11" });
    expect(defaultRange("2026-02-03")).toEqual({ from: "2025-12", to: "2026-02" });
    expect(addMonths("2026-01", -1)).toBe("2025-12");
  });
  test("lists months and refuses a wrong range", () => {
    expect(monthsBetween("2026-11", "2027-01")).toEqual(["2026-11", "2026-12", "2027-01"]);
    expect(rangeProblem("2026-01", "2026-12")).toBeNull();
    expect(rangeProblem("2026-01", "2027-01")).toBe("long");
    expect(rangeProblem("2026-05", "2026-04")).toBe("order");
    expect(rangeProblem("", "2026-04")).toBe("bad");
  });
  test("hours and rupees", () => {
    expect(hoursFromMinutes(90)).toBe("1.5");
    expect(hoursFromMinutes(120)).toBe("2");
    expect(hoursFromMinutes(null)).toBe("");
    expect(rupeesToPaise("250")).toBe(25000);
    expect(rupeesToPaise("99.5")).toBe(9950);
    expect(rupeesToPaise("")).toBeNull();
    expect(rupeesToPaise("1.234")).toBe("bad");
    expect(paiseToRupeesText(9950)).toBe("99.5");
    expect(paiseToRupeesText(25000)).toBe("250");
  });
});

const plan = { id: "p1", title: "Grease the rollers", steps: null, intervalDays: 30, intervalHours: null, active: true, due: { state: "soon", basis: "days" as const, daysLeft: 4, hoursLeft: null, hoursRun: null }, openWorkOrderId: "w1", openWorkOrderNumber: "MWO/0001" };

describe("asset screens render", () => {
  test("a plan shows its interval, due chip, due words and open work order", () => {
    const html = render(<PlanCard plan={plan} />);
    expect(html).toContain("Grease the rollers");
    expect(html).toContain("Every 30 days");
    expect(html).toContain("Due soon");
    expect(html).toContain("Due in 4 days");
    expect(html).toContain('href="/maintenance/work-orders/w1"');
  });
  test("a switched off plan is dimmed and says so", () => {
    const html = render(<PlanCard plan={{ ...plan, active: false }} />);
    expect(html).toContain("opacity-60");
    expect(html).toContain("Switched off");
    expect(html).not.toContain("Due in 4 days");
  });
  test("plans read in Hindi", () => {
    expect(render(<PlanCard plan={plan} />, "hi")).toContain("हर 30 दिन");
  });
  test("warranty line compares days", () => {
    const day = (d: string) => `D${d}`;
    expect(render(<WarrantyLine until="2027-01-01" today="2026-11-22" day={day} />)).toContain("Under warranty until D2027-01-01");
    expect(render(<WarrantyLine until="2026-01-01" today="2026-11-22" day={day} />)).toContain("Warranty ended D2026-01-01");
  });
  test("the form disables a press that already has an asset, but not this asset's own", () => {
    const options = [
      { kind: "press" as const, id: "a", code: "PR-1", name: null, retired: false, asset: { id: "x", code: "AST-1" } },
      { kind: "press" as const, id: "b", code: "PR-2", name: null, retired: false, asset: null },
    ];
    const html = render(<AssetFields form={emptyAssetForm()} onChange={() => {}} options={options} ownLink="" />);
    expect(html).toMatch(/<option value="press:a" disabled="">PR-1 \(Already asset AST-1\)<\/option>/);
    const own = render(<AssetFields form={emptyAssetForm()} onChange={() => {}} options={options} ownLink="press:a" />);
    expect(own).not.toContain('value="press:a" disabled');
  });
  test("history and spares tables", () => {
    const hist = render(<HistoryTable date={(at) => `at${at}`} rows={[{ id: "w1", number: "MWO/1", kind: "breakdown", status: "done", title: "Belt", createdAt: 5, finishedAt: 9, labourMin: 90 }]} />);
    expect(hist).toContain('href="/maintenance/work-orders/w1"');
    expect(hist).toContain("Breakdown");
    expect(hist).toContain("Done");
    expect(hist).toContain("1:30");
    const spares = render(<SparesTable date={(at) => `at${at}`} qty={(m) => String(m / 1000)} rows={[{ linkId: "l", workOrderId: "w1", workOrderNumber: "MWO/1", number: "ISS/1", itemName: "Bearing", unit: "nos", qtyMilli: 2000, issuedAt: 1, cancelledAt: 3 }]} />);
    expect(spares).toContain("2 nos");
    expect(spares).toContain("Cancelled in the store");
  });
});

const figures = { failures: 2, downtimeMin: 150, mttrMin: 75, mtbfMin: 600, labourMin: 90, sparesEntries: 3, labourPaise: 45000 };
const row = { asset: { id: "a1", code: "PR-1", name: "Press one", kind: "press", criticality: "A" }, months: [{ month: "2026-10", ...figures }], total: figures };

describe("report tables", () => {
  const money = (p: number) => `R${p / 100}`;
  test("shows downtime and repair as h:mm, time between breakdowns in hours, and cost when allowed", () => {
    const html = render(<TotalsTable rows={[row]} showMoney money={money} assetLabel="Name" />);
    expect(html).toContain("2:30");
    expect(html).toContain("1:15");
    expect(html).toContain(">10<");
    expect(html).toContain("R450");
    expect(html).toContain("Labour cost");
  });
  test("leaves the cost column out without money", () => {
    const html = render(<MonthsTable row={row} showMoney={false} money={money} />);
    expect(html).not.toContain("Labour cost");
    expect(html).toContain("2026-10");
  });
  test("reads in Hindi", () => {
    expect(render(<MonthsTable row={row} showMoney={false} money={money} />, "hi")).toContain("ब्रेकडाउन");
  });
});

/**
 * A plant set to pounds, feet and inches and international grouping reads a stock row in those units; a plant that
 * changed nothing reads the kg and mm it always did. Server render of the real list component.
 */
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { screenPrefs } from "@orrn/domain";
import { I18nProvider } from "@orrn/i18n";

import { FmtProvider } from "@/shared/lib/fmt";

import { BundleList, type BundleListItem } from "./bundle-list";

const ROW: BundleListItem = {
  id: "b1",
  serial: "BG-0001",
  status: "available",
  quantity: 21,
  weightG: 1_234_567_890, // 1,234,567.89 kg: big enough to show the grouping
  lengthMm: 3810,
  poNumber: null,
  dieSeries: "6063",
  dieSectionCode: "A12",
  createdAt: Date.UTC(2026, 10, 1),
  kgPer12ftMilli: 2090,
  locationCode: "Y1",
};

const page = { page: 1, pageSize: 25, total: 1, onPageChange() {} } as never;

function html(units: Parameters<typeof screenPrefs>[0]) {
  return renderToStaticMarkup(
    <I18nProvider locale="en">
      <FmtProvider prefs={screenPrefs(units)}>
        <BundleList rows={[ROW]} total={1} page={page} loading={false} empty={null} label="Bundles" />
      </FmtProvider>
    </I18nProvider>,
  );
}

describe("a stock row in the plant's units", () => {
  test("a plant that changed nothing: kg with Indian grouping, mm, kg/12ft, headers say kg and kg/12ft", () => {
    const out = html({});
    expect(out).toContain("12,34,567.89");
    expect(out).toContain("3810 mm");
    expect(out).toContain("2.090");
    expect(out).toContain("Weight (kg)");
    expect(out).toContain(">kg/12ft<");
  });
  test("a plant on lb, feet and inches, lb per foot and international grouping", () => {
    const out = html({ units: { mass: "lb", length: "ft_in", linear_mass: "lb_ft" }, number: { grouping: "international" } });
    expect(out).toContain("2,721,756.30");
    expect(out).toContain("12 ft 6 in");
    expect(out).toContain("0.384");
    expect(out).toContain("Weight (lb)");
    expect(out).toContain(">lb/ft<");
    expect(out).not.toContain("12,34,567");
    expect(out).not.toContain("3810 mm");
  });
  test("a plant on tonnes and metres", () => {
    const out = html({ units: { mass: "t", length: "m" } });
    expect(out).toContain("1,234.568");
    expect(out).toContain("3.810 m");
    expect(out).toContain("Weight (t)");
  });
});

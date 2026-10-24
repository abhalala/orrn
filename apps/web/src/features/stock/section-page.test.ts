import { describe, expect, test } from "bun:test";

import { failedWithoutData, resolveSectionPage, type SectionDie } from "./section-page";
import type { SectionStock } from "./sections";

const die: SectionDie = { series: "ANGLE", sectionCode: "11250", name: "Angle 25x25", weightMinG: 2_400, weightMaxG: 2_600 };

const stock: SectionStock = {
  dieId: "d1",
  series: "ANGLE",
  sectionCode: "11250",
  name: "Angle 25x25",
  weightMinG: 2_400,
  weightMaxG: 2_600,
  available: { bundles: 3, weightG: 150_000 },
  held: { bundles: 0, weightG: 0 },
};

describe("resolveSectionPage (/stock/$dieId header)", () => {
  test("a live die is the header, with its die page", () => {
    expect(resolveSectionPage({ die, dieFailed: false, stock: undefined, summaryReady: false, probe: undefined })).toEqual({
      kind: "ready",
      header: { label: "ANGLE 11250", name: "Angle 25x25", weightMinG: 2_400, weightMaxG: 2_600, dieListed: true },
    });
  });

  test("waits while the die is loading", () => {
    expect(resolveSectionPage({ die: undefined, dieFailed: false, stock, summaryReady: true, probe: undefined })).toEqual({
      kind: "loading",
    });
  });

  test("a deleted die that still has stock: header from the stock summary, no die page link", () => {
    expect(resolveSectionPage({ die: null, dieFailed: false, stock, summaryReady: true, probe: undefined })).toEqual({
      kind: "ready",
      header: { label: "ANGLE 11250", name: "Angle 25x25", weightMinG: 2_400, weightMaxG: 2_600, dieListed: false },
    });
  });

  test("a deleted die with only past bundles: header from its bundles, no band", () => {
    expect(
      resolveSectionPage({
        die: null,
        dieFailed: false,
        stock: undefined,
        summaryReady: true,
        probe: { total: 2, first: { dieSeries: "TEE", dieSectionCode: "13072" } },
      }),
    ).toEqual({
      kind: "ready",
      header: { label: "TEE 13072", name: null, weightMinG: 0, weightMaxG: 0, dieListed: false },
    });
  });

  test("not found only when there is no die, no stock and no bundle at all", () => {
    const base = { die: null, dieFailed: false, stock: undefined } as const;
    expect(resolveSectionPage({ ...base, summaryReady: false, probe: undefined })).toEqual({ kind: "loading" });
    expect(resolveSectionPage({ ...base, summaryReady: true, probe: undefined })).toEqual({ kind: "loading" });
    expect(resolveSectionPage({ ...base, summaryReady: true, probe: { total: 0 } })).toEqual({ kind: "notFound" });
  });

  test("a die that failed to load: the summary still names the section, else an error with retry", () => {
    expect(resolveSectionPage({ die: undefined, dieFailed: true, stock, summaryReady: true, probe: undefined })).toEqual({
      kind: "ready",
      header: { label: "ANGLE 11250", name: "Angle 25x25", weightMinG: 2_400, weightMaxG: 2_600, dieListed: true },
    });
    expect(
      resolveSectionPage({ die: undefined, dieFailed: true, stock: undefined, summaryReady: true, probe: undefined }),
    ).toEqual({ kind: "error" });
  });
});

describe("failedWithoutData", () => {
  test("a first load that failed shows the error", () => {
    expect(failedWithoutData({ isError: true, data: undefined })).toBe(true);
  });

  test("a failed refetch keeps the numbers already on screen", () => {
    expect(failedWithoutData({ isError: true, data: { items: [] } })).toBe(false);
  });

  test("no error, no error state", () => {
    expect(failedWithoutData({ isError: false, data: undefined })).toBe(false);
  });
});

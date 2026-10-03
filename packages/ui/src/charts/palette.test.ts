import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The dataviz skill's validator, vendored verbatim. It computes the checks; we never eyeball them.
import { validate, validateOrdinal } from "../../scripts/validate_palette.js";
import { contrastRatio, parseHex } from "../lib/contrast";
import { c2, chartCategorical, chartChrome, chartOrdinal, chartSequential, tones } from "../tokens";
import { CHART_MAX_SERIES, assignSeriesSlots, foldToOther, seriesColor } from "./scales";

type Report = { report: [string, unknown, string][]; ok: boolean };
const run = (r: Report) => ({ ok: r.ok, failing: r.report.filter(([, s]) => s === false || s === "fail") });

const SURFACES = {
  light: [c2.light.surface, c2.light.canvas],
  dark: [c2.dark.surface, c2.dark.canvas],
} as const;

/* OKLab Delta E x100, the same metric the validator uses. */
function oklab(hex: string): [number, number, number] {
  const lin = parseHex(hex).map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  const [r, g, b] = lin;
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}
const deltaE = (a: string, b: string) => {
  const x = oklab(a);
  const y = oklab(b);
  return 100 * Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
};

describe("categorical palette (dataviz validator)", () => {
  test("eight slots per mode, fixed order", () => {
    expect(chartCategorical.light).toHaveLength(CHART_MAX_SERIES);
    expect(chartCategorical.dark).toHaveLength(CHART_MAX_SERIES);
  });

  for (const mode of ["light", "dark"] as const) {
    test(`${mode}: every hard check passes on the card surface (adjacent pairs)`, () => {
      const result = run(validate([...chartCategorical[mode]], { mode, surface: c2[mode].surface }));
      expect(result.failing).toEqual([]);
      expect(result.ok).toBe(true);
    });

    test(`${mode}: the first three slots pass all-pairs (scatter, small multiples)`, () => {
      const result = run(validate(chartCategorical[mode].slice(0, 3), { mode, surface: c2[mode].surface, pairs: "all" }));
      expect(result.failing).toEqual([]);
      expect(result.ok).toBe(true);
    });

    test(`${mode}: slots 1-3 clear 3:1 on the card surface; slot 1 (single series, sparklines) on the canvas too`, () => {
      for (const hex of chartCategorical[mode].slice(0, 3)) {
        expect(contrastRatio(hex, c2[mode].surface)).toBeGreaterThanOrEqual(3);
      }
      for (const surface of SURFACES[mode]) {
        expect(contrastRatio(chartCategorical[mode][0], surface)).toBeGreaterThanOrEqual(3);
      }
    });
  }

  test("dark steps are the same hues as light (selected, not flipped)", () => {
    const hue = (hex: string) => {
      const [, a, b] = oklab(hex);
      return ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
    };
    chartCategorical.light.forEach((hex, i) => {
      const d = Math.abs(hue(hex) - hue(chartCategorical.dark[i]!));
      expect(Math.min(d, 360 - d)).toBeLessThan(6);
    });
  });
});

describe("categorical palette never impersonates a C2 status tone", () => {
  // Status blocks are gradients; compare against both stops of every status tone.
  const stops = (["green", "blue", "amber", "red", "violet"] as const).flatMap((n) => [tones[n].from, tones[n].to]);
  for (const mode of ["light", "dark"] as const) {
    test(`${mode}: slots 1-3 sit >= 15 Delta E from every status stop, the rest >= 11`, () => {
      chartCategorical[mode].forEach((hex, i) => {
        const nearest = Math.min(...stops.map((s) => deltaE(hex, s)));
        expect(nearest).toBeGreaterThanOrEqual(i < 3 ? 15 : 11);
      });
    });
  }
});

describe("ordinal and sequential ramps", () => {
  test("sequential is one hue, monotone light to dark", () => {
    const steps = Object.values(chartSequential);
    expect(steps).toHaveLength(7);
    const L = steps.map((h) => oklab(h)[0]);
    for (let i = 1; i < L.length; i++) expect(L[i]!).toBeLessThan(L[i - 1]!);
  });

  for (const mode of ["light", "dark"] as const) {
    test(`${mode}: ordinal ramp passes the validator's ordinal checks`, () => {
      const result = run(validateOrdinal([...chartOrdinal[mode]], { mode, surface: c2[mode].surface }));
      expect(result.failing).toEqual([]);
      expect(result.ok).toBe(true);
    });
  }
});

describe("chart chrome", () => {
  for (const mode of ["light", "dark"] as const) {
    test(`${mode}: "Other" grey and the axis baseline are visible marks`, () => {
      expect(contrastRatio(chartChrome[mode].other, c2[mode].surface)).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(chartChrome[mode].axis, c2[mode].surface)).toBeGreaterThanOrEqual(1.4);
      // Gridlines stay recessive: quieter than the axis.
      expect(contrastRatio(chartChrome[mode].grid, c2[mode].surface)).toBeLessThan(
        contrastRatio(chartChrome[mode].axis, c2[mode].surface),
      );
    });
  }
});

describe("series colour follows the key, never the rank", () => {
  test("slots come from the stable domain, not the visible list", () => {
    const domain = ["packed", "dispatched", "returned"];
    expect(assignSeriesSlots(["packed", "dispatched", "returned"], domain)).toEqual({
      packed: 0,
      dispatched: 1,
      returned: 2,
    });
    // Filtering out the first series must not repaint the survivors.
    expect(assignSeriesSlots(["dispatched", "returned"], domain)).toEqual({ dispatched: 1, returned: 2 });
  });

  test("without a domain the given order is the domain", () => {
    expect(assignSeriesSlots(["b", "a"])).toEqual({ b: 0, a: 1 });
  });

  test("keys past the eighth slot are refused, never cycled", () => {
    const keys = Array.from({ length: 9 }, (_, i) => `k${i}`);
    expect(() => assignSeriesSlots(keys)).toThrow(/Other/);
  });

  test("seriesColor is a CSS variable per slot", () => {
    expect(seriesColor(0)).toBe("var(--chart-1)");
    expect(seriesColor(7)).toBe("var(--chart-8)");
    expect(() => seriesColor(8)).toThrow();
  });
});

describe("folding the tail into Other", () => {
  const rows = Array.from({ length: 11 }, (_, i) => ({ key: `c${i}`, label: `Customer ${i}`, value: 100 - i }));
  test("keeps the top N and sums the rest", () => {
    const { rows: top, other } = foldToOther(rows, 8);
    expect(top).toHaveLength(8);
    expect(top[0]!.key).toBe("c0");
    expect(other).toBe(92 + 91 + 90);
  });
  test("nothing to fold leaves Other at 0", () => {
    expect(foldToOther(rows.slice(0, 3), 8).other).toBe(0);
  });
});

/** globals.css mirrors the chart tokens (one source of truth). */
describe("globals.css chart variables mirror tokens.ts", () => {
  const css = readFileSync(join(import.meta.dir, "../styles/globals.css"), "utf8");
  const block = (selector: string) => {
    const start = css.indexOf(`${selector} {`);
    if (start === -1) throw new Error(`missing ${selector} block`);
    return css.slice(start, css.indexOf("}", start));
  };
  const varIn = (src: string, name: string) =>
    src.match(new RegExp(`--${name}:\\s*([^;]+);`))?.[1]?.trim().toLowerCase();

  for (const [selector, mode] of [
    [":root", "light"],
    [".dark", "dark"],
  ] as const) {
    test(`${selector}`, () => {
      const src = block(selector);
      chartCategorical[mode].forEach((hex, i) => expect(varIn(src, `chart-${i + 1}`)).toBe(hex));
      chartOrdinal[mode].forEach((hex, i) => expect(varIn(src, `chart-ord-${i + 1}`)).toBe(hex));
      expect(varIn(src, "chart-other")).toBe(chartChrome[mode].other);
      expect(varIn(src, "chart-grid")).toBe(chartChrome[mode].grid);
      expect(varIn(src, "chart-axis")).toBe(chartChrome[mode].axis);
    });
  }
});

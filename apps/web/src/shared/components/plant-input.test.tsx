import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";

import { screenPrefs } from "@orrn/domain";
import { NumberInput } from "@orrn/ui/components/field";

import { FmtProvider } from "@/shared/lib/fmt";
import { LENGTH_FT, LENGTH_IN, LENGTH_MM, MASS_G, MASS_KG, SECTION_KG12 } from "@/shared/lib/plant-input";

import { PlantInput } from "./plant-input";

const noop = () => {};
const render = (units: Parameters<typeof screenPrefs>[0], node: React.ReactNode) =>
  renderToStaticMarkup(<FmtProvider prefs={screenPrefs(units)}>{node}</FmtProvider>);

describe("a plant that changed nothing gets the old box, markup for markup", () => {
  const cases = [
    [MASS_KG, "kg"], [MASS_G, "g"], [LENGTH_MM, "mm"], [SECTION_KG12, "kg/12ft"], [LENGTH_FT, "ft"], [LENGTH_IN, "in"],
  ] as const;
  for (const [spec, suffix] of cases) {
    test(`${spec.native}: same HTML as the NumberInput with the ${suffix} suffix`, () => {
      const mine = render({}, <PlantInput spec={spec} value="12.5" onValueChange={noop} data-testid="x" aria-label="A" />);
      const old = render({}, <NumberInput value="12.5" onValueChange={noop} suffix={suffix} data-testid="x" aria-label="A" />);
      // the unit word beside the box differs only for inches, where the old forms said "in"
      expect(mine).toBe(old);
    });
  }
});

describe("a plant on another unit", () => {
  test("pounds: the box shows the draft kg text as pounds, with lb beside it", () => {
    const html = render({ units: { mass: "lb" } }, <PlantInput spec={MASS_KG} value="52.435" onValueChange={noop} aria-label="W" />);
    expect(html).toContain('value="115.6"');
    expect(html).toContain(">lb<");
  });
  test("a grams box on a pound plant reads pounds; on a tonne plant it stays grams", () => {
    expect(render({ units: { mass: "lb" } }, <PlantInput spec={MASS_G} value="227" onValueChange={noop} aria-label="W" />)).toContain('value="0.5"');
    expect(render({ units: { mass: "t" } }, <PlantInput spec={MASS_G} value="227" onValueChange={noop} aria-label="W" />)).toContain(">g<");
  });
  test("metres: the mm draft reads metres", () => {
    const html = render({ units: { length: "m" } }, <PlantInput spec={LENGTH_MM} value="3658" onValueChange={noop} aria-label="L" />);
    expect(html).toContain('value="3.658"');
    expect(html).toContain(">m<");
  });
  test("feet and inches: an mm draft reads 12 ft 6 in in a free-text box", () => {
    const html = render({ units: { length: "ft_in" } }, <PlantInput spec={LENGTH_MM} value="3810" onValueChange={noop} aria-label="L" />);
    expect(html).toContain('value="12 ft 6 in"');
    expect(html).toContain("ft in");
    expect(html).toContain('inputMode="text"');
  });
  test("kg per metre for a section weight", () => {
    const html = render({ units: { linear_mass: "kg_m" } }, <PlantInput spec={SECTION_KG12} value="2.088" onValueChange={noop} aria-label="S" />);
    expect(html).toContain('value="0.571"');
    expect(html).toContain(">kg/m<");
  });
});

/** No entry box for a weight, length or section weight is left on a fixed unit word. */
describe("every web entry form follows the plant", () => {
  const ROOT = join(import.meta.dir, "../..");
  function files(dir: string, out: string[] = []): string[] {
    for (const n of readdirSync(dir)) {
      const p = join(dir, n);
      if (statSync(p).isDirectory()) files(p, out);
      else if (/\.tsx$/.test(n) && !/\.test\./.test(n)) out.push(p);
    }
    return out;
  }
  const FIXED = /<NumberInput\b[^>]*?suffix=(\{t\("units\.(kg|g|mm)"\)\}|"kg"|"ft"|\{t\("units\.ft"\)\}|\{t\("units\.inch"\)\})/gs;
  test("no NumberInput carries a fixed kg, g, mm or ft suffix, except the feet and inches pair boxes", () => {
    const left: string[] = [];
    for (const f of files(ROOT)) {
      if (f.includes("features/ingest") || f.includes("dev-kit")) continue;
      const s = readFileSync(f, "utf8");
      for (const m of s.matchAll(FIXED)) {
        const el = m[0];
        // the feet and inches pair of a feet and inches plant: already in the plant's unit
        if (/(\.feet|\.inches|feet\b|inches\b)/.test(el) && /units\.(ft|inch)/.test(el)) continue;
        // The foundry's LDO tank dip is a gauge reading in inches ("Inches stay inches", foundry.melt.ldo.hint), not a product length.
        if (f.endsWith("features/foundry/melt-steps.tsx") && /ldo/.test(el)) continue;
        left.push(`${f.slice(ROOT.length + 1)}: ${m[1]}`);
      }
    }
    expect(left).toEqual([]);
  });
});

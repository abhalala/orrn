import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";

import { formatterFor, screenPrefs } from "@orrn/domain";
import { NumberInput } from "@orrn/ui/components/field";

import { FmtProvider } from "@/shared/lib/fmt";
import { DIAMETER_MM, LENGTH_FT, LENGTH_IN, LENGTH_MM, MASS_G, MASS_KG, SECTION_KG12, typedToDraft, WALL_MM, WHOLE_KG } from "@/shared/lib/plant-input";

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
  test("feet and inches: the die wall and billet diameter stay plain mm boxes, as they always were", () => {
    const wall = render({ units: { length: "ft_in" } }, <PlantInput spec={WALL_MM} value="1.6" onValueChange={noop} aria-label="W" />);
    const old = render({}, <NumberInput value="1.6" onValueChange={noop} suffix="mm" aria-label="W" />);
    expect(wall).toBe(old);
    const dia = render({ units: { length: "ft_in" } }, <PlantInput spec={DIAMETER_MM} value="127" onValueChange={noop} aria-label="D" />);
    expect(dia).toContain('value="127"');
    expect(dia).toContain(">mm<");
  });
  test("a whole-kg box on a pound plant says what it kept", () => {
    const html = render({ units: { mass: "lb" } }, <PlantInput spec={WHOLE_KG} value="22680" typed="50000" onTypedChange={noop} onValueChange={noop} aria-label="Life" />);
    expect(html).toContain("Stored as 50000.84 lb, the nearest whole kg.");
    const exact = render({ units: { mass: "lb" } }, <PlantInput spec={WHOLE_KG} value="22680" typed="50000.84" onTypedChange={noop} onValueChange={noop} aria-label="Life" />);
    expect(exact).not.toContain("Stored as");
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

/** Which forms take a quantity in the plant's unit, and in which quantity: the list this part of the work wires. */
describe("the forms that take a weight, length or section weight", () => {
  const ROOT = join(import.meta.dir, "../..");
  function files(dir: string, out: string[] = []): string[] {
    for (const n of readdirSync(dir)) {
      const p = join(dir, n);
      if (statSync(p).isDirectory()) files(p, out);
      else if (/\.tsx$/.test(n) && !/\.test\./.test(n)) out.push(p);
    }
    return out;
  }
  const used = new Map<string, Set<string>>();
  for (const f of files(ROOT)) {
    const s = readFileSync(f, "utf8");
    for (const m of s.matchAll(/<PlantInput\b[^>]*?spec=\{([^}]*)\}/gs)) {
      const rel = f.slice(ROOT.length + 1);
      const set = used.get(rel) ?? new Set<string>();
      for (const spec of m[1]!.match(/MASS_KG|WHOLE_KG|GEOMETRY_MM|PRESSED_MM|PRESSED_IN|MASS_G|LENGTH_MM|DIAMETER_MM|LENGTH_FT|LENGTH_IN|SECTION_KG12|WALL_MM/g) ?? []) set.add(spec);
      used.set(rel, set);
    }
    if (/<BigNumberField[^>]*spec=\{/s.test(s) || /<QtyBox\b/.test(s)) used.set(f.slice(ROOT.length + 1), (used.get(f.slice(ROOT.length + 1)) ?? new Set()).add("MASS_KG"));
  }
  const FORMS = [
    "features/ageing/batch-sheets.tsx", "features/ageing/masters-pages.tsx", "features/dies/die-form.tsx", "features/die-room/band-form.tsx",
    "features/die-room/card-edit.tsx", "features/die-room/card-maker.tsx", "features/die-room/card-nitriding.tsx", "features/die-room/reading-pad.tsx",
    "features/dispatch/transport-fields.tsx", "features/foundry/close-sheet.tsx", "features/foundry/masters-view.tsx", "features/foundry/melt-steps.tsx",
    "features/foundry/stock-view.tsx", "features/masters/die-copy-sheet.tsx", "features/orders/components/die-block.tsx", "features/orders/components/line-editor.tsx",
    "features/orders/plan-board-page.tsx", "features/orders/plan-trial-form.tsx", "features/pack/bundles-step.tsx", "features/pack/die-step.tsx",
    "features/pack/rejects-panel.tsx", "features/portal/new-order-page.tsx", "features/press/station-count.tsx", "features/purchase/lot-sheets.tsx",
    "features/purchase/new-lot-page.tsx", "features/store/entry-form.tsx",
  ];
  test("every form on the list takes its quantity through the plant's unit", () => {
    expect(FORMS.filter((f) => !used.has(f))).toEqual([]);
  });
  test("no other form was added without being on the list", () => {
    expect([...used.keys()].filter((f) => !FORMS.includes(f) && !f.includes("shared/components")).sort()).toEqual([]);
  });
});

describe("the press count's die reading box takes the plant's section unit", () => {
  const src = readFileSync(join(import.meta.dir, "../../features/press/station-count.tsx"), "utf8");
  test("it is a PlantInput on the section weight, and no plain box wears the section unit word", () => {
    expect(src).toContain("<PlantInput spec={SECTION_KG12} value={draft.readingText}");
    expect(src).not.toContain("press.console.readingLabel");
    // the last reading in the hint is written by the plant formatter, not as milli / 1000
    expect(src).not.toContain("data.copy.kgPer12ftMilli / 1000");
  });
  test("0.441 typed on a pound per foot plant is kept as 2.4 kg per 12 ft, which saveNotes sends as 2400", () => {
    const step = typedToDraft(formatterFor(screenPrefs({ units: { linear_mass: "lb_ft" } }), { locale: "en", timeZone: "Asia/Kolkata" }), SECTION_KG12, "0.441");
    expect(step.problem).toBeNull();
    expect(Math.round(Number(step.draft) * 1000)).toBe(2400);
    expect(step.value).toBe(2400);
  });
});

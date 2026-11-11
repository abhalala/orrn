import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { PLANT_UNIT_CHOICES, readUnitSettings, validatePlantUnitSettings } from "@orrn/domain";
import { createI18n, I18nProvider } from "@orrn/i18n";

import { DATE_ORDERS, draftDirty, draftFromSettings, draftPayload, previewFor, type UnitsDraft } from "./units-model";
import { PreviewList } from "./units-preview";

const ENV = { locale: "en", timeZone: "Asia/Kolkata" } as const;
const none = readUnitSettings({});

describe("the draft a plant starts from", () => {
  test("a plant that changed nothing: kg, mm, kg/12ft, Indian, day first, 24 hour", () => {
    expect(draftFromSettings(none)).toEqual({ mass: "kg", length: "mm", linear_mass: "kg_12ft", grouping: "indian", dateOrder: "dmy", clock: "h23" });
  });
  test("an inch plant (legacy key) starts on feet and inches", () => {
    expect(draftFromSettings(readUnitSettings({ lengthUnit: "inch" })).length).toBe("ft_in");
  });
  test("a stored choice shows as the choice", () => {
    const plant = readUnitSettings({ units: { units: { mass: "lb", length: "m" }, number: { grouping: "international" }, clock: "h12", date: { order: "mdy" } } });
    expect(draftFromSettings(plant)).toMatchObject({ mass: "lb", length: "m", grouping: "international", clock: "h12", dateOrder: "mdy" });
  });
});

describe("save payload", () => {
  const draft: UnitsDraft = { mass: "lb", length: "ft_in", linear_mass: "lb_ft", grouping: "international", dateOrder: "ymd", clock: "h12" };
  test("the server accepts what the form sends", () => {
    const payload = draftPayload(draft, none);
    const checked = validatePlantUnitSettings(payload);
    expect(checked.ok).toBe(true);
    expect(payload.units).toEqual({ mass: "lb", length: "ft_in", linear_mass: "lb_ft" });
  });
  test("marks and month style the form does not edit are carried over", () => {
    const plant = readUnitSettings({ units: { number: { grouping: "indian", decimal: ",", group: "." }, date: { order: "dmy", month: "numeric" } } });
    const payload = draftPayload(draft, plant);
    expect(payload.number).toEqual({ grouping: "international", decimal: ",", group: "." });
    expect(payload.date).toEqual({ order: "ymd", month: "numeric" });
  });
  test("every choice the form offers is accepted by the server check", () => {
    for (const mass of PLANT_UNIT_CHOICES.mass) for (const length of PLANT_UNIT_CHOICES.length) for (const linear_mass of PLANT_UNIT_CHOICES.linear_mass) {
      for (const grouping of ["indian", "international"] as const) for (const dateOrder of DATE_ORDERS) for (const clock of ["h23", "h12"] as const) {
        expect(validatePlantUnitSettings(draftPayload({ mass, length, linear_mass, grouping, dateOrder, clock }, none)).ok).toBe(true);
      }
    }
  });
  test("dirty only when a choice differs from what is saved", () => {
    const saved = draftFromSettings(none);
    expect(draftDirty(saved, { ...saved })).toBe(false);
    expect(draftDirty(saved, { ...saved, mass: "lb" })).toBe(true);
    expect(draftDirty(saved, { ...saved, clock: "h12" })).toBe(true);
  });
});

describe("the preview shows what the screens will show", () => {
  test("the default choice: today's wording", () => {
    const p = previewFor(draftFromSettings(none), none, ENV);
    expect(p).toEqual({
      weight: "1,23,456.789 kg",
      length: "3810 mm",
      section: "2.090 kg/12ft",
      number: "₹12,34,567.50",
      date: "10 Nov 2026, 19:35",
    });
  });
  test("pounds, feet and inches, lb per foot, international, month first, 12 hour", () => {
    const d: UnitsDraft = { mass: "lb", length: "ft_in", linear_mass: "lb_ft", grouping: "international", dateOrder: "mdy", clock: "h12" };
    const p = previewFor(d, none, ENV);
    expect(p.weight).toBe("272,175.63 lb"); // 123456.789 kg, checked with exact fractions: 272175.63
    expect(p.length).toBe("12 ft 6 in");
    expect(p.section).toBe("0.384 lb/ft");
    expect(p.number).toBe("₹1,234,567.50");
    expect(p.date).toBe("Nov 10, 2026, 7:35 pm");
  });
  test("tonnes, metres, kg per metre, year first", () => {
    const d: UnitsDraft = { mass: "t", length: "m", linear_mass: "kg_m", grouping: "indian", dateOrder: "ymd", clock: "h23" };
    const p = previewFor(d, none, ENV);
    expect(p.weight).toBe("123.457 t");
    expect(p.length).toBe("3.810 m");
    expect(p.section).toBe("0.571 kg/m");
    expect(p.date).toBe("2026 Nov 10, 19:35");
  });
});

describe("PreviewList markup", () => {
  const html = renderToStaticMarkup(
    <I18nProvider locale="en">
      <PreviewList lines={previewFor(draftFromSettings(none), none, ENV)} />
    </I18nProvider>,
  );
  test("a definition list in a polite live region with a label for each line", () => {
    expect(html).toContain("<dl");
    expect(html).toContain('aria-live="polite"');
    for (const label of ["Weight", "Length", "Section weight", "Number", "Date and time"]) expect(html).toContain(`>${label}</dt>`);
    expect(html).toContain('data-testid="preview-weight">1,23,456.789 kg<');
  });
  test("in Hindi the labels are Hindi and the numbers stay Latin", () => {
    const hi = renderToStaticMarkup(
      <I18nProvider locale="hi">
        <PreviewList lines={previewFor(draftFromSettings(none), none, { ...ENV, locale: "hi" })} />
      </I18nProvider>,
    );
    expect(hi).toContain("सेक्शन का वज़न");
    expect(hi).toContain("1,23,456.789 kg");
  });
});

describe("words", () => {
  test("every offered unit has a name in en and hi, and a gu name where the namespace is a floor one", () => {
    for (const lang of ["en", "hi", "gu"] as const) {
      const { t } = createI18n(lang);
      for (const kind of Object.keys(PLANT_UNIT_CHOICES) as (keyof typeof PLANT_UNIT_CHOICES)[]) {
        for (const id of PLANT_UNIT_CHOICES[kind]) {
          const name = t(`units.name.${id}` as never);
          expect(name.length).toBeGreaterThan(0);
          expect(name).not.toBe(`units.name.${id}`);
        }
      }
    }
  });
});

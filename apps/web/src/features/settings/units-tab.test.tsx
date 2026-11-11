import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { mergeUnitSettings, PLANT_UNIT_CHOICES, readUnitSettings, validatePlantUnitSettings } from "@orrn/domain";
import { createI18n, I18nProvider } from "@orrn/i18n";

import { DATE_ORDERS, draftDirty, draftFromSettings, draftPayload, followUntouched, previewFor, rebaseDraft, type UnitsDraft } from "./units-model";
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

/** What the server stores for a payload: its merge over the plant, then its check (`company.updateSettings`). */
const stored = (payload: Record<string, unknown>, plant: ReturnType<typeof readUnitSettings>) => validatePlantUnitSettings(mergeUnitSettings(plant, payload));

describe("save payload", () => {
  const draft: UnitsDraft = { mass: "lb", length: "ft_in", linear_mass: "lb_ft", grouping: "international", dateOrder: "ymd", clock: "h12" };
  test("when every choice changed, the server accepts what the form sends", () => {
    const payload = draftPayload(draft, none);
    const checked = stored(payload, none);
    expect(checked.ok).toBe(true);
    expect(payload.units).toEqual({ mass: "lb", length: "ft_in", linear_mass: "lb_ft" });
    expect(payload.number).toEqual({ grouping: "international" });
    expect(payload.date).toEqual({ order: "ymd" });
    expect(payload.clock).toBe("h12");
  });
  test("only the choices the person changed are sent", () => {
    const saved = draftFromSettings(none);
    expect(draftPayload({ ...saved, clock: "h12" }, none)).toEqual({ clock: "h12" });
    expect(draftPayload({ ...saved, mass: "lb" }, none)).toEqual({ units: { mass: "lb" } });
    expect(draftPayload({ ...saved, grouping: "international", dateOrder: "mdy" }, none)).toEqual({ number: { grouping: "international" }, date: { order: "mdy" } });
    expect(draftPayload(saved, none)).toEqual({});
  });
  test("marks and month style the form does not edit are kept by the server, not carried by the form", () => {
    const plant = readUnitSettings({ units: { units: { mass: "kg" }, number: { grouping: "indian", decimal: ",", group: "." }, date: { order: "dmy", month: "numeric" } } });
    const payload = draftPayload({ ...draftFromSettings(plant), grouping: "international", dateOrder: "ymd" }, plant);
    expect(payload).toEqual({ number: { grouping: "international" }, date: { order: "ymd" } });
    const checked = stored(payload, plant);
    expect(checked.ok && checked.settings.number).toEqual({ grouping: "international", decimal: ",", group: "." });
    expect(checked.ok && checked.settings.date).toEqual({ order: "ymd", month: "numeric" });
  });
  test("two admins on two tabs: the second save does not send the first admin's choice back", () => {
    // Both opened the tab on the same plant (kg, 24 hour). Admin A saves pounds. Admin B, on a stale tab, only turns on the 12 hour clock.
    const opened = none;
    const draftB: UnitsDraft = { ...draftFromSettings(opened), clock: "h12" };
    const afterA = readUnitSettings({ units: { units: { mass: "lb" } } });
    const payloadB = draftPayload(draftB, opened);
    expect(payloadB).toEqual({ clock: "h12" });
    const checked = stored(payloadB, afterA);
    expect(checked.ok && checked.settings.units?.mass).toBe("lb");
    expect(checked.ok && checked.settings.clock).toBe("h12");
  });
  test("the preview still follows the whole draft", () => {
    const d: UnitsDraft = { ...draftFromSettings(none), mass: "lb", clock: "h12" };
    expect(previewFor(d, none, ENV).weight).toContain("lb");
    expect(previewFor(d, none, ENV).date).toContain("pm");
  });
  test("every choice the form offers is accepted by the server check", () => {
    for (const mass of PLANT_UNIT_CHOICES.mass) for (const length of PLANT_UNIT_CHOICES.length) for (const linear_mass of PLANT_UNIT_CHOICES.linear_mass) {
      for (const grouping of ["indian", "international"] as const) for (const dateOrder of DATE_ORDERS) for (const clock of ["h23", "h12"] as const) {
        expect(stored(draftPayload({ mass, length, linear_mass, grouping, dateOrder, clock }, none), none).ok).toBe(true);
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

describe("an open tab and a changed plant (another admin, a second tab)", () => {
  const kg = draftFromSettings(none);
  const lb: UnitsDraft = { ...kg, mass: "lb" };
  test("a draft nobody touched follows the new saved choices, so Save does not light up with nothing changed", () => {
    expect(rebaseDraft(kg, kg, lb)).toEqual(lb);
    expect(draftDirty(rebaseDraft(kg, kg, lb), lb)).toBe(false);
  });
  test("a stale draft would have sent the old weight back: after the rebase only the clock change differs", () => {
    const draft = rebaseDraft(kg, kg, lb);
    const edited = { ...draft, clock: "h12" as const };
    expect(draftDirty(edited, lb)).toBe(true);
    expect(edited.mass).toBe("lb");
  });
  test("a draft the person edited is kept", () => {
    const mine: UnitsDraft = { ...kg, clock: "h12" };
    expect(rebaseDraft(mine, kg, lb)).toBe(mine);
  });
  test("nothing changed on the server: the draft is left alone", () => {
    const mine: UnitsDraft = { ...kg, clock: "h12" };
    expect(rebaseDraft(mine, kg, { ...kg })).toBe(mine);
    expect(rebaseDraft(kg, kg, { ...kg })).toBe(kg);
  });
});

describe("a draft the person edited, while another admin saved", () => {
  const kg = draftFromSettings(none);
  const lbPlant = readUnitSettings({ units: { units: { mass: "lb" } } });
  const lb = draftFromSettings(lbPlant);
  test("the payload carries the touched choices only, so an untouched stale choice is never sent back", () => {
    // B's draft: opened on kg, clock edited. The saved set is now lb (admin A's save).
    const draft: UnitsDraft = { ...kg, clock: "h12" };
    expect(draftPayload(draft, lbPlant, new Set(["clock"]))).toEqual({ clock: "h12" });
    // Without the touched set the draft's mass would differ from the saved one and go out as kg.
    expect(draftPayload(draft, lbPlant)).toEqual({ units: { mass: "kg" }, clock: "h12" });
  });
  test("a touched choice equal to the saved one is not sent", () => {
    expect(draftPayload({ ...lb }, lbPlant, new Set(["mass"]))).toEqual({});
  });
  test("untouched choices follow the saved set, touched ones stay", () => {
    const draft: UnitsDraft = { ...kg, clock: "h12" };
    expect(followUntouched(draft, new Set(["clock"]), lb)).toEqual({ ...lb, clock: "h12" });
    expect(followUntouched(draft, new Set(), lb)).toEqual(lb);
  });
  test("nothing differs: the same draft comes back", () => {
    const draft: UnitsDraft = { ...lb, clock: "h12" };
    expect(followUntouched(draft, new Set(["clock"]), lb)).toBe(draft);
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
  test("each line is its own atomic live region, so a change is spoken with its label", () => {
    expect(html.match(/aria-live="polite" aria-atomic="true"/g)?.length).toBe(5);
    // the list itself is not the live region (a change inside it would be read as a bare value)
    expect(html).not.toMatch(/<dl[^>]*aria-live/);
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

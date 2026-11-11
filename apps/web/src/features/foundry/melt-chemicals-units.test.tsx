/**
 * A kilogram store item on the melt sheet follows the plant's weight unit, as it does on the store screens (units layer, review fix).
 * The draft stays kg text, so the melt model is unchanged; a plant that reads kg keeps the plain box it always had.
 */
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { screenPrefs } from "@orrn/domain";
import { I18nProvider } from "@orrn/i18n";

const { FmtProvider } = await import("@/shared/lib/fmt");
const { ChemicalsStep } = await import("./melt-steps");
const { blankForm } = await import("./melt-form");

const form = () => {
  const f = blankForm("2026-10-24", "furnace-1");
  f.chemicals = [
    { key: "a", storeItemId: "flux", name: "", unit: "", openText: "40", usedText: "12.5", closeText: "" },
    { key: "b", storeItemId: "gas", name: "", unit: "", openText: "10", usedText: "2", closeText: "" },
  ];
  return f;
};
const ITEMS = [
  { id: "flux", name: "Flux", unit: "kg", active: true },
  { id: "gas", name: "Argon", unit: "litre", active: true },
] as never;
const render = (prefs: ReturnType<typeof screenPrefs> | undefined) =>
  renderToStaticMarkup(
    <I18nProvider locale="en">
      <FmtProvider prefs={prefs} timeZone="Asia/Kolkata">
        <ChemicalsStep form={form()} patch={() => {}} issue={null} storeItems={ITEMS} />
      </FmtProvider>
    </I18nProvider>,
  );

describe("melt sheet chemicals", () => {
  test("on a pound plant a kg item is typed and shown in lb, the picker says lb, the close is in lb", () => {
    const html = render(screenPrefs({ units: { mass: "lb" } }));
    expect(html).toContain("Flux (lb)");
    expect(html).toContain('value="88.18"'); // 40 kg
    expect(html).toContain('value="27.56"'); // 12.5 kg
    expect(html).toContain('value="60.63"'); // close 27.5 kg
    expect(html).toContain(">lb<");
  });
  test("a litre item keeps its own unit on any plant", () => {
    const html = render(screenPrefs({ units: { mass: "lb" } }));
    expect(html).toContain("Argon (litre)");
    expect(html).toContain('value="10"');
    expect(html).toContain('value="8"');
  });
  test("a plant that changed nothing reads the plain boxes it always had", () => {
    const html = render(undefined);
    expect(html).toContain("Flux (kg)");
    expect(html).toContain('value="40"');
    expect(html).toContain('value="12.5"');
    expect(html).toContain('value="27.5"');
    expect(html).not.toContain(">kg<");
  });
});

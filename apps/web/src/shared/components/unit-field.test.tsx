import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { screenPrefs } from "@orrn/domain";

import { FmtProvider } from "@/shared/lib/fmt";

import { BareUnitBox, UnitField } from "./unit-field";

const render = (units: Parameters<typeof screenPrefs>[0], node: React.ReactNode) =>
  renderToStaticMarkup(<FmtProvider prefs={screenPrefs(units)}>{node}</FmtProvider>);

const noop = () => {};

describe("UnitField renders the stored integer in the plant's unit", () => {
  test("default plant: 12345 g is 12.345 with a kg suffix, a visible label and the suffix read out with the field", () => {
    const html = render({}, <UnitField field="order.weight" value={12_345} onValueChange={noop} label="Weight" id="w" />);
    expect(html).toContain('value="12.345"');
    expect(html).toContain(">kg<");
    expect(html).toContain('<label for="w"');
    expect(html).toMatch(/aria-describedby="[^"]*unit-/);
    expect(html).toContain('inputMode="decimal"');
  });
  test("a plant on pounds: 52435 g reads 115.6 lb", () => {
    const html = render({ units: { mass: "lb" } }, <UnitField field="bundle.weight" value={52_435} onValueChange={noop} aria-label="Bundle weight" />);
    expect(html).toContain('value="115.6"');
    expect(html).toContain(">lb<");
    expect(html).toContain('aria-label="Bundle weight"');
  });
  test("a plant on feet and inches: 3810 mm reads 12 ft 6 in, free-text keyboard", () => {
    const html = render({ units: { length: "ft_in" } }, <UnitField field="bundle.length" value={3810} onValueChange={noop} aria-label="Length" />);
    expect(html).toContain('value="12 ft 6 in"');
    expect(html).toContain(">ft in<");
    expect(html).toContain('inputMode="text"');
  });
  test("metres and mm", () => {
    expect(render({ units: { length: "m" } }, <UnitField field="bundle.length" value={3658} onValueChange={noop} aria-label="L" />)).toContain('value="3.658"');
    const mm = render({}, <UnitField field="bundle.length" value={3658} onValueChange={noop} aria-label="L" />);
    expect(mm).toContain('value="3658"');
    expect(mm).toContain(">mm<");
  });
  test("a label-less box shows its refusal sentence, tied to the box by aria-describedby", () => {
    const html = render({ units: { mass: "lb" } }, <BareUnitBox text="5.1234" onText={noop} kind="mass" problem="Too many decimal places for lb. Use at most 2." aria-label="W" />);
    const id = /<p id="([^"]+)"[^>]*>Too many decimal places/.exec(html)?.[1];
    expect(id).toBeDefined();
    expect(html).toMatch(new RegExp(`aria-describedby="[^"]*${id}`));
    expect(html).toContain('aria-invalid="true"');
    const clean = render({}, <UnitField field="order.weight" value={12_345} onValueChange={noop} aria-label="W" />);
    expect(clean).toContain('aria-live="polite"');
    expect(clean).not.toContain("unit-problem");
  });
  test("empty value is an empty box, not 0", () => {
    expect(render({}, <UnitField field="order.weight" value={null} onValueChange={noop} aria-label="W" />)).toContain('value=""');
  });
});

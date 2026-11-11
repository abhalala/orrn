/**
 * The unit of the log and billet length text is frozen when the melt editor opens (review recheck). A plant that changes its
 * length choice under an open form must not re-read "12" (feet) as 12 mm: the box shows the same length in the new unit.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";

import { screenPrefs } from "@orrn/domain";
import { I18nProvider } from "@orrn/i18n";

const { FmtProvider } = await import("@/shared/lib/fmt");
const { OutputStep } = await import("./melt-steps");
const { blankForm, lengthDraftToMm } = await import("./melt-form");

const form = () => {
  const f = blankForm("2026-10-24", "furnace-1");
  f.logs = [{ key: "a", pcsText: "4", lengthText: "12", billetLengthText: "", kgText: "100" }];
  return f;
};
const render = (prefs: ReturnType<typeof screenPrefs> | undefined, lengthDraft: "ft" | "mm") =>
  renderToStaticMarkup(
    <I18nProvider locale="en">
      <FmtProvider prefs={prefs} timeZone="Asia/Kolkata">
        <OutputStep form={form()} patch={() => {}} issue={null} streams={[]} capacityG={null} lengthDraft={lengthDraft} />
      </FmtProvider>
    </I18nProvider>,
  );

describe("melt log length draft stays in the unit it was typed in", () => {
  test("a feet draft of 12 on a plant that now reads metres shows 3.658 m, not 0.012", () => {
    const html = render(screenPrefs({ units: { length: "m" } }), "ft");
    expect(html).toContain('value="3.658"');
    expect(html).not.toContain('value="0.012"');
  });
  test("the same feet draft on a plant that reads mm shows 12 ft, as it always did", () => {
    expect(render(undefined, "ft")).toContain('value="12"');
  });
  test("a whole mm draft of 3658 on a plant that reads metres shows 3.658", () => {
    const f = form();
    f.logs[0]!.lengthText = "3658";
    const html = renderToStaticMarkup(
      <I18nProvider locale="en">
        <FmtProvider prefs={screenPrefs({ units: { length: "m" } })} timeZone="Asia/Kolkata">
          <OutputStep form={f} patch={() => {}} issue={null} streams={[]} capacityG={null} lengthDraft="mm" />
        </FmtProvider>
      </I18nProvider>,
    );
    expect(html).toContain('value="3.658"');
  });
  test("the saved length of a feet draft is 3658 mm, whichever plant unit shows it", () => {
    expect(lengthDraftToMm("12", "ft")).toBe(3658);
    expect(lengthDraftToMm("12", "mm")).toBe(12);
  });
  test("the editor holds the draft unit in state set once at mount, and the step and save read that value", () => {
    const src = readFileSync(new URL("./melt-view.tsx", import.meta.url), "utf8");
    expect(src).toContain("const [lengthDraft] = useState<LengthDraft>(() =>");
    expect(src).not.toMatch(/const lengthDraft = /);
    expect(src).toContain("lengthDraft={lengthDraft}");
    const steps = readFileSync(new URL("./melt-steps.tsx", import.meta.url), "utf8");
    expect(steps).not.toContain("logLengthSpec(useFmt())");
  });
});

import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { I18nProvider } from "@orrn/i18n";

const { FmtProvider } = await import("@/shared/lib/fmt");
const { ToolRoomView } = await import("./card-toolroom");
const { CostByMakerTable } = await import("./cost-by-maker");

const wrap = (node: React.ReactNode, locale: "en" | "hi" = "en") =>
  renderToStaticMarkup(
    <I18nProvider locale={locale}>
      <FmtProvider prefs={undefined} timeZone="Asia/Kolkata">
        {node}
      </FmtProvider>
    </I18nProvider>,
  );

const base = { category: { id: "c1", name: "Large hollow", expectedLifeG: 12_000_000 }, inspection: null, producedG: 3_500_000, seesCost: false, costPaise: null, costPerKgPaise: null };

describe("die card tool room block", () => {
  test("shows category, expected life and the inspection state, no cost without seesCost", () => {
    const html = wrap(<ToolRoomView data={base} />);
    expect(html).toContain("Large hollow");
    expect(html).toContain("Expected life");
    expect(html).toContain("Not inspected");
    expect(html).not.toContain("Purchase cost");
    expect(html).not.toContain("toolroom-failed");
  });
  test("a failed copy says it cannot be issued", () => {
    const html = wrap(<ToolRoomView data={{ ...base, inspection: "fail" }} />);
    expect(html).toContain("toolroom-failed");
    expect(html).toContain("cannot be issued until it passes");
  });
  test("cost and cost per kg show only for people who see money", () => {
    const html = wrap(<ToolRoomView data={{ ...base, inspection: "pass", seesCost: true, costPaise: 4_500_000, costPerKgPaise: 1_286 }} />);
    expect(html).toContain("Purchase cost");
    expect(html).toContain("Cost per kg made");
    expect(html).toContain("Passed");
  });
  test("a copy with no category and no cost entered reads plainly", () => {
    const html = wrap(<ToolRoomView data={{ ...base, category: null, seesCost: true }} />);
    expect(html).toContain("No die category yet");
    expect(html).toContain("Not entered");
    expect(html).toContain("Not run yet");
  });
  test("renders in Hindi", () => {
    expect(wrap(<ToolRoomView data={{ ...base, inspection: "fail" }} />, "hi")).toContain("इश्यू नहीं हो सकती");
  });
  test("the maker table lists a row with no maker", () => {
    const html = wrap(<CostByMakerTable rows={[{ makerId: null, makerName: null, copies: 2, costPaise: 900_000, producedG: 1_000_000, costPerKgPaise: 900 }]} />);
    expect(html).toContain("No maker");
    expect(html).toContain("Per kg");
  });
});

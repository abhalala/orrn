import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { I18nProvider } from "@orrn/i18n";

import { buildUpdate, doneDraft, formOf, hasChanges, localInputToMs, msToLocalInput, orderedMoves, parseLabour, type WoEditSource } from "./wo-model";

const { MoveBar, SpareRows } = await import("./wo-parts");

const wo: WoEditSource = {
  title: "Press 2 oil leak",
  priority: "high",
  assignedTo: "u1",
  cause: null,
  workDone: null,
  labourMin: 0,
  startedAt: null,
  finishedAt: null,
};

describe("labour minutes", () => {
  test("reads hours and minutes or plain minutes", () => {
    expect(parseLabour("1:30")).toBe(90);
    expect(parseLabour("90")).toBe(90);
    expect(parseLabour(" 0:45 ")).toBe(45);
    expect(parseLabour("2:5")).toBe(125);
  });
  test("blank is no entry; nonsense is bad", () => {
    expect(parseLabour("")).toBeNull();
    expect(parseLabour("1:75")).toBe("bad");
    expect(parseLabour("1.5")).toBe("bad");
    expect(parseLabour("abc")).toBe("bad");
    expect(parseLabour("-5")).toBe("bad");
    expect(parseLabour("999999")).toBe("bad");
  });
});

describe("datetime-local values", () => {
  test("round trip at the minute", () => {
    const ms = new Date(2026, 10, 22, 14, 5).getTime();
    expect(msToLocalInput(ms)).toBe("2026-11-22T14:05");
    expect(localInputToMs("2026-11-22T14:05")).toBe(ms);
  });
  test("none and unreadable", () => {
    expect(msToLocalInput(null)).toBe("");
    expect(localInputToMs("")).toBeNull();
    expect(localInputToMs("tomorrow")).toBeNull();
  });
});

describe("the update payload", () => {
  test("nothing changed sends nothing", () => {
    const r = buildUpdate(wo, formOf(wo));
    expect(r.ok && hasChanges(r.changes)).toBe(false);
  });
  test("only changed fields go", () => {
    const f = { ...formOf(wo), priority: "low", cause: "  worn seal ", labour: "1:30", assignedTo: "" };
    const r = buildUpdate(wo, f);
    expect(r).toEqual({ ok: true, changes: { priority: "low", cause: "worn seal", labourMin: 90, assignedTo: null } });
  });
  test("an untouched time is not sent back with its seconds cut", () => {
    const withTime = { ...wo, startedAt: new Date(2026, 10, 22, 9, 0, 30).getTime() };
    const r = buildUpdate(withTime, formOf(withTime));
    expect(r.ok && hasChanges(r.changes)).toBe(false);
  });
  test("a cleared time goes as null", () => {
    const withTime = { ...wo, startedAt: new Date(2026, 10, 22, 9, 0).getTime() };
    const r = buildUpdate(withTime, { ...formOf(withTime), startedAt: "" });
    expect(r).toEqual({ ok: true, changes: { startedAt: null } });
  });
  test("a blank labour box leaves labour alone", () => {
    const worked = { ...wo, labourMin: 60 };
    const r = buildUpdate(worked, { ...formOf(worked), labour: "" });
    expect(r.ok && hasChanges(r.changes)).toBe(false);
  });
  test("problems", () => {
    expect(buildUpdate(wo, { ...formOf(wo), title: "  " })).toEqual({ ok: false, problem: "title" });
    expect(buildUpdate(wo, { ...formOf(wo), labour: "x" })).toEqual({ ok: false, problem: "labour" });
    expect(buildUpdate(wo, { ...formOf(wo), startedAt: "2026-11-22T10:00", finishedAt: "2026-11-22T09:00" })).toEqual({ ok: false, problem: "finishBeforeStart" });
  });
  test("moves keep a fixed order with cancel last; done starts from what was written", () => {
    expect(orderedMoves(["cancelled", "done", "in_progress"])).toEqual(["in_progress", "done", "cancelled"]);
    expect(doneDraft(null)).toBe("");
    expect(doneDraft("changed seal")).toBe("changed seal");
  });
});

const rows = [
  { storeTxnId: "t1", number: "MRS/26-27/0007", itemName: "Hydraulic seal", issuedAt: 1_700_000_000_000, cancelledAt: null },
  { storeTxnId: "t2", number: "MRS/26-27/0008", itemName: "Grease", issuedAt: 1_700_100_000_000, cancelledAt: 1_700_200_000_000 },
  { storeTxnId: "t3", number: "MRS/26-27/0009", itemName: "Filter", issuedAt: 1_700_300_000_000, forThis: true },
];

function renderRows(locale: "en" | "hi") {
  return renderToStaticMarkup(
    <I18nProvider locale={locale}>
      <SpareRows rows={rows} qtyText={(r) => `qty-${r.number}`} when={(at) => `at-${at}`} actionLabel="Act" onAction={() => {}} emptyText="empty" />
    </I18nProvider>,
  );
}

describe("spares rows", () => {
  test("show number, item, unit text, date, the cancelled chip and the for-this chip, and no money", () => {
    const html = renderRows("en");
    expect(html).toContain("MRS/26-27/0007");
    expect(html).toContain("Hydraulic seal");
    expect(html).toContain("qty-MRS/26-27/0007");
    expect(html).toContain("Issued at-1700000000000");
    expect(html).toContain("Cancelled in the store");
    expect(html).toContain("Issued for this work order");
    expect(html).not.toContain("₹");
    expect((html.match(/Act/g) ?? []).length).toBe(3);
  });
  test("read in Hindi", () => {
    const html = renderRows("hi");
    expect(html).toContain("स्टोर में रद्द हुआ");
    expect(html).toContain("इश्यू हुआ at-1700000000000");
  });
  test("no rows says so, and no action means no button", () => {
    const html = renderToStaticMarkup(
      <I18nProvider locale="en">
        <SpareRows rows={[]} qtyText={() => ""} when={() => ""} emptyText="Nothing yet" />
      </I18nProvider>,
    );
    expect(html).toContain("Nothing yet");
    const plain = renderToStaticMarkup(
      <I18nProvider locale="en">
        <SpareRows rows={rows} qtyText={() => ""} when={() => ""} emptyText="" />
      </I18nProvider>,
    );
    expect(plain).not.toContain("<button");
  });
});

describe("the move buttons", () => {
  const render = (locale: "en" | "hi", moves: string[]) =>
    renderToStaticMarkup(
      <I18nProvider locale={locale}>
        <MoveBar moves={moves} onMove={() => {}} />
      </I18nProvider>,
    );
  test("one button for each move the server allows", () => {
    const html = render("en", ["in_progress", "cancelled"]);
    expect(html).toContain('data-move="in_progress"');
    expect(html).toContain("Start work");
    expect(html).toContain("Cancel work order");
    expect(html).not.toContain('data-move="done"');
  });
  test("a closed work order has no buttons", () => {
    expect(render("en", [])).toBe("");
  });
  test("reads in Hindi", () => {
    expect(render("hi", ["done"])).toContain("पूरा करें");
  });
});

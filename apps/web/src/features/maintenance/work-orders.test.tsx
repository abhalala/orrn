import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { I18nProvider } from "@orrn/i18n";

import { createRequestIds } from "@/features/store/request-id";

import {
  askAfterMoveError,
  buildUpdate,
  conflictingKeys,
  createIssueAttempts,
  doneDraft,
  formOf,
  hasChanges,
  issueSignature,
  localInputToMs,
  msToLocalInput,
  openMoveAsk,
  orderedMoves,
  parseLabour,
  rebaseForm,
  type WoEditSource,
} from "./wo-model";

const { AssetLoadError, MoveBar, SpareRows } = await import("./wo-parts");

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

const IST = "Asia/Kolkata";

describe("datetime-local values", () => {
  test("round trip at the minute", () => {
    // 14:05 on the plant's clock (IST) whatever zone the browser is in.
    const ms = Date.UTC(2026, 10, 22, 8, 35);
    expect(msToLocalInput(ms, IST)).toBe("2026-11-22T14:05");
    expect(localInputToMs("2026-11-22T14:05", IST)).toBe(ms);
    expect(msToLocalInput(ms, "UTC")).toBe("2026-11-22T08:35");
  });
  test("none and unreadable", () => {
    expect(msToLocalInput(null, IST)).toBe("");
    expect(localInputToMs("", IST)).toBeNull();
    expect(localInputToMs("tomorrow", IST)).toBeNull();
  });
});

describe("the update payload", () => {
  test("nothing changed sends nothing", () => {
    const r = buildUpdate(wo, formOf(wo, IST), IST);
    expect(r.ok && hasChanges(r.changes)).toBe(false);
  });
  test("only changed fields go", () => {
    const f = { ...formOf(wo, IST), priority: "low", cause: "  worn seal ", labour: "1:30", assignedTo: "" };
    const r = buildUpdate(wo, f, IST);
    expect(r).toEqual({ ok: true, changes: { priority: "low", cause: "worn seal", labourMin: 90, assignedTo: null } });
  });
  test("an untouched time is not sent back with its seconds cut", () => {
    const withTime = { ...wo, startedAt: new Date(2026, 10, 22, 9, 0, 30).getTime() };
    const r = buildUpdate(withTime, formOf(withTime, IST), IST);
    expect(r.ok && hasChanges(r.changes)).toBe(false);
  });
  test("a cleared time goes as null", () => {
    const withTime = { ...wo, startedAt: new Date(2026, 10, 22, 9, 0).getTime() };
    const r = buildUpdate(withTime, { ...formOf(withTime, IST), startedAt: "" }, IST);
    expect(r).toEqual({ ok: true, changes: { startedAt: null } });
  });
  test("a blank labour box leaves labour alone", () => {
    const worked = { ...wo, labourMin: 60 };
    const r = buildUpdate(worked, { ...formOf(worked, IST), labour: "" }, IST);
    expect(r.ok && hasChanges(r.changes)).toBe(false);
  });
  test("problems", () => {
    expect(buildUpdate(wo, { ...formOf(wo, IST), title: "  " }, IST)).toEqual({ ok: false, problem: "title" });
    expect(buildUpdate(wo, { ...formOf(wo, IST), labour: "x" }, IST)).toEqual({ ok: false, problem: "labour" });
    expect(buildUpdate(wo, { ...formOf(wo, IST), startedAt: "2026-11-22T10:00", finishedAt: "2026-11-22T09:00" }, IST)).toEqual({ ok: false, problem: "finishBeforeStart" });
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

describe("datetime that cannot be kept", () => {
  test("a nonempty time before 1970 is a field error, not a clear", () => {
    const withTime = { ...wo, startedAt: Date.UTC(2026, 10, 22, 8, 35), finishedAt: Date.UTC(2026, 10, 22, 9, 35) };
    expect(localInputToMs("1969-12-31T12:00", IST)).toBeNull();
    expect(buildUpdate(withTime, { ...formOf(withTime, IST), startedAt: "1969-12-31T12:00" }, IST)).toEqual({ ok: false, problem: "startBad" });
    expect(buildUpdate(withTime, { ...formOf(withTime, IST), finishedAt: "tomorrow" }, IST)).toEqual({ ok: false, problem: "finishBad" });
  });
  test("only an empty box clears", () => {
    const withTime = { ...wo, finishedAt: Date.UTC(2026, 10, 22, 9, 35) };
    expect(buildUpdate(withTime, { ...formOf(withTime, IST), finishedAt: "" }, IST)).toEqual({ ok: true, changes: { finishedAt: null } });
  });
  test("the seed zone keeps an untouched time unchanged when the plant zone later differs", () => {
    const withTime = { ...wo, startedAt: Date.UTC(2026, 10, 22, 8, 35) };
    const form = formOf(withTime, IST);
    const r = buildUpdate(withTime, form, IST);
    expect(r.ok && hasChanges(r.changes)).toBe(false);
    // Reading the same text in another zone would look like an edit: the card must keep using the seed zone.
    const other = buildUpdate(withTime, form, "UTC");
    expect(other.ok && hasChanges(other.changes)).toBe(true);
  });
});

describe("the move confirmation", () => {
  test("is opened against the order and version the operator saw", () => {
    const ask = openMoveAsk({ id: "w1", serverSeq: 4, workDone: "changed seal" }, "done");
    expect(ask).toEqual({ to: "done", id: "w1", serverSeq: 4, initial: "changed seal" });
    // A refetch to version 5 changes nothing in the open confirmation.
    expect(ask.serverSeq).toBe(4);
    expect(openMoveAsk({ id: "w1", serverSeq: 4, workDone: "x" }, "cancelled").initial).toBe("");
  });
  test("a conflict closes it; other errors leave it open", () => {
    const ask = openMoveAsk({ id: "w1", serverSeq: 4, workDone: null }, "done");
    expect(askAfterMoveError(ask, { data: { code: "CONFLICT" } })).toBeNull();
    expect(askAfterMoveError(ask, { data: { code: "BAD_REQUEST" } })).toBe(ask);
  });
});

describe("the edit draft against a refreshed order", () => {
  const base: WoEditSource = { ...wo, cause: "worn seal", labourMin: 30 };
  const next: WoEditSource = { ...base, cause: "cracked housing", priority: "low" };
  const draft = { ...formOf(base, IST), cause: "worn seal and hose", title: "Press 2 oil leak, again" };
  test("names the fields both sides changed", () => {
    expect(conflictingKeys(base, next, draft, IST)).toEqual(["cause"]);
  });
  test("keeps the operator's text, takes the new values elsewhere", () => {
    const re = rebaseForm(base, next, draft, IST);
    expect(re.cause).toBe("worn seal and hose");
    expect(re.title).toBe("Press 2 oil leak, again");
    expect(re.priority).toBe("low");
    // Saving now sends only the operator's own edits, never the old priority over the other user's.
    expect(buildUpdate(next, re, IST)).toEqual({ ok: true, changes: { title: "Press 2 oil leak, again", cause: "worn seal and hose" } });
  });
});

describe("issue from the store: retry and request ids", () => {
  const sig = issueSignature("i1", 1000, "w1", " note ");
  test("an exact retry reuses the id and skips the balance check; a changed request gets a new id and the check", () => {
    let n = 0;
    const a = createIssueAttempts(createRequestIds(() => `id-${++n}`));
    const first = a.prepare(sig);
    expect(first.retry).toBe(false);
    a.markSent(sig);
    const again = a.prepare(sig);
    expect(again).toEqual({ clientRequestId: first.clientRequestId, retry: true });
    expect(a.isRetry(sig)).toBe(true);
    const changed = issueSignature("i1", 2000, "w1", "note");
    expect(a.isRetry(changed)).toBe(false);
    expect(a.prepare(changed).clientRequestId).not.toBe(first.clientRequestId);
  });
  test("settling (saved, or a replay found cancelled) starts the next submission fresh", () => {
    let n = 0;
    const a = createIssueAttempts(createRequestIds(() => `id-${++n}`));
    const first = a.prepare(sig).clientRequestId;
    a.markSent(sig);
    a.settle();
    expect(a.isRetry(sig)).toBe(false);
    expect(a.prepare(sig).clientRequestId).not.toBe(first);
  });
  test("note whitespace does not make a different request", () => {
    expect(issueSignature("i1", 1000, "w1", " note ")).toBe(issueSignature("i1", 1000, "w1", "note"));
  });
});

describe("the machine list failed to load", () => {
  test("shows the reason and a Retry button, in both languages", () => {
    for (const locale of ["en", "hi"] as const) {
      const html = renderToStaticMarkup(
        <I18nProvider locale={locale}>
          <AssetLoadError error={new Error("boom")} onRetry={() => {}} />
        </I18nProvider>,
      );
      expect(html).toContain("<button");
      expect(html).toContain('role="alert"');
    }
  });
});

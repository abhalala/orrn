/**
 * A plant on international grouping, day-month-year dates and a 12 hour clock sees those styles on an order, a dispatch, a
 * press run and an approval (units layer, slice b part 3). The real components are server rendered inside the plant's
 * `FmtProvider`; a plant that changed nothing reads today's text on the same rows (24 hour clock, Indian grouping).
 */
import { describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";

import { screenPrefs } from "@orrn/domain";
import { I18nProvider } from "@orrn/i18n";

import { RequestCard } from "@/features/approvals/approvals-page";
import { DispatchHeader } from "@/features/dispatch/dispatch-header";
import { Timeline } from "@/features/orders/components/timeline";
import { BakiStrip } from "@/features/orders/components/baki-strip";
import type { Strip } from "@/features/orders/view";
import { RunCard } from "@/features/press/station";
import { trpc } from "@/shared/utils/trpc";

import { FmtProvider } from "./fmt";

const PLANT = screenPrefs({ number: { grouping: "international" }, date: { order: "dmy" }, clock: "h12" });
const ZONE = "Asia/Kolkata";

// 24 Oct 2026, 20:00 in Kolkata (14:30 UTC).
const AT = Date.UTC(2026, 9, 24, 14, 30);

const STRIP = { orderedG: 123_456_000, orderedPcs: 4_000, plannedG: 100_000_000, pressedG: 90_000_000, agedG: 80_000_000, packedG: 70_000_000, inStockG: 60_000_000, inStockPcs: 1_200, bakiG: 53_456_000, dispatchedG: 70_000_000, overG: 0 } as unknown as Strip;

function me(role = "owner") {
  return {
    user: { id: "u1", name: "Asha", email: "a@x.in" },
    company: { id: "c1", name: "Plant", role, settings: { timezone: ZONE }, modules: {}, units: PLANT },
    permissions: [],
  };
}

function page(prefs: typeof PLANT | undefined, children: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(trpc.auth.me.queryKey(), me() as never);
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <I18nProvider locale="en">
        <FmtProvider prefs={prefs} timeZone={ZONE}>
          {children}
        </FmtProvider>
      </I18nProvider>
    </QueryClientProvider>,
  );
}

const orderRow = () => (
  <>
    <Timeline events={[{ id: "e1", at: new Date(AT), action: "order.created", actorName: "Asha", meta: {} }]} />
    <BakiStrip strip={STRIP} />
  </>
);

const dispatchRow = () => (
  <DispatchHeader code="DSP-12" status="dispatched" customerName="Acme" shipDay={{ ymd: "2026-10-24", kind: "dispatched" }} bundles={1234} weightG={1_234_567_000} />
);

const RUN = {
  run: {
    id: "r1", number: "PR-9", sectionCode: "D-101", sectionName: "Patta", purpose: "production", urgent: false, lateEntry: false, timeUnconfirmed: false,
    operatorName: "Ravi", reliefOperatorName: null, supervisorName: null, productionDay: "2026-10-24", shiftId: null, shiftSeq: 1, castNumber: null,
    startedAt: new Date(AT).toISOString(), stoppedAt: null, hasDrawing: false, pressRemark: null, dieRemark: null,
  },
  copy: null,
  planLines: [{ id: "l1", orderNumber: "SO-7", customerName: "Acme", cutLengthMm: 3658, pcs: 400, kgG: 1_234_567_000 }],
  planTotals: { pcs: 400, kgG: 1_234_567_000 },
} as never;

const runRow = () => <RunCard data={RUN} unit="mm" tz={ZONE} />;

const APPROVAL = {
  id: "a1", kind: "press_late_entry", status: "pending", subjectId: "", requestedByName: "Ravi", createdAt: new Date(AT).toISOString(),
  meta: { runNumber: "PR-9", pressLineCode: "P1", startedAt: AT - 3 * 3600_000, stoppedAt: AT - 3_600_000 },
} as never;

const approvalRow = () => <RequestCard item={APPROVAL} onReview={() => {}} />;

describe("a plant on international grouping, day-month-year and a 12 hour clock", () => {
  test("an order: the timeline reads '24 Oct at 8:00 pm' and the strip groups in thousands", () => {
    const html = page(PLANT, orderRow());
    expect(html).toContain("24 Oct at 8:00 pm");
    expect(html).toContain("123,456.000 kg");
    expect(html).not.toContain("1,23,456.000");
    expect(html).not.toContain("20:00");
  });
  test("a dispatch: the ship day is day month year order and the kg groups in thousands", () => {
    const html = page(PLANT, dispatchRow());
    expect(html).toContain("24 Oct");
    expect(html).toContain("1,234,567.00");
    expect(html).not.toContain("12,34,567");
  });
  test("a press run: production day, start time on a 12 hour clock, plan kg in thousands", () => {
    const html = page(PLANT, runRow());
    expect(html).toContain("24 Oct 2026");
    expect(html).toContain("8:00 pm");
    expect(html).toContain("1,234,567.0");
    expect(html).not.toContain("12,34,567");
  });
  test("an approval: the asked-at time reads '24 Oct at 8:00 pm'", () => {
    const html = page(PLANT, approvalRow());
    expect(html).toContain("24 Oct at 8:00 pm");
    expect(html).not.toContain("20:00");
  });
});

describe("a plant that changed nothing sees today's text on the same rows", () => {
  test("24 hour clock and Indian grouping", () => {
    expect(page(undefined, orderRow())).toContain("24 Oct at 20:00");
    expect(page(undefined, orderRow())).toContain("1,23,456.000 kg");
    expect(page(undefined, dispatchRow())).toContain("12,34,567.00");
    expect(page(undefined, runRow())).toContain("20:00");
    expect(page(undefined, runRow())).toContain("12,34,567.0");
    expect(page(undefined, approvalRow())).toContain("24 Oct at 20:00");
  });
  test("month first and 24 hours: another plant's choice moves the order of the date", () => {
    const html = page(screenPrefs({ date: { order: "mdy" } }), orderRow());
    expect(html).toContain("Oct 24 at 20:00");
  });
});

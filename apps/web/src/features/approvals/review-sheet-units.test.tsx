/**
 * A number and its unit word agree on the approval review (units layer, review fix). A plant on pounds reads its kg figures
 * converted, with "lb" beside them; a plant that changed nothing reads the same text as before (Indian grouping, kg).
 */
import { describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";

import { screenPrefs } from "@orrn/domain";
import { I18nProvider } from "@orrn/i18n";

const { trpc } = await import("@/shared/utils/trpc");
const { FmtProvider } = await import("@/shared/lib/fmt");
const { NoteFigures, LateEntryFigures } = await import("./review-sheet");

const ZONE = "Asia/Kolkata";
const POUNDS = screenPrefs({ units: { mass: "lb" } });

function page(prefs: ReturnType<typeof screenPrefs> | undefined, children: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(trpc.auth.me.queryOptions().queryKey, { user: { id: "u", name: "A", email: "a@x.in" }, company: { id: "c", name: "P", role: "owner", settings: { timezone: ZONE }, modules: {} }, permissions: [] } as never);
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

const NOTE = {
  note: { type: "debit", reason: "weight", status: "pending", kgDiffG: 200_000, boriDeductionG: 0, amountPaise: 0 },
  lot: { partyKgG: 10_000_000, fcKgG: 9_800_000, ratePaise: 0 },
  shortG: 200_000,
  toleranceG: 50_000,
  toleranceBp: 50,
  weightNoteKgG: 1_000_000,
  shortBeyondTolerance: false,
  noteCoversShort: false,
  otherNotes: [{ id: "n2", number: "DN-2", type: "debit", reason: "weight", status: "approved", kgDiffG: 300_000 }],
} as never;

describe("weight note figures", () => {
  test("a plant on pounds reads the party and our kanta weight in pounds, with lb beside them", () => {
    const html = page(POUNDS, <NoteFigures data={NOTE} loading={false} error={false} />);
    expect(html).toContain("22,046.23 lb");
    expect(html).toContain("21,605.3 lb");
    expect(html).not.toContain("10,000 lb");
    expect(html).not.toContain("9,800 lb");
    expect(html).not.toMatch(/\d kg[<(\s]/);
  });
  test("the other notes line and the over-short sentence say lb too", () => {
    const html = page(POUNDS, <NoteFigures data={NOTE} loading={false} error={false} />);
    expect(html).toContain("661.39 lb");
    expect(html).not.toContain("300 lb");
  });
  test("a plant that changed nothing reads the same text as before", () => {
    const html = page(undefined, <NoteFigures data={NOTE} loading={false} error={false} />);
    expect(html).toContain("10,000 kg");
    expect(html).toContain("9,800 kg");
    expect(html).toContain("50 kg (0.5%)");
    expect(html).toContain("300 kg");
  });
});

describe("late press entry figures", () => {
  const LATE = { runId: "r1", runNumber: "PR-1", pressLineCode: "L1", copyCode: "C1", startedAt: null, stoppedAt: null, productionDay: null, shiftSeq: null };
  const RUN = { run: { number: "PR-1", startedAt: null, stoppedAt: null, productionDay: null, shiftSeq: null, sectionCode: null }, line: null, copy: null, figures: { inputG: 1_200_000, goodG: 900_000 } } as never;
  test("1,200 kg of billets reads in pounds on a pound plant and in kg on a plain plant", () => {
    const lb = page(POUNDS, <LateEntryFigures late={LATE} run={RUN} loading={false} error={false} />);
    expect(lb).toContain("2,645.55 lb");
    expect(lb).not.toContain("1,200.000 lb");
    const plain = page(undefined, <LateEntryFigures late={LATE} run={RUN} loading={false} error={false} />);
    expect(plain).toContain("1,200.000 kg");
  });
});

/**
 * Papers keep today's units and words (owner rule, units layer: prints, labels, PDFs and papers that leave the plant stay
 * on today's units for now). Each paper is rendered on a plant that changed nothing and on a plant that chose pounds, metres
 * and pounds per foot, with Hindi digits and 12 hour clocks off the table: the two renderings must be the same text, and
 * the figures and words must be the ones the paper always carried.
 */
import { describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";

import { screenPrefs } from "@orrn/domain";
import { I18nProvider } from "@orrn/i18n";
import type { ReactNode } from "react";

const { FmtProvider } = await import("./fmt");
const { trpc } = await import("../utils/trpc");
const { Sticker } = await import("@/features/pack/label-sheet");
const { PrintCard } = await import("@/features/die-room/print-card");
const { CastBlock, PortalCertificatePage } = await import("@/features/portal/certificate-page");
const { CertificateScreen } = await import("@/features/foundry/certificate-view");

const DEFAULT = screenPrefs({});
// Pounds, metres, pounds per foot, international grouping, month first, 12 hour clock: nothing of today's is left.
const FAR = screenPrefs({
  units: { mass: "lb", length: "m", linear_mass: "lb_ft" },
  number: { grouping: "international" },
  date: { order: "mdy" },
  clock: "h12",
});
// A plant that wrote lengths in feet and inches before the units layer (company length unit "inch").
const LEGACY_INCH = screenPrefs({ units: { length: "ft_in" } });
const FAR_FT_IN = screenPrefs({ units: { mass: "lb", length: "ft_in", linear_mass: "kg_m" } });

function page(prefs: ReturnType<typeof screenPrefs>, node: ReactNode, qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })) {
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <I18nProvider locale="en">
        <FmtProvider prefs={prefs} timeZone="Asia/Kolkata">
          {node}
        </FmtProvider>
      </I18nProvider>
    </QueryClientProvider>,
  );
}

const text = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");

describe("the pack sticker", () => {
  const label = {
    bundleId: "b1", serial: "26J9", partyNo: "", qr: "q", cast: "K31", salesOrder: "SO-4", standard: "", cml: "", showLogo: false,
    sectionCode: "12170", series: "Domal", dieName: null, weightG: 52_440, pieces: 24, lengthMm: 3_658, kgPer12ftMilli: 2_450, poNumber: null,
  };
  const render = (prefs: ReturnType<typeof screenPrefs>) => page(prefs, <Sticker label={label} company="Four Cubes" unit="mm" qr={undefined} dense={false} />);
  test("today's weight, length and section weight with today's words on a plant of pounds, metres and pounds per foot", () => {
    const t = text(render(FAR));
    expect(t).toContain("52.44 kg");
    expect(t).toContain("24 pcs");
    expect(t).toContain("3658");
    expect(t).toContain("2.450 kg/12ft");
    expect(t).not.toMatch(/\blb\b|lb\/ft| m\b/);
    expect(render(FAR)).toBe(render(DEFAULT));
  });
  test("a plant that wrote lengths in feet and inches keeps them, whatever else it chose", () => {
    expect(text(render(LEGACY_INCH))).toContain("12 ft");
    expect(render(FAR_FT_IN)).toBe(render(LEGACY_INCH));
    expect(text(render(FAR_FT_IN))).toContain("52.44 kg");
  });
});

describe("the printed die card", () => {
  const card = {
    instance: { code: "12170-2", tierRank: 1, trialKgPer12ftMilli: 2_410, hardness: null, rackNo: null, bolster: null, backerNo: null, subBolster: null, makerDieNo: null, makerProjectNo: null, supplier: null, ftr: null, lifeG: 17_636_980 },
    section: { series: "Domal", sectionCode: "12170", profileKind: null, alloy: "6063", temper: "T5" },
    band: { id: "b", wallTenthMm: 12, weightMinG: 2_300, weightMaxG: 2_500, label: null },
    owner: null,
    cavityCount: 1,
    producedG: 2_645_550,
    currentMilli: 2_410,
    kgPerMetre: 0.659,
    pctTenth: 48,
    readings: [{ id: "r1", readAt: new Date("2026-10-24T14:05:00+05:30").toISOString(), kgPer12ftMilli: 2_410, pctTenth: 48, pressRunNumber: "PR-9" }],
    nitriding: [{ id: "n1", nitridedAt: new Date("2026-10-20T09:00:00+05:30").toISOString(), hardness: 1100 }],
  } as never;
  const render = (prefs: ReturnType<typeof screenPrefs>) => page(prefs, <PrintCard card={card} />);
  test("kg/12ft, kg, mm, day month year and the 24 hour clock on a plant of pounds, metres and pounds per foot", () => {
    const t = text(render(FAR));
    expect(t).toContain("2.300\u20132.500 kg/12ft");
    expect(t).toContain("2.410 kg/12ft");
    expect(t).toContain("2,645.55 / 17,636.98 kg");
    expect(t).toContain("0.659 kg/m");
    expect(t).not.toMatch(/\blb\b|lb\/ft/);
    expect(t).toContain("24 Oct at 14:05");
    expect(render(FAR)).toBe(render(DEFAULT));
  });
});

describe("the certificate cast block", () => {
  const cast = { castNo: "K31", alloy: "6063", status: "tested", verdict: "pass", bundles: 1_234, pcs: 0, weightG: 52_440_000, sectionCodes: ["12170"], alBalance: true, elements: [] } as never;
  test("pieces and weight are today's: Indian grouping, kg", () => {
    const render = (prefs: ReturnType<typeof screenPrefs>) => page(prefs, <ul><CastBlock cast={cast} /></ul>);
    const t = text(render(FAR));
    expect(t).toContain("1,234");
    expect(t).toContain("52,440.000 kg");
    expect(t).not.toMatch(/\blb\b/);
    expect(render(FAR)).toBe(render(DEFAULT));
  });
});

describe("the portal test certificate", () => {
  const snapshot = {
    number: "TC-7", revision: 1, issuedOn: "2026-10-24",
    company: { name: "Four Cubes", legalName: null, gstin: null, address: null, phone: null },
    customer: { name: "Acme", gstin: null, address: null },
    dispatch: { code: "DSP-3", completedOn: "2026-10-24", plNumber: "PL-3", invoiceNumber: null },
    lines: [{ sectionCode: "12170", item: "12170 Domal", alloy: "6063", temper: "T5", standard: null, cml: null, standardSource: "as_packed", profileKindSet: true, bundles: 1_234, pcs: 24_000, weightG: 52_440_000 }],
    totals: { bundles: 1_234, pcs: 24_000, weightG: 52_440_000 },
    chemistry: { status: "tested", verdict: "pass", alloys: ["6063"], testedBundles: 1, untestedBundles: 0 },
    casts: [{ castNo: "K31", alloy: "6063", status: "tested", verdict: "pass", bundles: 1_234, pcs: 0, weightG: 52_440_000, sectionCodes: ["12170"], alBalance: true, elements: [] }],
  };
  function render(prefs: ReturnType<typeof screenPrefs>) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    qc.setQueryData(trpc.portal.certificate.get.queryOptions({ dispatchId: "d1" }).queryKey, { snapshot, revision: 1 } as never);
    return page(prefs, <PortalCertificatePage dispatchId="d1" />, qc);
  }
  test("the issue date, the weights and their words are today's on a plant of pounds, metres and pounds per foot", () => {
    const t = text(render(FAR));
    expect(t).toContain("24 Oct 2026");
    expect(t).toContain("52,440.000 kg");
    expect(t).not.toMatch(/\blb\b|October 24|10\/24/);
    expect(render(FAR)).toBe(render(DEFAULT));
  });
});

describe("the foundry test certificate", () => {
  const cast = {
    cast: { id: "c1", number: "K31", legacyCode: null, alloy: "6063", alloyId: "a1", year: 2026, month: 10 },
    melts: [{
      id: "m1", seq: 1, status: "locked", furnaceId: "f1", spectro: [],
      chargingStartAt: new Date("2026-10-24T08:05:00+05:30").toISOString(), castingEndAt: new Date("2026-10-24T14:35:00+05:30").toISOString(),
      outputs: [{ kind: "logs", pcs: 12, lengthMm: 3_658, kgG: 1_234_500, returnStreamId: null, billetLengthMm: null }],
    }],
  };
  const trace = { bundles: [{ id: "b1", serial: "26J9", weightG: 52_440 }] };
  function render(prefs: ReturnType<typeof screenPrefs>) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    qc.setQueryData(trpc.foundry.casts.get.queryOptions({ id: "c1" }).queryKey, cast as never);
    qc.setQueryData(trpc.foundry.casts.trace.queryOptions({ castId: "c1" }).queryKey, trace as never);
    qc.setQueryData(trpc.foundry.alloys.list.queryOptions().queryKey, { items: [] } as never);
    qc.setQueryData(trpc.foundry.furnaces.list.queryOptions().queryKey, { items: [{ id: "f1", code: "F1" }] } as never);
    qc.setQueryData(trpc.auth.me.queryOptions().queryKey, { company: { name: "Four Cubes", settings: {} } } as never);
    return page(prefs, <CertificateScreen id="c1" />, qc);
  }
  test("melt times, log lines and bundle weights are today's on a plant of pounds, metres and pounds per foot", () => {
    const t = text(render(FAR));
    expect(t).toContain("24 Oct 08:05 - 14:35");
    expect(t).toContain("12 pcs, 12 ft, 1,234.5 kg");
    expect(t).toContain("52.4 kg");
    expect(t).not.toMatch(/\blb\b|\bpm\b|\bam\b/);
  });
});

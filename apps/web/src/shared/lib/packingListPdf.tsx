/**
 * Packing list PDF, rendered in the browser with @react-pdf/renderer. Never
 * import this module directly: `exports.ts` loads it with `await import()` on
 * click, so the renderer (~1.4 MB) stays out of every page chunk (W3).
 *
 * Same header, columns, groups and totals as the screen, the Excel sheet and
 * the native print (`packingListModel`). English only, like the plant's
 * paper PL. Print colours are plain greys (a document, not the app UI).
 */
import { packingListModel, plKgPerPiece, type PackingListModel, type PackingListSnapshot } from "@orrn/documents/packing-list/model";
import { Document, Font, Page, StyleSheet, Text, View, pdf } from "@react-pdf/renderer";

import { plViewOf, type PlGroupView, type PlView } from "@/features/dispatch/pl-model";

Font.registerHyphenationCallback((word) => [word]);

const INK = "#111111";
const MUTED = "#555555";
const RULE = "#d4d4d4";
const BAND = "#f4f4f1";

const s = StyleSheet.create({
  page: { paddingTop: 32, paddingBottom: 44, paddingHorizontal: 32, fontSize: 8.5, fontFamily: "Helvetica", color: INK },
  header: { flexDirection: "row", justifyContent: "space-between", marginBottom: 14, gap: 16 },
  company: { fontSize: 16, fontFamily: "Helvetica-Bold" },
  docTitle: { fontSize: 10, color: MUTED, marginTop: 3 },
  meta: { flexDirection: "row", gap: 10 },
  metaLabels: { color: MUTED, gap: 2, textAlign: "right" },
  metaValues: { fontFamily: "Helvetica-Bold", gap: 2 },
  customer: { marginBottom: 10 },
  customerName: { fontSize: 11, fontFamily: "Helvetica-Bold" },
  totals: { fontSize: 12, fontFamily: "Helvetica-Bold", marginBottom: 10 },
  notes: { marginBottom: 10, color: MUTED },
  tableHead: { flexDirection: "row", borderBottomWidth: 1, borderColor: INK, paddingBottom: 4, marginBottom: 2 },
  th: { fontFamily: "Helvetica-Bold", fontSize: 7.5 },
  row: { flexDirection: "row", paddingVertical: 3, borderBottomWidth: 0.5, borderColor: RULE },
  group: { flexDirection: "row", paddingTop: 8, paddingBottom: 3, borderBottomWidth: 0.5, borderColor: RULE },
  groupText: { fontFamily: "Helvetica-Bold", fontSize: 9 },
  sub: { flexDirection: "row", paddingVertical: 3, backgroundColor: BAND, fontFamily: "Helvetica-Bold" },
  grand: { flexDirection: "row", paddingVertical: 5, borderTopWidth: 1.5, borderColor: INK, marginTop: 6, fontFamily: "Helvetica-Bold", fontSize: 10 },
  footer: { position: "absolute", bottom: 20, left: 32, right: 32, flexDirection: "row", justifyContent: "space-between", fontSize: 7, color: MUTED },
  cSr: { width: "5%" },
  cBundle: { width: "15%" },
  cItem: { width: "24%", paddingRight: 4 },
  cItemNarrow: { width: "15%", paddingRight: 4 },
  cKg: { width: "10%", textAlign: "right" },
  cFt: { width: "8%", textAlign: "right" },
  cIn: { width: "8%", textAlign: "right" },
  cPcs: { width: "7%", textAlign: "right" },
  cK12: { width: "10%", textAlign: "right" },
  cRange: { width: "13%", textAlign: "right" },
  cKgPc: { width: "9%", textAlign: "right" },
});

const kg = (v: number) =>
  new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
const bundlesText = (n: number) => `${n} ${n === 1 ? "bundle" : "bundles"}`;

function TableHead({ kgPerPiece }: { kgPerPiece: boolean }) {
  return (
    <View style={s.tableHead} fixed>
      <Text style={[s.th, s.cSr]}>Sr</Text>
      <Text style={[s.th, s.cBundle]}>Bundle no</Text>
      <Text style={[s.th, kgPerPiece ? s.cItemNarrow : s.cItem]}>Item</Text>
      <Text style={[s.th, s.cKg]}>Weight kg</Text>
      <Text style={[s.th, s.cFt]}>Cut ft</Text>
      <Text style={[s.th, s.cIn]}>Cut in</Text>
      <Text style={[s.th, s.cPcs]}>Pcs</Text>
      <Text style={[s.th, s.cK12]}>kg/12ft</Text>
      <Text style={[s.th, s.cRange]}>Weight range /12'</Text>
      {kgPerPiece ? <Text style={[s.th, s.cKgPc]}>kg/pc</Text> : null}
    </View>
  );
}

function PackingListDoc({ model, code, kgPerPiece }: { model: PackingListModel; code: string; kgPerPiece: boolean }) {
  const { header, groups, totals } = model;
  const meta: [string, string][] = [
    ["PL no", code],
    ["Dispatch", header.dispatchCode],
    ["Date", header.date ?? ""],
    ["Ship date", header.shipDate ?? ""],
  ];
  return (
    <Document title={`${code} packing list`} author={header.companyName}>
      <Page size="A4" style={s.page}>
        <View style={s.header}>
          <View>
            <Text style={s.company}>{header.companyName}</Text>
            <Text style={s.docTitle}>Packing list</Text>
          </View>
          <View style={s.meta}>
            <View style={s.metaLabels}>
              {meta.map(([k]) => (
                <Text key={k}>{k}</Text>
              ))}
            </View>
            <View style={s.metaValues}>
              {meta.map(([k, v]) => (
                <Text key={k}>{v || " "}</Text>
              ))}
            </View>
          </View>
        </View>

        <View style={s.customer}>
          <Text style={{ color: MUTED }}>Customer</Text>
          <Text style={s.customerName}>{header.customerName}</Text>
          {header.customerTaxId ? <Text>GSTIN {header.customerTaxId}</Text> : null}
          {header.customerPhone ? <Text>{header.customerPhone}</Text> : null}
        </View>

        <Text style={s.totals}>
          {bundlesText(totals.bundles)} · {kg(totals.weightKg)} kg
        </Text>
        {header.notes ? <Text style={s.notes}>{header.notes}</Text> : null}

        <TableHead kgPerPiece={kgPerPiece} />
        {groups.map((g) => (
          <View key={g.key}>
            <View style={s.group} wrap={false}>
              <Text style={s.groupText}>{g.labelled ? `${g.label}: ${g.dieLabel}` : g.label}</Text>
            </View>
            {g.rows.map((r) => (
              <View key={r.sr} style={s.row} wrap={false}>
                <Text style={s.cSr}>{r.sr}</Text>
                <Text style={s.cBundle}>{r.bundleNo}</Text>
                <Text style={kgPerPiece ? s.cItemNarrow : s.cItem}>{r.item}</Text>
                <Text style={s.cKg}>{kg(r.weightKg)}</Text>
                <Text style={s.cFt}>{r.cutLengthFt}</Text>
                <Text style={s.cIn}>{r.cutLengthIn}</Text>
                <Text style={s.cPcs}>{r.pcs}</Text>
                <Text style={s.cK12}>{r.kgPer12ft === null ? "" : r.kgPer12ft.toFixed(3)}</Text>
                <Text style={s.cRange}>{r.weightRange12ft === null ? "" : r.weightRange12ft.toFixed(1)}</Text>
                {kgPerPiece ? <Text style={s.cKgPc}>{r.kgPerPiece === null ? "" : r.kgPerPiece.toFixed(3)}</Text> : null}
              </View>
            ))}
            <View style={s.sub} wrap={false}>
              <Text style={s.cSr} />
              <Text style={s.cBundle}>{bundlesText(g.bundles)}</Text>
              <Text style={kgPerPiece ? s.cItemNarrow : s.cItem}>Total {g.label}</Text>
              <Text style={s.cKg}>{kg(g.weightKg)}</Text>
              <Text style={s.cFt} />
              <Text style={s.cIn} />
              <Text style={s.cPcs}>{g.pieces}</Text>
              <Text style={s.cK12} />
              <Text style={s.cRange} />
              {kgPerPiece ? <Text style={s.cKgPc} /> : null}
            </View>
          </View>
        ))}
        <View style={s.grand} wrap={false}>
          <Text style={s.cSr} />
          <Text style={s.cBundle}>{bundlesText(totals.bundles)}</Text>
          <Text style={kgPerPiece ? s.cItemNarrow : s.cItem}>Total</Text>
          <Text style={s.cKg}>{kg(totals.weightKg)}</Text>
          <Text style={s.cFt} />
          <Text style={s.cIn} />
          <Text style={s.cPcs}>{totals.pieces}</Text>
          <Text style={s.cK12} />
          <Text style={s.cRange} />
          {kgPerPiece ? <Text style={s.cKgPc} /> : null}
        </View>

        <View style={s.footer} fixed>
          <Text>
            {header.companyName}, {code}
          </Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

/* -------------------------------------------------------------------------- */
/* v2: the plant's packing list on A4 landscape (FP-PK-13)                      */
/* -------------------------------------------------------------------------- */

const v2s = StyleSheet.create({
  page: { paddingTop: 28, paddingBottom: 40, paddingHorizontal: 28, fontSize: 8, fontFamily: "Helvetica", color: INK },
  top: { flexDirection: "row", justifyContent: "space-between", marginBottom: 10, gap: 16 },
  company: { fontSize: 15, fontFamily: "Helvetica-Bold" },
  small: { color: MUTED, marginTop: 1 },
  meta: { flexDirection: "row", flexWrap: "wrap", width: "52%", gap: 0 },
  metaCell: { width: "33.33%", marginBottom: 4, paddingRight: 6 },
  metaLabel: { color: MUTED, fontSize: 7 },
  metaValue: { fontFamily: "Helvetica-Bold" },
  parties: { flexDirection: "row", gap: 12, marginBottom: 8 },
  party: { flexGrow: 1, flexBasis: 0, borderWidth: 0.5, borderColor: RULE, padding: 5 },
  partyName: { fontFamily: "Helvetica-Bold", fontSize: 9.5 },
  headline: { flexDirection: "row", justifyContent: "space-between", marginBottom: 6 },
  totals: { fontSize: 11, fontFamily: "Helvetica-Bold" },
  profile: { color: MUTED },
  th: { fontFamily: "Helvetica-Bold", fontSize: 7 },
  head: { flexDirection: "row", borderBottomWidth: 1, borderColor: INK, paddingBottom: 3, marginBottom: 1 },
  row: { flexDirection: "row", paddingVertical: 2, borderBottomWidth: 0.5, borderColor: RULE },
  groupRow: { flexDirection: "row", paddingTop: 6, paddingBottom: 2 },
  groupText: { fontFamily: "Helvetica-Bold", fontSize: 8.5 },
  sub: { flexDirection: "row", paddingVertical: 2, backgroundColor: BAND, fontFamily: "Helvetica-Bold" },
  grand: { flexDirection: "row", paddingVertical: 4, borderTopWidth: 1.5, borderColor: INK, marginTop: 4, fontFamily: "Helvetica-Bold", fontSize: 9.5 },
  footer: { position: "absolute", bottom: 16, left: 28, right: 28, flexDirection: "row", justifyContent: "space-between", fontSize: 7, color: MUTED },
});

const kg3 = (g: number) => new Intl.NumberFormat("en-IN", { minimumFractionDigits: 3, maximumFractionDigits: 3 }).format(g / 1000);

type Col = { key: string; label: string; w: number; end?: boolean };

/** Column weights (not percentages): the optional columns join only when they have something to say. */
function columnsOf(view: PlView, kgPerPiece = false): Col[] {
  return [
    { key: "sr", label: "Sr", w: 4 },
    { key: "bundle", label: "Bundle no", w: 13 },
    ...(view.columns.partyNo ? [{ key: "party", label: "Party no", w: 9 }] : []),
    { key: "section", label: "Section", w: 7 },
    { key: "item", label: "Item", w: 13 },
    { key: "kg", label: "Weight kg", w: 8, end: true },
    { key: "ft", label: "Cut ft", w: 5, end: true },
    { key: "in", label: "Cut in", w: 5, end: true },
    { key: "pcs", label: "Pcs", w: 5, end: true },
    { key: "k12", label: "kg/12ft", w: 7, end: true },
    { key: "range", label: "Range /12'", w: 7, end: true },
    { key: "po", label: "PO", w: 8 },
    ...(view.columns.originalSo ? [{ key: "so", label: "Original SO", w: 9 }] : []),
    // W2-OPPK-W: the plant's kg-per-piece column (Settings), weight / pieces of the row.
    ...(kgPerPiece ? [{ key: "kgpc", label: "kg/pc", w: 6, end: true }] : []),
  ];
}

function PackingListDocV2({ view, code, kgPerPiece = false }: { view: PlView; code: string; kgPerPiece?: boolean }) {
  const cols = columnsOf(view, kgPerPiece);
  const total = cols.reduce((n, c) => n + c.w, 0);
  const cell = (c: Col) => ({ width: `${(c.w / total) * 100}%`, textAlign: c.end ? ("right" as const) : ("left" as const), paddingRight: 3 });
  const cells = (g: PlGroupView, r: PlGroupView["rows"][number]) => ({
    sr: String(r.sr),
    bundle: r.bundleNo,
    party: r.partyNo ?? "",
    section: r.section,
    item: r.item,
    kg: kg3(r.weightG),
    ft: String(r.cutFt),
    in: String(r.cutIn),
    pcs: String(r.pcs),
    k12: r.kgPer12ftMilli === null ? "" : (r.kgPer12ftMilli / 1000).toFixed(3),
    range: r.range12ft === null ? "" : r.range12ft.toFixed(1),
    po: r.po ?? "",
    so: r.originalSo ?? "",
    kgpc: plKgPerPiece(r),
    _g: g.key,
  });
  const totalRow = (label: string, n: number, pcs: number, weightG: number, style: React.ComponentProps<typeof View>["style"], bold = false) => (
    <View style={style} wrap={false}>
      {cols.map((c) => (
        <Text key={c.key} style={[cell(c), bold ? { fontFamily: "Helvetica-Bold" } : {}]}>
          {c.key === "bundle" ? bundlesText(n) : c.key === "item" ? label : c.key === "kg" ? kg3(weightG) : c.key === "pcs" ? String(pcs) : ""}
        </Text>
      ))}
    </View>
  );
  const meta: [string, string | null][] = [
    ["PL no", view.revision > 1 ? `${view.plNumber} (Rev ${view.revision})` : view.plNumber],
    ["Date", view.date],
    ["Dispatch", view.dispatchCodes],
    ["Ship date", view.shipDate],
    ["Vehicle", view.vehicleNo],
    ["Driver", [view.driverName, view.driverPhone].filter(Boolean).join(" ") || null],
    ["Transporter", view.transporter],
    ["PO", view.poNumbers.length ? view.poNumbers.join(", ") : null],
    ["Invoice", view.invoiceNumber ? [view.invoiceNumber, view.invoiceDate].filter(Boolean).join(" ") : null],
  ];
  const kindWord = { hollow: "Hollow", solid: "Solid", semi: "Semi-hollow" } as const;
  return (
    <Document title={`${code} packing list`} author={view.company.name}>
      <Page size="A4" orientation="landscape" style={v2s.page}>
        <View style={v2s.top}>
          <View style={{ width: "44%" }}>
            {/* Branding off hides the tagline; the legal name always prints. */}
            <Text style={v2s.company}>{view.branding.show ? view.company.name : (view.company.legalName ?? view.company.name)}</Text>
            {view.branding.show && view.branding.tagline ? <Text style={v2s.small}>{view.branding.tagline}</Text> : null}
            {view.branding.show && view.company.legalName ? <Text style={v2s.small}>{view.company.legalName}</Text> : null}
            {view.company.address ? <Text style={v2s.small}>{view.company.address}</Text> : null}
            {view.company.gstin || view.company.phone ? (
              <Text style={v2s.small}>{[view.company.gstin ? `GSTIN ${view.company.gstin}` : null, view.company.phone].filter(Boolean).join("  ")}</Text>
            ) : null}
            <Text style={[v2s.small, { marginTop: 3 }]}>Packing list</Text>
          </View>
          <View style={v2s.meta}>
            {meta.map(([k, v]) => (
              <View key={k} style={v2s.metaCell}>
                <Text style={v2s.metaLabel}>{k}</Text>
                <Text style={v2s.metaValue}>{v || " "}</Text>
              </View>
            ))}
          </View>
        </View>

        <View style={v2s.parties}>
          {([["Bill to", view.billTo], ["Ship to", view.shipTo]] as const).map(([label, p]) => (
            <View key={label} style={v2s.party}>
              <Text style={v2s.metaLabel}>{label}</Text>
              <Text style={v2s.partyName}>{p.name}</Text>
              {p.address ? <Text>{p.address}</Text> : null}
              {p.gstin ? <Text>GSTIN {p.gstin}</Text> : null}
            </View>
          ))}
        </View>

        <View style={v2s.headline}>
          <Text style={v2s.totals}>
            {bundlesText(view.total.bundles)} · {kg3(view.total.weightG)} kg
          </Text>
          <Text style={v2s.profile}>
            {view.profile.map((k) => `${kindWord[k.kind]} ${bundlesText(k.bundles)} · ${kg3(k.weightG)} kg`).join("    ")}
          </Text>
        </View>

        <View style={v2s.head} fixed>
          {cols.map((c) => (
            <Text key={c.key} style={[v2s.th, cell(c)]}>
              {c.label}
            </Text>
          ))}
        </View>
        {view.groups.map((g) => (
          <View key={g.key}>
            <View style={v2s.groupRow} wrap={false} minPresenceAhead={30}>
              <Text style={v2s.groupText}>{g.title}</Text>
            </View>
            {g.rows.map((r) => {
              const v = cells(g, r) as Record<string, string>;
              return (
                <View key={r.sr} style={v2s.row} wrap={false}>
                  {cols.map((c) => (
                    <Text key={c.key} style={cell(c)}>
                      {v[c.key]}
                    </Text>
                  ))}
                </View>
              );
            })}
            {totalRow(`Total ${g.title.split(" · ")[0] ?? ""}`, g.subtotal.bundles, g.subtotal.pcs, g.subtotal.weightG, v2s.sub, true)}
            {g.sectionAfter
              ? totalRow(`Total section ${g.sectionAfter.sectionCode}`, g.sectionAfter.bundles, g.sectionAfter.pcs, g.sectionAfter.weightG, v2s.sub, true)
              : null}
          </View>
        ))}
        {totalRow("Total", view.total.bundles, view.total.pcs, view.total.weightG, v2s.grand, true)}

        <View style={v2s.footer} fixed>
          <Text>
            {view.company.legalName ?? view.company.name}, {code}
            {view.revision > 1 ? ` (Rev ${view.revision})` : ""}
          </Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

/** Render and save the packing list as `<code>.pdf`. */
export async function downloadPackingListPdf(pl: PackingListSnapshot, code: string, opts: { timeZone?: string; kgPerPiece?: boolean } = {}) {
  const view = plViewOf(pl);
  const kgPerPiece = opts.kgPerPiece === true;
  const blob = await pdf(
    view ? (
      <PackingListDocV2 view={view} code={code} kgPerPiece={kgPerPiece} />
    ) : (
      <PackingListDoc model={packingListModel(pl, opts)} code={code} kgPerPiece={kgPerPiece} />
    ),
  ).toBlob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${code.replace(/[^A-Za-z0-9._-]+/g, "-")}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Let the download start before the URL goes away.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

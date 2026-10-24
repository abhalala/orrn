/**
 * Packing list PDF, rendered in the browser with @react-pdf/renderer. Never
 * import this module directly: `exports.ts` loads it with `await import()` on
 * click, so the renderer (~1.4 MB) stays out of every page chunk (W3).
 *
 * Same header, columns, groups and totals as the screen, the Excel sheet and
 * the native print (`packingListModel`). English only, like the plant's
 * paper PL. Print colours are plain greys (a document, not the app UI).
 */
import { packingListModel, type PackingListModel, type PackingListSnapshot } from "@orrn/documents/packing-list/model";
import { Document, Font, Page, StyleSheet, Text, View, pdf } from "@react-pdf/renderer";

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
  cBundle: { width: "12%" },
  cItem: { width: "27%", paddingRight: 4 },
  cKg: { width: "10%", textAlign: "right" },
  cFt: { width: "8%", textAlign: "right" },
  cIn: { width: "8%", textAlign: "right" },
  cPcs: { width: "7%", textAlign: "right" },
  cK12: { width: "10%", textAlign: "right" },
  cRange: { width: "13%", textAlign: "right" },
});

const kg = (v: number) =>
  new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
const bundlesText = (n: number) => `${n} ${n === 1 ? "bundle" : "bundles"}`;

function TableHead() {
  return (
    <View style={s.tableHead} fixed>
      <Text style={[s.th, s.cSr]}>Sr</Text>
      <Text style={[s.th, s.cBundle]}>Bundle no</Text>
      <Text style={[s.th, s.cItem]}>Item</Text>
      <Text style={[s.th, s.cKg]}>Weight kg</Text>
      <Text style={[s.th, s.cFt]}>Cut ft</Text>
      <Text style={[s.th, s.cIn]}>Cut in</Text>
      <Text style={[s.th, s.cPcs]}>Pcs</Text>
      <Text style={[s.th, s.cK12]}>kg/12ft</Text>
      <Text style={[s.th, s.cRange]}>Weight range /12'</Text>
    </View>
  );
}

function PackingListDoc({ model, code }: { model: PackingListModel; code: string }) {
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

        <TableHead />
        {groups.map((g) => (
          <View key={g.key}>
            <View style={s.group} wrap={false}>
              <Text style={s.groupText}>{g.labelled ? `${g.label}: ${g.dieLabel}` : g.label}</Text>
            </View>
            {g.rows.map((r) => (
              <View key={r.sr} style={s.row} wrap={false}>
                <Text style={s.cSr}>{r.sr}</Text>
                <Text style={s.cBundle}>{r.bundleNo}</Text>
                <Text style={s.cItem}>{r.item}</Text>
                <Text style={s.cKg}>{kg(r.weightKg)}</Text>
                <Text style={s.cFt}>{r.cutLengthFt}</Text>
                <Text style={s.cIn}>{r.cutLengthIn}</Text>
                <Text style={s.cPcs}>{r.pcs}</Text>
                <Text style={s.cK12}>{r.kgPer12ft === null ? "" : r.kgPer12ft.toFixed(3)}</Text>
                <Text style={s.cRange}>{r.weightRange12ft === null ? "" : r.weightRange12ft.toFixed(1)}</Text>
              </View>
            ))}
            <View style={s.sub} wrap={false}>
              <Text style={s.cSr} />
              <Text style={s.cBundle}>{bundlesText(g.bundles)}</Text>
              <Text style={s.cItem}>Total {g.label}</Text>
              <Text style={s.cKg}>{kg(g.weightKg)}</Text>
              <Text style={s.cFt} />
              <Text style={s.cIn} />
              <Text style={s.cPcs}>{g.pieces}</Text>
              <Text style={s.cK12} />
              <Text style={s.cRange} />
            </View>
          </View>
        ))}
        <View style={s.grand} wrap={false}>
          <Text style={s.cSr} />
          <Text style={s.cBundle}>{bundlesText(totals.bundles)}</Text>
          <Text style={s.cItem}>Total</Text>
          <Text style={s.cKg}>{kg(totals.weightKg)}</Text>
          <Text style={s.cFt} />
          <Text style={s.cIn} />
          <Text style={s.cPcs}>{totals.pieces}</Text>
          <Text style={s.cK12} />
          <Text style={s.cRange} />
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

/** Render and save the packing list as `<code>.pdf`. */
export async function downloadPackingListPdf(pl: PackingListSnapshot, code: string, opts: { timeZone?: string } = {}) {
  const model = packingListModel(pl, opts);
  const blob = await pdf(<PackingListDoc model={model} code={code} />).toBlob();
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

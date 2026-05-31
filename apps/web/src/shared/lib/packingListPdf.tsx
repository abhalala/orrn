/**
 * Packing list PDF template — rendered client-side via @react-pdf/renderer.
 * Import lazily to keep the initial bundle lean.
 */
import type { LengthUnit } from "@orrn/server/lib/length";
import { formatLengthValue } from "@orrn/server/lib/length";
import type { PLSnapshot } from "@orrn/documents/packing-list";
export type { PLSnapshot } from "@orrn/documents/packing-list";
import {
  Document,
  Font,
  Page,
  StyleSheet,
  Text,
  View,
  pdf,
} from "@react-pdf/renderer";

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------
Font.registerHyphenationCallback((word) => [word]);

const s = StyleSheet.create({
  page: { padding: 36, fontSize: 9, fontFamily: "Helvetica", color: "#111" },
  header: { flexDirection: "row", justifyContent: "space-between", marginBottom: 20 },
  companyName: { fontSize: 16, fontFamily: "Helvetica-Bold" },
  docTitle: { fontSize: 11, color: "#555", marginTop: 2 },
  plCode: { fontSize: 18, fontFamily: "Helvetica-Bold", textAlign: "right" },
  plSub: { fontSize: 9, color: "#555", textAlign: "right", marginTop: 2 },
  section: { marginBottom: 14 },
  sectionLabel: { fontSize: 8, color: "#666", marginBottom: 3, textTransform: "uppercase" },
  sectionValue: { fontSize: 9 },
  row2: { flexDirection: "row", gap: 24 },
  col: { flex: 1 },
  divider: { borderBottomWidth: 1, borderBottomColor: "#e5e7eb", marginBottom: 12, marginTop: 4 },
  tableHeader: {
    flexDirection: "row",
    backgroundColor: "#f3f4f6",
    padding: "5 6",
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: "#e5e7eb",
  },
  tableRow: {
    flexDirection: "row",
    padding: "4 6",
    borderBottomWidth: 1,
    borderBottomColor: "#f3f4f6",
  },
  th: { fontFamily: "Helvetica-Bold", fontSize: 8, color: "#555", textTransform: "uppercase" },
  td: { fontSize: 9 },
  w1: { width: "14%" },
  w2: { width: "22%" },
  w3: { width: "14%" },
  w4: { width: "14%", textAlign: "right" },
  w5: { width: "12%", textAlign: "right" },
  w6: { width: "12%", textAlign: "right" },
  w7: { width: "12%", textAlign: "right" },
  totalsRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginTop: 8,
    gap: 24,
  },
  totalsLabel: { fontSize: 8, color: "#555", marginBottom: 2 },
  totalsValue: { fontSize: 11, fontFamily: "Helvetica-Bold" },
  footer: { position: "absolute", bottom: 24, left: 36, right: 36, fontSize: 7, color: "#aaa", textAlign: "center" },
  notesBox: { backgroundColor: "#fafafa", border: "1 solid #e5e7eb", padding: "6 8", borderRadius: 3 },
});

// ---------------------------------------------------------------------------
// Document component
// ---------------------------------------------------------------------------
function PackingListDoc({ pl, code, lengthUnit }: { pl: PLSnapshot; code: string; lengthUnit: LengthUnit }) {
  const shipDate = pl.dispatch.shipDate
    ? new Date(pl.dispatch.shipDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
    : "—";
  const genDate = new Date(pl.generatedAt).toLocaleDateString("en-IN", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
  const cust = pl.dispatch.customer;

  return (
    <Document>
      <Page size="A4" style={s.page}>
        {/* Header */}
        <View style={s.header}>
          <View>
            <Text style={s.companyName}>{pl.company.name}</Text>
            <Text style={s.docTitle}>Packing List</Text>
          </View>
          <View>
            <Text style={s.plCode}>{code}</Text>
            <Text style={s.plSub}>Dispatch: {pl.dispatch.code}</Text>
            <Text style={s.plSub}>Generated: {genDate}</Text>
          </View>
        </View>

        <View style={s.divider} />

        {/* Parties */}
        <View style={[s.row2, s.section]}>
          <View style={s.col}>
            <Text style={s.sectionLabel}>Customer</Text>
            <Text style={[s.sectionValue, { fontFamily: "Helvetica-Bold" }]}>{cust.name}</Text>
            {cust.phone && <Text style={s.sectionValue}>{cust.phone}</Text>}
            {cust.email && <Text style={s.sectionValue}>{cust.email}</Text>}
            {cust.taxId && <Text style={s.sectionValue}>Tax ID: {cust.taxId}</Text>}
          </View>
          <View style={s.col}>
            <Text style={s.sectionLabel}>Ship Date</Text>
            <Text style={s.sectionValue}>{shipDate}</Text>
          </View>
        </View>

        {/* Notes */}
        {pl.dispatch.notes && (
          <View style={[s.section]}>
            <Text style={s.sectionLabel}>Notes</Text>
            <View style={s.notesBox}>
              <Text style={s.sectionValue}>{pl.dispatch.notes}</Text>
            </View>
          </View>
        )}

        {/* Items table */}
        <View style={s.tableHeader}>
          <Text style={[s.th, s.w1]}>Serial</Text>
          <Text style={[s.th, s.w2]}>Die</Text>
          <Text style={[s.th, s.w3]}>Group</Text>
          <Text style={[s.th, s.w4, { textAlign: "right" }]}>Qty</Text>
          <Text style={[s.th, s.w5, { textAlign: "right" }]}>Wt (kg)</Text>
          <Text style={[s.th, s.w6, { textAlign: "right" }]}>Len ({lengthUnit === "inch" ? "in" : "mm"})</Text>
        </View>
        {pl.items.map((item, i) => (
          <View key={i} style={[s.tableRow, { backgroundColor: i % 2 === 0 ? "#fff" : "#fafafa" }]}>
            <Text style={[s.td, s.w1]}>{item.bundleSerial}</Text>
            <Text style={[s.td, s.w2]}>{item.die.series} / {item.die.sectionCode}</Text>
            <Text style={[s.td, s.w3]}>{item.groupId || "—"}</Text>
            <Text style={[s.td, s.w4]}>{item.quantity}</Text>
            <Text style={[s.td, s.w5]}>{(item.weightG / 1000).toFixed(3)}</Text>
            <Text style={[s.td, s.w6]}>{formatLengthValue(item.lengthMm, lengthUnit)}</Text>
          </View>
        ))}

        {/* Totals */}
        <View style={s.totalsRow}>
          <View>
            <Text style={s.totalsLabel}>Bundles</Text>
            <Text style={s.totalsValue}>{pl.totals.totalBundles}</Text>
          </View>
          <View>
            <Text style={s.totalsLabel}>Total Qty</Text>
            <Text style={s.totalsValue}>{pl.totals.totalQuantity}</Text>
          </View>
          <View>
            <Text style={s.totalsLabel}>Total Wt</Text>
            <Text style={s.totalsValue}>{pl.totals.totalWeightKg} kg</Text>
          </View>
          <View>
            <Text style={s.totalsLabel}>Total Len</Text>
            <Text style={s.totalsValue}>{formatLengthValue(pl.totals.totalLengthM * 1000, lengthUnit)} {lengthUnit === "inch" ? "in" : "mm"}</Text>
          </View>
        </View>

        <Text style={s.footer}>
          {pl.company.name} · {code} · This document is system-generated. Verify with original dispatch records.
        </Text>
      </Page>
    </Document>
  );
}

// ---------------------------------------------------------------------------
// Download helper
// ---------------------------------------------------------------------------
export async function downloadPackingListPdf(pl: PLSnapshot, code: string, lengthUnit: LengthUnit = "mm") {
  const blob = await pdf(<PackingListDoc pl={pl} code={code} lengthUnit={lengthUnit} />).toBlob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${code}.pdf`;
  a.click();
  URL.revokeObjectURL(url);
}

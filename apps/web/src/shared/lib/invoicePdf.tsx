/**
 * Tax invoice and credit note PDF (A4), rendered in the browser with @react-pdf/renderer. Never import this
 * module directly: `exports.ts` loads it with `await import()` on click, so the renderer stays out of every
 * page chunk. Every word and figure comes from `invoicePaperModel` (the frozen snapshot); the paper is English
 * and plain greys. A document waiting for its IRN says so and is not called a tax invoice.
 */
import { Document, Font, Page, StyleSheet, Text, View, pdf } from "@react-pdf/renderer";

import { invoicePaperModel, invoicePdfFileName, type InvoicePaper, type PaperDoc } from "./invoicePaper";

Font.registerHyphenationCallback((word) => [word]);

const INK = "#111111";
const MUTED = "#555555";
const RULE = "#d4d4d4";
const BAND = "#f4f4f1";

const s = StyleSheet.create({
  page: { paddingTop: 30, paddingBottom: 40, paddingHorizontal: 30, fontSize: 8.5, fontFamily: "Helvetica", color: INK },
  title: { fontSize: 14, fontFamily: "Helvetica-Bold", textAlign: "center", marginBottom: 4 },
  mark: { alignSelf: "center", borderWidth: 1.5, borderColor: INK, paddingVertical: 3, paddingHorizontal: 12, fontFamily: "Helvetica-Bold", fontSize: 11, marginBottom: 6 },
  seller: { borderBottomWidth: 0.5, borderColor: RULE, paddingBottom: 6, marginBottom: 6 },
  sellerName: { fontSize: 13, fontFamily: "Helvetica-Bold" },
  twoCol: { flexDirection: "row", gap: 12, marginBottom: 8 },
  col: { flexGrow: 1, flexBasis: 0 },
  label: { color: MUTED, fontSize: 7.5 },
  strong: { fontFamily: "Helvetica-Bold" },
  metaRow: { flexDirection: "row", gap: 6, marginBottom: 1.5 },
  metaLabel: { width: 78, color: MUTED },
  metaValue: { flexGrow: 1, flexBasis: 0, fontFamily: "Helvetica-Bold" },
  head: { flexDirection: "row", borderBottomWidth: 1, borderTopWidth: 0.5, borderColor: INK, paddingVertical: 3, backgroundColor: BAND },
  row: { flexDirection: "row", paddingVertical: 3, borderBottomWidth: 0.5, borderColor: RULE },
  th: { fontFamily: "Helvetica-Bold", fontSize: 7.5 },
  totals: { alignSelf: "flex-end", width: "52%", marginTop: 6 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 1.5 },
  grand: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 4, borderTopWidth: 1.5, borderColor: INK, marginTop: 3, fontFamily: "Helvetica-Bold", fontSize: 11 },
  words: { marginTop: 6, fontFamily: "Helvetica-Bold" },
  section: { marginTop: 10 },
  small: { fontSize: 7.5, color: MUTED },
  mono: { fontFamily: "Courier", fontSize: 6.5 },
  signRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 14, gap: 24 },
  signBox: { width: "42%", alignItems: "flex-end" },
  signLine: { height: 36, borderBottomWidth: 0.5, borderColor: INK, width: "100%" },
  footer: { position: "absolute", bottom: 18, left: 30, right: 30, flexDirection: "row", justifyContent: "space-between", fontSize: 7, color: MUTED },
});

const W = [24, 0, 44, 62, 52, 30, 62];
const colStyle = (i: number, right: boolean) => ({ width: W[i] || undefined, flexGrow: W[i] ? 0 : 1, flexBasis: W[i] ? undefined : 0, paddingRight: 3, textAlign: right ? ("right" as const) : ("left" as const) });
const RIGHT = new Set([3, 4, 5, 6]);

export function InvoiceDoc({ p }: { p: InvoicePaper }) {
  return (
    <Document title={p.title}>
      <Page size="A4" style={s.page}>
        <Text style={s.title}>{p.title}</Text>
        {p.mark ? <Text style={s.mark}>{p.mark}</Text> : null}

        <View style={s.seller}>
          <Text style={s.sellerName}>{p.seller.legalName}</Text>
          <Text>{p.seller.address}</Text>
          <Text>
            GSTIN {p.seller.gstin} · State {p.seller.state}
            {p.seller.phone ? ` · ${p.seller.phone}` : ""}
          </Text>
        </View>

        <View style={s.twoCol}>
          <View style={s.col}>
            {p.parties.map((pt) => (
              <View key={pt.label} style={{ marginBottom: 6 }}>
                <Text style={s.label}>{pt.label}</Text>
                <Text style={s.strong}>{pt.name}</Text>
                {pt.lines.map((l, i) => (
                  <Text key={i}>{l}</Text>
                ))}
                {pt.gstin ? <Text>GSTIN {pt.gstin}</Text> : null}
              </View>
            ))}
          </View>
          <View style={s.col}>
            {p.meta.map((m) => (
              <View key={m.label} style={s.metaRow}>
                <Text style={s.metaLabel}>{m.label}</Text>
                <Text style={s.metaValue}>{m.value}</Text>
              </View>
            ))}
          </View>
        </View>

        <View style={s.head}>
          {p.columns.map((c, i) => (
            <Text key={c} style={[s.th, colStyle(i, RIGHT.has(i))]}>
              {c}
            </Text>
          ))}
        </View>
        {p.rows.map((r, ri) => (
          <View key={ri} style={s.row} wrap={false}>
            {r.map((c, i) => (
              <Text key={i} style={colStyle(i, RIGHT.has(i))}>
                {c}
              </Text>
            ))}
          </View>
        ))}

        <View style={s.totals} wrap={false}>
          {p.tax.map((t) => (
            <View key={t.label} style={s.totalRow}>
              <Text>{t.label}</Text>
              <Text>{t.value}</Text>
            </View>
          ))}
          {p.roundOff ? (
            <View style={s.totalRow}>
              <Text>Round off</Text>
              <Text>{p.roundOff}</Text>
            </View>
          ) : null}
          <View style={s.grand}>
            <Text>Total (Rs)</Text>
            <Text>{p.total}</Text>
          </View>
        </View>
        <Text style={s.words}>{p.words}</Text>

        <View style={s.section} wrap={false}>
          <View style={s.head}>
            {p.hsnColumns.map((c, i) => (
              <Text key={c} style={[s.th, { flexGrow: 1, flexBasis: 0, textAlign: i === 0 ? "left" : "right" }]}>
                {c}
              </Text>
            ))}
          </View>
          {p.hsnRows.map((r, ri) => (
            <View key={ri} style={s.row}>
              {r.map((c, i) => (
                <Text key={i} style={{ flexGrow: 1, flexBasis: 0, textAlign: i === 0 ? "left" : "right" }}>
                  {c}
                </Text>
              ))}
            </View>
          ))}
        </View>

        {p.ack.length || p.signedQr ? (
          <View style={s.section} wrap={false}>
            {p.ack.map((a) => (
              <View key={a.label} style={s.metaRow}>
                <Text style={s.metaLabel}>{a.label}</Text>
                <Text style={s.metaValue}>{a.value}</Text>
              </View>
            ))}
            {p.signedQr ? (
              <>
                <Text style={s.label}>Signed QR text</Text>
                <Text style={s.mono}>{p.signedQr}</Text>
              </>
            ) : null}
          </View>
        ) : null}

        <View style={s.section} wrap={false}>
          <Text style={s.label}>Bank details</Text>
          <Text>{p.bank}</Text>
        </View>
        {p.terms ? (
          <View style={s.section} wrap={false}>
            <Text style={s.label}>Terms</Text>
            <Text>{p.terms}</Text>
          </View>
        ) : null}

        <View style={s.signRow} wrap={false}>
          <View style={{ flexGrow: 1 }} />
          <View style={s.signBox}>
            <Text style={s.strong}>{p.forLine}</Text>
            <View style={s.signLine} />
            <Text>Authorised signatory{p.signatory ? `: ${p.signatory}` : ""}</Text>
          </View>
        </View>

        <View style={s.footer} fixed>
          <Text>{p.mark ? `${p.title}. ${p.mark}.` : p.title}</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

export async function buildInvoicePdfBlob(doc: PaperDoc): Promise<Blob> {
  return pdf(<InvoiceDoc p={invoicePaperModel(doc)} />).toBlob();
}

export async function downloadInvoicePdf(doc: PaperDoc) {
  const blob = await buildInvoicePdfBlob(doc);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = invoicePdfFileName(doc);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

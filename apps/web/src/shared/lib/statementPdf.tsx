/**
 * Customer statement PDF (A4): opening balance, invoices, credit notes and payments with a running balance.
 * Loaded with `await import()` on click through `exports.ts`, like the other papers. English, plain greys.
 */
import { Document, Font, Page, StyleSheet, Text, View, pdf } from "@react-pdf/renderer";

import { statementPaperModel, statementPdfFileName, type StatementDoc, type StatementPaper } from "./invoicePaper";

Font.registerHyphenationCallback((word) => [word]);

const INK = "#111111";
const MUTED = "#555555";
const RULE = "#d4d4d4";
const BAND = "#f4f4f1";

const s = StyleSheet.create({
  page: { paddingTop: 32, paddingBottom: 40, paddingHorizontal: 32, fontSize: 8.5, fontFamily: "Helvetica", color: INK },
  title: { fontSize: 14, fontFamily: "Helvetica-Bold", marginBottom: 6 },
  name: { fontSize: 12, fontFamily: "Helvetica-Bold" },
  block: { marginBottom: 8 },
  label: { color: MUTED, fontSize: 7.5 },
  head: { flexDirection: "row", borderBottomWidth: 1, borderTopWidth: 0.5, borderColor: INK, paddingVertical: 3, backgroundColor: BAND },
  row: { flexDirection: "row", paddingVertical: 3, borderBottomWidth: 0.5, borderColor: RULE },
  th: { fontFamily: "Helvetica-Bold", fontSize: 7.5 },
  bold: { flexDirection: "row", paddingVertical: 4, fontFamily: "Helvetica-Bold" },
  closing: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 5, borderTopWidth: 1.5, borderColor: INK, marginTop: 4, fontFamily: "Helvetica-Bold", fontSize: 10 },
  footer: { position: "absolute", bottom: 18, left: 32, right: 32, flexDirection: "row", justifyContent: "space-between", fontSize: 7, color: MUTED },
});

const W = ["13%", "22%", "17%", "15%", "15%", "18%"];
const cell = (i: number) => ({ width: W[i], paddingRight: 3, textAlign: i >= 3 ? ("right" as const) : ("left" as const) });

export function StatementDocView({ p }: { p: StatementPaper }) {
  return (
    <Document title={p.title}>
      <Page size="A4" style={s.page}>
        <Text style={s.title}>{p.title}</Text>
        <View style={s.block}>
          {p.seller.map((l, i) => (
            <Text key={i} style={i === 0 ? { fontFamily: "Helvetica-Bold" } : undefined}>
              {l}
            </Text>
          ))}
        </View>
        <View style={s.block}>
          <Text style={s.label}>Customer</Text>
          {p.customer.map((l, i) => (
            <Text key={i} style={i === 0 ? s.name : undefined}>
              {l}
            </Text>
          ))}
          <Text style={s.label}>Period {p.period}</Text>
        </View>

        <View style={s.head} fixed>
          {p.columns.map((c, i) => (
            <Text key={c} style={[s.th, cell(i)]}>
              {c}
            </Text>
          ))}
        </View>
        <View style={s.row}>
          <Text style={cell(0)} />
          <Text style={[cell(1), { fontFamily: "Helvetica-Bold" }]}>Opening balance</Text>
          <Text style={cell(2)} />
          <Text style={cell(3)} />
          <Text style={cell(4)} />
          <Text style={[cell(5), { fontFamily: "Helvetica-Bold" }]}>{p.opening}</Text>
        </View>
        {p.rows.map((r, ri) => (
          <View key={ri} style={s.row} wrap={false}>
            {r.map((c, i) => (
              <Text key={i} style={cell(i)}>
                {c}
              </Text>
            ))}
          </View>
        ))}
        <View style={s.bold} wrap={false}>
          <Text style={cell(0)} />
          <Text style={cell(1)}>Total</Text>
          <Text style={cell(2)} />
          <Text style={cell(3)}>{p.totals[0]}</Text>
          <Text style={cell(4)}>{p.totals[1]}</Text>
          <Text style={cell(5)} />
        </View>
        <View style={s.closing} wrap={false}>
          <Text>Closing balance (Rs): {p.closing}</Text>
          <Text>{p.closingNote}</Text>
        </View>

        <View style={s.footer} fixed>
          <Text>Dr means you owe us. Cr means we owe you.</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

export async function downloadStatementPdf(doc: StatementDoc) {
  const blob = await pdf(<StatementDocView p={statementPaperModel(doc)} />).toBlob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = statementPdfFileName(doc.customer.name, doc.to);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

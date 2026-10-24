/**
 * "Stock held on this SO" PDF (FP-OP-19), rendered in the browser with @react-pdf/renderer. Never
 * import this module directly: `exports.ts` loads it with `await import()` on click, so the
 * renderer stays out of every page chunk (W3). Same rows and totals as the print and the Excel
 * sheet (`stockOnOrderModel`). English only, like the plant's paper lists; no rates.
 */
import { STOCK_ON_ORDER_COLUMNS, stockOnOrderCells, stockOnOrderFileName, stockOnOrderModel, type StockOnOrderInput, type StockOnOrderModel } from "@orrn/documents/stock-on-order/model";
import { Document, Font, Page, StyleSheet, Text, View, pdf } from "@react-pdf/renderer";

Font.registerHyphenationCallback((word) => [word]);

const INK = "#111111";
const MUTED = "#555555";
const RULE = "#d4d4d4";
const BAND = "#f4f4f1";

const s = StyleSheet.create({
  page: { paddingTop: 28, paddingBottom: 40, paddingHorizontal: 28, fontSize: 8.5, fontFamily: "Helvetica", color: INK },
  header: { flexDirection: "row", justifyContent: "space-between", marginBottom: 12, gap: 16 },
  company: { fontSize: 15, fontFamily: "Helvetica-Bold" },
  docTitle: { fontSize: 10, color: MUTED, marginTop: 3 },
  meta: { flexDirection: "row", gap: 10 },
  metaLabels: { color: MUTED, gap: 2, textAlign: "right" },
  metaValues: { fontFamily: "Helvetica-Bold", gap: 2 },
  head: { flexDirection: "row", borderBottomWidth: 1, borderColor: INK, paddingBottom: 4, marginBottom: 2 },
  th: { fontFamily: "Helvetica-Bold", fontSize: 7.5 },
  group: { paddingTop: 8, paddingBottom: 3, borderBottomWidth: 0.5, borderColor: RULE, fontFamily: "Helvetica-Bold", fontSize: 9 },
  row: { flexDirection: "row", paddingVertical: 3, borderBottomWidth: 0.5, borderColor: RULE },
  sub: { flexDirection: "row", paddingVertical: 3, backgroundColor: BAND, fontFamily: "Helvetica-Bold" },
  total: { marginTop: 10, fontSize: 11, fontFamily: "Helvetica-Bold", textAlign: "right" },
  strip: { marginTop: 6, flexDirection: "row", justifyContent: "flex-end", gap: 14 },
  note: { marginTop: 8, fontSize: 7, color: MUTED },
  footer: { position: "absolute", bottom: 18, left: 28, right: 28, flexDirection: "row", justifyContent: "space-between", fontSize: 7, color: MUTED },
});
const W = ["13%", "14%", "10%", "7%", "7%", "7%", "12%", "15%", "15%"];
const NUMERIC = new Set([3, 4, 5, 6]);
const cell = (i: number) => ({ width: W[i], paddingRight: 4, textAlign: NUMERIC.has(i) ? ("right" as const) : ("left" as const) });

const kg = (v: number) => new Intl.NumberFormat("en-IN", { minimumFractionDigits: 3, maximumFractionDigits: 3 }).format(v);
const bundles = (n: number) => `${n} ${n === 1 ? "bundle" : "bundles"}`;

function StockDoc({ model }: { model: StockOnOrderModel }) {
  const h = model.header;
  const meta: [string, string][] = [
    ["Order", h.orderNumber],
    ["Customer", h.customerName],
    ["PO", h.poNumber ?? ""],
    ["Order date", h.orderDate],
    ...(h.expectedDate ? ([["Expected by", h.expectedDate]] as [string, string][]) : []),
  ];
  return (
    <Document title={`Stock on ${h.orderNumber}`} author={h.companyName}>
      <Page size="A4" orientation="landscape" style={s.page}>
        <View style={s.header}>
          <View>
            <Text style={s.company}>{h.companyName || "Stock held on a sales order"}</Text>
            <Text style={s.docTitle}>Stock held on this order</Text>
          </View>
          <View style={s.meta}>
            <View style={s.metaLabels}>{meta.map(([k]) => <Text key={k}>{k}</Text>)}</View>
            <View style={s.metaValues}>{meta.map(([k, v]) => <Text key={k}>{v || " "}</Text>)}</View>
          </View>
        </View>
        {model.groups.length === 0 ? <Text>No stock is held on this order.</Text> : null}
        {model.groups.length > 0 ? (
          <View style={s.head} fixed>
            {STOCK_ON_ORDER_COLUMNS.map((c, i) => (
              <Text key={c} style={[s.th, cell(i)]}>{c}</Text>
            ))}
          </View>
        ) : null}
        {model.groups.map((g) => (
          <View key={g.key}>
            <Text style={s.group}>{`${g.title} · ordered ${kg(g.orderedKg)} kg`}</Text>
            {g.rows.map((r, ri) => (
              <View key={ri} style={s.row} wrap={false}>
                {stockOnOrderCells(r).map((c, i) => (
                  <Text key={i} style={cell(i)}>{String(c)}</Text>
                ))}
              </View>
            ))}
            <View style={s.sub} wrap={false}>
              <Text style={cell(0)}>{bundles(g.bundles)}</Text>
              <Text style={cell(1)} />
              <Text style={cell(2)} />
              <Text style={cell(3)} />
              <Text style={cell(4)} />
              <Text style={cell(5)}>{g.pcs}</Text>
              <Text style={cell(6)}>{kg(g.weightKg)}</Text>
            </View>
          </View>
        ))}
        <Text style={s.total}>{`${bundles(model.totals.bundles)} · ${model.totals.pcs} pcs · ${kg(model.totals.weightKg)} kg`}</Text>
        <View style={s.strip}>
          <Text>{`Ordered ${kg(model.strip.orderedKg)} kg`}</Text>
          <Text>{`Dispatched ${kg(model.strip.dispatchedKg)} kg`}</Text>
          <Text>{`In stock ${kg(model.strip.inStockKg)} kg`}</Text>
          <Text>{`Baki ${kg(model.strip.bakiKg)} kg`}</Text>
        </View>
        {model.groups.some((g) => g.rows.some((r) => r.onDispatch)) ? <Text style={s.note}>* on a dispatch that is not complete yet; it still lies in the yard.</Text> : null}
        {model.truncated ? <Text style={s.note}>The list was cut at the first bundles; open the order for the rest.</Text> : null}
        <View style={s.footer} fixed>
          <Text>{`${h.companyName}, ${h.orderNumber}`}</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

/** Render and save the list as `stock-on-<order>.pdf`. */
export async function downloadStockOnOrderPdf(data: StockOnOrderInput, opts: { timeZone?: string } = {}) {
  const model = stockOnOrderModel(data, opts);
  const blob = await pdf(<StockDoc model={model} />).toBlob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${stockOnOrderFileName(model.header.orderNumber)}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

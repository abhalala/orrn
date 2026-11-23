/**
 * What an invoice or credit note says: bill-to and ship-to, lines, tax split, round off, total, amount in
 * words and the HSN summary. Reads the snapshot only (the preview's or the frozen one), never works a figure out.
 */
import { GST_STATE_CODES, kgQtyText, taxHeadsFor } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import type { InvoiceSnapshot } from "@orrn/server/lib/billing/snapshot";

import { Rupees } from "./ui";

const pct = (bp: number) => `${(bp / 100).toFixed(bp % 100 === 0 ? 0 : 2)}%`;
const stateText = (code: string) => (GST_STATE_CODES[code] ? `${GST_STATE_CODES[code]} (${code})` : code);

export function InvoicePreview({ snapshot: s }: { snapshot: InvoiceSnapshot }) {
  const { t } = useT();
  const tot = s.totals;
  const heads = taxHeadsFor(s.supplyType);
  const ship = s.party.shipTo;
  return (
    <section aria-label={t("bill.doc.preview")} className="flex min-w-0 flex-col gap-4 rounded-card border border-border bg-card p-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <p className="m-0 text-xs text-muted-foreground">{t("bill.doc.billTo")}</p>
          <p className="m-0 font-semibold">{s.party.name}</p>
          <p className="m-0 text-[13px]">{s.party.address}</p>
          <p className="m-0 text-[13px]">
            {[s.party.place, s.party.pincode].filter(Boolean).join(" ")} · {stateText(s.party.stateCode)}
          </p>
          <p className="m-0 font-mono text-[13px]">{s.party.gstin ?? t("bill.doc.unregistered")}</p>
        </div>
        <div>
          <p className="m-0 text-xs text-muted-foreground">{t("bill.doc.shipTo")}</p>
          {ship ? (
            <>
              <p className="m-0 font-semibold">{ship.legalName}</p>
              <p className="m-0 text-[13px]">{ship.address1}</p>
              <p className="m-0 text-[13px]">
                {[ship.place, ship.pincode].filter(Boolean).join(" ")} · {stateText(ship.stateCode)}
              </p>
              {ship.gstin ? <p className="m-0 font-mono text-[13px]">{ship.gstin}</p> : null}
            </>
          ) : (
            <p className="m-0 text-[13px]">{t("bill.doc.shipSame")}</p>
          )}
          <p className="m-0 mt-2 text-xs text-muted-foreground">{t("bill.doc.placeOfSupply")}</p>
          <p className="m-0 text-[13px]">{stateText(s.placeOfSupply)}</p>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="py-1.5 pr-2 font-medium">{t("bill.doc.description")}</th>
              <th className="py-1.5 pr-2 font-medium">{t("bill.doc.hsn")}</th>
              <th className="py-1.5 pr-2 text-right font-medium">{t("bill.doc.kg")}</th>
              <th className="py-1.5 pr-2 text-right font-medium">{t("bill.doc.rate")}</th>
              <th className="py-1.5 pr-2 text-right font-medium">{t("bill.doc.gst")}</th>
              <th className="py-1.5 text-right font-medium">{t("bill.doc.taxable")}</th>
            </tr>
          </thead>
          <tbody>
            {tot.lines.map((l) => (
              <tr key={l.key} className="border-b border-border/60 align-top">
                <td className="py-1.5 pr-2">{l.description}</td>
                <td className="py-1.5 pr-2 font-mono">{l.hsn}</td>
                <td className="py-1.5 pr-2 text-right font-mono tabular-nums">{l.weightG === null ? "" : kgQtyText(l.weightG)}</td>
                <td className="py-1.5 pr-2 text-right">{l.ratePaise === null ? "" : <Rupees paise={l.ratePaise} />}</td>
                <td className="py-1.5 pr-2 text-right font-mono tabular-nums">{pct(l.gstRateBp)}</td>
                <td className="py-1.5 text-right">
                  <Rupees paise={l.taxablePaise} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <dl className="m-0 ml-auto grid w-full max-w-sm grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-[14px]">
        <dt>{t("bill.doc.taxableValue")}</dt>
        <dd className="m-0 text-right">
          <Rupees paise={tot.taxablePaise} />
        </dd>
        {heads === "cgst_sgst" ? (
          <>
            <dt>{t("bill.doc.cgst")}</dt>
            <dd className="m-0 text-right">
              <Rupees paise={tot.cgstPaise} />
            </dd>
            <dt>{t("bill.doc.sgst")}</dt>
            <dd className="m-0 text-right">
              <Rupees paise={tot.sgstPaise} />
            </dd>
          </>
        ) : heads === "igst" ? (
          <>
            <dt>{t("bill.doc.igst")}</dt>
            <dd className="m-0 text-right">
              <Rupees paise={tot.igstPaise} />
            </dd>
          </>
        ) : (
          <>
            <dt>{t("bill.doc.noTax")}</dt>
            <dd className="m-0 text-right">0.00</dd>
          </>
        )}
        {tot.roundOffPaise !== 0 ? (
          <>
            <dt>{t("bill.doc.roundOff")}</dt>
            <dd className="m-0 text-right">
              {tot.roundOffPaise < 0 ? "-" : ""}
              <Rupees paise={Math.abs(tot.roundOffPaise)} />
            </dd>
          </>
        ) : null}
        <dt className="border-t border-border pt-1 text-[16px] font-bold">{t("bill.doc.total")}</dt>
        <dd className="m-0 border-t border-border pt-1 text-right text-[16px] font-bold">
          <Rupees paise={tot.totalPaise} />
        </dd>
      </dl>
      <p className="m-0 text-[13px] font-semibold">{s.amountInWords}</p>

      <div className="overflow-x-auto">
        <p className="m-0 mb-1 text-xs text-muted-foreground">{t("bill.doc.hsnSummary")}</p>
        <table className="w-full min-w-[420px] border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="py-1 pr-2 font-medium">{t("bill.doc.hsn")}</th>
              <th className="py-1 pr-2 text-right font-medium">{t("bill.doc.taxable")}</th>
              <th className="py-1 pr-2 text-right font-medium">{t("bill.doc.gst")}</th>
              <th className="py-1 text-right font-medium">{heads === "igst" ? t("bill.doc.igst") : t("bill.doc.cgstSgst")}</th>
            </tr>
          </thead>
          <tbody>
            {tot.hsnSummary.map((h) => (
              <tr key={`${h.hsn}-${h.gstRateBp}`} className="border-b border-border/60">
                <td className="py-1 pr-2 font-mono">{h.hsn}</td>
                <td className="py-1 pr-2 text-right">
                  <Rupees paise={h.taxablePaise} />
                </td>
                <td className="py-1 pr-2 text-right font-mono tabular-nums">{pct(h.gstRateBp)}</td>
                <td className="py-1 text-right">
                  <Rupees paise={heads === "igst" ? h.igstPaise : h.cgstPaise + h.sgstPaise} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

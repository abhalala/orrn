import { useT } from "@orrn/i18n";

import {
  bandTitle,
  kgGroupedText,
  kgPerMetreText,
  milliKgText,
  pctTenthText,
  shortDate,
  shortDateTime,
  wallMmText,
} from "./die-room-model";
import type { CardData } from "./types";

/**
 * The A4 copy card (D16 / backlog 39): what the die room keeps on paper for one copy. Hidden on
 * screen; the "Print card" action marks the page (`data-die-print`) and the print styles show only
 * this sheet. Every figure is the server's, formatted: nothing is computed here.
 */
const PRINT_CSS = `
.die-print { display: none; }
@media print {
  @page { size: A4 portrait; margin: 12mm; }
  html[data-die-print] [data-slot="side-nav"],
  html[data-die-print] [data-slot="tab-bar"],
  html[data-die-print] [data-shell-chrome],
  html[data-die-print] [data-slot="app-shell"] > a,
  html[data-die-print] [data-sonner-toaster] {
    display: none !important;
  }
  html[data-die-print] [data-slot="app-shell"],
  html[data-die-print] [data-slot="app-shell"] > div:not([data-slot="side-nav"]):not([data-slot="tab-bar"]) {
    display: block !important;
    min-height: 0 !important;
  }
  html[data-die-print] main > div {
    max-width: none !important;
    padding: 0 !important;
  }
  html[data-die-print] .die-screen { display: none !important; }
  html[data-die-print] .die-print { display: block !important; color: #000; background: #fff; }
}
`;

export function PrintCard({ card }: { card: CardData }) {
  const { t } = useT();
  const { instance, section, band } = card;
  const shape = [
    section?.profileKind ? t(`dieRoom.card.${section.profileKind}`) : null,
    [section?.alloy, section?.temper].filter(Boolean).join(" ") || null,
    instance.tierRank == null ? t("dieRoom.copies.untiered") : t("dieRoom.copies.tier", { rank: instance.tierRank }),
  ]
    .filter(Boolean)
    .join(" · ");
  const facts: [string, string | null][] = [
    [t("dieRoom.card.cavities"), card.cavityCount == null ? null : String(card.cavityCount)],
    [t("dieRoom.card.wall"), band && band.wallTenthMm > 0 ? `${wallMmText(band.wallTenthMm)} ${t("units.mm")}` : null],
    [t("dieRoom.card.trial"), instance.trialKgPer12ftMilli == null ? null : `${milliKgText(instance.trialKgPer12ftMilli)} ${t("units.kgPer12ft")}`],
    [t("dieRoom.card.hardness"), instance.hardness == null ? null : String(instance.hardness)],
    [t("dieRoom.copies.rack"), instance.rackNo],
    [t("dieRoom.card.bolster"), instance.bolster],
    [t("dieRoom.card.backer"), instance.backerNo],
    [t("dieRoom.card.subBolster"), instance.subBolster],
    [t("dieRoom.card.makerDieNo"), instance.makerDieNo],
    [t("dieRoom.card.makerProjectNo"), instance.makerProjectNo],
    [t("dieRoom.card.supplier"), instance.supplier],
    [t("dieRoom.card.ftr"), instance.ftr],
    [t("dieRoom.copies.owner"), card.owner?.name ?? null],
    [t("dieRoom.card.lifeKg"), instance.lifeG == null ? null : `${kgGroupedText(card.producedG)} / ${kgGroupedText(instance.lifeG)} ${t("units.kg")}`],
  ];
  const cell = "border border-black px-2 py-1 text-left align-top";

  return (
    <div className="die-print" data-testid="print-card">
      <style>{PRINT_CSS}</style>
      <div className="m-0 font-mono text-[26px] font-bold">{instance.code}</div>
      <p className="m-0 text-[14px]">
        {section ? `${section.series} ${section.sectionCode}` : ""}
        {shape ? ` · ${shape}` : ""}
      </p>
      {band ? (
        <p className="m-0 mt-2 font-mono text-[15px] font-semibold">{bandTitle(band, t("units.mm"), t("units.kgPer12ft"))}</p>
      ) : null}
      <p className="m-0 mt-2 text-[15px]">
        {card.currentMilli == null ? (
          t("dieRoom.card.noReading")
        ) : (
          <>
            <strong className="font-mono text-[20px]">{milliKgText(card.currentMilli)}</strong> {t("units.kgPer12ft")}
            {" · "}
            {kgPerMetreText(card.kgPerMetre)} {t("units.kgPerMetre")}
            {card.pctTenth == null ? "" : ` · ${pctTenthText(card.pctTenth)}`}
          </>
        )}
      </p>

      <dl className="m-0 mt-4 grid grid-cols-3 gap-x-4 gap-y-2">
        {facts.map(([label, value]) => (
          <div key={label}>
            <dt className="text-[11px] font-medium">{label}</dt>
            <dd className="m-0 min-h-[1.25rem] border-b border-black text-[13px]">{value ?? ""}</dd>
          </div>
        ))}
      </dl>

      <h2 className="m-0 mt-5 text-[14px] font-semibold">{t("dieRoom.print.readings")}</h2>
      <table className="mt-1 w-full border-collapse text-[12px]">
        <thead>
          <tr>
            <th className={cell}>{t("dieRoom.print.date")}</th>
            <th className={cell}>{t("units.kgPer12ft")}</th>
            <th className={cell}>%</th>
            <th className={cell}>{t("dieRoom.issues.run")}</th>
          </tr>
        </thead>
        <tbody>
          {card.readings.slice(0, 12).map((r) => (
            <tr key={r.id}>
              <td className={cell}>{shortDateTime(r.readAt)}</td>
              <td className={`${cell} font-mono tabular-nums`}>{milliKgText(r.kgPer12ftMilli)}</td>
              <td className={`${cell} font-mono tabular-nums`}>{r.pctTenth == null ? "" : pctTenthText(r.pctTenth)}</td>
              <td className={cell}>{r.pressRunNumber ?? t("dieRoom.reading.bench")}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 className="m-0 mt-5 text-[14px] font-semibold">{t("dieRoom.tabs.nitriding")}</h2>
      <table className="mt-1 w-full border-collapse text-[12px]">
        <thead>
          <tr>
            <th className={cell}>{t("dieRoom.print.date")}</th>
            <th className={cell}>{t("dieRoom.card.hardness")}</th>
          </tr>
        </thead>
        <tbody>
          {card.nitriding.slice(0, 6).map((n) => (
            <tr key={n.id}>
              <td className={cell}>{shortDate(n.nitridedAt)}</td>
              <td className={cell}>{n.hardness ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 className="m-0 mt-5 text-[14px] font-semibold">{t("common.notes")}</h2>
      <div className="mt-1 h-32 border border-black" />
    </div>
  );
}

/** Mark the page for print, open the print dialog, and unmark when it closes. */
export function printCard() {
  const root = document.documentElement;
  root.setAttribute("data-die-print", "");
  const clear = () => {
    root.removeAttribute("data-die-print");
    window.removeEventListener("afterprint", clear);
  };
  window.addEventListener("afterprint", clear);
  window.print();
}

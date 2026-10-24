import { Button } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { StatusBlock } from "@orrn/ui/components/status-block";
import { useEffect, useState } from "react";

import {
  buildSpectro,
  CERTIFICATE_BUNDLES,
  formatBookDate,
  formatInches,
  formatKgFromG,
  formatKgValue,
  formatPercentFromPpm,
  BOOK_DATE,
  FURNACE,
  insideBand,
  K31_LOG,
  PLANT,
  SECTION,
  type SpectroRow,
} from "../fixtures";
import { FoundryScreenNav } from "./screen-nav";
import { SpectroTable } from "./spectro-table";
const PRINT_CSS = `
@media print {
  @page { margin: 12mm; }
  html[data-foundry-print] [data-slot="side-nav"],
  html[data-foundry-print] [data-slot="tab-bar"],
  html[data-foundry-print] [data-shell-chrome],
  html[data-foundry-print] [data-slot="app-shell"] > a {
    display: none !important;
  }
  html[data-foundry-print] [data-slot="app-shell"],
  html[data-foundry-print] [data-slot="app-shell"] > div {
    display: block !important;
    min-height: 0 !important;
  }
  html[data-foundry-print] main > div {
    max-width: none !important;
    padding: 0 !important;
  }
  html[data-foundry-print] main > div > div > *:not(:last-child) {
    display: none !important;
  }
  html[data-foundry-print] .foundry-no-print {
    display: none !important;
  }
  html[data-foundry-print] #foundry-certificate,
  html[data-foundry-print] #foundry-certificate * {
    color: #111 !important;
    box-shadow: none !important;
    background: transparent !important;
    border-color: #ccc !important;
  }
  html[data-foundry-print] #foundry-certificate {
    background: #fff !important;
  }
}
`;

export function CertificateScreen() {
  const [failFe, setFailFe] = useState(false);
  const sheet = buildSpectro("6063", failFe);
  const fe = sheet.rows.find((row) => row.element === "fe");
  useEffect(() => {
    document.documentElement.dataset.foundryPrint = "1";
    return () => {
      delete document.documentElement.dataset.foundryPrint;
    };
  }, []);
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <style>{PRINT_CSS}</style>
      <div className="foundry-no-print flex flex-wrap items-center gap-2">
        <FoundryScreenNav current="certificate" />
      </div>
      <div className="foundry-no-print flex flex-wrap gap-2">
        <Button onClick={() => window.print()}>Print</Button>
      </div>
      <div className="foundry-no-print flex flex-col gap-3 rounded-card border border-dashed border-border bg-surface-sunken p-4">
        <p className="m-0 text-[13px] font-medium text-muted-foreground">Demo</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" aria-pressed={failFe} onClick={() => setFailFe((value) => !value)}>
            Show a failed Fe reading
          </Button>
        </div>
      </div>
      <article id="foundry-certificate" className="flex min-w-0 flex-col gap-5 rounded-card border border-border bg-card p-5 shadow-sm">
        <header className="flex min-w-0 flex-col gap-2">
          <p className="m-0 text-[13px] font-medium text-muted-foreground">{PLANT}</p>
          <h2 className="m-0 font-display text-[32px] font-extrabold leading-none tracking-[-0.03em]">
            Test certificate
          </h2>
          <p className="m-0 text-[15px]">
            Cast <span className="font-mono font-semibold tabular-nums">K31</span> · Alloy 6063 · Furnace {FURNACE.code}{" "}
            · {formatBookDate(BOOK_DATE)}
          </p>
        </header>
        <StatusBlock
          tone={failFe ? "red" : "green"}
          title="Verdict"
          value={failFe ? "FAIL" : "Pass"}
          meta={failMeta(failFe, fe)}
          countUp={false}
        />
        <section className="flex min-w-0 flex-col gap-2">
          <h3 className="m-0 text-[15px] font-semibold">Spectro</h3>
          <p className="m-0 text-[13px] text-muted-foreground">Limits are the 6063 seed, snapshotted on the reading.</p>
          <SpectroTable sheet={sheet} />
        </section>
        <section className="flex min-w-0 flex-col gap-1">
          <h3 className="m-0 text-[15px] font-semibold">Logs</h3>
          <p className="m-0 text-[15px] tabular-nums">
            {K31_LOG.pcs} × {K31_LOG.logLengthFt} ft × {formatInches(K31_LOG.diameterMm)} inch,{" "}
            {formatKgFromG(K31_LOG.kgG)} kg
          </p>
        </section>
        <section className="flex min-w-0 flex-col gap-3">
          <div>
            <h3 className="m-0 text-[15px] font-semibold">Bundles that cite this cast</h3>
            <p className="m-0 mt-1 text-[13px] text-muted-foreground">
              {SECTION.code} {SECTION.name} · band {formatKgValue(SECTION.bandMinKg, 3)}–{formatKgValue(SECTION.bandMaxKg, 3)}{" "}
              kg per 12 ft
            </p>
          </div>
          <ul className="m-0 grid list-none grid-cols-1 gap-3 p-0 md:grid-cols-2">
            {CERTIFICATE_BUNDLES.map((bundle) => {
              const inBand = insideBand(bundle.kgPer12ft);
              return (
                <li key={bundle.serial} className="flex min-w-0 flex-col gap-1 rounded-card border border-border p-4">
                  <p className="m-0 font-mono text-[18px] font-bold tabular-nums">{bundle.serial}</p>
                  <p className="m-0 text-[14px]">{bundle.section}</p>
                  <p className="m-0 text-[14px] tabular-nums">
                    {bundle.lengthFt} ft · {bundle.pcs} pcs · {formatKgFromG(bundle.kgG)} kg
                  </p>
                  <p className="m-0 font-mono text-[14px] tabular-nums">
                    {formatKgValue(bundle.kgPer12ft, 3)} kg/12 ft
                  </p>
                  <Chip tone={inBand ? "green" : "amber"}>{inBand ? "Inside band" : "Outside band"}</Chip>
                  <p className="m-0 text-[14px] break-words">
                    {bundle.customer}, {bundle.city}
                  </p>
                  <p className="m-0 text-[13px] text-muted-foreground">{bundle.po}</p>
                </li>
              );
            })}
          </ul>
        </section>
        <p className="m-0 border-t border-border pt-4 text-[14px] font-medium">Staff copy. Not a tax invoice.</p>
      </article>
    </div>
  );
}

function failMeta(failFe: boolean, fe: SpectroRow | undefined): string {
  if (!failFe || !fe || fe.maxPpm == null) return "All eight elements inside the 6063 limits";
  return `Fe ${formatPercentFromPpm(fe.ppm)}% is over the ${formatPercentFromPpm(fe.maxPpm)}% max`;
}

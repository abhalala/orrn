/**
 * Shared pieces of the report pages: the print stylesheet (A4, landscape for wide tables, the app
 * chrome and filters hidden), the CSV + Print actions, the "no access" card and a plain table
 * shell. The CSV is written on the client from the rows the server returned (AGENTS.md: Workers do
 * not build files) and saved with the shared `downloadCsv`, which adds the UTF-8 BOM so Excel reads
 * Hindi.
 */
import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Checkbox } from "@orrn/ui/components/checkbox";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Download, Printer } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { Can } from "@/shared/components/can";

import { downloadCsv } from "../imports/templates";

const PRINT_CSS = `
@media print {
  @page { size: A4 landscape; margin: 8mm; }
  html[data-report-print] [data-slot="side-nav"],
  html[data-report-print] [data-slot="tab-bar"],
  html[data-report-print] [data-shell-chrome],
  html[data-report-print] [data-slot="app-shell"] > a { display: none !important; }
  html[data-report-print] [data-slot="app-shell"],
  html[data-report-print] [data-slot="app-shell"] > div { display: block !important; min-height: 0 !important; }
  html[data-report-print] main > div { max-width: none !important; padding: 0 !important; }
  html[data-report-print] .report-no-print { display: none !important; }
  html[data-report-print] .report-scroll { overflow: visible !important; border: 0 !important; }
  html[data-report-print] .report-table { width: 100% !important; min-width: 0 !important; font-size: 9px !important; }
  html[data-report-print] .report-table th,
  html[data-report-print] .report-table td { padding: 2px 4px !important; white-space: normal !important; }
  html[data-report-print] .report-print-context { display: block !important; margin: 0 0 4px; font-size: 11px; }
}
`;

/** Marks the page for the print stylesheet while it is mounted. */
export function ReportPrintStyle() {
  useEffect(() => {
    document.documentElement.dataset.reportPrint = "1";
    return () => {
      delete document.documentElement.dataset.reportPrint;
    };
  }, []);
  return <style>{PRINT_CSS}</style>;
}

/**
 * One line under the title that shows only on paper: the filters the screen shows in the controls
 * (which print hides), so a printout says which party, period, status and grouping it is.
 */
export function ReportPrintContext({ parts }: { parts: readonly (string | null | undefined | false)[] }) {
  const line = parts.filter(Boolean).join(" · ");
  if (!line) return null;
  return (
    <p className="report-print-context m-0 hidden" data-testid="report-print-context">
      {line}
    </p>
  );
}

/** CSV and Print buttons; `csv` returns the file (name + text) or null while there is nothing to save. */
export function ReportActions({ csv }: { csv?: () => { name: string; text: string } | null | Promise<{ name: string; text: string } | null> }) {
  const { t } = useT();
  const [failed, setFailed] = useState(false);
  return (
    <>
      {csv ? (
        <Button
          variant="secondary"
          onClick={async () => {
            setFailed(false);
            try {
              const file = await csv();
              if (file) downloadCsv(file.name, file.text);
            } catch {
              setFailed(true);
            }
          }}
        >
          <Download aria-hidden="true" className="size-4" />
          {t("reports.csv")}
        </Button>
      ) : null}
      <Button onClick={() => window.print()}>
        <Printer aria-hidden="true" className="size-4" />
        {t("common.print")}
      </Button>
      {failed ? (
        <p role="alert" className="m-0 w-full text-[14px] font-medium text-destructive">
          {t("reports.downloadFailed")}
        </p>
      ) : null}
    </>
  );
}

/** The page body for `reports.read` holders; everyone else gets one quiet card. */
export function ReportsGate({ children }: { children: ReactNode }) {
  const { t } = useT();
  return (
    <Can
      do="reports.read"
      fallback={
        <div className="rounded-card border border-border bg-card" data-testid="reports-no-access">
          <EmptyState title={t("reports.noAccess")} />
        </div>
      }
    >
      {children}
    </Can>
  );
}

/** Horizontal-scroll frame for a report table (a focusable region, so a keyboard can scroll it). */
export function ReportTableFrame({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="report-scroll min-w-0 overflow-x-auto rounded-card border border-border bg-card" tabIndex={0} role="region" aria-label={label}>
      {children}
    </div>
  );
}

export const TH = "whitespace-nowrap px-3 py-2 font-medium";
export const TD = "px-3 py-2 tabular-nums";
export const NUM = "text-right font-mono tabular-nums";

/** A labelled checkbox filter (44 px tall row). */
export function ReportToggle({ id, checked, onChange, label }: { id: string; checked: boolean; onChange(v: boolean): void; label: string }) {
  return (
    <div className="flex min-h-11 items-center gap-3">
      <Checkbox id={id} checked={checked} onCheckedChange={(v) => onChange(v === true)} />
      <label htmlFor={id} className="text-[15px] leading-5 font-medium">
        {label}
      </label>
    </div>
  );
}

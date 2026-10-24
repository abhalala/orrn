import { Button } from "@orrn/ui/components/button";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { SegmentedControl } from "@orrn/ui/components/segmented-control";
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import {
  LINE,
  PRODUCTION_DAY,
  formatKgG,
  formatRecoveryBp,
  reportRowFromSnapshot,
  secondReportRow,
  sheetFooter,
  type ReportRow,
  type ShiftId,
} from "../fixtures";
import { usePressDemo } from "../store";
import { ScreenLinks } from "./chrome";

const PRINT_CSS = `
@media print {
  @page { size: A4 landscape; margin: 8mm; }
  html[data-press-print] [data-slot="side-nav"],
  html[data-press-print] [data-slot="tab-bar"],
  html[data-press-print] [data-shell-chrome],
  html[data-press-print] [data-slot="app-shell"] > a {
    display: none !important;
  }
  html[data-press-print] [data-slot="app-shell"],
  html[data-press-print] [data-slot="app-shell"] > div {
    display: block !important;
    min-height: 0 !important;
  }
  html[data-press-print] main > div {
    max-width: none !important;
    padding: 0 !important;
  }
  html[data-press-print] main > div > div > *:not(:last-child) {
    display: none !important;
  }
  html[data-press-print] .press-no-print {
    display: none !important;
  }
  html[data-press-print] .press-report-scroll {
    overflow: visible !important;
    border: 0 !important;
  }
  html[data-press-print] .press-report-table {
    width: 100% !important;
    min-width: 0 !important;
    font-size: 7.5px !important;
    table-layout: fixed;
  }
  html[data-press-print] .press-report-table th,
  html[data-press-print] .press-report-table td {
    padding: 2px 3px !important;
    white-space: normal !important;
  }
}
`;

type ShiftFilter = "all" | ShiftId;

export function ReportSheet() {
  const demo = usePressDemo();
  const [shift, setShift] = useState<ShiftFilter>("all");
  useEffect(() => {
    document.documentElement.dataset.pressPrint = "1";
    return () => {
      delete document.documentElement.dataset.pressPrint;
    };
  }, []);

  const logged = demo.pr42.phase === "logged" ? demo.pr42.logged : null;
  const rows: ReportRow[] = [];
  if (logged) rows.push(reportRowFromSnapshot("PR-42", logged, "day", "09:12–11:04"));
  if (demo.showSecondReportRow) rows.push(secondReportRow());
  const visible = shift === "all" ? rows : rows.filter((row) => row.shiftId === shift);
  const footer = sheetFooter(visible);

  return (
    <>
      <style>{PRINT_CSS}</style>
      <div className="press-no-print">
        <ScreenLinks current="report" />
      </div>
      <div className="press-no-print flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <SegmentedControl
          label="Shift"
          value={shift}
          onChange={setShift}
          options={[
            { value: "all", label: "All shifts" },
            { value: "day", label: "Day" },
            { value: "night", label: "Night" },
          ]}
        />
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => window.print()}>Print</Button>
        </div>
      </div>
      <p className="m-0 text-[14px] text-muted-foreground">
        {PRODUCTION_DAY} · {LINE.name} · landscape sheet.
      </p>
      <p className="press-no-print m-0 text-[14px] leading-6 text-muted-foreground md:hidden">
        This sheet is for the tablet and the laptop. On a phone, scroll sideways, or read today's three
        numbers on the summary.
      </p>
      {visible.length === 0 ? (
        <div className="rounded-card border border-dashed border-border bg-card">
          <EmptyState
            title="No logged runs for this day."
            body="Log a run on the station. This sheet does not invent a recovery."
            action={
              <Button asChild variant="secondary">
                <Link to="/preview/press/console" search={{ run: "PR-42" }}>
                  Open the station
                </Link>
              </Button>
            }
          />
        </div>
      ) : (
        <>
          {demo.showSecondReportRow ? (
            <p className="m-0 rounded-card border border-border bg-surface-sunken px-4 py-3 text-[14px] leading-6">
              Two rows, still a list. This sheet does not draw a stops chart. That stays on the daily
              summary.
            </p>
          ) : (
            <p className="press-no-print m-0 text-[13px] leading-5 text-muted-foreground">
              Longest stops stay on the daily summary, not on this sheet.
            </p>
          )}
          <div className="press-report-scroll min-w-0 overflow-x-auto rounded-card border border-border bg-card">
            <table className="press-report-table w-max min-w-full border-collapse text-left text-[12px] leading-5">
              <caption className="sr-only">Press report, {PRODUCTION_DAY}</caption>
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  {[
                    "Run no",
                    "Production day",
                    "Shift",
                    "Press line",
                    "Operator",
                    "Section",
                    "Die copy",
                    "Orders",
                    "Cut lengths",
                    "Cast",
                    "Billets",
                    "Started – stopped",
                    "Running minutes",
                    "Downtime",
                    "Good kg and pcs",
                    "Butt + ends + rejects",
                    "Recovery",
                  ].map((header) => (
                    <th key={header} scope="col" className="whitespace-nowrap px-2 py-2 font-medium">
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => (
                  <tr key={row.id} className="border-b border-border last:border-0">
                    <td className="whitespace-nowrap px-2 py-2 font-mono tabular-nums">{row.runNo}</td>
                    <td className="whitespace-nowrap px-2 py-2">{row.productionDay}</td>
                    <td className="px-2 py-2">{row.shift}</td>
                    <td className="whitespace-nowrap px-2 py-2">{row.line}</td>
                    <td className="whitespace-nowrap px-2 py-2">{row.operator}</td>
                    <td className="whitespace-nowrap px-2 py-2">{row.section}</td>
                    <td className="whitespace-nowrap px-2 py-2 font-mono tabular-nums">{row.copy}</td>
                    <td className="whitespace-nowrap px-2 py-2">{row.orders}</td>
                    <td className="min-w-[12rem] px-2 py-2">{row.cuts}</td>
                    <td className="px-2 py-2 font-mono">{row.cast}</td>
                    <td className="whitespace-nowrap px-2 py-2">{row.billets}</td>
                    <td className="whitespace-nowrap px-2 py-2 font-mono tabular-nums">{row.window}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{row.runningMin}</td>
                    <td className="whitespace-nowrap px-2 py-2 font-mono">{row.downtime}</td>
                    <td className="whitespace-nowrap px-2 py-2 tabular-nums">{row.good}</td>
                    <td className="whitespace-nowrap px-2 py-2 tabular-nums">{row.scrap}</td>
                    <td className="px-2 py-2 text-right font-mono tabular-nums">{row.recovery}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {footer ? (
            <p className="m-0 text-[15px] leading-6 tabular-nums">
              Input {formatKgG(footer.inputG)} kg, good {formatKgG(footer.goodG)} kg, recovery{" "}
              {footer.recoveryBp === null ? "—" : formatRecoveryBp(footer.recoveryBp)}, downtime{" "}
              {footer.downtimeMin} min
              {footer.downtimeCodes.length > 0 ? ` (${footer.downtimeCodes.join(", ")})` : ""}.
            </p>
          ) : null}
        </>
      )}
    </>
  );
}

import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { ResponsiveList } from "@orrn/ui/components/responsive-list";
import { useQuery } from "@tanstack/react-query";

import { DieLifeHeader } from "@/features/reports/die-life-header";
import { Can } from "@/shared/components/can";
import { INLINE_ERROR_META } from "@/shared/lib/query-errors";
import { trpc } from "@/shared/utils/trpc";

import { bpText, kgGroupedText, milliKgText, pctTenthText, shortDate } from "./die-room-model";

/** Logged press runs of the copy, with the running total made by this copy. Empty until runs are logged. */
export function RunsPanel({ copyId }: { copyId: string }) {
  const { t } = useT();
  const runs = useQuery({ ...trpc.dieInstance.runs.queryOptions({ dieInstanceId: copyId }), meta: INLINE_ERROR_META });
  return (
    <>
      {/* W4-ANALYTICS: life used by this copy (life_g against its logged runs' good kg). */}
      <Can do={["reports.read", "die.card", "die.reading"]}>
        <DieLifeHeader copyId={copyId} />
      </Can>
      <ResponsiveList
        label={t("dieRoom.runs.label")}
        rows={runs.data ?? []}
        rowKey={(r) => r.pressRunId}
        loading={runs.isPending}
        empty={
          runs.isError ? (
            <EmptyState
              title={t("dieRoom.runs.loadFailed")}
              action={
                <Button variant="secondary" onClick={() => runs.refetch()}>
                  {t("common.retry")}
                </Button>
              }
            />
          ) : (
            <EmptyState title={t("dieRoom.runs.empty")} body={t("dieRoom.runs.emptyBody")} />
          )
        }
        columns={[
          {
            key: "run",
            header: t("dieRoom.runs.run"),
            cell: (r) => <span className="font-mono font-semibold whitespace-nowrap tabular-nums">{r.number}</span>,
          },
          {
            key: "day",
            header: t("dieRoom.runs.day"),
            cell: (r) =>
              r.shift.productionDay
                ? `${shortDate(r.shift.productionDay)}${r.shift.seq != null ? ` · ${t("dieRoom.runs.shiftSeq", { seq: r.shift.seq })}` : ""}`
                : "—",
          },
          {
            key: "in",
            header: t("dieRoom.runs.input"),
            align: "end",
            cell: (r) => <span className="font-mono tabular-nums">{kgGroupedText(r.inputG)}</span>,
          },
          {
            key: "out",
            header: t("dieRoom.runs.output"),
            align: "end",
            cell: (r) => <span className="font-mono tabular-nums">{kgGroupedText(r.outputG)}</span>,
          },
          {
            key: "recovery",
            header: t("dieRoom.runs.recovery"),
            align: "end",
            cell: (r) => <span className="tabular-nums">{bpText(r.recoveryBp) || "—"}</span>,
          },
          {
            key: "reading",
            header: t("dieRoom.runs.reading"),
            cell: (r) =>
              r.readingMilli == null ? (
                "—"
              ) : (
                <span className="font-mono tabular-nums">
                  {milliKgText(r.readingMilli)}
                  {r.pctTenth != null ? ` (${pctTenthText(r.pctTenth)})` : ""}
                </span>
              ),
          },
          {
            key: "accumulated",
            header: t("dieRoom.runs.accumulated"),
            align: "end",
            hideOnPhone: true,
            cell: (r) => <span className="font-mono tabular-nums">{kgGroupedText(r.accumulatedG)}</span>,
          },
          {
            key: "nitriding",
            header: t("dieRoom.tabs.nitriding"),
            hideOnPhone: true,
            cell: (r) => (r.nitridedAt ? shortDate(r.nitridedAt) : "—"),
          },
          {
            key: "remark",
            header: t("dieRoom.runs.remark"),
            hideOnPhone: true,
            cell: (r) => r.dieRemark ?? r.pressRemark ?? "—",
          },
        ]}
      />
    </>
  );
}

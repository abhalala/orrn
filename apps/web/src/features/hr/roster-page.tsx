/** `/hr/roster`: a week as a grid, person by day. Each cell is a shift, the weekly off, or the person's own shift. */
import { useT } from "@orrn/i18n";
import { Button, IconButton } from "@orrn/ui/components/button";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { PageHeader } from "@orrn/ui/components/page-header";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Can } from "@/shared/components/can";
import { useFmt } from "@/shared/lib/fmt";
import { bookDayText } from "@/shared/lib/fmt-text";
import { trpc } from "@/shared/utils/trpc";

import { addDaysYmd, cellFor, cellInput, cellValue, weekStart } from "./model";
import { HrGate, HrTabs, LoadError, Pick, errorText, useCan, useToday } from "./ui";

export function RosterPage() {
  const { t } = useT();
  const fmt = useFmt();
  const qc = useQueryClient();
  const today = useToday();
  const canSet = useCan("attendance.mark");
  const [start, setStart] = useState(weekStart(today));
  const q = useQuery(trpc.hr.roster.week.queryOptions({ weekStart: start }));

  const set = useMutation({
    ...trpc.hr.roster.set.mutationOptions(),
    onSuccess: () => qc.invalidateQueries({ queryKey: trpc.hr.roster.pathKey() }),
    onError: (e) => toast.error(errorText(e, t("hr.saveFailed"))),
  });
  const copy = useMutation({
    ...trpc.hr.roster.copyLastWeek.mutationOptions(),
    onSuccess: async (r) => {
      await qc.invalidateQueries({ queryKey: trpc.hr.roster.pathKey() });
      toast.success(t("hr.roster.copied", { count: r.cells }));
    },
    onError: (e) => toast.error(errorText(e, t("hr.saveFailed"))),
  });

  const data = q.data;
  const shiftName = (id: string | null) => data?.shifts.find((s) => s.id === id)?.name ?? "";
  const lastDay = addDaysYmd(start, 6);

  return (
    <HrGate needs={["hr.view", "attendance.mark"]}>
      <PageHeader
        title={t("hr.roster.title")}
        subtitle={t("hr.roster.subtitle")}
        back={{ to: "/hr", label: t("hr.title") }}
        actions={
          <Can do="attendance.mark">
            <Button variant="secondary" loading={copy.isPending} onClick={() => copy.mutate({ weekStart: start })}>
              {t("hr.roster.copy")}
            </Button>
          </Can>
        }
      />
      <HrTabs current="roster" />
      <div className="flex flex-wrap items-center gap-2">
        <IconButton label={t("hr.roster.prev")} icon={<ChevronLeft aria-hidden="true" />} variant="secondary" onClick={() => setStart(addDaysYmd(start, -7))} />
        <span className="min-w-44 text-center text-[15px] font-semibold">{t("hr.roster.week", { from: fmt.day(start, { year: false }), to: fmt.day(lastDay, { year: start.slice(0, 4) !== lastDay.slice(0, 4) }) })}</span>
        <IconButton label={t("hr.roster.next")} icon={<ChevronRight aria-hidden="true" />} variant="secondary" onClick={() => setStart(addDaysYmd(start, 7))} />
        <Button variant="secondary" onClick={() => setStart(weekStart(today))}>
          {t("hr.roster.thisWeek")}
        </Button>
      </div>
      <p className="m-0 text-[13px] text-muted-foreground">{t("hr.roster.hint")}</p>

      {q.isPending ? <Skeleton className="h-64 w-full rounded-card" /> : null}
      {q.isError ? <LoadError onRetry={() => void q.refetch()} /> : null}
      {data && data.people.length === 0 ? <EmptyState title={t("hr.roster.empty")} /> : null}
      {data && data.people.length > 0 ? (
        <div className="overflow-x-auto rounded-card border border-border bg-card" tabIndex={0} role="region" aria-label={t("hr.roster.gridLabel")}>
          <table className="w-full min-w-[56rem] border-collapse text-[13px]">
            <thead>
              <tr className="bg-surface-sunken text-left">
                <th scope="col" className="sticky left-0 z-[1] min-w-40 bg-surface-sunken px-3 py-2 font-medium">
                  {t("hr.people.name")}
                </th>
                {data.days.map((d) => (
                  <th key={d} scope="col" className={`px-2 py-2 font-medium whitespace-nowrap ${d === today ? "text-primary" : ""}`}>
                    {fmt.day(d, { year: false })}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.people.map((p) => (
                <tr key={p.id} className="border-t border-border">
                  <th scope="row" className="sticky left-0 z-[1] bg-card px-3 py-1.5 text-left font-semibold">
                    {p.name} <span className="font-mono text-xs font-normal text-muted-foreground">{p.code}</span>
                  </th>
                  {data.days.map((d) => {
                    const cell = cellFor(data.cells, p.id, d);
                    const defaultName = shiftName(p.shiftId);
                    return (
                      <td key={d} className="px-1.5 py-1">
                        <Pick
                          compact
                          aria-label={`${p.name}, ${bookDayText(fmt, d, today)}`}
                          disabled={!canSet || set.isPending}
                          value={cellValue(cell)}
                          onChange={(v) => set.mutate({ employeeId: p.id, day: d, shiftId: cellInput(v) })}
                          options={[
                            { value: "default", label: defaultName ? t("hr.roster.default", { shift: defaultName }) : t("hr.roster.defaultNone") },
                            ...data.shifts.map((s) => ({ value: s.id, label: s.name })),
                            { value: "off", label: t("hr.roster.off") },
                          ]}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </HrGate>
  );
}

import { Button } from "@orrn/ui/components/button";
import { Combobox } from "@orrn/ui/components/combobox";
import { Field, TextInput } from "@orrn/ui/components/field";
import { NativeSelect } from "@orrn/ui/components/native-select";
import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";

import { ReportToggle } from "@/features/reports/report-chrome";
import { INLINE_ERROR_META } from "@/shared/lib/query-errors";
import { trpc, trpcClient } from "@/shared/utils/trpc";

import type { CapacityView } from "./hooks";
import { bpText, hoursText, scenarioPct } from "./model";
import { Loaded, Note, Panel, useCostSay } from "./ui";

type What = { customerId: string; name: string; pct: number };
const WEEK_CHOICES = [4, 8, 13, 26] as const;

/** Row 51: each press line week by week, booked hours against available, over-booked weeks with the orders behind them. */
export function CapacityTab() {
  const say = useCostSay();
  const { t } = say;
  const [weeks, setWeeks] = useState<number>(8);
  const [withForecast, setWithForecast] = useState(false);
  const [what, setWhat] = useState<What[]>([]);
  const [pick, setPick] = useState<{ id: string; name: string } | null>(null);
  const [pct, setPct] = useState("");
  const names = useRef(new Map<string, string>());
  const pctValue = scenarioPct(pct);
  const cap = useQuery({
    ...trpc.costing.capacity.queryOptions({ weeks, withForecast, scenario: what.map((w) => ({ customerId: w.customerId, pct: w.pct })) }),
    meta: INLINE_ERROR_META,
  });
  const addWhat = () => {
    if (!pick || pctValue === null) return;
    setWhat([...what.filter((w) => w.customerId !== pick.id), { customerId: pick.id, name: pick.name, pct: pctValue }].slice(0, 10));
    setPick(null);
    setPct("");
  };
  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="capacity-tab">
      <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
        <Field label={t("cost.capacity.weeks")} className="w-32">
          <NativeSelect value={String(weeks)} onChange={(e) => setWeeks(Number(e.currentTarget.value))}>
            {WEEK_CHOICES.map((w) => (
              <option key={w} value={w}>{w}</option>
            ))}
          </NativeSelect>
        </Field>
        <ReportToggle id="cap-forecast" checked={withForecast} onChange={setWithForecast} label={t("cost.capacity.withForecast")} />
      </div>
      <Panel title={t("cost.capacity.whatIf")}>
        <Note>{t("cost.capacity.whatIfHint")}</Note>
        <div className="grid min-w-0 gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto] sm:items-end">
          <Field label={t("cost.capacity.customer")}>
            <Combobox<string>
              value={pick?.id ?? null}
              valueLabel={pick?.name}
              onChange={(id) => setPick(id ? { id, name: names.current.get(id) ?? id } : null)}
              search={async (q) => {
                const res = await trpcClient.customer.list.query({ search: q, limit: 20 });
                for (const c of res.items) names.current.set(c.id, c.name);
                return res.items.map((c) => ({ value: c.id, label: c.name, hint: c.phone ?? undefined }));
              }}
              placeholder={t("cost.capacity.pickCustomer")}
            />
          </Field>
          <Field label={t("cost.capacity.change")} error={pct !== "" && pctValue === null ? t("cost.settings.badNumber") : undefined}>
            <TextInput value={pct} inputMode="numeric" autoComplete="off" onChangeText={setPct} />
          </Field>
          <Button variant="secondary" onClick={addWhat} disabled={!pick || pctValue === null}>{t("cost.capacity.add")}</Button>
        </div>
        {what.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            {what.map((w) => (
              <span key={w.customerId} className="rounded-full border border-border px-3 py-1 text-[14px]">
                {t("cost.capacity.scenarioLine", { customer: w.name, pct: `${w.pct > 0 ? "+" : ""}${w.pct}%` })}
              </span>
            ))}
            <Button variant="ghost" onClick={() => setWhat([])}>{t("cost.capacity.clear")}</Button>
          </div>
        ) : null}
      </Panel>
      <Loaded query={cap}>{(data) => <Lines data={data} />}</Loaded>
    </div>
  );
}

function Lines({ data }: { data: CapacityView }) {
  const say = useCostSay();
  const { t } = say;
  if (data.lines.length === 0) return <Note>{t("cost.capacity.noLines")}</Note>;
  return (
    <>
      {data.lines.map((line) => (
        <Panel key={line.id} title={`${line.code} ${line.name}`} testId={`capacity-line-${line.code}`}>
          <div className="min-w-0 overflow-x-auto" tabIndex={0} role="region" aria-label={`${t("cost.capacity.line")} ${line.code}`}>
            <table className="w-full border-collapse text-left text-[13px] leading-5">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th scope="col" className="px-3 py-2 font-medium">{t("cost.capacity.week")}</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">{t("cost.capacity.available")}</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">{t("cost.capacity.booked")}</th>
                  <th scope="col" className="px-3 py-2 font-medium">{t("cost.capacity.load")}</th>
                  <th scope="col" className="px-3 py-2 font-medium">{t("cost.capacity.causes")}</th>
                </tr>
              </thead>
              <tbody>
                {line.weeks.map((w) => (
                  <tr key={w.week} className={`border-b border-border last:border-0 ${w.over ? "bg-destructive/5" : ""}`} data-over={w.over ? "1" : undefined}>
                    <th scope="row" className="whitespace-nowrap px-3 py-2 font-medium tabular-nums">{say.day(w.start)}</th>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{hoursText(w.availableMin)}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{hoursText(w.bookedMin)}</td>
                    <td className="min-w-[10rem] px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className="relative h-2 w-24 shrink-0 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                          <span className={`absolute inset-y-0 left-0 ${w.over ? "bg-destructive" : "bg-foreground/60"}`} style={{ width: `${Math.min(100, (w.loadBp ?? 0) / 100)}%` }} />
                        </span>
                        <span className={`tabular-nums ${w.over ? "font-semibold text-destructive" : ""}`}>{bpText(w.loadBp)}</span>
                        {w.over ? <span className="font-semibold text-destructive">{t("cost.capacity.over")}</span> : null}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      {w.over && w.refs.length > 0 ? (
                        <ul className="m-0 list-none p-0">
                          {w.refs.map((r) => (
                            <li key={r.ref}>{t("cost.capacity.refKg", { ref: r.ref, hours: hoursText(r.minutes), kg: say.kgU(r.g) })}</li>
                          ))}
                        </ul>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      ))}
      <div className="flex flex-col gap-1">
        {data.unassignedCount - data.pressInactiveCount > 0 ? <Note>{t("cost.capacity.unassigned", { n: data.unassignedCount - data.pressInactiveCount })}</Note> : null}
        {data.pressInactiveCount > 0 ? <Note>{t("cost.capacity.pressInactive", { n: data.pressInactiveCount })}</Note> : null}
        {data.noSpeedCount > 0 ? <Note>{t("cost.capacity.noSpeed", { n: data.noSpeedCount })}</Note> : null}
        {data.laterG > 0 ? <Note>{t("cost.capacity.later", { kg: say.kgU(data.laterG) })}</Note> : null}
        {data.forecast ? <Note>{t("cost.capacity.forecastNote", { n: data.forecast.pairs })}</Note> : null}
        {data.truncated || data.forecast?.truncated ? <Note>{t("cost.capacity.truncated")}</Note> : null}
      </div>
    </>
  );
}

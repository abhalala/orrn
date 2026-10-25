import { parseDecimal } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { Field, TextInput } from "@orrn/ui/components/field";
import { NativeSelect } from "@orrn/ui/components/native-select";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { UiLink } from "@orrn/ui/components/link";
import type { AppRouter } from "@orrn/server/routers/index";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import { useState } from "react";
import { toast } from "sonner";

import { Can } from "@/shared/components/can";
import { can, useMe } from "@/shared/lib/me";
import { INLINE_ERROR_META } from "@/shared/lib/query-errors";
import { trpc } from "@/shared/utils/trpc";

import { Note } from "./ui";

type Threshold = inferRouterOutputs<AppRouter>["press"]["collector"]["thresholds"][number];

/** The readings a band can watch (server `pressAlertMetrics`). */
export const COLLECTOR_METRICS = ["ram_speed", "billet_temp", "exit_temp", "container_temp", "pressure"] as const;
export type CollectorMetric = (typeof COLLECTOR_METRICS)[number];

/** Typed text for one side of a band: "" = open, a number, or null when it is not a number. */
export function parseBound(text: string): number | null | "bad" {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  const n = parseDecimal(trimmed);
  return n === null || n > 5000 ? "bad" : n;
}

/** What a row would send, or why it cannot be sent (the server's rules: one side at least, lower below upper). */
export function bandDraft(minText: string, maxText: string): { ok: true; min: number | null; max: number | null } | { ok: false } {
  const min = parseBound(minText);
  const max = parseBound(maxText);
  if (min === "bad" || max === "bad") return { ok: false };
  if (min === null && max === null) return { ok: false };
  if (min !== null && max !== null && min > max) return { ok: false };
  return { ok: true, min, max };
}

const text = (n: number | null | undefined) => (n === null || n === undefined ? "" : String(n));

/**
 * Collectors (Settings, Devices; FP-PR-22): the limits a press reading must stay inside, per press
 * and reading, or for every press. A reading outside raises an alert on Today and on /press/alerts.
 * Managers, admins and owners (`masters.publish`) set them; the card links to the alerts list and the
 * spectro inbox. Units: ram speed mm/s, temperatures °C, pressure bar.
 */
export function CollectorsCard() {
  const { t } = useT();
  const lines = useQuery({ ...trpc.press.lines.list.queryOptions(), meta: INLINE_ERROR_META });
  const thresholds = useQuery({ ...trpc.press.collector.thresholds.queryOptions(), meta: INLINE_ERROR_META });
  const open = useQuery({ ...trpc.press.collector.openAlertCount.queryOptions(), meta: INLINE_ERROR_META });
  const inbox = useQuery({ ...trpc.foundry.spectroInbox.list.queryOptions(), meta: INLINE_ERROR_META });
  const [lineId, setLineId] = useState<string>("");

  const saved = (metric: CollectorMetric, forLine: string): Threshold | undefined =>
    thresholds.data?.find((r) => r.metric === metric && (forLine ? r.pressLineId === forLine : r.pressLineId === null));

  return (
    <section aria-labelledby="collectors-heading" className="flex min-w-0 flex-col gap-3 rounded-card border border-border bg-card p-4 sm:p-5" data-testid="settings-collectors">
      <div className="flex min-w-0 flex-col gap-1">
        <h2 id="collectors-heading" className="m-0 text-[17px] font-semibold">
          {t("devices.collectors.title")}
        </h2>
        <Note>{t("devices.collectors.intro")}</Note>
      </div>
      <p className="m-0 flex flex-wrap items-center gap-3 text-[15px]">
        <UiLink to="/press/alerts" className="font-semibold underline underline-offset-4" data-testid="collectors-alerts-link">
          {t("devices.collectors.alertsLink")}
        </UiLink>
        {open.data && open.data.open > 0 ? <Chip tone="red">{t("press.summary.alertsOpen", { count: open.data.open })}</Chip> : null}
        <Can do="cast.enter">
          <UiLink to="/casts/inbox" className="font-semibold underline underline-offset-4" data-testid="collectors-inbox-link">
            {t("devices.collectors.inboxLink")}
          </UiLink>
          {inbox.data && inbox.data.length > 0 ? <Chip tone="amber">{t("devices.collectors.inboxWaiting", { count: inbox.data.length })}</Chip> : null}
        </Can>
      </p>

      {thresholds.isPending || lines.isPending ? (
        <Skeleton className="h-40 w-full rounded-card" aria-busy="true" />
      ) : thresholds.isError || lines.isError ? (
        <p role="alert" className="m-0 text-[15px] text-tone-red-ink">
          {t("devices.collectors.loadFailed")}
        </p>
      ) : (
        <>
          <Can do="masters.publish" fallback={<Note testId="collectors-read-only">{t("devices.collectors.readOnly")}</Note>}>
            {null}
          </Can>
          {(lines.data ?? []).length === 0 ? (
            <Note>{t("devices.collectors.noLines")}</Note>
          ) : null}
          <Field label={t("devices.collectors.line")} hint={lineId === "" ? t("devices.collectors.allLinesHint") : undefined}>
            <NativeSelect value={lineId} onChange={(e) => setLineId(e.currentTarget.value)} data-testid="collectors-line">
              <option value="">{t("devices.collectors.allLines")}</option>
              {(lines.data ?? []).map((l) => (
                <option key={l.id} value={l.id}>
                  {l.code} {l.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <ul className="m-0 flex list-none flex-col gap-4 p-0" data-testid="collectors-bands">
            {COLLECTOR_METRICS.map((metric) => (
              <li key={`${lineId}:${metric}`} className="min-w-0">
                <BandRow metric={metric} lineId={lineId || null} row={saved(metric, lineId)} fallback={lineId ? saved(metric, "") : undefined} />
              </li>
            ))}
          </ul>
          <Note>{t("devices.collectors.unitHint")}</Note>
        </>
      )}
    </section>
  );
}

function BandRow({ metric, lineId, row, fallback }: { metric: CollectorMetric; lineId: string | null; row: Threshold | undefined; fallback: Threshold | undefined }) {
  const { t } = useT();
  const queryClient = useQueryClient();
  const { data: me } = useMe();
  const editable = can(me, "masters.publish");
  const [min, setMin] = useState(text(row?.min));
  const [max, setMax] = useState(text(row?.max));
  const [active, setActive] = useState(row?.active ?? true);
  const draft = bandDraft(min, max);
  const dirty = text(row?.min) !== min.trim() || text(row?.max) !== max.trim() || (row?.active ?? true) !== active;
  const unit = t(`press.alerts.unit.${metric}`);

  const save = useMutation(
    trpc.press.collector.setThreshold.mutationOptions({
      onSuccess: async () => {
        toast.success(t("devices.collectors.saved"));
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: trpc.press.collector.pathKey() }),
          queryClient.invalidateQueries({ queryKey: trpc.dashboard.pathKey() }),
        ]);
      },
      onError: () => toast.error(t("devices.collectors.saveFailed")),
    }),
  );

  return (
    <form
      noValidate
      className="grid min-w-0 grid-cols-2 items-end gap-3 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_auto_auto]"
      data-testid={`band-${metric}`}
      onSubmit={(e) => {
        e.preventDefault();
        if (!draft.ok || !dirty || save.isPending) return;
        save.mutate({ pressLineId: lineId, metric, min: draft.min, max: draft.max, active });
      }}
    >
      <p className="col-span-2 m-0 min-w-0 text-[15px] font-semibold sm:col-span-1">
        {t(`press.alerts.metric.${metric}`)} <span className="font-normal text-muted-foreground">({unit})</span>
        {!row && fallback ? (
          <span className="block text-[13px] font-normal text-muted-foreground">
            {t("devices.collectors.allLines")}: {fallback.min ?? "-"} to {fallback.max ?? "-"} {unit}
          </span>
        ) : null}
      </p>
      <Field label={t("devices.collectors.min")}>
        <TextInput inputMode="decimal" autoComplete="off" value={min} className="font-mono tabular-nums" data-testid={`band-${metric}-min`} onChange={(e) => setMin(e.currentTarget.value)} disabled={!editable} />
      </Field>
      <Field label={t("devices.collectors.max")}>
        <TextInput inputMode="decimal" autoComplete="off" value={max} className="font-mono tabular-nums" data-testid={`band-${metric}-max`} onChange={(e) => setMax(e.currentTarget.value)} disabled={!editable} />
      </Field>
      <label className="flex min-h-11 items-center gap-2 text-[15px]">
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.currentTarget.checked)} className="size-5 accent-[var(--color-foreground)]" disabled={!editable} />
        {t("devices.collectors.on")}
      </label>
      <Can do="masters.publish">
        <Button type="submit" size="sm" variant="secondary" disabled={!draft.ok || !dirty} loading={save.isPending} data-testid={`band-${metric}-save`}>
          {t("devices.collectors.save")}
        </Button>
      </Can>
      {!draft.ok && (min.trim() !== "" || max.trim() !== "") ? (
        <p role="alert" className="col-span-full m-0 text-[13px] text-tone-red-ink">
          {t("devices.collectors.invalid")}
        </p>
      ) : null}
    </form>
  );
}

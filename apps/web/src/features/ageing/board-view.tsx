import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { UiLink } from "@orrn/ui/components/link";
import { PageHeader } from "@orrn/ui/components/page-header";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { cn } from "@orrn/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { Flame, History, PackagePlus } from "lucide-react";

import { kgFromG } from "@/features/press/model";
import { Can } from "@/shared/components/can";
import { INLINE_ERROR_META, showsQueryError } from "@/shared/lib/query-errors";
import { trpc } from "@/shared/utils/trpc";

import { BOARD_POLL_MS, useDuration, useNow, useShifts, type Batch, type BatchSummary, type Oven, type Trolley } from "./hooks";
import { batchByOven, batchByTrolley, capacityTone, soakProgress, x10Text } from "./model";
import { TempSpark } from "./sparkline";
import { Panel, PhaseChip, Section } from "./ui";

/**
 * `/ageing` (FP-AG-01, 02, 05, 11): the ovens with the batch in each, a stage timer and the last
 * readings as a line; the trolleys free or carrying a batch (loading, out, released, held). One
 * primary action: Load trolley. Figures come from `ageing.batches.list` and `ageing.batches.get`;
 * nothing is worked out here.
 */
export function BoardScreen() {
  const { t } = useT();
  const now = useNow();
  const { shifts, settings } = useShifts();
  const ovens = useQuery({ ...trpc.ageing.ovens.list.queryOptions({}), refetchInterval: BOARD_POLL_MS, meta: INLINE_ERROR_META });
  const trolleys = useQuery({ ...trpc.ageing.trolleys.list.queryOptions({}), refetchInterval: BOARD_POLL_MS, meta: INLINE_ERROR_META });
  const batches = useQuery({ ...trpc.ageing.batches.list.queryOptions({ limit: 100 }), refetchInterval: BOARD_POLL_MS, meta: INLINE_ERROR_META });

  const header = (
    <PageHeader
      title={t("ageing.title")}
      subtitle={t("ageing.floor.subtitle")}
      actions={
        <>
          <Button asChild variant="secondary">
            <UiLink to="/ageing/history" className="no-underline">
              <History aria-hidden="true" className="size-4" />
              {t("ageing.history.title")}
            </UiLink>
          </Button>
          <Can do="ageing.load">
            <Button asChild>
              <UiLink to="/ageing/load" className="no-underline" data-testid="load-trolley">
                <PackagePlus aria-hidden="true" className="size-4" />
                {t("ageing.action.load")}
              </UiLink>
            </Button>
          </Can>
        </>
      }
    />
  );

  if (showsQueryError(ovens) || showsQueryError(trolleys) || showsQueryError(batches)) {
    return (
      <>
        {header}
        <div className="rounded-card border border-border bg-card">
          <EmptyState
            title={t("ageing.loadFailed")}
            action={
              <Button
                variant="secondary"
                onClick={() => {
                  void ovens.refetch();
                  void trolleys.refetch();
                  void batches.refetch();
                }}
              >
                {t("common.retry")}
              </Button>
            }
          />
        </div>
      </>
    );
  }
  if (!ovens.data || !trolleys.data || !batches.data) {
    return (
      <>
        {header}
        <Skeleton className="h-48 rounded-card" aria-busy="true" />
      </>
    );
  }

  const live = batches.data.items.filter((b) => b.status !== "closed" && b.status !== "void");
  const byOven = batchByOven(live);
  const byTrolley = batchByTrolley(live);
  const activeOvens = ovens.data.items.filter((o) => o.status !== "draft");
  const activeTrolleys = trolleys.data.items.filter((r) => r.status !== "draft");
  const held = live.filter((b) => b.status === "held");
  const noShift = settings.isSuccess && shifts.length === 0;
  const counts = {
    inOven: live.filter((b) => b.status === "in_oven").length,
    out: live.filter((b) => b.status === "out").length,
    held: held.length,
  };

  return (
    <>
      {header}
      <ul className="m-0 flex list-none flex-wrap gap-2 p-0" aria-label={t("ageing.floor.counts")} data-testid="board-counts">
        <li><Chip tone="amber" truncate={false}>{t("ageing.floor.inOven", { count: counts.inOven })}</Chip></li>
        <li><Chip tone="blue" truncate={false}>{t("ageing.floor.out", { count: counts.out })}</Chip></li>
        <li><Chip tone={counts.held > 0 ? "red" : "neutral"} truncate={false}>{t("ageing.floor.held", { count: counts.held })}</Chip></li>
      </ul>

      {activeOvens.length === 0 ? (
        <Can do={["masters.draft", "masters.publish"]} fallback={<Notice text={t("ageing.empty.noOvenAsk")} />}>
          <Notice text={t("ageing.empty.noOven")} to="/masters/ovens" action={t("ageing.action.addOven")} />
        </Can>
      ) : null}
      {noShift ? (
        <Can do="settings.update" fallback={<Notice text={t("ageing.empty.noShiftAsk")} />}>
          <Notice text={t("ageing.empty.noShift")} to="/settings" action={t("nav.settings")} />
        </Can>
      ) : null}

      {held.length > 0 ? (
        <Section id="held-title" title={t("ageing.floor.heldTitle")} hint={t("ageing.floor.heldHint")}>
          <ul className="m-0 grid list-none grid-cols-1 gap-3 p-0 md:grid-cols-2" data-testid="held-batches">
            {held.map((b) => (
              <li key={b.id}>
                <HeldCard batch={b} />
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 md:items-start">
        <Section id="ovens-title" title={t("ageing.floor.ovens")}>
          <ul className="m-0 flex list-none flex-col gap-3 p-0" data-testid="oven-cards">
            {activeOvens.map((o) => (
              <li key={o.id}>
                <OvenCard oven={o} batch={byOven.get(o.id)} now={now} />
              </li>
            ))}
          </ul>
        </Section>
        <Section id="trolleys-title" title={t("ageing.floor.trolleys")}>
          <ul className="m-0 flex list-none flex-col gap-3 p-0" data-testid="trolley-cards">
            {activeTrolleys.length === 0 ? (
              <li>
                <Can do={["masters.draft", "masters.publish"]} fallback={<Notice text={t("ageing.empty.noTrolleyAsk")} />}>
                  <Notice text={t("ageing.empty.noTrolley")} to="/masters/trolleys" action={t("ageing.action.addTrolley")} />
                </Can>
              </li>
            ) : null}
            {activeTrolleys.map((r) => (
              <li key={r.id}>
                <TrolleyCard trolley={r} batch={byTrolley.get(r.id)} />
              </li>
            ))}
          </ul>
        </Section>
      </div>
    </>
  );
}

function Notice({ text, to, action }: { text: string; to?: string; action?: string }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-card border border-tone-amber-ink/30 bg-tone-amber-tint px-4 py-3 text-tone-amber-ink" role="status">
      <p className="m-0 min-w-0 flex-1 basis-[240px] text-[14px] leading-6 break-words">{text}</p>
      {to && action ? (
        <Button asChild variant="secondary" size="sm">
          <UiLink to={to} className="no-underline">
            {action}
          </UiLink>
        </Button>
      ) : null}
    </div>
  );
}

/** The batch in an oven: stage timer, last reading and the line of the log. */
function OvenCard({ oven, batch, now }: { oven: Oven; batch: BatchSummary | undefined; now: number }) {
  const { t } = useT();
  const out = oven.status === "out_of_service";
  return (
    <Panel data-testid="oven-card" data-oven={oven.code} className={cn("flex flex-col gap-3", out && "opacity-80")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="m-0 flex items-center gap-2 font-display text-[20px] font-bold tracking-[-0.02em]">
          <Flame aria-hidden="true" className="size-5 text-tone-amber-ink" strokeWidth={2} />
          <span className="font-mono">{oven.code}</span>
        </h3>
        {out ? <Chip tone="neutral" truncate={false}>{t("ageing.masterStatus.out_of_service")}</Chip> : batch ? <PhaseChip phase={batch.phase} /> : <Chip tone="neutral" truncate={false}>{t("ageing.floor.empty")}</Chip>}
      </div>
      {batch ? (
        <OvenBatch batch={batch} now={now} />
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="m-0 text-[14px] text-muted-foreground">
            {oven.capacityG ? t("ageing.floor.capacity", { kg: kgFromG(oven.capacityG) }) : t("ageing.capacity.unknown")}
          </p>
          {!out ? (
            <Can do="ageing.load">
              <Button asChild variant="secondary" size="sm">
                <UiLink to="/ageing/load" className="no-underline">
                  {t("ageing.action.load")}
                </UiLink>
              </Button>
            </Can>
          ) : null}
        </div>
      )}
    </Panel>
  );
}

function OvenBatch({ batch, now }: { batch: BatchSummary; now: number }) {
  const { t } = useT();
  const duration = useDuration();
  // The curve and the band come from the batch itself; one detail query per batch in an oven.
  const detail = useQuery({ ...trpc.ageing.batches.get.queryOptions({ id: batch.id }), refetchInterval: BOARD_POLL_MS, meta: INLINE_ERROR_META });
  const progress = soakProgress(batch.soakStartedAt, batch.soakMin, now);
  const d: Batch | undefined = detail.data;
  const snap = d?.snapshot ?? null;
  const band = snap ? { lowX10: snap.targetTempX10 - snap.toleranceX10, highX10: snap.targetTempX10 + snap.toleranceX10 } : null;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <UiLink to={`/ageing/batch/${batch.id}`} className="font-mono text-[18px] font-semibold" data-testid="oven-batch-link">
          {batch.number}
        </UiLink>
        <span className="text-[14px] text-muted-foreground">
          {t("ageing.floor.onTrolley", { trolley: batch.trolleyCode })} · {batch.recipeLabel ?? ""}
        </span>
      </div>
      <dl className="m-0 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <dt className="text-[13px] font-medium text-muted-foreground">{t("ageing.floor.lastTemp")}</dt>
          <dd className="m-0 font-mono text-[22px] font-semibold tabular-nums" data-testid="oven-last-temp">
            {batch.lastTempCX10 === null ? "-" : `${x10Text(batch.lastTempCX10)} °C`}
          </dd>
        </div>
        <div className="flex min-w-0 flex-col gap-0.5">
          <dt className="text-[13px] font-medium text-muted-foreground">{progress ? t("ageing.floor.soakOf", { total: duration(batch.soakMin ?? 0) }) : t("ageing.floor.stage")}</dt>
          <dd className="m-0 text-[17px] font-semibold tabular-nums" data-testid="oven-stage">
            {progress ? duration(progress.elapsedMin) : t(`ageing.phase.${batch.phase}`)}
          </dd>
        </div>
        <div className="flex min-w-0 flex-col gap-0.5">
          <dt className="text-[13px] font-medium text-muted-foreground">{t("ageing.field.loaded")}</dt>
          <dd className="m-0 text-[17px] font-semibold tabular-nums">
            {t("ageing.pcsKg", { pcs: batch.totals.loadedPcs, kg: kgFromG(batch.totals.loadedKgG) })}
          </dd>
        </div>
      </dl>
      {progress ? (
        <div className="h-2 overflow-hidden rounded-full bg-surface-sunken" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress.ratio * 100)} aria-label={t("ageing.floor.soakProgress")}>
          <div className="h-full rounded-full bg-tone-green" style={{ width: `${Math.round(progress.ratio * 100)}%` }} />
        </div>
      ) : null}
      {d ? <TempSpark readings={d.readings} band={band} /> : <Skeleton className="h-14 rounded-input" />}
      {batch.capacity === "over" || batch.capacity === "near" ? (
        <Chip tone={capacityTone(batch.capacity)} truncate={false}>
          {t(`ageing.capacity.${batch.capacity}`)}
        </Chip>
      ) : null}
    </div>
  );
}

/** A trolley: free, or the batch it carries and where that stands. */
function TrolleyCard({ trolley, batch }: { trolley: Trolley; batch: BatchSummary | undefined }) {
  const { t } = useT();
  const out = trolley.status === "out_of_service";
  const carried = batch ?? null;
  return (
    <Panel data-testid="trolley-card" data-trolley={trolley.code} data-state={carried ? carried.status : out ? "out" : "free"} className={cn("flex flex-col gap-2", !carried && "bg-surface-sunken/50")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="m-0 font-mono text-[18px] font-semibold">{trolley.code}</h3>
        {carried ? <PhaseChip phase={carried.phase} /> : out ? <Chip tone="neutral" truncate={false}>{t("ageing.masterStatus.out_of_service")}</Chip> : <Chip tone="green" truncate={false}>{t("ageing.floor.free")}</Chip>}
      </div>
      {carried ? (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <UiLink to={`/ageing/batch/${carried.id}`} className="font-mono text-[16px] font-semibold">
              {carried.number}
            </UiLink>
            <span className="text-[14px] text-muted-foreground">{carried.recipeLabel ?? t("ageing.floor.noRecipeYet")}</span>
          </div>
          <p className="m-0 flex flex-wrap gap-x-4 gap-y-1 text-[14px] tabular-nums">
            <span>{t("ageing.floor.loadedPcs", { pcs: carried.totals.loadedPcs })}</span>
            {carried.totals.packablePcs > 0 ? <span>{t("ageing.floor.packablePcs", { pcs: carried.totals.packablePcs })}</span> : null}
            {carried.totals.heldPcs > 0 ? <span className="font-semibold text-tone-red-ink">{t("ageing.floor.heldPcs", { pcs: carried.totals.heldPcs })}</span> : null}
          </p>
        </div>
      ) : !out ? (
        <Can do="ageing.load">
          <div>
            <Button asChild variant="secondary" size="sm">
              <UiLink to={`/ageing/load?trolley=${trolley.id}`} className="no-underline">
                {t("ageing.action.load")}
              </UiLink>
            </Button>
          </div>
        </Can>
      ) : null}
    </Panel>
  );
}

function HeldCard({ batch }: { batch: BatchSummary }) {
  const { t } = useT();
  return (
    <Panel className="flex flex-col gap-1 border-tone-red-ink/30 bg-tone-red-tint/40" data-testid="held-card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <UiLink to={`/ageing/batch/${batch.id}`} className="font-mono text-[18px] font-semibold">
          {batch.number}
        </UiLink>
        <PhaseChip phase="held" />
      </div>
      <p className="m-0 text-[14px] text-muted-foreground">
        {t("ageing.floor.onTrolley", { trolley: batch.trolleyCode })} · {batch.recipeLabel ?? ""} · {t("ageing.floor.heldPcs", { pcs: batch.totals.heldPcs })}
      </p>
    </Panel>
  );
}


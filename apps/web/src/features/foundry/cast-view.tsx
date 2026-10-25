import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { UiLink } from "@orrn/ui/components/link";
import { PageHeader } from "@orrn/ui/components/page-header";
import { ResponsiveList, type ResponsiveListColumn } from "@orrn/ui/components/responsive-list";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { Tabs } from "@orrn/ui/components/tabs";
import type { AppRouter } from "@orrn/server/routers/index";
import { useQuery } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import { useState } from "react";

import { kgFromG } from "@/features/press/model";
import { Can } from "@/shared/components/can";
import { canAny, useMe } from "@/shared/lib/me";
import { INLINE_ERROR_META, showsQueryError } from "@/shared/lib/query-errors";
import { isNotFound } from "@/shared/lib/session-errors";
import { PURCHASE_READERS } from "@/features/approvals/approval-view";
import { trpc } from "@/shared/utils/trpc";

import { CancelCastSheet, CloseCastSheet } from "./close-sheet";
import { bpText, CAST_TONE, canCancelCast, castPeriodText, closeBlock, latestVerdict, lockedMeltTone, MELT_TONE, tailChip, verdictTone, type MeltStatus } from "./model";
import { TraceTree } from "./trace-tree";
import { Figure, LoadFailed, Note, Panel, useTimeZone } from "./ui";
import { clockText, dayText } from "./format";

type CastData = inferRouterOutputs<AppRouter>["foundry"]["casts"]["get"];
type MeltRow = CastData["melts"][number];

export type CastTab = "melts" | "trace";

/**
 * `/casts/$id` (FP-FD-02, 14, 15, 17, 20): the cast number and state, the billet tail (produced less
 * what the press used less what is on hand) with burn and bundles beside it, the melts, the close
 * and cancel actions for supervisors, the trace tree, and the charge cost for purchase readers.
 */
export function CastScreen({ id, tab, bundle, onTab }: { id: string; tab: CastTab; bundle?: string; onTab(tab: CastTab): void }) {
  const { t } = useT();
  const query = useQuery({ ...trpc.foundry.casts.get.queryOptions({ id }), meta: INLINE_ERROR_META });
  const [closing, setClosing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const back = { to: "/casts", label: t("foundry.casts.title") };
  if (showsQueryError(query)) {
    return (
      <>
        <PageHeader title={t("foundry.casts.title")} back={back} />
        {isNotFound(query.error) ? (
          <div className="rounded-card border border-border bg-card">
            <EmptyState title={t("foundry.cast.notFound")} action={<Button asChild variant="secondary"><UiLink to="/casts">{t("foundry.casts.title")}</UiLink></Button>} />
          </div>
        ) : (
          <LoadFailed title={t("foundry.cast.loadFailed")} onRetry={() => void query.refetch()} />
        )}
      </>
    );
  }
  const data = query.data;
  if (!data) {
    return (
      <>
        <PageHeader title={t("foundry.casts.title")} back={back} />
        <Skeleton className="h-48 rounded-card" />
      </>
    );
  }
  const c = data.cast;
  const co = data.closeout;
  const chip = tailChip(co);
  const block = closeBlock(c.status, co);

  return (
    <>
      <PageHeader
        title={t("foundry.cast.heading", { number: c.number })}
        subtitle={[castPeriodText(c.year, c.month), t("foundry.cast.alloyIs", { alloy: c.alloy }), ...(c.legacyCode ? [t("foundry.casts.legacyChip", { code: c.legacyCode })] : [])].join(" · ")}
        back={back}
        actions={
          <div className="flex flex-wrap gap-2">
            <Can do="melt.enter">
              {c.status === "open" ? (
                <Button asChild>
                  <UiLink to={`/casts/${c.id}/melt/new`} data-testid="new-melt">
                    {t("foundry.melt.new")}
                  </UiLink>
                </Button>
              ) : null}
            </Can>
            <Button asChild variant="secondary">
              <UiLink to={`/casts/${c.id}/certificate`} data-testid="certificate-link">
                {t("foundry.cast.certificate")}
              </UiLink>
            </Button>
            <Can do="cast.close">
              {c.status === "open" ? (
                <Button variant="secondary" onClick={() => setClosing(true)} disabled={block !== null} data-testid="close-cast">
                  {t("foundry.cast.close.button")}
                </Button>
              ) : null}
              {canCancelCast(c.status, co) ? (
                <Button variant="ghost" onClick={() => setCancelling(true)} data-testid="cancel-cast">
                  {t("foundry.cast.cancel.button")}
                </Button>
              ) : null}
            </Can>
          </div>
        }
      />
      <div className="flex flex-wrap items-center gap-2" data-testid="cast-chips">
        <Chip tone={CAST_TONE[c.status]} truncate={false}>{t(`foundry.casts.status.${c.status}`)}</Chip>
        <Chip tone={chip.tone} truncate={false} data-testid="tail-chip">
          {chip.kind === "balanced"
            ? t("foundry.cast.tailChip.balanced")
            : chip.kind === "short"
              ? t("foundry.cast.tailChip.short", { kg: kgFromG(co.shortG) })
              : chip.kind === "empty"
                ? t("foundry.cast.tailChip.empty")
                : t("foundry.cast.tailChip.tail", { kg: kgFromG(Math.abs(co.tailG)) })}
        </Chip>
        {co.draftMelts > 0 ? <Chip tone="amber" truncate={false}>{t("foundry.casts.drafts", { count: co.draftMelts })}</Chip> : null}
      </div>
      {c.status === "closing" ? <Note tone="amber" testId="closing-note">{t("foundry.cast.approval.waiting")}</Note> : null}
      {c.status === "open" && data.approval?.status === "rejected" ? (
        <Note tone="red" testId="rejected-note">
          {t("foundry.cast.approval.rejected")}
          {data.approval.note ? ` ${data.approval.note}` : ""}
        </Note>
      ) : null}
      {c.status === "open" && block === "draft_melts" ? <Note tone="amber">{t("foundry.cast.close.blockedDraft")}</Note> : null}

      <Panel id="tail-panel" title={t("foundry.cast.panel.title")} testId="tail-panel">
        <dl className="m-0 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
          <Figure label={t("foundry.cast.panel.produced")} value={`${kgFromG(co.producedG)} ${t("units.kg")}`} testId="fig-produced" />
          <Figure label={t("foundry.cast.panel.pressed")} value={`${kgFromG(co.creditedG)} ${t("units.kg")}`} testId="fig-pressed" />
          <Figure label={t("foundry.cast.panel.onHand")} value={`${kgFromG(co.billetsOnHandG)} ${t("units.kg")}`} testId="fig-onhand" />
          <Figure label={t("foundry.cast.panel.tail")} value={`${co.tailG < 0 ? "-" : ""}${kgFromG(Math.abs(co.tailG))} ${t("units.kg")}`} hint={co.tailBp !== null ? `${bpText(co.tailBp)}%` : undefined} strong testId="fig-tail" />
        </dl>
        <p className="m-0 text-[13px] text-muted-foreground">{t("foundry.cast.panel.hint")}</p>
        <dl className="m-0 grid grid-cols-2 gap-x-6 gap-y-3 border-t border-border pt-3 sm:grid-cols-4" aria-label={t("foundry.cast.panel.beside")}>
          <Figure label={t("foundry.cast.panel.metalIn")} value={`${kgFromG(co.inputG)} ${t("units.kg")}`} testId="fig-in" />
          <Figure label={t("foundry.cast.panel.burn")} value={`${kgFromG(co.burnG)} ${t("units.kg")}`} testId="fig-burn" />
          <Figure label={t("foundry.cast.panel.bundles")} value={`${kgFromG(co.bundlesG)} ${t("units.kg")}`} testId="fig-bundles" />
          <Figure label={t("foundry.cast.panel.melts")} value={co.liveMelts} testId="fig-melts" />
        </dl>
      </Panel>

      <Tabs
        label={t("foundry.cast.tabs.label")}
        value={tab}
        onValueChange={(v) => onTab(v as CastTab)}
        items={[
          { id: "melts", label: t("foundry.cast.tabs.melts") },
          { id: "trace", label: t("foundry.cast.tabs.trace") },
        ]}
      >
        {tab === "melts" ? <MeltsList castId={c.id} melts={data.melts} castOpen={c.status === "open"} /> : <TraceTree castId={c.id} highlight={bundle} />}
      </Tabs>
      <CostCard castId={c.id} />
      <CloseCastSheet open={closing} onClose={() => setClosing(false)} cast={data} />
      <CancelCastSheet open={cancelling} onClose={() => setCancelling(false)} castId={c.id} number={c.number} />
    </>
  );
}

function MeltsList({ castId, melts, castOpen }: { castId: string; melts: MeltRow[]; castOpen: boolean }) {
  const { t } = useT();
  const tz = useTimeZone();
  const columns: ResponsiveListColumn<MeltRow>[] = [
    {
      key: "seq",
      header: t("foundry.cast.melts.melt"),
      cell: (m) => (
        <span className="flex min-w-0 flex-col">
          <span className="text-[16px] font-bold">{t("foundry.melt.number", { n: m.seq })}</span>
          {m.castingEndAt || m.chargingStartAt ? (
            <span className="text-[13px] text-muted-foreground">{dayText(new Date(m.chargingStartAt ?? m.castingEndAt!).getTime(), tz)}</span>
          ) : null}
        </span>
      ),
    },
    { key: "status", header: t("foundry.cast.melts.status"), phoneWide: true, cell: (m) => <MeltChip m={m} /> },
    {
      key: "time",
      header: t("foundry.cast.melts.time"),
      hideOnPhone: true,
      cell: (m) => (m.chargingStartAt && m.castingEndAt ? <span className="tabular-nums">{clockText(new Date(m.chargingStartAt).getTime(), tz)} - {clockText(new Date(m.castingEndAt).getTime(), tz)}</span> : "-"),
    },
    { key: "in", header: t("foundry.cast.melts.in"), align: "end", cell: (m) => <span className="tabular-nums whitespace-nowrap">{m.status === "draft" ? "-" : `${kgFromG(m.inputG)} ${t("units.kg")}`}</span> },
    { key: "logs", header: t("foundry.cast.melts.logs"), align: "end", cell: (m) => <span className="tabular-nums whitespace-nowrap">{m.status === "draft" ? "-" : `${kgFromG(m.logsG)} ${t("units.kg")}`}</span> },
    { key: "burn", header: t("foundry.cast.melts.burn"), align: "end", hideOnPhone: true, cell: (m) => (m.status === "locked" ? <span className="tabular-nums">{bpText(m.lossBp)}%</span> : "-") },
    { key: "spectro", header: t("foundry.cast.melts.spectro"), cell: (m) => <SpectroChip m={m} /> },
  ];
  return (
    <ResponsiveList
      rows={melts}
      columns={columns}
      rowKey={(m) => m.id}
      rowHref={(m) => `/casts/${castId}/melt/${m.id}`}
      label={t("foundry.cast.melts.title")}
      empty={
        <EmptyState
          title={t("foundry.cast.melts.none")}
          action={
            castOpen ? (
              <Can do="melt.enter">
                <Button asChild>
                  <UiLink to={`/casts/${castId}/melt/new`}>{t("foundry.melt.new")}</UiLink>
                </Button>
              </Can>
            ) : undefined
          }
        />
      }
    />
  );
}

export function MeltChip({ m }: { m: Pick<MeltRow, "status" | "lossBp" | "warnings" | "spectro"> }) {
  const { t } = useT();
  const status = m.status as MeltStatus;
  const verdict = latestVerdict(m.spectro);
  const tone = status === "locked" ? lockedMeltTone({ verdict, lossBp: m.lossBp, warnings: m.warnings ?? [] }) : (MELT_TONE[status] ?? "neutral");
  return <Chip tone={tone} truncate={false}>{t(`foundry.melt.status.${m.status}`)}</Chip>;
}

export { latestVerdict };

function SpectroChip({ m }: { m: MeltRow }) {
  const { t } = useT();
  if (m.status === "draft") return <span className="text-muted-foreground">-</span>;
  const v = latestVerdict(m.spectro);
  return v ? <Chip tone={verdictTone(v)} truncate={false}>{t(`foundry.spectro.verdict.${v}`)}</Chip> : <Chip tone="neutral" truncate={false}>{t("foundry.spectro.none")}</Chip>;
}

/** casts.cost (FP-FD-20): purchase readers only; rates stay off every other role's screen. */
function CostCard({ castId }: { castId: string }) {
  const { t } = useT();
  const { data: me } = useMe();
  const allowed = canAny(me, PURCHASE_READERS);
  const query = useQuery({ ...trpc.foundry.casts.cost.queryOptions({ castId }), enabled: allowed, meta: INLINE_ERROR_META });
  if (!allowed) return null;
  const d = query.data;
  const rupees = (paise: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(paise / 100);
  return (
    <Panel id="cost-panel" title={t("foundry.cast.cost.title")} testId="cost-card">
      {showsQueryError(query) ? (
        <LoadFailed title={t("foundry.cast.cost.loadFailed")} onRetry={() => void query.refetch()} />
      ) : !d ? (
        <Skeleton className="h-16 rounded-card" />
      ) : (
        <>
          <dl className="m-0 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
            <Figure label={t("foundry.cast.cost.total")} value={d.costPaise === null ? t("foundry.cast.cost.notCosted") : rupees(d.costPaise)} testId="cost-total" />
            <Figure label={t("foundry.cast.cost.perKg")} value={d.perKgBilletPaise === null ? "-" : rupees(d.perKgBilletPaise)} testId="cost-per-kg" />
            <Figure label={t("foundry.cast.cost.lotsKg")} value={`${kgFromG(d.lotsG)} ${t("units.kg")}`} />
          </dl>
          {d.costPaise === null ? <p className="m-0 text-[13px] text-muted-foreground">{t("foundry.cast.cost.missingRate")}</p> : null}
          {d.streamsG > 0 ? <p className="m-0 text-[13px] text-muted-foreground">{t("foundry.cast.cost.streams", { kg: kgFromG(d.streamsG) })}</p> : null}
        </>
      )}
    </Panel>
  );
}

import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Field, NumberInput, TextInput } from "@orrn/ui/components/field";
import { UiLink } from "@orrn/ui/components/link";
import { PageHeader } from "@orrn/ui/components/page-header";
import { ResponsiveList, type ResponsiveListColumn } from "@orrn/ui/components/responsive-list";
import { SegmentedControl } from "@orrn/ui/components/segmented-control";
import { Sheet } from "@orrn/ui/components/sheet";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { reasonOptions, type ReasonCodeKind } from "@/features/press/reason-label";
import { useCompanyWhen } from "@/features/stock/use-company-when";
import { Can } from "@/shared/components/can";
import { PlantInput } from "@/shared/components/plant-input";
import { useFmt } from "@/shared/lib/fmt";
import { kgGrouped1 } from "@/shared/lib/fmt-text";
import { MASS_KG } from "@/shared/lib/plant-input";
import { INLINE_ERROR_META, showsQueryError } from "@/shared/lib/query-errors";
import { trpc } from "@/shared/utils/trpc";

import type { StockPlace } from "./billets-model";
import {
  blankReject,
  checkReject,
  kindOfSearch,
  noteRequired,
  rangeBackwards,
  reasonKindOf,
  reasonShares,
  rejectPlaceOptions,
  rejectReasonText,
  type RejectKind,
  type RejectsSearch,
} from "./rejects-model";
import { useRequestKey } from "./request-key";
import { ErrorLine, FieldSelect, LoadFailed, Note, Panel } from "./ui";

/**
 * `/foundry/rejects?kind=log|billet` (row 43): the log and billet reject registers for a range of plant days, totals by
 * reason, and the "Reject" sheet. A reject takes the kg off the place it lay at and puts it back as scrap.
 */
export function RejectsScreen({ search, onSearch }: { search: RejectsSearch; onSearch(next: RejectsSearch): void }) {
  const fmt = useFmt();
  const { t } = useT();
  const when = useCompanyWhen();
  const kind = kindOfSearch(search);
  const [open, setOpen] = useState(false);
  const backwards = rangeBackwards(search);
  const query = useQuery({
    ...trpc.foundry.rejects.list.queryOptions({ kind, ...(search.from ? { from: search.from } : {}), ...(search.to ? { to: search.to } : {}), limit: 100 }),
    enabled: !backwards,
    meta: INLINE_ERROR_META,
  });
  const set = (patch: Partial<RejectsSearch>) => onSearch({ ...search, ...patch });
  const header = <PageHeader title={t("fdy2.rejects.title")} subtitle={t("fdy2.rejects.subtitle")} back={{ to: "/foundry/stock", label: t("foundry.stock.title") }} />;
  const controls = (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <SegmentedControl
          label={t("fdy2.rejects.kindLabel")}
          value={kind}
          options={[
            { value: "log", label: t("fdy2.rejects.kind.log") },
            { value: "billet", label: t("fdy2.rejects.kind.billet") },
          ]}
          onChange={(v) => set({ kind: v === "billet" ? "billet" : undefined })}
        />
        <Can do="foundry.reject">
          <Button onClick={() => setOpen(true)} data-testid="reject-open">{t("fdy2.rejects.button")}</Button>
        </Can>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label={t("fdy2.rejects.from")}>
          <TextInput type="date" value={search.from ?? ""} onChange={(e) => set({ from: e.currentTarget.value || undefined })} data-testid="rejects-from" />
        </Field>
        <Field label={t("fdy2.rejects.to")}>
          <TextInput type="date" value={search.to ?? ""} onChange={(e) => set({ to: e.currentTarget.value || undefined })} data-testid="rejects-to" />
        </Field>
      </div>
      {backwards ? <Note tone="amber" role="alert">{t("fdy2.rejects.backwards")}</Note> : null}
    </div>
  );
  if (showsQueryError(query)) return <>{header}{controls}<LoadFailed title={t("fdy2.rejects.loadFailed")} onRetry={() => void query.refetch()} /></>;
  const rows = query.data?.items ?? [];
  const totals = query.data?.totals;
  const shares = reasonShares((totals?.byReason ?? []).map((r) => ({ ...r, label: rejectReasonText(t, kind, r.code, r.label) })));
  const columns: ResponsiveListColumn<(typeof rows)[number]>[] = [
    { key: "day", header: t("fdy2.rejects.col.day"), cell: (r) => <span className="whitespace-nowrap tabular-nums">{when(r.rejectedAt)}</span> },
    { key: "cast", header: t("fdy2.rejects.col.cast"), cell: (r) => <UiLink to={`/casts/${r.castId}`} className="font-mono font-semibold">{r.castNumber}</UiLink> },
    { key: "place", header: t("fdy2.rejects.col.place"), hideOnPhone: true, cell: (r) => <span className="font-mono">{r.locationCode}</span> },
    { key: "reason", header: t("fdy2.rejects.col.reason"), phoneWide: true, cell: (r) => rejectReasonText(t, kind, r.reasonCode ?? "other", r.reasonLabel) },
    { key: "note", header: t("fdy2.rejects.col.note"), hideOnPhone: true, hideWhenEmpty: true, cell: (r) => (r.reasonNote ? <span className="break-words">{r.reasonNote}</span> : null) },
    { key: "pcs", header: t("fdy2.rejects.col.pcs"), align: "end", cell: (r) => <span className="font-mono tabular-nums">{r.pcs}</span> },
    { key: "kg", header: t("fdy2.rejects.col.kg"), align: "end", cell: (r) => <span className="font-mono tabular-nums">{t("fdy2.rejects.kgLine", { kg: kgGrouped1(fmt, r.kgG) })}</span> },
    { key: "stream", header: t("fdy2.rejects.col.stream"), hideOnPhone: true, cell: (r) => <span className="font-mono">{r.streamCode}</span> },
  ];
  return (
    <>
      {header}
      {controls}
      {totals && totals.entries > 0 ? (
        <Panel id="rejects-totals" title={t("fdy2.rejects.totals.title")} testId="rejects-totals">
          <p className="m-0 text-[15px] font-semibold tabular-nums" data-testid="rejects-sum">
            {t("fdy2.rejects.totals.sum", { entries: totals.entries, pcs: totals.pcs, kg: kgGrouped1(fmt, totals.kgG) })}
          </p>
          <ul className="m-0 flex list-none flex-col divide-y divide-border p-0">
            {shares.map((s) => (
              <li key={s.code} className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2 text-[14px]" data-reason={s.code}>
                <span className="min-w-0 break-words font-medium">{s.label}</span>
                <span className="font-mono tabular-nums">{t("fdy2.rejects.totals.line", { pcs: s.pcs, kg: kgGrouped1(fmt, s.kgG), share: (s.shareBp / 100).toFixed(0) })}</span>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
      <ResponsiveList rows={rows} columns={columns} rowKey={(r) => r.id} loading={query.isLoading} label={t(`fdy2.rejects.kind.${kind}`)} empty={<EmptyState title={t(kind === "log" ? "fdy2.rejects.emptyLog" : "fdy2.rejects.emptyBillet")} />} />
      <RejectSheet open={open} onClose={() => setOpen(false)} kind={kind} />
    </>
  );
}

function RejectSheet({ open, onClose, kind }: { open: boolean; onClose(): void; kind: RejectKind }) {
  const fmt = useFmt();
  const { t, locale } = useT();
  const queryClient = useQueryClient();
  const [d, setD] = useState(blankReject());
  const [tried, setTried] = useState(false);
  const stock = useQuery({ ...trpc.foundry.billets.stock.queryOptions(), enabled: open, meta: INLINE_ERROR_META });
  const reasons = useQuery({ ...trpc.press.reasons.queryOptions({ kind: reasonKindOf(kind) }), enabled: open });
  const streams = useQuery({ ...trpc.foundry.returnStreams.list.queryOptions(), enabled: open, meta: INLINE_ERROR_META });
  const picks = rejectPlaceOptions(kind, (stock.data?.places ?? []) as StockPlace[]);
  const rows = reasons.data ?? [];
  const options = reasonOptions(t, reasonKindOf(kind) as unknown as ReasonCodeKind, rows, locale).map((o) => ({ ...o, label: rejectReasonText(t, kind, o.value, rows.find((r) => r.code === o.value)?.label) }));
  const chargeStreams = (streams.data?.items ?? []).filter((s) => s.kind === "charge" && s.active);
  const pick = picks.find((p) => p.value === d.pick);
  const check = checkReject(d, picks, rows);
  const issue = tried && !check.ok ? check.issue : null;
  const needsNote = noteRequired(d.reasonCode, rows.find((r) => r.code === d.reasonCode)?.requiresNote);
  const key = useRequestKey();
  const post = useMutation(
    trpc.foundry.rejects.create.mutationOptions({
      onSuccess: () => {
        key.landed();
        toast.success(t("fdy2.rejects.saved"));
        void queryClient.invalidateQueries({ queryKey: trpc.foundry.rejects.pathKey() });
        void queryClient.invalidateQueries({ queryKey: trpc.foundry.billets.pathKey() });
        void queryClient.invalidateQueries({ queryKey: trpc.foundry.stock.pathKey() });
        done();
      },
    }),
  );
  const done = () => {
    setD(blankReject());
    setTried(false);
    post.reset();
    onClose();
  };
  const set = (patch: Partial<typeof d>) => setD((x) => ({ ...x, ...patch }));
  const msg = (code: string) => (issue === code ? t(`fdy2.rejects.issue.${code}`, { kg: pick ? kgGrouped1(fmt, pick.kgG) : "" }) : undefined);
  return (
    <Sheet
      open={open}
      onOpenChange={(o) => (o ? undefined : done())}
      title={t(`fdy2.rejects.sheetTitle.${kind}`)}
      footer={
        <>
          <Button variant="secondary" size="lg" onClick={done}>{t("common.cancel")}</Button>
          <Button
            size="lg"
            loading={post.isPending}
            data-testid="reject-save"
            onClick={() => {
              setTried(true);
              if (check.ok) post.mutate({ kind, ...check.input, clientRequestId: key.keyFor({ kind, ...check.input }) });
            }}
          >
            {t("fdy2.rejects.save")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 pt-1">
        {stock.data && picks.length === 0 ? <Note tone="amber">{t(kind === "log" ? "fdy2.rejects.noStockLog" : "fdy2.rejects.noStockBillet")}</Note> : null}
        <Field label={t("fdy2.rejects.pick")} hint={pick ? t("fdy2.rejects.onHand", { kg: kgGrouped1(fmt, pick.kgG), place: pick.locationCode }) : undefined} error={msg("pick")}>
          <FieldSelect value={d.pick} onChange={(e) => set({ pick: e.currentTarget.value })} data-testid="reject-pick">
            <option value="">{t("fdy2.rejects.pickNone")}</option>
            {picks.map((p) => (
              <option key={p.value} value={p.value}>{p.number} · {p.alloy} · {p.locationCode} · {t("fdy2.rejects.kgLine", { kg: kgGrouped1(fmt, p.kgG) })}</option>
            ))}
          </FieldSelect>
        </Field>
        <Field label={t("fdy2.rejects.reason")} error={msg("reason")}>
          <FieldSelect value={d.reasonCode} onChange={(e) => set({ reasonCode: e.currentTarget.value })} data-testid="reject-reason">
            <option value="">{t("fdy2.rejects.reasonNone")}</option>
            {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </FieldSelect>
        </Field>
        <Field label={needsNote ? t("fdy2.rejects.noteRequired") : t("fdy2.rejects.note")} error={msg("note")}>
          <TextInput value={d.note} maxLength={500} onChange={(e) => set({ note: e.currentTarget.value })} data-testid="reject-note" />
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={t("fdy2.rejects.pcs")} error={msg("pcs")}>
            <NumberInput value={d.pcs} onValueChange={(v) => set({ pcs: v })} decimal={false} data-testid="reject-pcs" />
          </Field>
          <Field label={t("fdy2.rejects.kg")} error={msg("kg") ?? msg("more_than_stock")}>
            <PlantInput spec={MASS_KG} value={d.kg} onValueChange={(v) => set({ kg: v })} data-testid="reject-kg" />
          </Field>
        </div>
        <Field label={t("fdy2.rejects.stream")} hint={t("fdy2.rejects.streamHint")}>
          <FieldSelect value={d.streamId} onChange={(e) => set({ streamId: e.currentTarget.value })} data-testid="reject-stream">
            <option value="">{t("fdy2.rejects.streamDefault")}</option>
            {chargeStreams.map((s) => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}
          </FieldSelect>
        </Field>
        <ErrorLine error={post.error} />
      </div>
    </Sheet>
  );
}

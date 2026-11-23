import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Field, NumberInput } from "@orrn/ui/components/field";
import { UiLink } from "@orrn/ui/components/link";
import { PageHeader } from "@orrn/ui/components/page-header";
import { ResponsiveList, type ResponsiveListColumn } from "@orrn/ui/components/responsive-list";
import { Sheet } from "@orrn/ui/components/sheet";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { Tabs } from "@orrn/ui/components/tabs";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { Can } from "@/shared/components/can";
import { PlantInput } from "@/shared/components/plant-input";
import { useCompanyWhen } from "@/features/stock/use-company-when";
import { useFmt } from "@/shared/lib/fmt";
import { cutLengthText, kgGrouped1 } from "@/shared/lib/fmt-text";
import { MASS_KG, LENGTH_MM } from "@/shared/lib/plant-input";
import { INLINE_ERROR_META, showsQueryError } from "@/shared/lib/query-errors";
import { trpc } from "@/shared/utils/trpc";

import {
  BILLET_TABS,
  blankCut,
  blankIssue,
  castsAt,
  checkCut,
  checkIssue,
  CUT_MACHINES,
  cutPreview,
  groupPlaces,
  isHomogRefusal,
  linesWithFloor,
  tabOf,
  yieldText,
  type BilletsSearch,
  type BilletTab,
  type CutDraft,
  type IssueDraft,
  type StockPlace,
} from "./billets-model";
import { useRequestKey } from "./request-key";
import { ErrorLine, FieldSelect, LoadFailed, Note, Panel } from "./ui";

/**
 * `/foundry/billets` (rows 44 and 50): billet and log stock by place (the store, the rack, one section per press
 * floor), the cutting list with its "Cut logs" sheet, and the issue list with "Issue to press". The kg is the billet ledger.
 */
export function BilletsScreen({ search, onSearch }: { search: BilletsSearch; onSearch(next: BilletsSearch): void }) {
  const { t } = useT();
  const tab = tabOf(search);
  const stock = useQuery({ ...trpc.foundry.billets.stock.queryOptions(), meta: INLINE_ERROR_META });
  const places = useQuery({ ...trpc.foundry.billets.places.queryOptions(), meta: INLINE_ERROR_META });
  const header = <PageHeader title={t("fdy2.billets.title")} subtitle={t("fdy2.billets.subtitle")} back={{ to: "/foundry/stock", label: t("foundry.stock.title") }} />;
  if (showsQueryError(stock) || showsQueryError(places)) {
    return (
      <>
        {header}
        <LoadFailed title={t("fdy2.billets.loadFailed")} onRetry={() => { void stock.refetch(); void places.refetch(); }} />
      </>
    );
  }
  if (!stock.data || !places.data) return <>{header}<Skeleton className="h-40 rounded-card" /></>;
  const stockPlaces = stock.data.places as StockPlace[];
  const lines = places.data.pressLines;
  return (
    <>
      {header}
      <Tabs
        label={t("fdy2.billets.tabs.label")}
        value={tab}
        onValueChange={(v) => onSearch(v === "stock" ? {} : { tab: v as Exclude<BilletTab, "stock"> })}
        items={BILLET_TABS.map((id) => ({ id, label: t(`fdy2.billets.tabs.${id}`) }))}
      >
        {tab === "stock" ? <StockTab places={stockPlaces} lines={lines} otherG={stock.data.otherG} /> : tab === "cut" ? <CutTab places={stockPlaces} /> : <IssueTab places={stockPlaces} lines={lines} />}
      </Tabs>
    </>
  );
}

// --- Stock ----------------------------------------------------------------------------------------------

function PlaceCard({ p }: { p: StockPlace }) {
  const fmt = useFmt();
  const { t } = useT();
  return (
    <li className="flex min-w-0 flex-col gap-2 rounded-card border border-border bg-card p-4" data-place={p.code}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="min-w-0">
          <span className="font-mono text-[16px] font-semibold">{p.code}</span>
          <span className="ml-2 text-[13px] text-muted-foreground break-words">{p.name}</span>
        </span>
        <span className="font-mono text-[16px] font-semibold tabular-nums">{t("fdy2.billets.kgLine", { kg: kgGrouped1(fmt, p.kgG) })}</span>
      </div>
      {p.casts.length === 0 ? (
        <p className="m-0 text-[13px] text-muted-foreground">{t("fdy2.billets.placeEmpty")}</p>
      ) : (
        <ul className="m-0 flex list-none flex-col divide-y divide-border p-0">
          {p.casts.map((c) => (
            <li key={c.castId} className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 py-1.5 text-[14px]" data-cast={c.number}>
              <span className="flex min-w-0 flex-wrap items-center gap-2">
                <UiLink to={`/casts/${c.castId}`} className="font-mono font-semibold">{c.number}</UiLink>
                <span className="font-mono text-muted-foreground">{c.alloy}</span>
                {c.source === "bought_in" ? <Chip tone="blue" truncate={false}>{t("fdy2.billets.boughtIn")}</Chip> : null}
              </span>
              <span className={`font-mono tabular-nums ${c.kgG < 0 ? "text-tone-red-ink" : ""}`}>{t("fdy2.billets.kgLine", { kg: kgGrouped1(fmt, c.kgG) })}</span>
            </li>
          ))}
        </ul>
      )}
      {p.casts.some((c) => c.kgG < 0) ? <Note tone="amber">{t("fdy2.billets.negative")}</Note> : null}
    </li>
  );
}

function StockTab({ places, lines, otherG }: { places: StockPlace[]; lines: { id: string; code: string; name: string; status: string }[]; otherG: number }) {
  const fmt = useFmt();
  const { t } = useT();
  const g = groupPlaces(places, lines);
  const total = places.reduce((s, p) => s + p.kgG, 0);
  const grid = "m-0 grid list-none grid-cols-1 gap-3 p-0 md:grid-cols-2";
  if (places.length === 0) {
    return <div className="rounded-card border border-dashed border-border bg-card"><EmptyState title={t("fdy2.billets.noPlaces")} /></div>;
  }
  return (
    <div className="flex min-w-0 flex-col gap-5" data-testid="billet-stock">
      <p className="m-0 text-[15px] font-semibold tabular-nums" data-testid="billet-total">{t("fdy2.billets.total", { kg: kgGrouped1(fmt, total) })}</p>
      {otherG !== 0 ? <Note tone="amber">{t("fdy2.billets.other", { kg: kgGrouped1(fmt, otherG) })}</Note> : null}
      <section aria-labelledby="bs-store" className="flex min-w-0 flex-col gap-3">
        <h2 id="bs-store" className="m-0 text-[17px] font-semibold">{t("fdy2.billets.group.store")}</h2>
        <p className="m-0 text-[13px] text-muted-foreground">{t("fdy2.billets.group.storeHint")}</p>
        {g.store.length === 0 ? <Note>{t("fdy2.billets.noStore")}</Note> : <ul className={grid}>{g.store.map((p) => <PlaceCard key={p.id} p={p} />)}</ul>}
      </section>
      <section aria-labelledby="bs-rack" className="flex min-w-0 flex-col gap-3">
        <h2 id="bs-rack" className="m-0 text-[17px] font-semibold">{t("fdy2.billets.group.rack")}</h2>
        <p className="m-0 text-[13px] text-muted-foreground">{t("fdy2.billets.group.rackHint")}</p>
        {g.rack.length === 0 ? <Note>{t("fdy2.billets.noRack")}</Note> : <ul className={grid}>{g.rack.map((p) => <PlaceCard key={p.id} p={p} />)}</ul>}
      </section>
      <section aria-labelledby="bs-floor" className="flex min-w-0 flex-col gap-3">
        <h2 id="bs-floor" className="m-0 text-[17px] font-semibold">{t("fdy2.billets.group.floor")}</h2>
        <p className="m-0 text-[13px] text-muted-foreground">{t("fdy2.billets.group.floorHint")}</p>
        {g.floors.length === 0 ? <Note>{t("fdy2.billets.noFloor")}</Note> : null}
        {g.floors.map((f) => (
          <Panel key={f.key} id={`bs-press-${f.key}`} title={f.code ? t("fdy2.billets.pressTitle", { press: f.code }) : t("fdy2.billets.pressNone")} actions={<span className="font-mono text-[15px] font-semibold tabular-nums">{t("fdy2.billets.kgLine", { kg: kgGrouped1(fmt, f.kgG) })}</span>} testId="press-floor">
            {f.places.length === 0 ? <p className="m-0 text-[14px] text-muted-foreground">{t("fdy2.billets.noFloorForPress")}</p> : <ul className={grid}>{f.places.map((p) => <PlaceCard key={p.id} p={p} />)}</ul>}
          </Panel>
        ))}
      </section>
    </div>
  );
}

// --- Cut ------------------------------------------------------------------------------------------------

function CutTab({ places }: { places: StockPlace[] }) {
  const fmt = useFmt();
  const { t } = useT();
  const when = useCompanyWhen();
  const [open, setOpen] = useState(false);
  const cuts = useQuery({ ...trpc.foundry.billets.cuts.queryOptions({ limit: 100 }), meta: INLINE_ERROR_META });
  if (showsQueryError(cuts)) return <LoadFailed title={t("fdy2.billets.cut.loadFailed")} onRetry={() => void cuts.refetch()} />;
  const rows = cuts.data?.items ?? [];
  const tot = cuts.data?.totals;
  const kg = (g: number) => kgGrouped1(fmt, g);
  const columns: ResponsiveListColumn<(typeof rows)[number]>[] = [
    { key: "at", header: t("fdy2.billets.cut.col.at"), cell: (r) => <span className="whitespace-nowrap tabular-nums">{when(r.cutAt)}</span> },
    { key: "cast", header: t("fdy2.billets.cut.col.cast"), cell: (r) => <UiLink to={`/casts/${r.castId}`} className="font-mono font-semibold">{r.castNumber}</UiLink> },
    { key: "machine", header: t("fdy2.billets.cut.col.machine"), hideOnPhone: true, cell: (r) => t(`fdy2.billets.machine.${r.machine}`) },
    { key: "logs", header: t("fdy2.billets.cut.col.logs"), align: "end", cell: (r) => <span className="font-mono tabular-nums">{t("fdy2.billets.pcsKg", { pcs: r.logPcs, kg: kg(r.logG) })}</span> },
    { key: "len", header: t("fdy2.billets.cut.col.length"), hideOnPhone: true, align: "end", cell: (r) => <span className="font-mono tabular-nums">{cutLengthText(fmt, r.billetLengthMm)}</span> },
    { key: "billets", header: t("fdy2.billets.cut.col.billets"), align: "end", cell: (r) => <span className="font-mono tabular-nums">{t("fdy2.billets.pcsKg", { pcs: r.billetPcs, kg: kg(r.billetG) })}</span> },
    { key: "end", header: t("fdy2.billets.cut.col.end"), hideOnPhone: true, align: "end", cell: (r) => <span className="font-mono tabular-nums">{t("fdy2.billets.kgLine", { kg: kg(r.endG) })}</span> },
    { key: "yield", header: t("fdy2.billets.cut.col.yield"), align: "end", cell: (r) => <span className="font-mono tabular-nums">{yieldText(r.yieldBp)} %</span> },
  ];
  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="billet-cuts">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {tot && rows.length > 0 ? (
          <p className="m-0 text-[14px] tabular-nums" data-testid="cut-totals">
            {t("fdy2.billets.cut.totals", { logs: kg(tot.logG), billets: kg(tot.billetG), end: kg(tot.endG), yield: yieldText(tot.yieldBp) })}
          </p>
        ) : <span />}
        <Can do="foundry.billets">
          <Button onClick={() => setOpen(true)} data-testid="cut-open">{t("fdy2.billets.cut.button")}</Button>
        </Can>
      </div>
      <ResponsiveList rows={rows} columns={columns} rowKey={(r) => r.id} loading={cuts.isLoading} label={t("fdy2.billets.cut.title")} empty={<EmptyState title={t("fdy2.billets.cut.empty")} />} />
      <CutSheet open={open} onClose={() => setOpen(false)} places={places} />
    </div>
  );
}

/**
 * The refusal of a write, said from the dictionary (`ErrorLine`, never the server's English). The homogenizing
 * gate adds what to do next above it.
 */
function Refusal({ error }: { error: unknown }) {
  const { t } = useT();
  if (!error) return null;
  if (isHomogRefusal((error as { message?: unknown }).message)) {
    return (
      <div className="flex flex-col gap-1" data-testid="homog-refusal">
        <Note tone="red" role="alert">{t("fdy2.billets.cut.homogNeeded")}</Note>
        <ErrorLine error={error} />
      </div>
    );
  }
  return <ErrorLine error={error} />;
}

function CutSheet({ open, onClose, places }: { open: boolean; onClose(): void; places: StockPlace[] }) {
  const fmt = useFmt();
  const { t } = useT();
  const queryClient = useQueryClient();
  const [d, setD] = useState<CutDraft>(blankCut());
  const [tried, setTried] = useState(false);
  const logs = castsAt(places, ["billet_store"]);
  const pick = logs.find((c) => c.value === d.cast);
  const check = checkCut(d, logs);
  const preview = cutPreview(d);
  const issue = tried && !check.ok ? check.issue : null;
  const key = useRequestKey();
  const post = useMutation(
    trpc.foundry.billets.cut.mutationOptions({
      onSuccess: () => {
        key.landed();
        toast.success(t("fdy2.billets.cut.saved"));
        void queryClient.invalidateQueries({ queryKey: trpc.foundry.billets.pathKey() });
        void queryClient.invalidateQueries({ queryKey: trpc.foundry.stock.pathKey() });
        done();
      },
    }),
  );
  const done = () => {
    setD(blankCut());
    setTried(false);
    post.reset();
    onClose();
  };
  const set = (patch: Partial<CutDraft>) => setD((x) => ({ ...x, ...patch }));
  const msg = (code: string) => (issue === code ? t(`fdy2.billets.cut.issue.${code}`, { kg: pick ? kgGrouped1(fmt, pick.kgG) : "", min: fmt.q("bundle.length", 100), max: fmt.q("bundle.length", 2_000) }) : undefined);
  return (
    <Sheet
      open={open}
      onOpenChange={(o) => (o ? undefined : done())}
      title={t("fdy2.billets.cut.sheetTitle")}
      footer={
        <>
          <Button variant="secondary" size="lg" onClick={done}>{t("common.cancel")}</Button>
          <Button
            size="lg"
            loading={post.isPending}
            data-testid="cut-save"
            onClick={() => {
              setTried(true);
              if (check.ok) post.mutate({ ...check.input, clientRequestId: key.keyFor(check.input) });
            }}
          >
            {t("fdy2.billets.cut.save")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 pt-1">
        {logs.length === 0 ? <Note tone="amber">{t("fdy2.billets.cut.noLogs")}</Note> : null}
        <Field label={t("fdy2.billets.cut.cast")} hint={pick ? t("fdy2.billets.cut.inStore", { kg: kgGrouped1(fmt, pick.kgG), place: pick.locationCode }) : undefined} error={msg("cast")}>
          <FieldSelect value={d.cast} onChange={(e) => set({ cast: e.currentTarget.value })} data-testid="cut-cast">
            <option value="">{t("fdy2.billets.cut.castPick")}</option>
            {logs.map((c) => (
              <option key={c.value} value={c.value}>{c.number} · {c.alloy} · {t("fdy2.billets.kgLine", { kg: kgGrouped1(fmt, c.kgG) })}</option>
            ))}
          </FieldSelect>
        </Field>
        <Field label={t("fdy2.billets.cut.machine")}>
          <FieldSelect value={d.machine} onChange={(e) => set({ machine: e.currentTarget.value as CutDraft["machine"] })} data-testid="cut-machine">
            {CUT_MACHINES.map((m) => <option key={m} value={m}>{t(`fdy2.billets.machine.${m}`)}</option>)}
          </FieldSelect>
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={t("fdy2.billets.cut.logPcs")} error={msg("logPcs")}>
            <NumberInput value={d.logPcs} onValueChange={(v) => set({ logPcs: v })} decimal={false} data-testid="cut-log-pcs" />
          </Field>
          <Field label={t("fdy2.billets.cut.logKg")} error={msg("logKg")}>
            <PlantInput spec={MASS_KG} value={d.logKg} onValueChange={(v) => set({ logKg: v })} data-testid="cut-log-kg" />
          </Field>
          <Field label={t("fdy2.billets.cut.length")} error={msg("lengthMm") ?? msg("length_range")}>
            <PlantInput spec={LENGTH_MM} value={d.lengthMm} onValueChange={(v) => set({ lengthMm: v })} data-testid="cut-length" />
          </Field>
          <span className="hidden sm:block" />
          <Field label={t("fdy2.billets.cut.billetPcs")} error={msg("billetPcs")}>
            <NumberInput value={d.billetPcs} onValueChange={(v) => set({ billetPcs: v })} decimal={false} data-testid="cut-billet-pcs" />
          </Field>
          <Field label={t("fdy2.billets.cut.billetKg")} error={msg("billetKg") ?? msg("more_out_than_in")}>
            <PlantInput spec={MASS_KG} value={d.billetKg} onValueChange={(v) => set({ billetKg: v })} data-testid="cut-billet-kg" />
          </Field>
        </div>
        {preview ? (
          <Note testId="cut-preview">{t("fdy2.billets.cut.preview", { end: kgGrouped1(fmt, preview.endG), yield: yieldText(preview.yieldBp) })}</Note>
        ) : (
          <p className="m-0 text-[13px] text-muted-foreground">{t("fdy2.billets.cut.previewHint")}</p>
        )}
        {issue === "more_than_stock" ? <Note tone="red" role="alert">{t("fdy2.billets.cut.issue.more_than_stock", { kg: pick ? kgGrouped1(fmt, pick.kgG) : "" })}</Note> : null}
        <Refusal error={post.error} />
      </div>
    </Sheet>
  );
}

// --- Issue ----------------------------------------------------------------------------------------------

function IssueTab({ places, lines }: { places: StockPlace[]; lines: { id: string; code: string; name: string; status: string }[] }) {
  const fmt = useFmt();
  const { t } = useT();
  const when = useCompanyWhen();
  const [open, setOpen] = useState(false);
  const issues = useQuery({ ...trpc.foundry.billets.issues.queryOptions({ limit: 100 }), meta: INLINE_ERROR_META });
  if (showsQueryError(issues)) return <LoadFailed title={t("fdy2.billets.issue.loadFailed")} onRetry={() => void issues.refetch()} />;
  const rows = issues.data?.items ?? [];
  const columns: ResponsiveListColumn<(typeof rows)[number]>[] = [
    { key: "at", header: t("fdy2.billets.cut.col.at"), cell: (r) => <span className="whitespace-nowrap tabular-nums">{when(r.issuedAt)}</span> },
    { key: "cast", header: t("fdy2.billets.cut.col.cast"), cell: (r) => <UiLink to={`/casts/${r.castId}`} className="font-mono font-semibold">{r.castNumber}</UiLink> },
    { key: "press", header: t("fdy2.billets.issue.col.press"), cell: (r) => <span className="font-mono">{r.pressCode}</span> },
    { key: "from", header: t("fdy2.billets.issue.col.from"), hideOnPhone: true, cell: (r) => <span className="font-mono">{r.fromCode}</span> },
    { key: "pcs", header: t("fdy2.billets.issue.col.pcs"), align: "end", cell: (r) => <span className="font-mono tabular-nums">{r.pcs}</span> },
    { key: "kg", header: t("fdy2.billets.issue.col.kg"), align: "end", cell: (r) => <span className="font-mono tabular-nums">{t("fdy2.billets.kgLine", { kg: kgGrouped1(fmt, r.kgG) })}</span> },
  ];
  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="billet-issues">
      <div className="flex justify-end">
        <Can do="foundry.billets">
          <Button onClick={() => setOpen(true)} data-testid="issue-open">{t("fdy2.billets.issue.button")}</Button>
        </Can>
      </div>
      <ResponsiveList rows={rows} columns={columns} rowKey={(r) => r.id} loading={issues.isLoading} label={t("fdy2.billets.issue.title")} empty={<EmptyState title={t("fdy2.billets.issue.empty")} />} />
      <IssueSheet open={open} onClose={() => setOpen(false)} places={places} lines={lines} />
    </div>
  );
}

function IssueSheet({ open, onClose, places, lines }: { open: boolean; onClose(): void; places: StockPlace[]; lines: { id: string; code: string; name: string; status: string }[] }) {
  const fmt = useFmt();
  const { t } = useT();
  const queryClient = useQueryClient();
  const [d, setD] = useState<IssueDraft>(blankIssue());
  const [tried, setTried] = useState(false);
  const rack = castsAt(places, ["billet_rack"]);
  const pressOptions = linesWithFloor(lines, places);
  const pick = rack.find((c) => c.value === d.cast);
  const check = checkIssue(d, rack);
  const issue = tried && !check.ok ? check.issue : null;
  const key = useRequestKey();
  const post = useMutation(
    trpc.foundry.billets.issue.mutationOptions({
      onSuccess: () => {
        key.landed();
        toast.success(t("fdy2.billets.issue.saved"));
        void queryClient.invalidateQueries({ queryKey: trpc.foundry.billets.pathKey() });
        done();
      },
    }),
  );
  const done = () => {
    setD(blankIssue());
    setTried(false);
    post.reset();
    onClose();
  };
  const set = (patch: Partial<IssueDraft>) => setD((x) => ({ ...x, ...patch }));
  const msg = (code: string) => (issue === code ? t(`fdy2.billets.issue.issue.${code}`, { kg: pick ? kgGrouped1(fmt, pick.kgG) : "" }) : undefined);
  return (
    <Sheet
      open={open}
      onOpenChange={(o) => (o ? undefined : done())}
      title={t("fdy2.billets.issue.sheetTitle")}
      footer={
        <>
          <Button variant="secondary" size="lg" onClick={done}>{t("common.cancel")}</Button>
          <Button
            size="lg"
            loading={post.isPending}
            data-testid="issue-save"
            onClick={() => {
              setTried(true);
              if (check.ok) post.mutate({ ...check.input, clientRequestId: key.keyFor(check.input) });
            }}
          >
            {t("fdy2.billets.issue.save")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 pt-1">
        {rack.length === 0 ? <Note tone="amber">{t("fdy2.billets.issue.noRack")}</Note> : null}
        {pressOptions.length === 0 ? <Note tone="amber">{t("fdy2.billets.issue.noPress")}</Note> : null}
        <Field label={t("fdy2.billets.issue.cast")} hint={pick ? t("fdy2.billets.issue.onRack", { kg: kgGrouped1(fmt, pick.kgG), place: pick.locationCode }) : undefined} error={msg("cast")}>
          <FieldSelect value={d.cast} onChange={(e) => set({ cast: e.currentTarget.value })} data-testid="issue-cast">
            <option value="">{t("fdy2.billets.issue.castPick")}</option>
            {rack.map((c) => (
              <option key={c.value} value={c.value}>{c.number} · {c.alloy} · {c.locationCode} · {t("fdy2.billets.kgLine", { kg: kgGrouped1(fmt, c.kgG) })}</option>
            ))}
          </FieldSelect>
        </Field>
        <Field label={t("fdy2.billets.issue.press")} error={msg("press")}>
          <FieldSelect value={d.pressLineId} onChange={(e) => set({ pressLineId: e.currentTarget.value })} data-testid="issue-press">
            <option value="">{t("fdy2.billets.issue.pressPick")}</option>
            {pressOptions.map((l) => <option key={l.id} value={l.id}>{l.code} · {l.name}</option>)}
          </FieldSelect>
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={t("fdy2.billets.issue.pcs")} error={msg("pcs")}>
            <NumberInput value={d.pcs} onValueChange={(v) => set({ pcs: v })} decimal={false} data-testid="issue-pcs" />
          </Field>
          <Field label={t("fdy2.billets.issue.kg")} error={msg("kg") ?? msg("more_than_stock")}>
            <PlantInput spec={MASS_KG} value={d.kg} onValueChange={(v) => set({ kg: v })} data-testid="issue-kg" />
          </Field>
        </div>
        <Refusal error={post.error} />
      </div>
    </Sheet>
  );
}


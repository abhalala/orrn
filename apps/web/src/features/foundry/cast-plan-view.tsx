import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Field, TextInput } from "@orrn/ui/components/field";
import { UiLink } from "@orrn/ui/components/link";
import { PageHeader } from "@orrn/ui/components/page-header";
import { ResponsiveList, type ResponsiveListColumn } from "@orrn/ui/components/responsive-list";
import { Sheet } from "@orrn/ui/components/sheet";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Can } from "@/shared/components/can";
import { PlantInput } from "@/shared/components/plant-input";
import { useFmt } from "@/shared/lib/fmt";
import { kgGrouped1 } from "@/shared/lib/fmt-text";
import { MASS_KG } from "@/shared/lib/plant-input";
import { INLINE_ERROR_META, showsQueryError } from "@/shared/lib/query-errors";
import { trpc } from "@/shared/utils/trpc";

import {
  acceptState,
  checkPlanDraft,
  furnaceLine,
  groupByDay,
  LINE_TONE,
  lineActions,
  planRange,
  type PlanRow,
  rangeIssue,
  type LineStatus,
  type PlanDraft,
  type PlanSearch,
} from "./cast-plan-model";
import { gToKgText } from "./melt-form";
import { todayIn } from "./melt-times";
import { useRequestKey } from "./request-key";
import { ErrorLine, LoadFailed, Note, Panel, useTimeZone } from "./ui";

/**
 * `/foundry/plan` (row 46): the casting plan for a range of plant days. The server proposes what to cast from the press
 * plans' billet need less stock and accepted lines; the person taps Accept per row. Nothing is accepted on its own.
 */
export function CastPlanScreen({ search, onSearch }: { search: PlanSearch; onSearch(next: PlanSearch): void }) {
  const fmt = useFmt();
  const { t } = useT();
  const tz = useTimeZone();
  const range = planRange(search, todayIn(tz));
  const issue = rangeIssue(range);
  const [accepting, setAccepting] = useState<PlanRowT | null>(null);
  const [editing, setEditing] = useState<PlanLineT | null>(null);
  const [dropping, setDropping] = useState<PlanLineT | null>(null);
  const query = useQuery({ ...trpc.foundry.castPlan.propose.queryOptions(range), enabled: !issue, meta: INLINE_ERROR_META });
  const kg = (g: number) => kgGrouped1(fmt, g);
  const header = <PageHeader title={t("fdy2.plan.title")} subtitle={t("fdy2.plan.subtitle")} back={{ to: "/foundry/casts", label: t("foundry.casts.title") }} />;
  const controls = (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label={t("fdy2.plan.from")}>
          <TextInput type="date" value={range.from} onChange={(e) => e.currentTarget.value && onSearch({ ...search, from: e.currentTarget.value, to: range.to })} data-testid="plan-from" />
        </Field>
        <Field label={t("fdy2.plan.to")}>
          <TextInput type="date" value={range.to} onChange={(e) => e.currentTarget.value && onSearch({ ...search, from: range.from, to: e.currentTarget.value })} data-testid="plan-to" />
        </Field>
      </div>
      {issue ? <Note tone="amber" role="alert">{t(issue === "backwards" ? "fdy2.plan.backwards" : "fdy2.plan.tooLong")}</Note> : null}
    </div>
  );
  if (issue) return <>{header}{controls}</>;
  if (showsQueryError(query)) return <>{header}{controls}<LoadFailed title={t("fdy2.plan.loadFailed")} onRetry={() => void query.refetch()} /></>;
  const data = query.data;
  const rows = data?.rows ?? [];
  const lines = data?.lines ?? [];
  const plans = data?.plans ?? [];
  const days = groupByDay(rows);

  const proposedCols: ResponsiveListColumn<PlanRowT>[] = [
    { key: "alloy", header: t("fdy2.plan.proposed.col.alloy"), cell: (r) => <span className="font-semibold">{r.alloy}</span> },
    { key: "need", header: t("fdy2.plan.proposed.col.need"), align: "end", cell: (r) => <span className="font-mono tabular-nums">{t("fdy2.plan.kgLine", { kg: kg(r.needG) })}</span> },
    { key: "covered", header: t("fdy2.plan.proposed.col.covered"), align: "end", cell: (r) => <span className="font-mono tabular-nums">{t("fdy2.plan.kgLine", { kg: kg(r.coveredG) })}</span> },
    { key: "cast", header: t("fdy2.plan.proposed.col.cast"), align: "end", cell: (r) => <span className="font-mono font-semibold tabular-nums">{t("fdy2.plan.kgLine", { kg: kg(r.castG) })}</span> },
    { key: "casts", header: t("fdy2.plan.proposed.col.casts"), align: "end", cell: (r) => <span className="font-mono tabular-nums">{r.casts}</span> },
    {
      key: "act",
      header: t("fdy2.plan.proposed.accept"),
      headerHidden: true,
      align: "end",
      cell: (r) => {
        const state = acceptState(r);
        if (state === "nothing") return <span className="text-[13px] text-muted-foreground">{t("fdy2.plan.proposed.nothing")}</span>;
        return (
          <Can do="foundry.plan">
            <div className="flex flex-col items-end gap-1">
              <Button size="sm" variant="secondary" disabled={state === "no_alloy"} onClick={() => setAccepting(r)} data-testid={`plan-accept-${r.day}-${r.alloy}`}>
                {t("fdy2.plan.proposed.accept")}
              </Button>
              {state === "no_alloy" ? <span className="text-[12px] text-tone-amber-ink">{t("fdy2.plan.proposed.noAlloy")}</span> : null}
            </div>
          </Can>
        );
      },
    },
  ];

  const lineCols: ResponsiveListColumn<PlanLineT>[] = [
    { key: "day", header: t("fdy2.plan.lines.col.day"), cell: (l) => <span className="whitespace-nowrap tabular-nums">{fmt.day(l.day)}</span> },
    { key: "alloy", header: t("fdy2.plan.lines.col.alloy"), cell: (l) => <span className="font-semibold">{l.alloy}</span> },
    {
      key: "kg",
      header: t("fdy2.plan.lines.col.kg"),
      align: "end",
      cell: (l) => (
        <span className="font-mono tabular-nums">
          {t("fdy2.plan.kgLine", { kg: kg(l.kgG) })}
          {l.proposedG !== l.kgG ? <span className="block text-[12px] text-muted-foreground">{t("fdy2.plan.lines.proposedWas", { kg: kg(l.proposedG) })}</span> : null}
        </span>
      ),
    },
    { key: "status", header: t("fdy2.plan.lines.col.status"), cell: (l) => <Chip tone={LINE_TONE[l.status as LineStatus] ?? "neutral"}>{t(`fdy2.plan.lines.status.${l.status as LineStatus}`)}</Chip> },
    { key: "note", header: t("fdy2.plan.lines.col.note"), hideOnPhone: true, hideWhenEmpty: true, cell: (l) => (l.note ? <span className="break-words">{l.note}</span> : null) },
    {
      key: "act",
      header: t("fdy2.plan.lines.col.actions"),
      headerHidden: true,
      align: "end",
      cell: (l) => <LineActions line={l} onEdit={() => setEditing(l)} onDrop={() => setDropping(l)} />,
    },
  ];

  return (
    <>
      {header}
      {controls}
      <Note testId="plan-furnace">{furnaceLine(data?.castSizeG) === "size" ? t("fdy2.plan.furnaceSize", { kg: kg(data?.castSizeG ?? 0) }) : t("fdy2.plan.furnaceNone")}</Note>
      {data?.truncated ? <Note tone="amber" role="alert" testId="plan-truncated">{t("fdy2.plan.plans.truncated")}</Note> : null}

      <Panel id="plan-proposed" title={t("fdy2.plan.proposed.title")} testId="plan-proposed">
        {query.isLoading ? (
          <ResponsiveList rows={[]} columns={proposedCols} loading label={t("fdy2.plan.proposed.title")} empty={null} />
        ) : days.length === 0 ? (
          <EmptyState title={t("fdy2.plan.proposed.empty")} />
        ) : (
          <div className="flex flex-col gap-4">
            {days.map((d) => (
              <div key={d.day} className="flex min-w-0 flex-col gap-1" data-day={d.day}>
                <h3 className="m-0 text-[15px] font-semibold tabular-nums">{fmt.day(d.day)}</h3>
                <ResponsiveList rows={d.rows} columns={proposedCols} rowKey={(r) => `${r.day}-${r.alloy}`} label={t("fdy2.plan.proposed.title")} empty={null} />
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel id="plan-plans" title={t("fdy2.plan.plans.title")} testId="plan-plans">
        {plans.length === 0 ? (
          <p className="m-0 text-[14px] text-muted-foreground">{t("fdy2.plan.plans.empty")}</p>
        ) : (
          <ul className="m-0 flex list-none flex-col divide-y divide-border p-0">
            {plans.map((p) => (
              <li key={p.id} className="flex min-w-0 flex-col gap-1 py-2 text-[14px]" data-plan={p.number}>
                <UiLink to={`/orders/plan/${p.id}`} className="break-words font-medium">
                  {t("fdy2.plan.plans.line", { number: p.number, day: fmt.day(p.day), kg: kg(p.billetKgG) })}
                </UiLink>
                {p.noAlloyG > 0 ? <Note tone="amber">{t("fdy2.plan.plans.noAlloy", { kg: kg(p.noAlloyG) })}</Note> : null}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel id="plan-lines" title={t("fdy2.plan.lines.title")} testId="plan-lines">
        <ResponsiveList rows={lines} columns={lineCols} rowKey={(l) => l.id} loading={query.isLoading} label={t("fdy2.plan.lines.title")} empty={<EmptyState title={t("fdy2.plan.lines.empty")} />} />
      </Panel>

      {data && data.totals.length > 0 ? (
        <Panel id="plan-totals" title={t("fdy2.plan.totals.title")} testId="plan-totals">
          <ul className="m-0 flex list-none flex-col divide-y divide-border p-0">
            {data.totals.map((x) => (
              <li key={x.alloy} className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2 text-[14px]" data-alloy={x.alloy}>
                <span className="font-semibold">{x.alloy}</span>
                <span className="font-mono tabular-nums">{t("fdy2.plan.totals.line", { need: kg(x.needG), covered: kg(x.coveredG), cast: kg(x.castG), casts: x.casts })}</span>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      <PlanSheet mode="accept" row={accepting} line={null} onClose={() => setAccepting(null)} />
      <PlanSheet mode="edit" row={null} line={editing} onClose={() => setEditing(null)} />
      <DropSheet line={dropping} onClose={() => setDropping(null)} />
    </>
  );
}

type PlanRowT = PlanRow;
type PlanLineT = {
  id: string;
  day: string;
  alloy: string;
  kgG: number;
  proposedG: number;
  status: string;
  castId: string | null;
  castNumber: string | null;
  note: string | null;
};

function useRefresh() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: trpc.foundry.castPlan.pathKey() });
    void queryClient.invalidateQueries({ queryKey: trpc.foundry.casts.pathKey() });
  };
}

function LineActions({ line, onEdit, onDrop }: { line: PlanLineT; onEdit(): void; onDrop(): void }) {
  const { t } = useT();
  const navigate = useNavigate();
  const refresh = useRefresh();
  const can = lineActions(line.status);
  const open = useMutation(
    trpc.foundry.castPlan.open.mutationOptions({
      onSuccess: (res) => {
        toast.success(t("fdy2.plan.accept.opened", { number: res.number }));
        refresh();
        void navigate({ to: "/casts/$id", params: { id: res.castId } });
      },
    }),
  );
  if (can.castLink && line.castId) {
    return <UiLink to={`/casts/${line.castId}`} className="font-mono font-semibold">{t("fdy2.plan.lines.cast", { number: line.castNumber ?? "" })}</UiLink>;
  }
  if (!can.edit) return null;
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap justify-end gap-2">
        <Can do="foundry.plan">
          <Button size="sm" variant="secondary" onClick={onEdit} data-testid={`plan-edit-${line.id}`}>{t("fdy2.plan.lines.edit")}</Button>
          <Button size="sm" variant="secondary" onClick={onDrop} data-testid={`plan-drop-${line.id}`}>{t("fdy2.plan.lines.drop")}</Button>
        </Can>
        <Can do="cast.enter">
          <Button size="sm" loading={open.isPending} onClick={() => open.mutate({ id: line.id })} data-testid={`plan-open-${line.id}`}>{t("fdy2.plan.lines.open")}</Button>
        </Can>
      </div>
      <ErrorLine error={open.error} />
    </div>
  );
}

/** The sheet that accepts a proposed row (weight prefilled from the row) or edits an accepted line. */
function PlanSheet({ mode, row, line, onClose }: { mode: "accept" | "edit"; row: PlanRowT | null; line: PlanLineT | null; onClose(): void }) {
  const fmt = useFmt();
  const { t } = useT();
  const refresh = useRefresh();
  const open = mode === "accept" ? row !== null : line !== null;
  const [d, setD] = useState<PlanDraft>({ kg: "", day: "", note: "" });
  const [tried, setTried] = useState(false);
  const key = mode === "accept" ? (row ? `${row.day}-${row.alloy}` : "") : (line?.id ?? "");
  useEffect(() => {
    if (mode === "accept" && row) setD({ kg: gToKgText(row.castG), day: row.day, note: "" });
    if (mode === "edit" && line) setD({ kg: gToKgText(line.kgG), day: line.day, note: line.note ?? "" });
    setTried(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const done = () => {
    post.reset();
    setTried(false);
    onClose();
  };
  const onSuccess = (message: string) => () => {
    toast.success(message);
    refresh();
    done();
  };
  const acceptKey = useRequestKey();
  const accepted = onSuccess(t("fdy2.plan.accept.saved"));
  const accept = useMutation(
    trpc.foundry.castPlan.accept.mutationOptions({
      onSuccess: () => {
        acceptKey.landed();
        accepted();
      },
    }),
  );
  const update = useMutation(trpc.foundry.castPlan.update.mutationOptions({ onSuccess: onSuccess(t("fdy2.plan.accept.updated")) }));
  const post = mode === "accept" ? accept : update;
  const check = checkPlanDraft(d);
  const issue = tried && !check.ok ? check.issue : null;
  const alloyName = (mode === "accept" ? row?.alloy : line?.alloy) ?? "";
  const submit = () => {
    setTried(true);
    if (!check.ok) return;
    if (mode === "accept" && row?.alloyId) {
      const body = { day: check.day, alloyId: row.alloyId, kgG: check.kgG, proposedG: row.castG, ...(check.note ? { note: check.note } : {}) };
      accept.mutate({ ...body, clientRequestId: acceptKey.keyFor(body) });
    }
    if (mode === "edit" && line) update.mutate({ id: line.id, kgG: check.kgG, day: check.day, ...(check.note ? { note: check.note } : {}) });
  };
  return (
    <Sheet
      open={open}
      onOpenChange={(o) => (o ? undefined : done())}
      title={mode === "accept" ? t("fdy2.plan.accept.title", { alloy: alloyName, day: fmt.day(row?.day ?? d.day) }) : t("fdy2.plan.accept.editTitle", { alloy: alloyName })}
      footer={
        <>
          <Button variant="secondary" size="lg" onClick={done}>{t("common.cancel")}</Button>
          <Button size="lg" loading={post.isPending} onClick={submit} data-testid="plan-save">
            {mode === "accept" ? t("fdy2.plan.accept.save") : t("fdy2.plan.accept.saveEdit")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 pt-1">
        <Field label={t("fdy2.plan.accept.kg")} hint={mode === "accept" && row ? t("fdy2.plan.accept.proposedHint", { kg: kgGrouped1(fmt, row.castG) }) : undefined} error={issue === "kg" ? t("fdy2.plan.accept.issue.kg") : undefined}>
          <PlantInput spec={MASS_KG} value={d.kg} onValueChange={(v) => setD((x) => ({ ...x, kg: v }))} data-testid="plan-kg" />
        </Field>
        {mode === "edit" ? (
          <Field label={t("fdy2.plan.accept.day")} error={issue === "day" ? t("fdy2.plan.accept.issue.day") : undefined}>
            <TextInput type="date" value={d.day} onChange={(e) => setD((x) => ({ ...x, day: e.currentTarget.value }))} data-testid="plan-day" />
          </Field>
        ) : null}
        <Field label={t("fdy2.plan.accept.note")}>
          <TextInput value={d.note} maxLength={300} onChange={(e) => setD((x) => ({ ...x, note: e.currentTarget.value }))} data-testid="plan-note" />
        </Field>
        <ErrorLine error={post.error} />
      </div>
    </Sheet>
  );
}

function DropSheet({ line, onClose }: { line: PlanLineT | null; onClose(): void }) {
  const { t } = useT();
  const refresh = useRefresh();
  const [note, setNote] = useState("");
  const done = () => {
    drop.reset();
    setNote("");
    onClose();
  };
  const drop = useMutation(
    trpc.foundry.castPlan.drop.mutationOptions({
      onSuccess: () => {
        toast.success(t("fdy2.plan.accept.dropped"));
        refresh();
        done();
      },
    }),
  );
  return (
    <Sheet
      open={line !== null}
      onOpenChange={(o) => (o ? undefined : done())}
      title={t("fdy2.plan.accept.dropTitle", { alloy: line?.alloy ?? "" })}
      footer={
        <>
          <Button variant="secondary" size="lg" onClick={done}>{t("common.cancel")}</Button>
          <Button size="lg" variant="danger" loading={drop.isPending} onClick={() => line && drop.mutate({ id: line.id, ...(note.trim() ? { note: note.trim() } : {}) })} data-testid="plan-drop-confirm">
            {t("fdy2.plan.accept.confirmDrop")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 pt-1">
        <Field label={t("fdy2.plan.accept.note")}>
          <TextInput value={note} maxLength={300} onChange={(e) => setNote(e.currentTarget.value)} data-testid="plan-drop-note" />
        </Field>
        <ErrorLine error={drop.error} />
      </div>
    </Sheet>
  );
}

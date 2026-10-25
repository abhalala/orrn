import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { Dialog } from "@orrn/ui/components/dialog";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Field } from "@orrn/ui/components/field";
import { FieldTextArea as TextArea } from "./textarea";
import { PageHeader } from "@orrn/ui/components/page-header";
import { Select } from "@orrn/ui/components/select";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { formatLength } from "@orrn/domain";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Can } from "@/shared/components/can";
import { useLengthUnit } from "@/shared/lib/length";
import { INLINE_ERROR_META, showsQueryError } from "@/shared/lib/query-errors";
import { isNotFound } from "@/shared/lib/session-errors";
import { trpc } from "@/shared/utils/trpc";

import { ErrorLines } from "./error-lines";
import { pressErrorText, pressErrorToast } from "./hooks";
import { JobCard } from "./job-card";
import { LateEntrySheet } from "./late-entry-sheet";
import { kgFromG, reorderTarget, splitQueue } from "./model";
import type { QueueSearch } from "./search";
import type { QueueCard, QueueLine } from "./types";

const ALL = "__all";

/**
 * `/press/lines/$id`: one press's job cards. "On the line" holds what is running, stopped or being
 * counted; "Waiting" what has not started, in running order (so the count on the board and the list
 * here can never disagree). press.queue holders reorder, mark urgent and take one cut length back.
 */
export function QueueScreen({ lineId, search, onSearch }: { lineId: string; search: QueueSearch; onSearch: (next: QueueSearch) => void }) {
  const { t } = useT();
  const { unit } = useLengthUnit();
  const qc = useQueryClient();
  const query = useQuery({
    ...trpc.press.queue.list.queryOptions({ pressLineId: lineId }),
    refetchInterval: 20_000,
    meta: INLINE_ERROR_META,
  });
  const [lateOpen, setLateOpen] = useState(false);
  const [pull, setPull] = useState<{ card: QueueCard; line: QueueLine } | null>(null);
  const [pullReason, setPullReason] = useState("");
  const [pullError, setPullError] = useState<string | null>(null);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: trpc.press.queue.list.queryKey({ pressLineId: lineId }) });
    void qc.invalidateQueries({ queryKey: trpc.press.lines.list.queryKey() });
  };
  const move = useMutation({
    ...trpc.press.queue.move.mutationOptions(),
    onSuccess: refresh,
    onError: (e) => {
      toast.error(pressErrorToast(t, e, "press.queue.moveFailed"));
      refresh();
    },
  });
  const urgent = useMutation({
    ...trpc.press.queue.urgent.mutationOptions(),
    onSuccess: refresh,
    onError: (e) => {
      toast.error(pressErrorToast(t, e, "press.queue.moveFailed"));
      refresh();
    },
  });
  const pullBack = useMutation({
    ...trpc.press.queue.pullBack.mutationOptions(),
    onSuccess: () => {
      setPull(null);
      setPullReason("");
      setPullError(null);
      refresh();
    },
    onError: (e) => setPullError(pressErrorText(t, e, "press.queue.pullBackFailed")),
  });

  const data = query.data;
  const cards = data?.cards ?? [];
  const filtered = useMemo(
    () =>
      cards.filter(
        (c) =>
          (!search.section || c.sectionId === search.section) &&
          (!search.copy || c.dieInstanceId === search.copy) &&
          (!search.order || c.lines.some((l) => l.orderId === search.order)),
      ),
    [cards, search.section, search.copy, search.order],
  );
  const { onLine, closing, waiting } = splitQueue(filtered);
  // The position among ALL waiting runs (a filter hides cards, it does not renumber the queue).
  const all = splitQueue(cards);
  const allWaiting = all.waiting;

  const sections = uniqueBy(cards, (c) => c.sectionId).map((c) => ({ value: c.sectionId, label: `${c.sectionCode} ${c.sectionName}` }));
  const orders = uniqueBy(
    cards.flatMap((c) => c.lines),
    (l) => l.orderId,
  ).map((l) => ({ value: l.orderId, label: `${l.orderNumber} ${l.customerName}` }));
  const copies = uniqueBy(
    cards.filter((c) => c.dieInstanceId && c.copyCode),
    (c) => c.dieInstanceId as string,
  ).map((c) => ({ value: c.dieInstanceId as string, label: c.copyCode as string }));
  const filtering = Boolean(search.section || search.order || search.copy);
  const fmt = (mm: number) => formatLength(mm, unit);

  const header = (
    <PageHeader
      title={data ? t("press.queue.title", { line: data.line.code }) : t("press.title")}
      subtitle={data ? data.line.name : undefined}
      back={{ to: "/press", label: t("press.title") }}
      actions={
        <>
          {data && data.line.status !== "active" ? <Chip tone="neutral">{t("press.linesPage.retired")}</Chip> : null}
          <Can do="press.close">
            <Button variant="secondary" onClick={() => setLateOpen(true)}>
              {t("press.queue.lateEntry")}
            </Button>
          </Can>
        </>
      }
    />
  );

  if (showsQueryError(query)) {
    return (
      <>
        {header}
        <div className="rounded-card border border-border bg-card">
          <EmptyState
            title={isNotFound(query.error) ? t("errors.notFoundInCompany") : t("press.queue.loadFailed")}
            action={
              <Button variant="secondary" onClick={() => void query.refetch()}>
                {t("common.retry")}
              </Button>
            }
          />
        </div>
      </>
    );
  }
  if (!data) {
    return (
      <>
        {header}
        <div aria-busy="true" className="flex flex-col gap-3">
          <span className="sr-only">{t("common.loading")}</span>
          <Skeleton className="h-40 rounded-card" />
          <Skeleton className="h-40 rounded-card" />
        </div>
      </>
    );
  }

  return (
    <>
      {header}
      <dl className="m-0 grid grid-cols-3 gap-3">
        <div className="rounded-card bg-surface-sunken px-4 py-3">
          <dt className="text-xs font-medium text-muted-foreground">{t("press.queue.onLine")}</dt>
          <dd data-testid="queue-on-line-count" className="m-0 mt-1 font-mono text-[22px] font-semibold tabular-nums">
            {all.onLine.length}
          </dd>
        </div>
        <div className="rounded-card bg-surface-sunken px-4 py-3">
          <dt className="text-xs font-medium text-muted-foreground">{t("press.queue.closing")}</dt>
          <dd data-testid="queue-closing-count" className="m-0 mt-1 font-mono text-[22px] font-semibold tabular-nums">
            {all.closing.length}
          </dd>
        </div>
        <div className="rounded-card bg-surface-sunken px-4 py-3">
          <dt className="text-xs font-medium text-muted-foreground">{t("press.queue.waiting")}</dt>
          <dd data-testid="queue-waiting-count" className="m-0 mt-1 font-mono text-[22px] font-semibold tabular-nums">
            {allWaiting.length}
          </dd>
        </div>
      </dl>

      {cards.length > 1 ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3" role="group" aria-label={t("common.filter")}>
          <Field label={t("press.queue.filterSection")}>
            <Select
              value={search.section ?? ALL}
              onValueChange={(v) => onSearch({ ...search, section: v === ALL ? undefined : v })}
              options={[{ value: ALL, label: t("press.queue.filterAll") }, ...sections]}
            />
          </Field>
          <Field label={t("press.queue.filterOrder")}>
            <Select
              value={search.order ?? ALL}
              onValueChange={(v) => onSearch({ ...search, order: v === ALL ? undefined : v })}
              options={[{ value: ALL, label: t("press.queue.filterAll") }, ...orders]}
            />
          </Field>
          <Field label={t("press.queue.filterCopy")}>
            <Select
              value={search.copy ?? ALL}
              onValueChange={(v) => onSearch({ ...search, copy: v === ALL ? undefined : v })}
              options={[{ value: ALL, label: t("press.queue.filterAll") }, ...copies]}
            />
          </Field>
        </div>
      ) : null}

      {cards.length === 0 ? (
        <div className="rounded-card border border-dashed border-border bg-card">
          <EmptyState title={t("press.queue.empty")} body={t("press.queue.emptyBody")} />
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-card border border-dashed border-border bg-card">
          <EmptyState
            title={t("press.queue.noMatch")}
            action={
              filtering ? (
                <Button variant="secondary" onClick={() => onSearch({})}>
                  {t("press.queue.filterAll")}
                </Button>
              ) : undefined
            }
          />
        </div>
      ) : (
        <>
          {onLine.length > 0 ? (
            <section aria-labelledby="queue-on-line" className="flex min-w-0 flex-col gap-3">
              <h2 id="queue-on-line" className="m-0 text-[15px] font-semibold">
                {t("press.queue.onLine")}
              </h2>
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                {onLine.map((card) => (
                  <JobCard key={card.id} card={card} formatLength={fmt} position={null} waitingCount={allWaiting.length} />
                ))}
              </div>
            </section>
          ) : null}
          {closing.length > 0 ? (
            <section aria-labelledby="queue-closing" className="flex min-w-0 flex-col gap-3">
              <h2 id="queue-closing" className="m-0 text-[15px] font-semibold">
                {t("press.queue.closing")}
              </h2>
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                {closing.map((card) => (
                  <JobCard key={card.id} card={card} formatLength={fmt} position={null} waitingCount={allWaiting.length} />
                ))}
              </div>
            </section>
          ) : null}
          {waiting.length > 0 ? (
            <section aria-labelledby="queue-waiting" className="flex min-w-0 flex-col gap-3">
              <h2 id="queue-waiting" className="m-0 text-[15px] font-semibold">
                {t("press.queue.waiting")}
              </h2>
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                {waiting.map((card) => {
                  const position = allWaiting.findIndex((c) => c.id === card.id) + 1;
                  return (
                    <JobCard
                      key={card.id}
                      card={card}
                      formatLength={fmt}
                      position={position}
                      waitingCount={allWaiting.length}
                      busy={move.isPending || urgent.isPending}
                      onMove={(dir) => {
                        const to = reorderTarget(allWaiting, card.id, dir);
                        if (to !== null) move.mutate({ runId: card.id, toIndex: to });
                      }}
                      onUrgent={(value) => urgent.mutate({ runId: card.id, urgent: value })}
                      onPullBack={(line) => {
                        setPullError(null);
                        setPull({ card, line });
                      }}
                    />
                  );
                })}
              </div>
            </section>
          ) : null}
        </>
      )}

      <LateEntrySheet open={lateOpen} onOpenChange={setLateOpen} pressLineId={lineId} queued={allWaiting} />

      <Dialog
        open={pull !== null}
        onOpenChange={(open) => {
          if (!open) setPull(null);
        }}
        title={t("press.queue.pullBackTitle")}
        description={
          pull
            ? t("press.queue.pullBackBody", {
                order: pull.line.orderNumber,
                length: fmt(pull.line.cutLengthMm),
                pcs: pull.line.pcs,
                kg: kgFromG(pull.line.kgG),
              })
            : undefined
        }
        actions={
          <>
            <Button variant="secondary" onClick={() => setPull(null)}>
              {t("common.cancel")}
            </Button>
            <Button
              disabled={pullBack.isPending}
              onClick={() => pull && pullBack.mutate({ pressPlanLineId: pull.line.id, reason: pullReason.trim() || undefined })}
            >
              {t("press.queue.pullBackConfirm")}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <Field label={t("press.queue.pullBackReason")}>
            <TextArea value={pullReason} onChangeText={setPullReason} rows={2} maxLength={500} />
          </Field>
          {pullError ? <ErrorLines message={pullError} className="m-0 text-[14px] font-medium text-destructive" /> : null}
        </div>
      </Dialog>
    </>
  );
}

function uniqueBy<T>(items: readonly T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const k = key(item);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out;
}

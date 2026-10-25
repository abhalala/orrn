/**
 * Review one approval request: what it is, who asked and why, the figures an
 * approver needs (a D/C note shows the lot's two kantas, the short, the
 * tolerance and whether the notes cover it, from `purchase.dcNotes.get`, which
 * only purchase readers may call), and Approve / Reject. Reject asks for a
 * reason so the requester can fix it. Nobody decides their own request.
 */
import { useT } from "@orrn/i18n";
import type { AppRouter } from "@orrn/server/routers/index";
import { Button } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { Field, TextInput } from "@orrn/ui/components/field";
import { UiLink } from "@orrn/ui/components/link";
import { Sheet } from "@orrn/ui/components/sheet";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { cn } from "@orrn/ui/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import { AlertTriangle } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { serverRefusal } from "@/features/shared/server-refusal";
import { reasonLabel } from "@/features/press/reason-label";
import { canAny, useMe } from "@/shared/lib/me";
import { useCompanyTimeZone } from "@/features/dispatch/hooks";
import { trpc } from "@/shared/utils/trpc";

import { isStaleRefusal } from "../purchase/errors";
import { kgText, pctText } from "../purchase/format";
import { formatRate, weightNotesOverShortG } from "../purchase/lot-view";
import { showsQueryError } from "../purchase/query-state";
import {
  APPROVAL_TONE,
  PURCHASE_READERS,
  approvalSubject,
  canOpenSubject,
  decideState,
  durationText,
  hasLiveFacts,
  lateEntryOf,
  lateWindowText,
  plantTimeText,
  moveEndText,
  moveFactsView,
  moveKgText,
  reallocateMoveOf,
  subjectCodes,
  tierFactsView,
  unbrokenCodes,
  type LateEntryView,
  type ReallocateView,
} from "./approval-view";

export type ApprovalItem = inferRouterOutputs<AppRouter>["approval"]["list"]["items"][number];

export function ReviewSheet({ item, onOpenChange }: { item: ApprovalItem | null; onOpenChange(open: boolean): void }) {
  const { t } = useT();
  const { data: me } = useMe();
  const queryClient = useQueryClient();
  const [note, setNote] = useState("");
  const [rejectTried, setRejectTried] = useState(false);
  // Keep the last item while the sheet animates closed.
  const [shown, setShown] = useState<ApprovalItem | null>(item);
  useEffect(() => {
    if (item) {
      setShown(item);
      setNote("");
      setRejectTried(false);
    }
  }, [item]);

  const open = item !== null;
  const current = item ?? shown;
  const state = current ? decideState(me, current) : "view";
  const subject = current ? approvalSubject(current, { plant: t("approvals.move.plant"), mainBand: t("approvals.band.main"), otherBand: t("approvals.band.other") }) : null;
  // BACKLOG 34: a move request shows what moves, from where to where, before anyone decides.
  const move = current?.kind === "order_reallocate" ? reallocateMoveOf(current.meta) : null;
  const readsFigures = canAny(me, PURCHASE_READERS);
  const isNote = current?.kind === "dc_note";
  // H1: a late entry shows the run (press, copy, the typed start and stop, kg in and good) before anyone decides.
  const late = current?.kind === "press_late_entry" ? lateEntryOf(current) : null;
  const lateRun = useQuery({
    ...trpc.press.runs.get.queryOptions({ id: late?.runId ?? "" }),
    enabled: open && late !== null && late.runId !== null,
  });

  // BACKLOG 89: a move and a tier change read what is true now before Approve opens.
  const liveKind = current !== null && hasLiveFacts(current.kind);
  const facts = useQuery({
    ...trpc.approval.facts.queryOptions({ id: current?.id ?? "" }),
    enabled: open && liveKind,
  });

  const figures = useQuery({
    ...trpc.purchase.dcNotes.get.queryOptions({ id: current?.subjectId ?? "" }),
    enabled: open && isNote && readsFigures,
  });

  const decide = useMutation(
    trpc.approval.decide.mutationOptions({
      onSuccess: async (res) => {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: trpc.approval.pathKey() }),
          queryClient.invalidateQueries({ queryKey: trpc.purchase.pathKey() }),
          queryClient.invalidateQueries({ queryKey: trpc.press.pathKey() }),
        ]);
        toast.success(res.status === "approved" ? t("approvals.approved") : t("approvals.rejected"));
        onOpenChange(false);
      },
      onError: (e) => {
        toast.error(serverRefusal(t, e));
        // "This request was already decided" (another approver won), "the lot changed": show what is true now.
        if (isStaleRefusal(e)) {
          void Promise.all([
            queryClient.invalidateQueries({ queryKey: trpc.approval.pathKey() }),
            queryClient.invalidateQueries({ queryKey: trpc.purchase.pathKey() }),
          ]);
          onOpenChange(false);
        }
      },
    }),
  );

  if (!current || !subject) {
    return <Sheet open={false} onOpenChange={onOpenChange} title={t("approvals.title")}>{null}</Sheet>;
  }

  const title = unbrokenCodes(t(subject.titleKey, subject.vars) || t(subject.kindKey), subjectCodes(subject));
  const rejectError = rejectTried && note.trim() === "" ? t("approvals.rejectNeedsNote") : undefined;
  // Nobody approves a D/C note without its figures on screen; Reject stays open (it needs a reason anyway).
  // Nor a late entry without its run on screen.
  const figuresMissing =
    (isNote && readsFigures && !figures.data) || (late !== null && late.runId !== null && !lateRun.data) || (liveKind && facts.data === undefined);
  const canOpen = subject.href !== null && subject.openKey !== null && canOpenSubject(me, current);

  const footer =
    state === "decide" ? (
      <CanDecide item={current}>
        <Button
          size="lg"
          variant="danger"
          loading={decide.isPending && decide.variables?.decision === "rejected"}
          disabled={decide.isPending}
          onClick={() => {
            setRejectTried(true);
            if (note.trim() === "") return;
            decide.mutate({ id: current.id, decision: "rejected", note: note.trim() });
          }}
        >
          {t("approvals.reject")}
        </Button>
        <Button
          size="lg"
          loading={decide.isPending && decide.variables?.decision === "approved"}
          disabled={decide.isPending || figuresMissing}
          onClick={() => decide.mutate({ id: current.id, decision: "approved", ...(note.trim() ? { note: note.trim() } : {}) })}
        >
          {t("approvals.approve")}
        </Button>
      </CanDecide>
    ) : undefined;

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={title} footer={footer}>
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center gap-2">
          <Chip tone={APPROVAL_TONE[current.status]}>{t(`status.request.${current.status}`)}</Chip>
          <span className="text-[14px] text-muted-foreground">
            {t("approvals.askedBy", { name: current.requestedByName ?? t("approvals.someone") })}
          </span>
        </div>

        {current.requestNote ? (
          <Block title={t("approvals.theirNote")}>
            <p className="m-0 rounded-input bg-surface-sunken px-3 py-2 text-[15px] break-words">{current.requestNote}</p>
          </Block>
        ) : null}

        {liveKind ? <LiveFacts data={facts.data} loading={facts.isLoading} error={showsQueryError(facts)} /> : null}

        {move ? <MoveFigures move={move} /> : null}

        {late ? <LateEntryFigures late={late} run={lateRun.data} loading={lateRun.isLoading} error={showsQueryError(lateRun)} /> : null}

        {isNote ? (
          readsFigures ? (
            <NoteFigures data={figures.data} loading={figures.isLoading} error={showsQueryError(figures)} />
          ) : (
            <p className="m-0 text-[14px] text-muted-foreground">{t("approvals.figuresHidden")}</p>
          )
        ) : null}

        {canOpen ? (
          <UiLink
            to={subject.href!}
            className="inline-flex min-h-11 items-center self-start rounded-full border border-border bg-card px-5 text-[15px] font-semibold text-foreground no-underline hover:bg-surface-sunken"
          >
            {t(subject.openKey!)}
          </UiLink>
        ) : null}

        {current.status !== "pending" ? (
          <Block title={t("approvals.decisionNote")}>
            <p className="m-0 text-[15px] break-words">
              {t("approvals.decidedBy", {
                status: t(`status.request.${current.status}`),
                name: current.decidedByName ?? t("approvals.someone"),
              })}
              {current.note ? `: ${current.note}` : ""}
            </p>
          </Block>
        ) : state === "decide" ? (
          <Field label={t("approvals.note")} hint={t("approvals.noteHint")} error={rejectError}>
            <TextInput value={note} onChangeText={setNote} maxLength={500} />
          </Field>
        ) : (
          <p role="status" className="m-0 rounded-card border border-border bg-surface-sunken px-4 py-3 text-[15px]">
            {state === "own" ? t("approvals.own") : t("approvals.viewOnly")}
          </p>
        )}
      </div>
    </Sheet>
  );
}

/**
 * `<Can>` for decisions: approving follows the approver roles of the request's kind
 * (APPROVER_ROLES, not an action), and nobody decides their own request. The server
 * (`approval.decide`) is still authoritative.
 */
export function CanDecide({ item, children }: { item: ApprovalItem; children: ReactNode }) {
  const { data: me } = useMe();
  return decideState(me, item) === "decide" ? <>{children}</> : null;
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="m-0 text-[14px] font-semibold">{title}</h3>
      {children}
    </section>
  );
}

/** The bundles of a move request: count and kg, from and to, each bundle's serial and kg, the reason code. */
function MoveFigures({ move }: { move: ReallocateView }) {
  const { t } = useT();
  const plant = t("approvals.move.plant");
  const endText = (end: ReallocateView["to"]) => (end ? t("approvals.move.line", { party: end.customerName, order: end.orderNumber, line: end.lineNo }) : plant);
  const rows: [string, ReactNode][] = [
    [t("approvals.move.bundles"), t("approvals.move.count", { count: move.count, kg: moveKgText(move.kgG) })],
    [t("approvals.move.from"), move.from.map(endText).join(", ") || plant],
    [t("approvals.move.to"), endText(move.to)],
  ];
  if (move.reasonCode) rows.push([t("approvals.move.reason"), reasonLabel(t, "reallocate", move.reasonCode, move.reasonCode)]);
  return (
    <Block title={t("approvals.move.title")}>
      <dl className="m-0 flex flex-col divide-y divide-border rounded-card border border-border px-4" data-testid="move-summary">
        {rows.map(([label, value]) => (
          <div key={label} className="flex min-h-11 flex-wrap items-baseline justify-between gap-x-4 py-2 text-[15px]">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="m-0 min-w-0 text-right font-medium break-words">{value}</dd>
          </div>
        ))}
      </dl>
      {move.bundles.length > 0 ? (
        <ul className="m-0 flex list-none flex-col gap-1 p-0" data-testid="move-bundles" aria-label={t("approvals.move.bundles")}>
          {move.bundles.map((b) => (
            <li key={b.serial} className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 text-[14px]">
              <span className="font-mono font-semibold">{b.serial}</span>
              <span className="min-w-0 flex-1 text-muted-foreground break-words">{moveEndText(b.from, plant)}</span>
              <span className="font-mono">{moveKgText(b.weightG)} kg</span>
            </li>
          ))}
        </ul>
      ) : null}
    </Block>
  );
}

type FactsData = inferRouterOutputs<AppRouter>["approval"]["facts"];

function Rows({ rows, testId }: { rows: [string, ReactNode][]; testId: string }) {
  return (
    <dl className="m-0 flex flex-col divide-y divide-border rounded-card border border-border px-4" data-testid={testId}>
      {rows.map(([label, value]) => (
        <div key={label} className="flex min-h-11 flex-wrap items-baseline justify-between gap-x-4 py-2 text-[15px]">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="m-0 min-w-0 text-right font-medium break-words">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Owner tour (BACKLOG 89): the live facts first, the request's own copy below. A move shows where each bundle
 * is now, who would move and who takes a new party number; a tier change shows the copy now, the ask and the
 * last reading against the band. Approve waits for this (the sheet disables it until the facts load).
 */
function LiveFacts({ data, loading, error }: { data: FactsData | undefined; loading: boolean; error: boolean }) {
  const { t } = useT();
  const tz = useCompanyTimeZone();
  if (loading || data === undefined) {
    return error ? (
      <p className="m-0 text-[14px] text-destructive">{t("approvals.facts.error")}</p>
    ) : (
      <div aria-busy="true" className="flex flex-col gap-2">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-5 w-full" />
        ))}
      </div>
    );
  }
  if (data === null) return null;
  if (data.kind === "order_reallocate") {
    const v = moveFactsView(data);
    return (
      <Block title={t("approvals.facts.moveTitle")}>
        <p className="m-0 text-[15px] font-medium" data-testid="live-move-count">
          {t("approvals.facts.moveCount", { count: v.moving, total: v.total, kg: moveKgText(data.willMove.kgG) })}
        </p>
        {v.closed ? <p className="m-0 text-[14px] text-destructive">{t("approvals.facts.closed")}</p> : null}
        {v.skipped > 0 && !v.closed ? <p className="m-0 text-[14px] text-destructive">{t("approvals.facts.skipped", { count: v.skipped })}</p> : null}
        {v.moving > 0 ? (
          <p className="m-0 text-[14px] text-muted-foreground">
            {t(v.partyRule === "series" ? "approvals.facts.partySeries" : "approvals.facts.partySerial", { customer: v.customer })}
          </p>
        ) : null}
        <ul className="m-0 flex list-none flex-col gap-1 p-0" data-testid="live-move-bundles" aria-label={t("approvals.move.bundles")}>
          {v.rows.map((b) => (
            <li key={b.serial} data-will-move={b.willMove ? "yes" : "no"} className={cn("flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 text-[14px]", !b.willMove && "text-muted-foreground")}>
              <span className="font-mono font-semibold">{b.serial}</span>
              <span className="min-w-0 flex-1 break-words text-muted-foreground">{t("approvals.facts.partyNow", { number: b.partyNo })}</span>
              {b.newNumber ? <Chip tone="amber">{t("approvals.facts.newNumber")}</Chip> : null}
              {!b.willMove ? <Chip tone="red">{t("approvals.facts.stays")}</Chip> : null}
              <span className="font-mono">{moveKgText(b.weightG)} kg</span>
            </li>
          ))}
        </ul>
      </Block>
    );
  }
  const v = tierFactsView(data, { mainBand: t("approvals.band.main") });
  const rows: [string, ReactNode][] = [[t("approvals.facts.copy"), v.code]];
  rows.push([
    t("approvals.facts.tier"),
    v.tierChanges
      ? t("approvals.facts.tierValue", { from: v.askedFromTier ?? t("approvals.facts.tierNone"), to: v.askedToTier })
      : (v.nowTier ?? t("approvals.facts.tierNone")),
  ]);
  rows.push([
    t("approvals.facts.band"),
    v.bandChange ? t("approvals.facts.bandValue", { from: v.bandChange.from, to: v.bandChange.to }) : t("approvals.facts.bandNow", { band: v.nowBand }),
  ]);
  rows.push([
    t("approvals.facts.reading"),
    v.readingKg === null || v.readAt === null
      ? t("approvals.facts.readingNone")
      : `${t("approvals.facts.readingValue", { kg: v.readingKg, when: plantTimeText(v.readAt, tz) })}${v.position ? `, ${t(`approvals.facts.${v.position}`)}` : ""}`,
  ]);
  return (
    <Block title={t("approvals.facts.tierTitle")}>
      <Rows rows={rows} testId="live-tier" />
      {v.changedSince ? (
        <p className="m-0 text-[14px] text-destructive" data-testid="tier-changed-since">
          {t("approvals.facts.changedSince", { tier: v.nowTier ?? t("approvals.facts.tierNone"), band: v.nowBand })}
        </p>
      ) : null}
    </Block>
  );
}

type RunData = inferRouterOutputs<AppRouter>["press"]["runs"]["get"];

const KG3 = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 3, maximumFractionDigits: 3 });

/**
 * H1 (final explore): what a late entry asks to accept. Round 1 (m1): the live run comes first (that is what
 * Approve accepts: times, press, copy, day and shift, kg in and good); the request's own copy fills in only
 * while the run loads, and a note says so when the request asked for other times. Times are in the plant's time zone.
 */
function LateEntryFigures({ late, run, loading, error }: { late: LateEntryView; run: RunData | undefined; loading: boolean; error: boolean }) {
  const { t } = useT();
  const tz = useCompanyTimeZone();
  const ms = (v: string | number | Date | null | undefined) => (v ? new Date(v).getTime() : null);
  const startedAt = ms(run?.run.startedAt) ?? late.startedAt;
  const stoppedAt = ms(run?.run.stoppedAt) ?? late.stoppedAt;
  const lineCode = run?.line?.code ?? late.pressLineCode ?? null;
  const copyCode = run?.copy?.code ?? late.copyCode ?? null;
  const day = run?.run.productionDay ?? late.productionDay ?? null;
  const shift = run?.run.productionDay ? (run.run.shiftSeq ?? null) : late.shiftSeq;
  const askedDiffers =
    run !== undefined && late.startedAt !== null && late.stoppedAt !== null && (late.startedAt !== ms(run.run.startedAt) || late.stoppedAt !== ms(run.run.stoppedAt));
  const figures = run?.figures;
  const counted = figures !== undefined && figures.inputG > 0;
  const kg = (g: number) => `${KG3.format(g / 1000)} kg`;
  const pending = loading ? <Skeleton className="h-5 w-24" /> : "-";
  const rows: [string, ReactNode, string][] = [
    [t("approvals.late.run"), run?.run.number || late.runNumber || "-", "run"],
    [t("approvals.late.line"), lineCode ?? "-", "line"],
  ];
  if (run?.run.sectionCode) rows.push([t("approvals.late.die"), `${run.run.sectionCode}${run.run.sectionName ? ` ${run.run.sectionName}` : ""}`, "die"]);
  rows.push([t("approvals.late.copy"), copyCode ?? "-", "copy"]);
  if (startedAt !== null && stoppedAt !== null) {
    rows.push([t("approvals.late.times"), lateWindowText(startedAt, stoppedAt, tz), "times"]);
    rows.push([t("approvals.late.duration"), durationText(startedAt, stoppedAt), "duration"]);
  }
  if (day) rows.push([t("approvals.late.shift"), shift !== null ? t("approvals.late.shiftValue", { day, shift }) : day, "shift"]);
  rows.push([t("approvals.late.kgIn"), figures ? (counted ? kg(figures.inputG) : t("approvals.late.notCounted")) : pending, "kg-in"]);
  rows.push([t("approvals.late.good"), figures ? (figures.goodG > 0 ? kg(figures.goodG) : t("approvals.late.notCounted")) : pending, "good"]);
  if (figures && counted && figures.recoveryPct) rows.push([t("approvals.late.recovery"), `${figures.recoveryPct}%`, "recovery"]);
  return (
    <Block title={t("approvals.late.title")}>
      <dl className="m-0 flex flex-col divide-y divide-border rounded-card border border-border px-4" data-testid="late-entry-summary">
        {rows.map(([label, value, key]) => (
          <div key={key} data-row={key} className="flex min-h-11 flex-wrap items-baseline justify-between gap-x-4 py-2 text-[15px]">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="m-0 min-w-0 text-right font-medium break-words">{value}</dd>
          </div>
        ))}
      </dl>
      {askedDiffers ? (
        <p className="m-0 text-[14px] text-muted-foreground" data-testid="late-entry-differs">
          {t("approvals.late.changed", { times: lateWindowText(late.startedAt!, late.stoppedAt!, tz) })}
        </p>
      ) : null}
      {error ? <p className="m-0 text-[14px] text-destructive">{t("approvals.late.runError")}</p> : null}
    </Block>
  );
}

type NoteData = inferRouterOutputs<AppRouter>["purchase"]["dcNotes"]["get"];

function NoteFigures({ data, loading, error }: { data: NoteData | undefined; loading: boolean; error: boolean }) {
  const { t } = useT();
  if (loading) {
    return (
      <div aria-busy="true" className="flex flex-col gap-2">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-5 w-full" />
        ))}
      </div>
    );
  }
  if (error || !data) return <p className="m-0 text-[14px] text-destructive">{t("approvals.error")}</p>;
  const { note, lot } = data;
  const pct = pctText(data.toleranceBp);
  const weightDebit = note.type === "debit" && note.reason === "weight";
  // Live weight notes (this one included while it is live) beyond the whole short: almost always a typo.
  const overG = weightDebit && note.status !== "rejected" ? weightNotesOverShortG(data.shortG, data.weightNoteKgG) : 0;
  const othersLive = data.otherNotes.some(
    (n) => n.type === "debit" && n.reason === "weight" && (n.status === "pending" || n.status === "approved"),
  );
  const rows: [string, ReactNode][] = [
    [t("approvals.party"), `${kgText(lot.partyKgG)} kg`],
    [t("approvals.ours"), lot.fcKgG === null ? "-" : `${kgText(lot.fcKgG)} kg`],
    [t("approvals.short"), data.shortG === null ? "-" : `${kgText(Math.max(0, data.shortG))} kg`],
    [t("approvals.tolerance"), `${kgText(data.toleranceG)} kg (${pct})`],
    [t("approvals.kgDiff"), `${kgText(note.kgDiffG)} kg`],
    [t("approvals.bori"), `${kgText(note.boriDeductionG)} kg`],
    [
      t("approvals.rate"),
      <>
        {formatRate(lot.ratePaise)} <span className="font-sans">{t("purchase.detail.perKgUnit")}</span>
      </>,
    ],
    [t("approvals.amount"), formatRate(note.amountPaise)],
  ];
  return (
    <Block title={t("approvals.figures")}>
      <dl className="m-0 flex flex-col divide-y divide-border rounded-card border border-border px-4">
        {rows.map(([label, value]) => (
          <div key={label} className="flex min-h-11 flex-wrap items-baseline justify-between gap-x-4 py-2 text-[15px]">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="m-0 font-mono font-medium">{value}</dd>
          </div>
        ))}
      </dl>
      {overG > 0 ? (
        <p
          data-testid="note-over-short"
          className="m-0 flex items-start gap-2 rounded-input bg-tone-red-tint px-3 py-2 text-[14px] font-semibold text-tone-red-ink"
        >
          <AlertTriangle aria-hidden="true" strokeWidth={2} className="mt-0.5 size-4 shrink-0" />
          <span className="min-w-0 break-words">
            {othersLive ? t("approvals.overShortWithOthers", { kg: kgText(overG) }) : t("approvals.overShort", { kg: kgText(overG) })}
          </span>
        </p>
      ) : weightDebit && data.shortBeyondTolerance ? (
        <p
          className={cn(
            "m-0 rounded-input px-3 py-2 text-[14px] font-semibold",
            data.noteCoversShort ? "bg-tone-green-tint text-tone-green-ink" : "bg-tone-red-tint text-tone-red-ink",
          )}
        >
          {data.noteCoversShort ? t("approvals.covers", { pct }) : t("approvals.notCovers", { pct })}
        </p>
      ) : null}
      {data.otherNotes.length > 0 ? (
        <div className="flex flex-col gap-1.5 pt-1">
          <h4 className="m-0 text-[14px] font-semibold">{t("approvals.otherNotes")}</h4>
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {data.otherNotes.map((n) => (
              <li key={n.id} className="flex flex-wrap items-center gap-2 text-[14px]">
                <span className="font-mono font-semibold">{n.number}</span>
                <span>{t(`purchase.detail.noteType.${n.type}`)}</span>
                <span className="font-mono text-muted-foreground">{kgText(n.kgDiffG)} kg</span>
                <Chip tone={APPROVAL_TONE[n.status]}>{t(`status.request.${n.status}`)}</Chip>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Block>
  );
}

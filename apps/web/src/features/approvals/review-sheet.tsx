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

import { reasonLabel } from "@/features/press/reason-label";
import { canAny, useMe } from "@/shared/lib/me";
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
  moveEndText,
  moveKgText,
  reallocateMoveOf,
  subjectCodes,
  unbrokenCodes,
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
  const subject = current ? approvalSubject(current, { plant: t("approvals.move.plant") }) : null;
  // BACKLOG 34: a move request shows what moves, from where to where, before anyone decides.
  const move = current?.kind === "order_reallocate" ? reallocateMoveOf(current.meta) : null;
  const readsFigures = canAny(me, PURCHASE_READERS);
  const isNote = current?.kind === "dc_note";

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
        ]);
        toast.success(res.status === "approved" ? t("approvals.approved") : t("approvals.rejected"));
        onOpenChange(false);
      },
      onError: (e) => {
        toast.error(e.message);
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
  const figuresMissing = isNote && readsFigures && !figures.data;
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

        {move ? <MoveFigures move={move} /> : null}

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

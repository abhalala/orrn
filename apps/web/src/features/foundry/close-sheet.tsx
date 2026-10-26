import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Field, NumberInput } from "@orrn/ui/components/field";
import { Sheet } from "@orrn/ui/components/sheet";
import type { AppRouter } from "@orrn/server/routers/index";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { FieldTextArea } from "@/features/catalog/field-text-area";
import { kgFromG } from "@/features/press/model";
import { reasonOptions } from "@/features/press/reason-label";
import { useOnceMutation } from "@/shared/lib/once-mutation";
import { trpc } from "@/shared/utils/trpc";

import { INLINE_ERROR_META } from "@/shared/lib/query-errors";

import { bpText, closeFormIssue, countedBillets, countKey } from "./model";
import { ErrorLine, Note, FieldSelect } from "./ui";

type CastData = inferRouterOutputs<AppRouter>["foundry"]["casts"]["get"];

function useRefreshCast() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: trpc.foundry.casts.pathKey() });
    void queryClient.invalidateQueries({ queryKey: trpc.foundry.stock.pathKey() });
    void queryClient.invalidateQueries({ queryKey: trpc.approval.pathKey() });
  };
}

/**
 * Close a cast (FP-FD-14, Q59-A): the closer counts the billets of the cast still in the yard (pieces
 * and kg). The server works the tail out from the ledger and the count (`closePreview`, then
 * `close`); a tail needs a `cast_tail` reason from the plant's own list, a large one or billets short
 * goes to a second person, and the ledger moves to the count when the close lands.
 */
export function CloseCastSheet({ open, onClose, cast }: { open: boolean; onClose(): void; cast: CastData }) {
  const { t, locale } = useT();
  const refresh = useRefreshCast();
  const co = cast.closeout;
  const reasons = useQuery({ ...trpc.press.reasons.queryOptions({ kind: "cast_tail" }), enabled: open });
  const options = reasonOptions(t, "cast_tail", reasons.data, locale);
  const [pcs, setPcs] = useState("");
  const [kg, setKg] = useState("");
  const [reasonCode, setReasonCode] = useState("");
  const [note, setNote] = useState("");
  const [tried, setTried] = useState(false);
  const requestId = useRef(crypto.randomUUID());
  const count = countedBillets(pcs, kg);
  // The server is asked once the count stops changing (300 ms), not on every keystroke; the figures
  // shown stay until the new answer lands, and Confirm waits for an answer to the count on screen.
  const key = countKey(count);
  const [settled, setSettled] = useState({ key: "", billetsOnHand: { count: 0, kgG: 0 } });
  useEffect(() => {
    const timer = setTimeout(() => setSettled({ key, billetsOnHand: count.ok ? count.billetsOnHand : { count: 0, kgG: 0 } }), key === "" ? 0 : 300);
    return () => clearTimeout(timer);
    // `count` is a function of `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const preview = useQuery({
    ...trpc.foundry.casts.closePreview.queryOptions({ castId: cast.cast.id, billetsOnHand: settled.billetsOnHand }),
    enabled: open && settled.key !== "",
    placeholderData: keepPreviousData,
    meta: INLINE_ERROR_META,
  });
  const p = count.ok ? preview.data : undefined;
  // The answer in `p` is for the count on screen only when it settled, finished loading, and is the same count.
  const checking = count.ok && (settled.key !== key || preview.isFetching || preview.isPlaceholderData);
  const close = useOnceMutation(
    trpc.foundry.casts.close.mutationOptions({
      onSuccess: (res) => {
        toast.success(res.status === "closing" ? t("foundry.cast.close.sent", { number: res.number }) : t("foundry.cast.close.closed", { number: res.number }));
        refresh();
        done();
      },
    }),
  );
  useEffect(() => {
    if (open) requestId.current = crypto.randomUUID();
  }, [open]);
  const done = () => {
    setPcs("");
    setKg("");
    setReasonCode("");
    setNote("");
    setTried(false);
    setSettled({ key: "", billetsOnHand: { count: 0, kgG: 0 } });
    close.reset();
    onClose();
  };
  const issue = p ? closeFormIssue(p, { reasonCode, note }, reasons.data ?? []) : null;
  const row = reasons.data?.find((r) => r.code === reasonCode);
  const countError = tried && !count.ok ? count.issue : null;
  return (
    <Sheet
      open={open}
      onOpenChange={(o) => (o ? undefined : done())}
      title={t("foundry.cast.close.title", { number: cast.cast.number })}
      footer={
        <>
          <Button variant="secondary" size="lg" onClick={done}>
            {t("common.cancel")}
          </Button>
          <Button
            size="lg"
            loading={close.isPending || checking}
            data-testid="close-confirm"
            onClick={() => {
              setTried(true);
              if (!count.ok || !p || issue || checking) return;
              close.mutate({ castId: cast.cast.id, billetsOnHand: count.billetsOnHand, ...(row ? { reasonCodeId: row.id } : {}), ...(note.trim() ? { note: note.trim() } : {}), clientMutationId: requestId.current });
            }}
          >
            {p?.needsApproval ? t("foundry.cast.close.askButton") : t("foundry.cast.close.confirm")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 pt-1">
        <dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-3 text-[15px]" data-testid="close-figures" aria-busy={checking}>
          <Row label={t("foundry.cast.panel.produced")} value={`${kgFromG(co.producedG)} ${t("units.kg")}`} />
          <Row label={t("foundry.cast.panel.pressed")} value={`${kgFromG(co.creditedG)} ${t("units.kg")}`} />
          <Row label={t("foundry.cast.close.ledgerOnHand")} value={`${kgFromG(co.billetsOnHandG)} ${t("units.kg")}`} testId="close-ledger" />
          <Row
            label={t("foundry.cast.panel.tail")}
            value={p ? `${p.tailG < 0 ? "-" : ""}${kgFromG(Math.abs(p.tailG))} ${t("units.kg")}${p.tailBp !== null ? ` (${bpText(p.tailBp)}%)` : ""}` : "-"}
            strong
            testId="close-tail"
          />
        </dl>
        <section className="flex flex-col gap-3" aria-labelledby="close-count">
          <h3 id="close-count" className="m-0 text-[16px] font-semibold">{t("foundry.cast.close.countTitle")}</h3>
          <p className="m-0 text-[14px] text-muted-foreground">{t("foundry.cast.close.countHint")}</p>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("foundry.cast.close.pcs")} error={countError === "pcs" ? t("foundry.cast.close.pcsInvalid") : undefined}>
              <NumberInput decimal={false} value={pcs} onValueChange={setPcs} data-testid="close-pcs" />
            </Field>
            <Field label={t("foundry.cast.close.kg")} error={countError === "kg" ? t("foundry.cast.close.kgInvalid") : undefined}>
              <NumberInput value={kg} suffix={t("units.kg")} onValueChange={setKg} data-testid="close-kg" />
            </Field>
          </div>
          {!count.ok && count.issue === "together" ? <Note tone="amber">{t("foundry.cast.close.together")}</Note> : null}
        </section>
        {!p && !(count.ok === false && count.issue === "together") ? <Note>{t("foundry.cast.close.waitingCount")}</Note> : null}
        {p && p.shortG > 0 ? <Note tone="red">{t("foundry.cast.close.short", { kg: kgFromG(p.shortG) })}</Note> : null}
        {p && p.tailG < 0 && p.shortG === 0 ? <Note tone="amber">{t("foundry.cast.close.countOver", { kg: kgFromG(-p.tailG) })}</Note> : null}
        {p ? (
          <p className="m-0 text-[14px] text-muted-foreground" data-testid="close-adjust">
            {p.adjustG !== 0 ? t("foundry.cast.close.adjust", { kg: `${p.adjustG < 0 ? "-" : "+"}${kgFromG(Math.abs(p.adjustG))}` }) : t("foundry.cast.close.adjustNone")}
          </p>
        ) : null}
        {p && !p.needsReason ? <Note tone="green" testId="close-clean">{t("foundry.cast.close.clean")}</Note> : null}
        {p?.needsApproval ? <Note tone="amber" testId="close-needs-approval">{t("foundry.cast.close.needsApproval")}</Note> : null}
        {p?.needsReason ? (
          <>
            <Field label={t("foundry.cast.close.reason")} error={tried && issue === "reason" ? t("foundry.cast.close.reasonRequired") : undefined}>
              <FieldSelect value={reasonCode} onChange={(e) => setReasonCode(e.currentTarget.value)} data-testid="close-reason">
                <option value="">{t("foundry.cast.close.reasonPick")}</option>
                {/* L10: "Press used more billets than the store held" is only a reason when billets are short. */}
                {options.filter((o) => o.value !== "billets_short" || p.shortG > 0).map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </FieldSelect>
            </Field>
            <Field label={t("foundry.cast.close.note")} error={tried && issue === "note" ? t("foundry.cast.close.noteRequired") : undefined}>
              <FieldTextArea value={note} maxLength={500} onChange={(e) => setNote(e.currentTarget.value)} data-testid="close-note" />
            </Field>
          </>
        ) : null}
        <ErrorLine error={close.error ?? (count.ok ? preview.error : null)} />
      </div>
    </Sheet>
  );
}

function Row({ label, value, strong, testId }: { label: string; value: string; strong?: boolean; testId?: string }) {
  return (
    <div className="min-w-0" data-testid={testId}>
      <dt className="text-[13px] text-muted-foreground">{label}</dt>
      <dd className={`m-0 font-mono tabular-nums break-words ${strong ? "font-bold" : "font-semibold"}`}>{value}</dd>
    </div>
  );
}

/** Cancel an empty cast (nothing melted, nothing in the store): the number is not given back. */
export function CancelCastSheet({ open, onClose, castId, number }: { open: boolean; onClose(): void; castId: string; number: string }) {
  const { t } = useT();
  const refresh = useRefreshCast();
  const [reason, setReason] = useState("");
  const [tried, setTried] = useState(false);
  const cancel = useOnceMutation(
    trpc.foundry.casts.cancel.mutationOptions({
      onSuccess: () => {
        toast.success(t("foundry.cast.cancel.done", { number }));
        refresh();
        done();
      },
    }),
  );
  const done = () => {
    setReason("");
    setTried(false);
    cancel.reset();
    onClose();
  };
  return (
    <Sheet
      open={open}
      onOpenChange={(o) => (o ? undefined : done())}
      title={t("foundry.cast.cancel.title", { number })}
      footer={
        <>
          <Button variant="secondary" size="lg" onClick={done}>
            {t("common.cancel")}
          </Button>
          <Button
            size="lg"
            variant="danger"
            loading={cancel.isPending}
            data-testid="cancel-confirm"
            onClick={() => {
              setTried(true);
              if (reason.trim() !== "") cancel.mutate({ castId, reason: reason.trim() });
            }}
          >
            {t("foundry.cast.cancel.confirm")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 pt-1">
        <Note>{t("foundry.cast.cancel.body")}</Note>
        <Field label={t("foundry.cast.cancel.reason")} error={tried && reason.trim() === "" ? t("foundry.cast.cancel.reasonRequired") : undefined}>
          <FieldTextArea value={reason} maxLength={500} onChange={(e) => setReason(e.currentTarget.value)} data-testid="cancel-reason" />
        </Field>
        <ErrorLine error={cancel.error} />
      </div>
    </Sheet>
  );
}

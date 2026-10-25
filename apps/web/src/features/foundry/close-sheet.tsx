import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Field } from "@orrn/ui/components/field";
import { NativeSelect } from "@orrn/ui/components/native-select";
import { Sheet } from "@orrn/ui/components/sheet";
import type { AppRouter } from "@orrn/server/routers/index";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { FieldTextArea } from "@/features/catalog/field-text-area";
import { kgFromG } from "@/features/press/model";
import { reasonOptions } from "@/features/press/reason-label";
import { trpc } from "@/shared/utils/trpc";

import { bpText, closeFormIssue } from "./model";
import { ErrorLine, Note } from "./ui";

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
 * Close a cast (FP-FD-14): the server's close-out figures, a `cast_tail` reason from the plant's own
 * list when the tail is not zero, and the plain statement that a large tail goes to a second person.
 */
export function CloseCastSheet({ open, onClose, cast }: { open: boolean; onClose(): void; cast: CastData }) {
  const { t, locale } = useT();
  const refresh = useRefreshCast();
  const co = cast.closeout;
  const reasons = useQuery({ ...trpc.press.reasons.queryOptions({ kind: "cast_tail" }), enabled: open });
  const options = reasonOptions(t, "cast_tail", reasons.data, locale);
  const [reasonCode, setReasonCode] = useState("");
  const [note, setNote] = useState("");
  const [tried, setTried] = useState(false);
  const requestId = useRef(crypto.randomUUID());
  const close = useMutation(
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
    setReasonCode("");
    setNote("");
    setTried(false);
    close.reset();
    onClose();
  };
  const issue = closeFormIssue(co, { reasonCode, note }, reasons.data ?? []);
  const row = reasons.data?.find((r) => r.code === reasonCode);
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
            loading={close.isPending}
            data-testid="close-confirm"
            onClick={() => {
              setTried(true);
              if (issue) return;
              close.mutate({ castId: cast.cast.id, ...(row ? { reasonCodeId: row.id } : {}), ...(note.trim() ? { note: note.trim() } : {}), clientMutationId: requestId.current });
            }}
          >
            {co.needsApproval ? t("foundry.cast.close.askButton") : t("foundry.cast.close.confirm")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 pt-1">
        <dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-3 text-[15px]" data-testid="close-figures">
          <Row label={t("foundry.cast.panel.produced")} value={`${kgFromG(co.producedG)} ${t("units.kg")}`} />
          <Row label={t("foundry.cast.panel.pressed")} value={`${kgFromG(co.creditedG)} ${t("units.kg")}`} />
          <Row label={t("foundry.cast.panel.onHand")} value={`${kgFromG(co.billetsOnHandG)} ${t("units.kg")}`} />
          <Row label={t("foundry.cast.panel.tail")} value={`${co.tailG < 0 ? "-" : ""}${kgFromG(Math.abs(co.tailG))} ${t("units.kg")}${co.tailBp !== null ? ` (${bpText(co.tailBp)}%)` : ""}`} strong />
        </dl>
        {co.shortG > 0 ? <Note tone="red">{t("foundry.cast.close.short", { kg: kgFromG(co.shortG) })}</Note> : null}
        {!co.needsReason ? <Note tone="green">{t("foundry.cast.close.clean")}</Note> : null}
        {co.needsApproval ? <Note tone="amber" testId="close-needs-approval">{t("foundry.cast.close.needsApproval")}</Note> : null}
        {co.needsReason ? (
          <>
            <Field label={t("foundry.cast.close.reason")} error={tried && issue === "reason" ? t("foundry.cast.close.reasonRequired") : undefined}>
              <NativeSelect value={reasonCode} onChange={(e) => setReasonCode(e.currentTarget.value)} data-testid="close-reason">
                <option value="">{t("foundry.cast.close.reasonPick")}</option>
                {options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label={t("foundry.cast.close.note")} error={tried && issue === "note" ? t("foundry.cast.close.noteRequired") : undefined}>
              <FieldTextArea value={note} maxLength={500} onChange={(e) => setNote(e.currentTarget.value)} data-testid="close-note" />
            </Field>
          </>
        ) : null}
        <ErrorLine error={close.error} />
      </div>
    </Sheet>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="min-w-0">
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
  const cancel = useMutation(
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

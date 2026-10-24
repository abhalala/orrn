import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Field, TextInput } from "@orrn/ui/components/field";
import { FormActions } from "@orrn/ui/components/form-actions";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouterState } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { FieldTextArea } from "@/features/catalog/field-text-area";
import { useCompanyWhen } from "@/features/stock/use-company-when";
import { Can } from "@/shared/components/can";
import { INLINE_ERROR_META } from "@/shared/lib/query-errors";
import { trpc } from "@/shared/utils/trpc";

import { Note } from "./ui";

/** The server's cap on a help request (`MAX_SUPPORT_BODY`). */
export const SUPPORT_BODY_MAX = 2000;

const TONE = { open: "blue", answered: "green", closed: "neutral" } as const;

/**
 * Help (FP-PF-14): ask the orrn team (`support.request`, every role) and read your own requests
 * with their replies (`support.mine`). The page you were on is sent with the request.
 */
export function SupportTab() {
  const { t } = useT();
  const when = useCompanyWhen();
  const queryClient = useQueryClient();
  const mine = useQuery({ ...trpc.support.mine.queryOptions(), meta: INLINE_ERROR_META });
  const screen = useRouterState({ select: (s) => s.location.pathname });
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);

  const send = useMutation(
    trpc.support.request.mutationOptions({
      onSuccess: () => {
        toast.success(t("support.sent"));
        setSubject("");
        setBody("");
        setError(null);
        void queryClient.invalidateQueries({ queryKey: trpc.support.mine.queryKey() });
      },
      onError: () => setError(t("support.sendFailed")),
    }),
  );

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!body.trim()) {
      setError(t("support.bodyRequired"));
      return;
    }
    setError(null);
    send.mutate({ ...(subject.trim() ? { subject: subject.trim() } : {}), body: body.trim(), screen });
  };

  return (
    <div className="flex min-w-0 flex-col gap-5" data-testid="settings-support">
      <Can do="support.request" fallback={<Note>{t("support.cantAsk")}</Note>}>
        <form noValidate onSubmit={submit} className="flex min-w-0 flex-col gap-4 rounded-card border border-border bg-card p-4 sm:p-5">
          <h2 className="m-0 text-[17px] font-semibold">{t("support.ask")}</h2>
          <Field label={t("support.subject")} hint={t("support.subjectHint")}>
            <TextInput value={subject} maxLength={120} autoComplete="off" data-testid="support-subject" onChange={(e) => setSubject(e.currentTarget.value)} />
          </Field>
          <Field label={t("support.body")} hint={t("support.bodyHint")} error={error ?? undefined}>
            <FieldTextArea
              value={body}
              maxLength={SUPPORT_BODY_MAX}
              rows={5}
              data-testid="support-body"
              onChangeText={(next) => {
                setBody(next);
                if (error) setError(null);
              }}
            />
          </Field>
          <FormActions sticky={false}>
            <Button type="submit" loading={send.isPending} data-testid="support-send">
              {t("support.submit")}
            </Button>
          </FormActions>
        </form>
      </Can>

      <section aria-labelledby="my-requests" className="flex min-w-0 flex-col gap-3">
        <h2 id="my-requests" className="m-0 text-[17px] font-semibold">
          {t("support.mine")}
        </h2>
        {mine.isPending ? (
          <Skeleton className="h-24 w-full rounded-card" aria-busy="true" />
        ) : mine.isError ? (
          <div className="rounded-card border border-border bg-card">
            <EmptyState
              title={t("support.loadFailed")}
              action={
                <Button variant="secondary" onClick={() => void mine.refetch()}>
                  {t("common.retry")}
                </Button>
              }
            />
          </div>
        ) : mine.data.length === 0 ? (
          <div className="rounded-card border border-border bg-card">
            <EmptyState title={t("support.empty")} />
          </div>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-3 p-0" data-testid="support-mine">
            {mine.data.map((r) => (
              <li key={r.id} className="flex min-w-0 flex-col gap-2 rounded-card border border-border bg-card p-4" data-status={r.status}>
                <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                  <p className="m-0 min-w-0 text-[15px] font-semibold break-words">{r.subject}</p>
                  <Chip tone={TONE[r.status]}>{t(`support.status.${r.status}`)}</Chip>
                </div>
                <p className="m-0 text-[13px] text-muted-foreground">
                  {when(r.createdAt)}
                  {r.screen ? ` · ${t("support.fromScreen", { screen: r.screen })}` : ""}
                </p>
                <p className="m-0 text-[15px] leading-6 break-words whitespace-pre-wrap">{r.body}</p>
                {r.reply ? (
                  <div className="flex min-w-0 flex-col gap-1 rounded-card bg-surface-sunken p-3">
                    <p className="m-0 text-[13px] font-semibold text-muted-foreground">{t("support.replyFrom")}</p>
                    <p className="m-0 text-[15px] leading-6 break-words whitespace-pre-wrap">{r.reply}</p>
                  </div>
                ) : r.status === "open" ? (
                  <Note>{t("support.waiting")}</Note>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

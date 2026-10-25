import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Field } from "@orrn/ui/components/field";
import { FormActions } from "@orrn/ui/components/form-actions";
import { PageHeader } from "@orrn/ui/components/page-header";
import { ResponsiveList, type ResponsiveListColumn } from "@orrn/ui/components/responsive-list";
import { SegmentedControl } from "@orrn/ui/components/segmented-control";
import { Sheet } from "@orrn/ui/components/sheet";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AppRouter } from "@orrn/server/routers/index";
import type { inferRouterOutputs } from "@trpc/server";
import { useState } from "react";
import { toast } from "sonner";

import { FieldTextArea } from "@/features/catalog/field-text-area";
import { Can } from "@/shared/components/can";
import { trpc } from "@/shared/utils/trpc";

import { errorCode } from "./error-code";
import { formatAgo, formatDay, formatTime } from "./format";
import { LoadError, useLastValue } from "./ui";

type Request = inferRouterOutputs<AppRouter>["platform"]["support"]["list"][number];
type StatusFilter = "all" | Request["status"];

const TONE = { open: "blue", answered: "green", closed: "neutral" } as const;

/** The reply box's limit, matching `platform.support.reply`. */
export const REPLY_MAX = 2000;

/**
 * Godseye > Support (`/admin/support`, FP-PF-14): requests from every plant, newest first. Support
 * staff, admins and super admins read; those with `platform.support.reply` answer or close. A
 * reply lands only if the request is unchanged since it was read: when another person got there
 * first the server answers CONFLICT, and the list reloads with their answer.
 */
export function SupportPage() {
  const { t, locale } = useT();
  const [status, setStatus] = useState<StatusFilter>("all");
  const [openId, setOpenId] = useState<string | null>(null);
  // Kept here, not in the detail: the reload that follows a conflict changes the status and remounts it.
  const [conflictId, setConflictId] = useState<string | null>(null);
  const list = useQuery({
    ...trpc.platform.support.list.queryOptions({ ...(status === "all" ? {} : { status }), limit: 100 }),
    meta: { inlineError: true },
  });
  const selected = list.data?.find((r) => r.id === openId) ?? null;
  const shown = useLastValue(selected);

  const columns: ResponsiveListColumn<Request>[] = [
    { key: "plant", header: t("admin.support.columns.plant"), cell: (r) => <span className="font-semibold break-words">{r.companyName}</span> },
    {
      key: "subject",
      header: t("admin.support.columns.subject"),
      cell: (r) => (
        <button
          type="button"
          onClick={() => {
            setConflictId(null);
            setOpenId(r.id);
          }}
          className="inline-flex min-h-11 min-w-0 items-center text-left break-words underline decoration-control underline-offset-4 hover:decoration-foreground"
          data-testid="support-open"
        >
          {r.subject}
        </button>
      ),
    },
    { key: "status", header: t("admin.support.columns.status"), cell: (r) => <Chip tone={TONE[r.status]}>{t(`support.status.${r.status}`)}</Chip> },
    {
      key: "asked",
      header: t("admin.support.columns.asked"),
      hideOnPhone: true,
      cell: (r) => <span className="whitespace-nowrap">{formatAgo(r.createdAt, { locale })}</span>,
    },
  ];

  return (
    <div className="flex min-w-0 flex-col gap-5" data-testid="admin-support">
      <PageHeader title={t("admin.support.title")} subtitle={t("admin.support.subtitle")} />
      <SegmentedControl<StatusFilter>
        label={t("admin.support.status")}
        value={status}
        onChange={setStatus}
        options={[
          { value: "all", label: t("admin.support.allStatuses") },
          { value: "open", label: t("support.status.open") },
          { value: "answered", label: t("support.status.answered") },
          { value: "closed", label: t("support.status.closed") },
        ]}
      />
      {list.isError && list.data === undefined ? (
        <LoadError message={t("admin.support.loadError")} onRetry={() => void list.refetch()} />
      ) : (
        <ResponsiveList
          rows={list.data ?? []}
          loading={list.isPending}
          label={t("admin.support.title")}
          rowKey={(r) => r.id}
          columns={columns}
          empty={<EmptyState title={t("admin.support.empty")} />}
        />
      )}
      <Sheet open={selected !== null} onOpenChange={(open) => !open && setOpenId(null)} title={shown?.subject ?? ""}>
        {shown ? (
          <RequestDetail
            key={`${shown.id}-${shown.status}`}
            request={shown}
            conflict={conflictId === shown.id}
            onConflict={() => {
              setConflictId(shown.id);
              void list.refetch();
            }}
            onSent={() => setConflictId(null)}
          />
        ) : null}
      </Sheet>
    </div>
  );
}

function RequestDetail({
  request,
  conflict,
  onConflict,
  onSent,
}: {
  request: Request;
  conflict: boolean;
  onConflict(): void;
  onSent(): void;
}) {
  const { t, locale } = useT();
  const queryClient = useQueryClient();
  const [reply, setReply] = useState("");
  const finished = request.status === "closed";
  const canReply = request.status === "open";

  const send = useMutation(
    trpc.platform.support.reply.mutationOptions({
      onSuccess: (_, vars) => {
        onSent();
        toast.success(vars.close ? t("admin.support.closed") : t("admin.support.replied"));
        void queryClient.invalidateQueries({ queryKey: trpc.platform.support.list.queryKey() });
      },
      onError: (error) => {
        if (errorCode(error) === "CONFLICT") {
          // Someone else answered or closed it first: show their answer, not ours.
          onConflict();
        } else {
          toast.error(t("admin.support.failed"));
        }
      },
    }),
  );

  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="support-detail">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Chip tone={TONE[request.status]}>{t(`support.status.${request.status}`)}</Chip>
        <span className="min-w-0 text-[13px] text-muted-foreground break-words">
          {request.companyName} · {formatDay(request.createdAt, { locale })}, {formatTime(request.createdAt, locale)}
        </span>
      </div>
      {request.screen ? <p className="m-0 text-[13px] text-muted-foreground break-words">{t("admin.support.from", { screen: request.screen })}</p> : null}
      <p className="m-0 text-[15px] leading-6 break-words whitespace-pre-wrap">{request.body}</p>
      {request.reply ? (
        <div className="flex min-w-0 flex-col gap-1 rounded-card bg-surface-sunken p-3">
          <p className="m-0 text-[13px] font-semibold text-muted-foreground">
            {request.repliedAt ? t("admin.support.earlierReply", { time: formatDay(request.repliedAt, { locale }) }) : t("support.replyFrom")}
          </p>
          <p className="m-0 text-[15px] leading-6 break-words whitespace-pre-wrap">{request.reply}</p>
        </div>
      ) : null}
      {conflict ? (
        <p role="alert" data-testid="support-conflict" className="m-0 text-[15px] leading-6 font-medium text-destructive">
          {t("admin.support.conflict")}
        </p>
      ) : null}
      <Can do="platform.support.reply" fallback={<p className="m-0 text-[13px] text-muted-foreground">{t("admin.support.readOnly")}</p>}>
        {!finished ? (
          <form
            noValidate
            className="flex min-w-0 flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (reply.trim()) send.mutate({ id: request.id, reply: reply.trim(), close: false });
            }}
          >
            {canReply ? (
              <Field label={t("admin.support.yourReply")}>
                <FieldTextArea value={reply} maxLength={REPLY_MAX} rows={4} data-testid="support-reply" onChangeText={setReply} />
              </Field>
            ) : null}
            <FormActions sticky={false}>
              <Button type="button" variant="secondary" loading={send.isPending && send.variables?.reply === undefined} onClick={() => send.mutate({ id: request.id, close: true })} data-testid="support-close">
                {t("admin.support.close")}
              </Button>
              {canReply ? (
                <>
                  <Button type="button" variant="secondary" disabled={!reply.trim()} onClick={() => send.mutate({ id: request.id, reply: reply.trim(), close: true })} data-testid="support-send-close">
                    {t("admin.support.sendClose")}
                  </Button>
                  <Button type="submit" disabled={!reply.trim()} loading={send.isPending && send.variables?.reply !== undefined && !send.variables?.close} data-testid="support-send">
                    {t("admin.support.send")}
                  </Button>
                </>
              ) : null}
            </FormActions>
          </form>
        ) : null}
      </Can>
    </div>
  );
}

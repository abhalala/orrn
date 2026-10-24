import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Field, TextInput } from "@orrn/ui/components/field";
import { ResponsiveList, type ResponsiveListColumn } from "@orrn/ui/components/responsive-list";
import { SegmentedControl } from "@orrn/ui/components/segmented-control";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Eye } from "lucide-react";
import { useId, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Can } from "@/shared/components/can";
import { useMe } from "@/shared/lib/me";
import { trpc } from "@/shared/utils/trpc";

import { formatDay, formatTime } from "./format";
import { grantEndsAt, grantState, grantStateKey, grantTone, inactiveReason } from "./status";
import type { CompanyDetail, GrantRow } from "./types";
import { errorText, Panel } from "./ui";
import { useEnterCompany } from "./use-impersonate";

/** Minutes. The unit is in the control's label, so each segment is just a number (Hindi "मिनट" did not fit four times at 375px). */
const DURATIONS = ["15", "30", "60", "120"] as const;
type Duration = (typeof DURATIONS)[number];

/**
 * Godseye company tab "Access" (spec §3): start a support session
 * (impersonation grant, time-boxed, audited) that opens /today inside the
 * company with the banner, and the company's recent sessions. Staff can
 * resume or stop their own active session from here.
 */
export function CompanyAccessTab({ detail }: { detail: CompanyDetail }) {
  const { t, locale } = useT();
  const { data: me } = useMe();
  const qc = useQueryClient();
  const formId = useId();
  const company = detail.company;
  const [reason, setReason] = useState("");
  const [duration, setDuration] = useState<Duration>("30");
  const enter = useEnterCompany();

  const start = useMutation({
    ...trpc.platform.impersonationCreateGrant.mutationOptions(),
    onSuccess: (grant) => {
      toast.success(t("admin.access.started"));
      void enter(grant.companyId, grant.expiresAt);
    },
    onError: (err) => toast.error(errorText(t, err)),
  });

  const stop = useMutation({
    ...trpc.platform.impersonationRevokeGrant.mutationOptions(),
    onSuccess: async () => {
      toast.success(t("admin.access.stopped"));
      await qc.invalidateQueries({ queryKey: trpc.platform.companiesGet.queryKey({ id: company.id }) });
    },
    onError: (err) => toast.error(errorText(t, err)),
  });

  const blocked = inactiveReason(company.status);
  // Already inside a company as support (Back from it, or a second tab): one session at a time.
  const inside = me?.impersonation ?? null;
  const insideName = me?.company?.name ?? inside?.companyId ?? "";
  const canStart = blocked === null && !inside;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!canStart) return;
    start.mutate({ companyId: company.id, ttlMinutes: Number(duration), reason: reason.trim() || undefined });
  };

  const now = new Date();
  const columns: ResponsiveListColumn<GrantRow>[] = [
    {
      key: "staff",
      header: t("admin.access.staff"),
      cell: (row) => (
        <span className="font-semibold text-foreground break-words">
          {row.platformAdminId === me?.user.id
            ? t("admin.access.staffYou", { name: row.staffName ?? t("admin.access.unknownStaff") })
            : (row.staffName ?? t("admin.access.unknownStaff"))}
        </span>
      ),
    },
    {
      key: "status",
      header: t("admin.companies.columns.status"),
      cell: (row) => {
        const state = grantState(row, now);
        return <Chip tone={grantTone(state)} truncate={false}>{t(grantStateKey(state))}</Chip>;
      },
    },
    {
      key: "reason",
      header: t("admin.access.reason"),
      cell: (row) =>
        row.reason ? (
          <span className="break-words">{row.reason}</span>
        ) : (
          <span className="text-muted-foreground">{t("admin.access.noReason")}</span>
        ),
    },
    {
      key: "started",
      header: t("admin.access.startedAt"),
      cell: (row) => (
        <span className="whitespace-nowrap tabular-nums">
          {formatDay(row.createdAt, { locale })} {formatTime(row.createdAt, locale)}
        </span>
      ),
    },
    {
      key: "ends",
      header: t("admin.access.ends"),
      // A stopped session shows when it was stopped, not the end it never reached.
      cell: (row) => <span className="whitespace-nowrap tabular-nums">{formatTime(grantEndsAt(row), locale)}</span>,
    },
    {
      key: "actions",
      header: t("admin.access.actions"),
      headerHidden: true,
      align: "end",
      cell: (row) =>
        row.platformAdminId === me?.user.id && grantState(row, now) === "active" ? (
          <Can do="platform.impersonate">
            <span className="flex flex-wrap justify-end gap-2">
              <Button variant="secondary" onPress={() => void enter(company.id, row.expiresAt)}>
                {t("admin.access.resume")}
              </Button>
              <Button
                variant="ghost"
                loading={stop.isPending && stop.variables?.id === row.id}
                onPress={() => stop.mutate({ id: row.id })}
              >
                {t("admin.access.stopSession")}
              </Button>
            </span>
          </Can>
        ) : null,
    },
  ];

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <Can
        do="platform.impersonate"
        fallback={
          <Panel>
            <EmptyState title={t("admin.access.restricted")} />
          </Panel>
        }
      >
        <Panel aria-labelledby={`${formId}-title`} className="flex flex-col gap-5 p-5 sm:p-6">
          <div className="flex min-w-0 items-start gap-4">
            <span
              aria-hidden="true"
              className="orrn-block orrn-block-violet hidden size-12 shrink-0 items-center justify-center rounded-full sm:flex"
            >
              <Eye className="size-[22px]" strokeWidth={2} />
            </span>
            <div className="flex min-w-0 flex-col gap-1">
              <h2
                id={`${formId}-title`}
                className="m-0 font-display text-[22px] font-bold leading-tight tracking-[-0.025em] text-foreground break-words"
              >
                {t("admin.access.title", { company: company.name })}
              </h2>
              <p className="m-0 max-w-[60ch] text-[15px] leading-6 text-muted-foreground">
                {blocked === "waiting"
                  ? t("admin.access.waiting", { company: company.name })
                  : blocked === "suspended"
                    ? t("admin.access.inactive", { company: company.name })
                    : inside
                      ? t("admin.access.inside", { company: insideName })
                      : t("admin.access.body")}
              </p>
            </div>
          </div>

          <form id={formId} onSubmit={submit} className="flex flex-col gap-5">
            <div className="grid min-w-0 grid-cols-1 gap-5 md:grid-cols-[minmax(0,1fr)_auto]">
              <Field label={t("admin.access.reasonLabel")} hint={t("admin.access.reasonHint")}>
                <TextInput value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} disabled={!canStart} />
              </Field>
              <div className="flex min-w-0 flex-col gap-1.5">
                <p className="m-0 text-[14px] font-semibold leading-5 text-foreground">{t("admin.access.durationLabel")}</p>
                <SegmentedControl
                  label={t("admin.access.durationLabel")}
                  value={duration}
                  onChange={setDuration}
                  options={DURATIONS.map((d) => ({ value: d, label: d }))}
                  className="max-w-full self-start"
                />
              </div>
            </div>
            <div className="flex">
              <Button
                type="submit"
                disabled={!canStart}
                loading={start.isPending}
                className="w-full sm:w-auto pointer-coarse:h-14"
              >
                {t("admin.access.impersonate")}
              </Button>
            </div>
          </form>
        </Panel>
      </Can>

      <section aria-labelledby={`${formId}-sessions`} className="flex min-w-0 flex-col gap-3">
        <h2
          id={`${formId}-sessions`}
          className="m-0 font-display text-[19px] font-bold tracking-[-0.02em] text-foreground"
        >
          {t("admin.access.sessions")}
        </h2>
        <ResponsiveList
          label={t("admin.access.sessions")}
          rows={detail.recentGrants}
          columns={columns}
          rowKey={(row) => row.id}
          empty={<EmptyState title={t("admin.access.sessionsEmpty")} />}
        />
      </section>
    </div>
  );
}

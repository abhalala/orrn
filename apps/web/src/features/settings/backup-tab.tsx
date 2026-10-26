import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@orrn/ui/components/card";
import { Chip } from "@orrn/ui/components/chip";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { useCompanyWhen } from "@/features/stock/use-company-when";
import { Can } from "@/shared/components/can";
import { INLINE_ERROR_META } from "@/shared/lib/query-errors";
import { useMe } from "@/shared/lib/me";
import { trpc } from "@/shared/utils/trpc";

import { Note, TabState } from "./ui";

type RunView = { status: "ok" | "running" | "failed"; bytes: number | null; startedAt: string; finishedAt: string | null };

const TONE = { ok: "green", running: "blue", failed: "red" } as const;

/** Megabytes with one decimal, for the size of an export. */
export function megabytes(bytes: number | null): string | null {
  if (bytes === null || bytes === undefined) return null;
  return (bytes / 1_048_576).toLocaleString("en-IN", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

/**
 * Backup (FP-PF-12): the plant sees the last good backup, a newer failed or running try, and the
 * last restore drill. Status only: there is no download and no restore for the plant. orrn staff
 * (platform roles) also get the two buttons that run a backup and a drill now.
 */
export function BackupTab() {
  const { t } = useT();
  const when = useCompanyWhen();
  const status = useQuery({ ...trpc.backup.status.queryOptions(), meta: INLINE_ERROR_META });

  return (
    <TabState query={status}>
      {status.data ? (
        <div className="flex min-w-0 flex-col gap-4" data-testid="settings-backup">
          {!status.data.configured ? <Note>{t("backups.notConfigured")}</Note> : null}
          <Card>
            <CardHeader>
              <CardTitle>{t("backups.title")}</CardTitle>
              <CardDescription>{t("backups.cardHint")}</CardDescription>
            </CardHeader>
            <CardContent>
              <Line label={t("backups.lastOk")} run={status.data.lastOk} none={t(status.data.configured ? "backups.none" : "backups.notConfigured")} when={when} testId="backup-last" />
              {status.data.lastAttempt ? (
                <p className="m-0 text-[15px] leading-6" data-testid="backup-attempt">
                  {t("backups.lastAttempt", {
                    status: t(`backups.status.${status.data.lastAttempt.status}`),
                    time: when(status.data.lastAttempt.startedAt),
                  })}
                </p>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("backups.drillTitle")}</CardTitle>
              <CardDescription>{t("backups.drillBody")}</CardDescription>
            </CardHeader>
            <CardContent>
              <Line label={t("backups.drillTitle")} run={status.data.lastDrill} none={t(status.data.configured ? "backups.drillNone" : "backups.notConfigured")} when={when} testId="backup-drill" />
              {status.data.configured ? <Note>{t("backups.runbook")}</Note> : null}
            </CardContent>
          </Card>

          <Can do="platform.backup.run">
            {status.data.configured ? <StaffRunner /> : null}
          </Can>
        </div>
      ) : null}
    </TabState>
  );
}

function Line({
  label,
  run,
  none,
  when,
  testId,
}: {
  label: string;
  run: RunView | null;
  none: string;
  when: (at: string) => string;
  testId: string;
}) {
  const { t } = useT();
  if (!run) {
    return (
      <p className="m-0 text-[15px] leading-6 text-muted-foreground" data-testid={testId}>
        {none}
      </p>
    );
  }
  const size = megabytes(run.bytes);
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1" data-testid={testId} data-status={run.status}>
      <Chip tone={TONE[run.status]}>{t(`backups.status.${run.status}`)}</Chip>
      <span className="text-[15px] leading-6">
        {label}: {when(run.finishedAt ?? run.startedAt)}
      </span>
      {size ? <span className="font-mono text-[14px] tabular-nums text-muted-foreground">{t("backups.size", { mb: size })}</span> : null}
    </div>
  );
}

/** ORRN staff only (`platform.backup.run`): export now, or restore the latest export into a scratch copy. */
function StaffRunner() {
  const { t } = useT();
  const { data: me } = useMe();
  const queryClient = useQueryClient();
  const companyId = me?.company?.id ?? "";
  const refresh = () => void queryClient.invalidateQueries({ queryKey: trpc.backup.status.queryKey() });
  const run = useMutation(
    trpc.platform.backup.run.mutationOptions({
      onSuccess: (r) => {
        refresh();
        if (r.status === "failed") toast.error(t("backups.failedToRun"));
        else toast.success(t("backups.started"));
      },
      onError: () => toast.error(t("backups.failedToRun")),
    }),
  );
  const drill = useMutation(
    trpc.platform.backup.drill.mutationOptions({
      onSuccess: (r) => {
        refresh();
        if (r.status === "failed") toast.error(t("backups.failedToRun"));
        else toast.success(t("backups.drillStarted"));
      },
      onError: () => toast.error(t("backups.failedToRun")),
    }),
  );
  return (
    <Card data-testid="backup-staff">
      <CardHeader>
        <CardTitle>{t("backups.staffTitle")}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-2">
          <Button loading={run.isPending} disabled={!companyId || drill.isPending} onClick={() => run.mutate({ companyId })}>
            {t("backups.runNow")}
          </Button>
          <Button variant="secondary" loading={drill.isPending} disabled={!companyId || run.isPending} onClick={() => drill.mutate({ companyId })}>
            {t("backups.runDrill")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

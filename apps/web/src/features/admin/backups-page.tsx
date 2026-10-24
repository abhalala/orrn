import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Field } from "@orrn/ui/components/field";
import { NativeSelect } from "@orrn/ui/components/native-select";
import { PageHeader } from "@orrn/ui/components/page-header";
import { ResponsiveList, type ResponsiveListColumn } from "@orrn/ui/components/responsive-list";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AppRouter } from "@orrn/server/routers/index";
import type { inferRouterOutputs } from "@trpc/server";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { megabytes } from "@/features/settings/backup-tab";
import { Can } from "@/shared/components/can";
import { trpc } from "@/shared/utils/trpc";

import { formatDay, formatTime } from "./format";
import { LoadError } from "./ui";

type Run = inferRouterOutputs<AppRouter>["platform"]["backup"]["list"][number];

const TONE = { ok: "green", running: "blue", failed: "red" } as const;

/** A drill's detail is `{ expected, restored }` count maps; it matches when every count is equal. */
export function drillMatches(detail: unknown): boolean | null {
  if (!detail || typeof detail !== "object") return null;
  const { expected, restored } = detail as { expected?: Record<string, number>; restored?: Record<string, number> };
  if (!expected || !restored) return null;
  return Object.keys(expected).every((k) => expected[k] === restored[k]);
}

/**
 * Godseye > Backups (`/admin/backups`, FP-PF-12): the daily exports and restore drills of every
 * plant, newest first, with a button per plant to export now or run a drill. The staff list never
 * carries the R2 key. A failed run keeps the last good backup (the list shows both).
 */
export function BackupsPage() {
  const { t, locale } = useT();
  const queryClient = useQueryClient();
  const [companyId, setCompanyId] = useState("");
  const companies = useQuery(trpc.platform.companiesList.queryOptions({ limit: 100 }));
  const list = useQuery({
    ...trpc.platform.backup.list.queryOptions({ ...(companyId ? { companyId } : {}), limit: 50 }),
    meta: { inlineError: true },
  });
  const names = useMemo(() => new Map((companies.data?.items ?? []).map((c) => [c.id, c.name])), [companies.data]);

  const refresh = () => void queryClient.invalidateQueries({ queryKey: trpc.platform.backup.list.queryKey() });
  const run = useMutation(
    trpc.platform.backup.run.mutationOptions({
      onSuccess: (r) => {
        refresh();
        if (r.status === "failed") toast.error(t("admin.backups.actionFailed"));
        else toast.success(t("admin.backups.ran"));
      },
      onError: () => toast.error(t("admin.backups.actionFailed")),
    }),
  );
  const drill = useMutation(
    trpc.platform.backup.drill.mutationOptions({
      onSuccess: (r) => {
        refresh();
        if (r.status === "failed") toast.error(t("admin.backups.actionFailed"));
        else toast.success(t("admin.backups.drilled"));
      },
      onError: () => toast.error(t("admin.backups.actionFailed")),
    }),
  );

  const columns: ResponsiveListColumn<Run>[] = [
    { key: "plant", header: t("admin.backups.columns.plant"), cell: (r) => <span className="font-semibold break-words">{names.get(r.companyId ?? "") ?? r.companyId ?? "-"}</span> },
    {
      key: "what",
      header: t("admin.backups.columns.what"),
      cell: (r) => (
        <span>
          {t(`admin.backups.purpose.${r.purpose}`)}
          {r.purpose === "export" ? ` · ${t(`admin.backups.kind.${r.kind}`)}` : ""}
        </span>
      ),
    },
    { key: "status", header: t("admin.backups.columns.status"), cell: (r) => <Chip tone={TONE[r.status]}>{t(`admin.backups.status.${r.status}`)}</Chip> },
    {
      key: "started",
      header: t("admin.backups.columns.started"),
      cell: (r) => (
        <span className="whitespace-nowrap tabular-nums">
          {formatDay(r.startedAt, { locale })}, {formatTime(r.startedAt, locale)}
        </span>
      ),
    },
    { key: "size", header: t("admin.backups.columns.size"), align: "end", hideOnPhone: true, cell: (r) => <span className="font-mono tabular-nums">{r.bytes ? t("backups.size", { mb: megabytes(r.bytes) ?? "" }) : "-"}</span> },
    {
      key: "detail",
      header: t("admin.backups.columns.detail"),
      cell: (r) => {
        if (r.purpose === "drill") {
          const ok = drillMatches(r.detail);
          return ok === null ? null : <Chip tone={ok ? "green" : "red"}>{ok ? t("admin.backups.matches") : t("admin.backups.mismatch")}</Chip>;
        }
        return r.rowCount ? <span className="font-mono tabular-nums">{r.rowCount.toLocaleString("en-IN")}</span> : null;
      },
    },
  ];

  return (
    <div className="flex min-w-0 flex-col gap-5" data-testid="admin-backups">
      <PageHeader title={t("admin.backups.title")} subtitle={t("admin.backups.subtitle")} />
      <div className="flex min-w-0 flex-col gap-3 rounded-card border border-border bg-card p-4 sm:flex-row sm:items-end sm:p-5">
        <Field label={t("admin.backups.company")} className="sm:w-80">
          <NativeSelect value={companyId} onChange={(e) => setCompanyId(e.target.value)} data-testid="backup-company">
            <option value="">{t("admin.backups.allCompanies")}</option>
            {(companies.data?.items ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Can do="platform.backup.run">
          <div className="flex flex-wrap gap-2">
            <Button disabled={!companyId || drill.isPending} loading={run.isPending} onClick={() => run.mutate({ companyId })} data-testid="backup-run">
              {t("admin.backups.runNow")}
            </Button>
            <Button variant="secondary" disabled={!companyId || run.isPending} loading={drill.isPending} onClick={() => drill.mutate({ companyId })} data-testid="backup-drill">
              {t("admin.backups.runDrill")}
            </Button>
          </div>
        </Can>
      </div>
      {list.isError && list.data === undefined ? (
        <LoadError message={t("admin.backups.loadError")} onRetry={() => void list.refetch()} />
      ) : (
        <ResponsiveList
          rows={list.data ?? []}
          loading={list.isPending}
          label={t("admin.backups.title")}
          rowKey={(r) => r.id}
          columns={columns}
          empty={<EmptyState title={t("admin.backups.empty")} />}
        />
      )}
    </div>
  );
}

import { useT } from "@orrn/i18n";
import { Chip } from "@orrn/ui/components/chip";
import { ResponsiveList, type ResponsiveListColumn } from "@orrn/ui/components/responsive-list";
import type { ReactNode } from "react";

import { metaText } from "./model";

export type AuditRow = {
  id: string;
  at: string;
  action: string;
  subjectType: string;
  subjectId: string | null;
  actorId: string | null;
  actorName: string | null;
  byStaff: boolean;
  meta: Record<string, unknown>;
};

/**
 * The audit entries as a table (iPad up) or stacked rows (phone). Read only: nothing here edits or
 * removes an entry. `when` formats the time in the plant's zone; `onSubject` (the plant viewer)
 * turns the subject into a filter, and is left out where there is no filter to set.
 */
export function AuditRows({
  rows,
  loading,
  empty,
  when,
  onSubject,
  label,
}: {
  rows: AuditRow[];
  loading?: boolean;
  empty: ReactNode;
  when: (at: string) => string;
  onSubject?: (subjectId: string) => void;
  label: string;
}) {
  const { t } = useT();
  const columns: ResponsiveListColumn<AuditRow>[] = [
    { key: "when", header: t("audit.columns.when"), cell: (r) => <span className="whitespace-nowrap tabular-nums">{when(r.at)}</span> },
    {
      key: "who",
      header: t("audit.columns.who"),
      cell: (r) => (
        <span className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="break-words">{r.actorName ?? t("audit.unknownActor")}</span>
          {r.byStaff ? <Chip tone="violet">{t("audit.byStaff")}</Chip> : null}
        </span>
      ),
    },
    { key: "what", header: t("audit.columns.what"), cell: (r) => <code className="font-mono text-[13px] break-all">{r.action}</code> },
    {
      key: "subject",
      header: t("audit.columns.subject"),
      cell: (r) =>
        r.subjectId ? (
          onSubject ? (
            <button
              type="button"
              onClick={() => onSubject(r.subjectId!)}
              className="inline-flex min-h-11 min-w-0 flex-col items-start text-left font-mono text-[13px] break-all underline decoration-control underline-offset-4 hover:decoration-foreground"
            >
              <span className="text-muted-foreground no-underline">{r.subjectType}</span>
              <span>{r.subjectId}</span>
            </button>
          ) : (
            <span className="flex min-w-0 flex-col font-mono text-[13px] break-all">
              <span className="text-muted-foreground">{r.subjectType}</span>
              <span>{r.subjectId}</span>
            </span>
          )
        ) : (
          <span className="font-mono text-[13px] text-muted-foreground">{r.subjectType}</span>
        ),
    },
    {
      key: "details",
      header: t("audit.details"),
      hideOnPhone: false,
      cell: (r) => {
        const text = metaText(r.meta);
        return text ? (
          <details className="min-w-0">
            <summary className="inline-flex min-h-11 cursor-pointer items-center text-[13px] font-semibold underline decoration-control underline-offset-4">
              {t("audit.details")}
            </summary>
            <pre className="m-0 max-w-full overflow-x-auto rounded-input bg-surface-sunken p-3 font-mono text-[12px] leading-5 whitespace-pre-wrap break-words">{text}</pre>
          </details>
        ) : null;
      },
    },
  ];
  return <ResponsiveList rows={rows} loading={loading} label={label} rowKey={(r) => r.id} columns={columns} empty={empty} />;
}

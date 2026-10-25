import { useT, type MessageKey } from "@orrn/i18n";
import { Chip } from "@orrn/ui/components/chip";
import { ResponsiveList, type ResponsiveListColumn } from "@orrn/ui/components/responsive-list";
import type { ReactNode } from "react";

import { auditActionKey } from "./action-words";
import { metaEntries } from "./model";

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
  const words = { yes: t("audit.valueYes"), no: t("audit.valueNo"), none: t("audit.valueNone"), change: (from: string, to: string) => t("audit.change", { from, to }) };
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
    {
      key: "what",
      header: t("audit.columns.what"),
      // Wave-2 M5: the action in words; the code under it, small, for support and the Kind filter.
      cell: (r) => {
        const words = auditActionKey(r.action);
        if (!words) return <code className="font-mono text-[13px] break-all">{r.action}</code>;
        return (
          <span className="flex min-w-0 flex-col" data-audit-action={r.action}>
            <span className="break-words">{t(words as MessageKey)}</span>
            <code className="font-mono text-[12px] text-muted-foreground break-all">{r.action}</code>
          </span>
        );
      },
    },
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
        const entries = metaEntries(r.meta, words);
        return entries.length > 0 ? (
          <details className="min-w-0">
            <summary className="inline-flex min-h-11 cursor-pointer items-center text-[13px] font-semibold underline decoration-control underline-offset-4">
              {t("audit.details")}
            </summary>
            <dl className="m-0 grid max-w-full grid-cols-1 gap-x-4 gap-y-2 rounded-input bg-surface-sunken p-3 text-[13px] leading-5 sm:grid-cols-[max-content_1fr]" data-testid="audit-meta">
              {entries.map((e) => (
                <div key={e.key} className="contents">
                  <dt className="font-semibold text-muted-foreground">{e.label}</dt>
                  <dd className="m-0 min-w-0 break-words">{e.value}</dd>
                </div>
              ))}
            </dl>
          </details>
        ) : null;
      },
    },
  ];
  return <ResponsiveList rows={rows} loading={loading} label={label} rowKey={(r) => r.id} columns={columns} empty={empty} />;
}

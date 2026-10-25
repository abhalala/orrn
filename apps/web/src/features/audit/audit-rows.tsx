import { useT, type MessageKey } from "@orrn/i18n";
import { Chip } from "@orrn/ui/components/chip";
import { ResponsiveList, type ResponsiveListColumn } from "@orrn/ui/components/responsive-list";
import type { ReactNode } from "react";

import { RouterLink } from "@/shared/components/router-link";

import { metaEntries } from "./model";
import { subjectPath, subjectTypeFallback, subjectTypeKey } from "./subject-words";

export type AuditRow = {
  id: string;
  at: string;
  action: string;
  subjectType: string;
  subjectId: string | null;
  /** The number, code or name the subject goes by (the server, this plant only); null when it has none. */
  subjectLabel?: string | null;
  actorId: string | null;
  actorName: string | null;
  byStaff: boolean;
  meta: Record<string, unknown>;
};

/**
 * The audit entries as a table (iPad up) or stacked rows (phone). Read only: nothing here edits or
 * removes an entry. `when` formats the time in the plant's zone; `onSubject` (the plant viewer)
 * turns the subject into a filter, and is left out where there is no filter to set. `linkSubjects` (default on)
 * links a subject to its screen in the viewer's own plant; Godseye's company tab turns it off, because those screens
 * would open the staff member's plant, not the plant being audited.
 */
export function AuditRows({
  rows,
  loading,
  empty,
  when,
  onSubject,
  linkSubjects = true,
  label,
}: {
  rows: AuditRow[];
  loading?: boolean;
  empty: ReactNode;
  when: (at: string) => string;
  onSubject?: (subjectId: string) => void;
  linkSubjects?: boolean;
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
    { key: "what", header: t("audit.columns.what"), cell: (r) => <code className="font-mono text-[13px] break-all">{r.action}</code> },
    {
      key: "subject",
      header: t("audit.columns.subject"),
      cell: (r) => {
        // BACKLOG 100: "Packing list PL/2026-27/5" with a link to it; the raw id only as the filter handle, small, under it.
        const typeKey = subjectTypeKey(r.subjectType);
        const typeWords = typeKey ? t(typeKey as MessageKey) : subjectTypeFallback(r.subjectType);
        const path = linkSubjects ? subjectPath(r.subjectType, r.subjectId) : null;
        const name = r.subjectLabel ?? null;
        const head = name ? (
          path ? (
            <RouterLink to={path} className="font-semibold underline decoration-control underline-offset-4 hover:decoration-foreground break-words" data-audit-subject-link="">
              {name}
            </RouterLink>
          ) : (
            <span className="font-semibold break-words">{name}</span>
          )
        ) : null;
        return (
          <span className="flex min-w-0 flex-col gap-0.5 text-[13px]" data-audit-subject={r.subjectType}>
            <span className="text-muted-foreground">{typeWords}</span>
            {head}
            {r.subjectId ? (
              onSubject ? (
                <button
                  type="button"
                  onClick={() => onSubject(r.subjectId!)}
                  className="inline-flex min-h-11 min-w-0 items-center text-left font-mono text-[12px] break-all text-muted-foreground underline decoration-control underline-offset-4 hover:decoration-foreground"
                  title={r.subjectId}
                  aria-label={name ? `${t("audit.onlyThis")}: ${name}` : undefined}
                >
                  {name ? t("audit.onlyThis") : r.subjectId}
                </button>
              ) : name ? null : (
                <span className="font-mono text-[12px] break-all text-muted-foreground">{r.subjectId}</span>
              )
            ) : null}
          </span>
        );
      },
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

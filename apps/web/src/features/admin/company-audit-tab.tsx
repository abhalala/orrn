import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Field } from "@orrn/ui/components/field";
import { NativeSelect } from "@orrn/ui/components/native-select";
import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { AuditRows, type AuditRow } from "@/features/audit/audit-rows";
import { AUDIT_KINDS, isAuditKind, type AuditKind } from "@/features/audit/model";
import { formatDay, formatTime } from "@/features/admin/format";
import { LoadError } from "@/features/admin/ui";
import { trpcClient } from "@/shared/utils/trpc";

const PAGE = 50;

/**
 * Audit tab of a company in Godseye (`platform.companiesAudit`): that plant's trail, newest first,
 * read only, filtered by kind, paged with "Show older entries". Times are in the viewer's zone.
 */
export function CompanyAuditTab({ companyId }: { companyId: string }) {
  const { t, locale } = useT();
  const [kind, setKind] = useState<AuditKind | "">("");
  const list = useInfiniteQuery({
    queryKey: [["platform", "companiesAudit"], { input: { companyId, kind }, type: "infinite" }] as const,
    queryFn: ({ pageParam }) =>
      trpcClient.platform.companiesAudit.query({
        companyId,
        limit: PAGE,
        ...(kind ? { action: `${kind}.` } : {}),
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    initialPageParam: undefined as { at: number; id: string } | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
    meta: { inlineError: true },
  });
  const rows = useMemo(() => {
    const seen = new Map<string, AuditRow>();
    for (const page of list.data?.pages ?? []) for (const r of page.items as AuditRow[]) if (!seen.has(r.id)) seen.set(r.id, r);
    return [...seen.values()];
  }, [list.data]);
  const when = (at: string) => `${formatDay(at, { locale })}, ${formatTime(at, locale)}`;

  if (list.isError && list.data === undefined) return <LoadError message={t("audit.loadFailed")} onRetry={() => void list.refetch()} />;

  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="company-audit">
      <Field id="company-audit-kind" label={t("audit.kind")} className="sm:max-w-xs">
        <NativeSelect id="company-audit-kind" value={kind} onChange={(e) => setKind(isAuditKind(e.target.value) ? e.target.value : "")} data-testid="company-audit-kind">
          <option value="">{t("audit.anyKind")}</option>
          {AUDIT_KINDS.map((k) => (
            <option key={k} value={k}>
              {t(`audit.kinds.${k}`)}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <AuditRows
        rows={rows}
        loading={list.isPending}
        when={when}
        label={t("audit.listLabel")}
        empty={<EmptyState title={t("admin.company.auditEmpty")} />}
      />
      {list.hasNextPage ? (
        <div>
          <Button variant="secondary" loading={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>
            {list.isFetchingNextPage ? t("audit.loadingMore") : t("audit.showMore")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

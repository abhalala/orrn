import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Field, TextInput } from "@orrn/ui/components/field";
import { NativeSelect } from "@orrn/ui/components/native-select";
import { PageHeader } from "@orrn/ui/components/page-header";
import { keepPreviousData, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import { Can } from "@/shared/components/can";
import { useCompanyWhen } from "@/features/stock/use-company-when";
import { useMe } from "@/shared/lib/me";
import { trpc, trpcClient } from "@/shared/utils/trpc";

import { AuditRows, type AuditRow } from "./audit-rows";
import { AUDIT_KINDS, auditInput, filtersActive, isAuditKind, type AuditFilters } from "./model";

const PAGE = 50;

/**
 * Audit log (`/audit`, FP-PF-16; `audit.read`: owner, admin, manager). Read only: filter by
 * person, kind, subject and dates, page back with "Show older entries". The filters live in the
 * URL so a view can be shared. Dates are the plant's calendar days.
 */
export function AuditScreen({ filters, onFilters }: { filters: AuditFilters; onFilters(next: AuditFilters): void }) {
  const { t, locale } = useT();
  const { data: me } = useMe();
  const when = useCompanyWhen();
  const tz = typeof me?.company?.settings?.timezone === "string" && me.company.settings.timezone ? me.company.settings.timezone : "Asia/Kolkata";
  const members = useQuery(trpc.company.membersList.queryOptions());

  const input = useMemo(() => auditInput(filters, tz), [filters, tz]);
  const list = useInfiniteQuery({
    queryKey: [["audit", "list"], { input, type: "infinite" }] as const,
    queryFn: ({ pageParam }) => trpcClient.audit.list.query({ ...input, limit: PAGE, ...(pageParam ? { cursor: pageParam } : {}) }),
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
  const since = list.data?.pages[0]?.from;

  // The subject box applies on Enter or blur, so each keystroke is not a request.
  const [subject, setSubject] = useState(filters.subject ?? "");
  useEffect(() => setSubject(filters.subject ?? ""), [filters.subject]);
  const set = (patch: Partial<AuditFilters>) => {
    const next = { ...filters, ...patch };
    for (const k of Object.keys(next) as (keyof AuditFilters)[]) if (next[k] === undefined || next[k] === "") delete next[k];
    onFilters(next);
  };
  const dateLabel = since ? new Intl.DateTimeFormat(locale === "hi" ? "hi-IN" : locale === "gu" ? "gu-IN" : "en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: tz, numberingSystem: "latn" }).format(new Date(since)) : "";

  return (
    <>
      <PageHeader title={t("audit.title")} subtitle={t("audit.subtitle")} />
      <Can do="audit.read" fallback={<div className="rounded-card border border-border bg-card"><EmptyState title={t("audit.noAccess")} /></div>}>
        <form
          role="search"
          aria-label={t("audit.filters")}
          className="grid min-w-0 grid-cols-1 gap-3 rounded-card border border-border bg-card p-4 sm:grid-cols-2 xl:grid-cols-5"
          data-testid="audit-filters"
          onSubmit={(e) => {
            e.preventDefault();
            set({ subject: subject.trim() });
          }}
        >
          <Field id="audit-actor" label={t("audit.actor")}>
            <NativeSelect id="audit-actor" value={filters.actor ?? ""} onChange={(e) => set({ actor: e.target.value })} data-testid="audit-actor">
              <option value="">{t("audit.anyone")}</option>
              {(members.data ?? []).map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.user.name || m.user.email}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field id="audit-kind" label={t("audit.kind")}>
            <NativeSelect
              id="audit-kind"
              value={filters.kind ?? ""}
              onChange={(e) => set({ kind: isAuditKind(e.target.value) ? e.target.value : undefined })}
              data-testid="audit-kind"
            >
              <option value="">{t("audit.anyKind")}</option>
              {AUDIT_KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(`audit.kinds.${k}`)}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label={t("audit.subject")} hint={t("audit.subjectHint")}>
            <TextInput
              value={subject}
              maxLength={64}
              autoComplete="off"
              spellCheck={false}
              data-testid="audit-subject"
              onChange={(e) => setSubject(e.currentTarget.value)}
              onBlur={() => subject.trim() !== (filters.subject ?? "") && set({ subject: subject.trim() })}
            />
          </Field>
          <Field label={t("audit.from")}>
            <TextInput type="date" value={filters.from ?? ""} max={filters.to} data-testid="audit-from" onChange={(e) => set({ from: e.currentTarget.value })} />
          </Field>
          <Field label={t("audit.to")}>
            <TextInput type="date" value={filters.to ?? ""} min={filters.from} data-testid="audit-to" onChange={(e) => set({ to: e.currentTarget.value })} />
          </Field>
          {filtersActive(filters) ? (
            <div className="sm:col-span-2 xl:col-span-5">
              <Button type="button" variant="secondary" onClick={() => onFilters({})} data-testid="audit-clear">
                {t("audit.clear")}
              </Button>
            </div>
          ) : null}
        </form>

        {list.isError && list.data === undefined ? (
          <div className="rounded-card border border-border bg-card">
            <EmptyState
              title={t("audit.loadFailed")}
              action={
                <Button variant="secondary" onClick={() => void list.refetch()}>
                  {t("common.retry")}
                </Button>
              }
            />
          </div>
        ) : (
          <div className="flex min-w-0 flex-col gap-3" data-testid="audit-list">
            {since ? <p className="m-0 text-[13px] text-muted-foreground">{t("audit.since", { date: dateLabel })}</p> : null}
            <AuditRows
              rows={rows}
              loading={list.isPending}
              when={when}
              label={t("audit.listLabel")}
              onSubject={(subjectId) => set({ subject: subjectId })}
              empty={
                <EmptyState
                  title={filtersActive(filters) ? t("audit.empty") : t("audit.emptyNone")}
                  body={filtersActive(filters) ? t("audit.emptyBody") : undefined}
                />
              }
            />
            {list.hasNextPage ? (
              <div>
                <Button variant="secondary" loading={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()} data-testid="audit-more">
                  {list.isFetchingNextPage ? t("audit.loadingMore") : t("audit.showMore")}
                </Button>
              </div>
            ) : null}
          </div>
        )}
      </Can>
    </>
  );
}

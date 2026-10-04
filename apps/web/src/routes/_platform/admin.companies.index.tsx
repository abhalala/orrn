import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Checkbox } from "@orrn/ui/components/checkbox";
import { Chip } from "@orrn/ui/components/chip";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Field, TextInput } from "@orrn/ui/components/field";
import { PageHeader } from "@orrn/ui/components/page-header";
import { ResponsiveList, type ResponsiveListColumn } from "@orrn/ui/components/responsive-list";
import { SegmentedControl } from "@orrn/ui/components/segmented-control";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useId, useRef, useState } from "react";

import { formatDay } from "@/features/admin/format";
import { companyStatusKey, companyStatusTone, printingKey, printingTone } from "@/features/admin/status";
import { showsLoadError } from "@/features/admin/query-state";
import type { CompanyListRow } from "@/features/admin/types";
import { LoadError } from "@/features/admin/ui";
import { trpc } from "@/shared/utils/trpc";

const STATUS_FILTERS = ["all", "active", "suspended", "pending"] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];
const PAGE_SIZE = 50;

type CompaniesSearch = { status: StatusFilter; printing?: boolean; offset?: number };

/** `?printing=1` is the old /admin/spool list (spec §3: "with a Printing filter"). */
function parsePrinting(value: unknown): boolean | undefined {
  return value === true || value === 1 || value === "1" || value === "true" ? true : undefined;
}

export const Route = createFileRoute("/_platform/admin/companies/")({
  component: AdminCompanies,
  validateSearch: (search: Record<string, unknown>): CompaniesSearch => {
    const status = STATUS_FILTERS.includes(search.status as StatusFilter) ? (search.status as StatusFilter) : "all";
    const offset = Number(search.offset);
    return {
      status,
      printing: parsePrinting(search.printing),
      offset: Number.isInteger(offset) && offset > 0 ? offset : undefined,
    };
  },
});

/** Waits `ms` after the last keystroke before searching. */
function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), ms);
    return () => window.clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

function AdminCompanies() {
  const { t, locale } = useT();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const printingId = useId();
  const [query, setQuery] = useState("");
  const debounced = useDebounced(query.trim(), 250);
  const offset = search.offset ?? 0;

  // A new search starts on the first page (not on mount: a link to page 2 stays on page 2).
  const lastSearch = useRef(debounced);
  useEffect(() => {
    if (lastSearch.current === debounced) return;
    lastSearch.current = debounced;
    if (offset > 0) void navigate({ search: (s) => ({ ...s, offset: undefined }), replace: true });
  }, [debounced, offset, navigate]);

  const list = useQuery({
    ...trpc.platform.companiesList.queryOptions({
      limit: PAGE_SIZE,
      offset,
      search: debounced || undefined,
      status: search.status === "all" ? undefined : search.status,
      printing: search.printing,
    }),
    placeholderData: keepPreviousData,
  });

  const filtered = Boolean(debounced) || search.status !== "all" || Boolean(search.printing);
  const rows = list.data?.items ?? [];

  const columns: ResponsiveListColumn<CompanyListRow>[] = [
    {
      key: "company",
      header: t("admin.companies.columns.company"),
      cell: (row) => (
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="font-semibold text-foreground break-words">{row.name}</span>
          <span className="font-mono text-[12px] font-normal text-muted-foreground [overflow-wrap:anywhere]">{row.slug}</span>
        </span>
      ),
    },
    {
      key: "status",
      header: t("admin.companies.columns.status"),
      phoneWide: true,
      cell: (row) => (
        <Chip tone={companyStatusTone(row.status)} truncate={false}>
          {t(companyStatusKey(row.status))}
        </Chip>
      ),
    },
    {
      key: "printing",
      header: t("admin.companies.columns.printing"),
      phoneWide: true,
      cell: (row) => (
        <Chip tone={printingTone(row.printing)} truncate={false}>
          {t(printingKey(row.printing))}
        </Chip>
      ),
    },
    {
      key: "members",
      header: t("admin.companies.columns.members"),
      align: "end",
      cell: (row) => <span className="font-mono tabular-nums">{row.memberCount}</span>,
    },
    {
      key: "joined",
      header: t("admin.companies.columns.joined"),
      cell: (row) => <span className="whitespace-nowrap">{formatDay(row.createdAt, { locale })}</span>,
    },
  ];

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <PageHeader
        title={t("admin.companies.title")}
        subtitle={list.data ? t("admin.companies.subtitle", { count: list.data.total }) : undefined}
      />

      <div className="flex min-w-0 flex-col gap-4 lg:flex-row lg:flex-wrap lg:items-end">
        <Field label={t("admin.companies.search")} className="lg:w-80">
          <TextInput
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("admin.companies.searchHint")}
            autoComplete="off"
            enterKeyHint="search"
          />
        </Field>
        <SegmentedControl
          label={t("admin.companies.status")}
          value={search.status}
          onChange={(status) => void navigate({ search: (s) => ({ ...s, status, offset: undefined }) })}
          options={[
            { value: "all", label: t("common.all") },
            { value: "active", label: t("status.company.active") },
            { value: "suspended", label: t("status.company.suspended") },
            { value: "pending", label: t("admin.companies.filterPending") },
          ]}
          className="max-w-full self-start lg:self-auto"
        />
        <label
          htmlFor={printingId}
          className="flex min-h-11 cursor-pointer items-center gap-3 self-start rounded-full pr-2 text-[15px] font-medium text-foreground lg:self-auto"
        >
          <Checkbox
            id={printingId}
            checked={Boolean(search.printing)}
            onCheckedChange={(checked) =>
              void navigate({ search: (s) => ({ ...s, printing: checked === true ? true : undefined, offset: undefined }) })
            }
          />
          {t("admin.companies.printingOnly")}
        </label>
      </div>

      {showsLoadError(list) ? (
        <LoadError message={t("admin.companies.loadError")} onRetry={() => void list.refetch()} />
      ) : (
        <ResponsiveList
          label={t("admin.companies.listLabel")}
          rows={rows}
          columns={columns}
          rowKey={(row) => row.id}
          rowHref={(row) => `/admin/companies/${encodeURIComponent(row.id)}`}
          loading={list.isFetching}
          total={list.data?.total}
          page={{
            offset,
            limit: PAGE_SIZE,
            onChange: (next) => void navigate({ search: (s) => ({ ...s, offset: next || undefined }) }),
          }}
          empty={
            filtered ? (
              <EmptyState
                title={t("admin.companies.emptyFiltered")}
                action={
                  <Button
                    variant="secondary"
                    onPress={() => {
                      setQuery("");
                      void navigate({ search: { status: "all" } });
                    }}
                  >
                    {t("admin.companies.clearFilters")}
                  </Button>
                }
              />
            ) : (
              <EmptyState title={t("admin.companies.empty")} />
            )
          }
        />
      )}
    </div>
  );
}

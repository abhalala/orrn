import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Field, TextInput } from "@orrn/ui/components/field";
import { UiLink } from "@orrn/ui/components/link";
import { PageHeader } from "@orrn/ui/components/page-header";
import { ResponsiveList, type ResponsiveListColumn } from "@orrn/ui/components/responsive-list";
import { useQuery } from "@tanstack/react-query";

import { kgFromG } from "@/features/press/model";
import { useCompanyWhen } from "@/features/stock/use-company-when";
import { Can } from "@/shared/components/can";
import { INLINE_ERROR_META, showsQueryError } from "@/shared/lib/query-errors";
import { trpc } from "@/shared/utils/trpc";

import type { BatchSummary } from "./hooks";
import { STATUS_FILTERS } from "./model";
import type { HistorySearch, HistoryStatus } from "./search";
import { PhaseChip, FieldSelect as NativeSelect } from "./ui";

const PAGE = 50;

/**
 * `/ageing/history` (FP-AG-05, 10): finished and live batches, newest first, with the production
 * day, oven, recipe and status filters. Reading needs `ageing.view`; the table is the server's page,
 * "1-50 of N", never a silently cut list. The CSV and the line-level report are `/reports/ageing`.
 */
export function HistoryScreen({ search, onSearch }: { search: HistorySearch; onSearch: (next: HistorySearch) => void }) {
  const { t } = useT();
  const when = useCompanyWhen();
  const offset = search.offset ?? 0;
  const ovens = useQuery({ ...trpc.ageing.ovens.list.queryOptions({ includeInactive: true }), meta: INLINE_ERROR_META });
  const list = useQuery({
    ...trpc.ageing.batches.list.queryOptions({
      limit: PAGE,
      offset,
      ...(search.status ? { status: search.status } : {}),
      ...(search.oven ? { ovenId: search.oven } : {}),
      ...(search.from ? { from: search.from } : {}),
      ...(search.to ? { to: search.to } : {}),
    }),
    meta: INLINE_ERROR_META,
  });
  const recipe = search.recipe?.toLowerCase();
  const items = (list.data?.items ?? []).filter((b) => !recipe || (b.recipeLabel ?? "").toLowerCase().includes(recipe));
  const set = (patch: Partial<HistorySearch>) => onSearch({ ...search, offset: undefined, ...patch });

  const columns: ResponsiveListColumn<BatchSummary>[] = [
    {
      key: "number",
      header: t("ageing.field.number"),
      cell: (b) => (
        <UiLink to={`/ageing/batch/${b.id}`} className="font-mono font-semibold whitespace-nowrap" data-testid="history-batch">
          {b.number}
        </UiLink>
      ),
    },
    { key: "day", header: t("ageing.field.day"), cell: (b) => <span className="font-mono tabular-nums whitespace-nowrap">{b.productionDay ?? "-"}</span> },
    { key: "oven", header: t("ageing.field.oven"), cell: (b) => <span className="font-mono">{b.ovenCode ?? "-"}</span> },
    { key: "trolley", header: t("ageing.field.trolley"), hideOnPhone: true, cell: (b) => <span className="font-mono">{b.trolleyCode}</span> },
    { key: "recipe", header: t("ageing.field.recipe"), cell: (b) => b.recipeLabel ?? "-" },
    { key: "in", header: t("ageing.field.inAt"), hideOnPhone: true, cell: (b) => (b.inAt ? <span className="whitespace-nowrap tabular-nums">{when(b.inAt)}</span> : "-") },
    { key: "pcs", header: t("ageing.field.loaded"), align: "end", cell: (b) => <span className="font-mono tabular-nums">{b.totals.loadedPcs} · {kgFromG(b.totals.loadedKgG)}</span> },
    { key: "status", header: t("ageing.field.verdict"), phoneWide: true, cell: (b) => <PhaseChip phase={b.phase} /> },
  ];

  const filtersOn = Boolean(search.status || search.oven || search.from || search.to || search.recipe);
  return (
    <>
      <PageHeader
        title={t("ageing.history.title")}
        subtitle={t("ageing.history.subtitle")}
        back={{ to: "/ageing", label: t("ageing.title") }}
        actions={
          <Can do="reports.read">
            <Button asChild variant="secondary">
              <UiLink to="/reports/ageing" className="no-underline">
                {t("ageing.history.report")}
              </UiLink>
            </Button>
          </Can>
        }
      />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5" data-testid="history-filters">
        <Field label={t("ageing.history.from")}>
          <TextInput type="date" value={search.from ?? ""} onChange={(e) => set({ from: e.currentTarget.value || undefined })} data-testid="history-from" />
        </Field>
        <Field label={t("ageing.history.to")}>
          <TextInput type="date" value={search.to ?? ""} onChange={(e) => set({ to: e.currentTarget.value || undefined })} data-testid="history-to" />
        </Field>
        <Field label={t("ageing.field.oven")}>
          <NativeSelect value={search.oven ?? ""} onChange={(e) => set({ oven: e.currentTarget.value || undefined })} data-testid="history-oven">
            <option value="">{t("ageing.history.anyOven")}</option>
            {(ovens.data?.items ?? []).map((o) => (
              <option key={o.id} value={o.id}>
                {o.code}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label={t("ageing.field.recipe")}>
          <TextInput value={search.recipe ?? ""} maxLength={40} placeholder="6063 T5" onChange={(e) => set({ recipe: e.currentTarget.value || undefined })} data-testid="history-recipe" />
        </Field>
        <Field label={t("ageing.field.verdict")}>
          <NativeSelect value={search.status ?? ""} onChange={(e) => set({ status: (e.currentTarget.value || undefined) as HistoryStatus | undefined })} data-testid="history-status">
            <option value="">{t("ageing.history.anyStatus")}</option>
            {STATUS_FILTERS.map((s) => (
              <option key={s} value={s}>
                {t(`ageing.status.${s}`)}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>
      {filtersOn ? (
        <div>
          <Button variant="ghost" size="sm" onClick={() => onSearch({})}>
            {t("ageing.history.clear")}
          </Button>
        </div>
      ) : null}
      {showsQueryError(list) ? (
        <div className="rounded-card border border-border bg-card">
          <EmptyState title={t("ageing.loadFailed")} action={<Button variant="secondary" onClick={() => void list.refetch()}>{t("common.retry")}</Button>} />
        </div>
      ) : (
        <ResponsiveList
          rows={items}
          columns={columns}
          rowKey={(b) => b.id}
          loading={list.isLoading}
          total={list.data?.total}
          page={{ offset, limit: PAGE, onChange: (o) => onSearch({ ...search, offset: o || undefined }) }}
          label={t("ageing.history.title")}
          empty={<EmptyState title={t("ageing.empty.noBatches")} />}
        />
      )}
    </>
  );
}

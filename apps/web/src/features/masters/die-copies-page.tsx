import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Field } from "@orrn/ui/components/field";
import { UiLink } from "@orrn/ui/components/link";
import { NativeSelect } from "@orrn/ui/components/native-select";
import { PageHeader } from "@orrn/ui/components/page-header";
import { ResponsiveList, type ResponsiveListColumn } from "@orrn/ui/components/responsive-list";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useId, useState } from "react";

import { Can } from "@/shared/components/can";
import { trpc } from "@/shared/utils/trpc";

import { DieCopySheet, SectionPicker } from "./die-copy-sheet";
import { DIE_CARD_EDITORS, DIE_COPY_STATUSES, dieCopyStatusView, kgPer12ftInput, type DieCopyStatus } from "./masters-model";
import { MastersLoadError, RowEdit } from "./masters-ui";
import { useMastersAccess, type DieCopyRow } from "./use-masters";

export type DieCopiesSearch = { section?: string; status?: DieCopyStatus; offset?: number };

const PAGE = 50;

/**
 * Die copies (route /masters/dies?section&status&offset): every physical copy across sections with
 * its tier, status and latest kg/12ft reading, filtered by section and status. The die room and
 * masters publishers add copies and edit cards in a sheet; the section link opens the section.
 */
export function DieCopiesPage({ search, onSearch }: { search: DieCopiesSearch; onSearch(next: DieCopiesSearch): void }) {
  const { t } = useT();
  const access = useMastersAccess();
  const statusId = `die-copies-status-${useId().replace(/:/g, "")}`;
  const offset = search.offset ?? 0;
  const list = useQuery({
    ...trpc.dieInstance.list.queryOptions({ sectionId: search.section, status: search.status, limit: PAGE, offset }),
    placeholderData: (prev) => prev,
  });
  const section = useQuery({
    ...trpc.die.get.queryOptions({ id: search.section ?? "" }),
    enabled: Boolean(search.section),
  });
  const [sheet, setSheet] = useState<{ open: boolean; row?: DieCopyRow }>({ open: false });
  const filtered = Boolean(search.section || search.status);
  const rows = list.data?.items ?? [];

  const columns: ResponsiveListColumn<DieCopyRow>[] = [
    {
      key: "copy",
      header: t("masters.dieCopies.columns.copy"),
      cell: (r) => (
        <RowEdit editable={access.canEditDieCopies} label={r.code} mono onEdit={() => setSheet({ open: true, row: r })}>
          {r.code}
        </RowEdit>
      ),
    },
    {
      key: "section",
      header: t("masters.dieCopies.columns.section"),
      cell: (r) => (
        <span className="flex min-w-0 flex-col">
          <UiLink
            to={`/dies/${encodeURIComponent(r.sectionId)}`}
            aria-label={t("masters.dieCopies.openSection", { code: r.sectionCode })}
            className="inline-flex min-h-11 items-center self-start font-mono font-medium whitespace-nowrap text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground"
          >
            {r.sectionCode}
          </UiLink>
          <span className="text-[13px] text-muted-foreground break-words">{r.sectionSeries}</span>
        </span>
      ),
    },
    {
      key: "tier",
      header: t("masters.dieCopies.columns.tier"),
      cell: (r) =>
        r.tierRank ? (
          <span className="font-medium">{t("masters.dieCopies.tier", { rank: r.tierRank })}</span>
        ) : (
          <span className="text-muted-foreground">{t("masters.dieCopies.notRanked")}</span>
        ),
    },
    {
      key: "latest",
      header: t("masters.dieCopies.columns.latest"),
      align: "end",
      cell: (r) =>
        r.latestKgPer12ftMilli ? (
          <span data-no-truncate="" className="font-mono tabular-nums">
            {kgPer12ftInput(r.latestKgPer12ftMilli)}
          </span>
        ) : (
          <span className="text-muted-foreground">{t("masters.dieCopies.noReading")}</span>
        ),
    },
    {
      key: "supplier",
      header: t("masters.dieCopies.columns.supplier"),
      hideOnPhone: true,
      cell: (r) => (r.supplier ? <span className="break-words">{r.supplier}</span> : <span className="text-muted-foreground">-</span>),
    },
    {
      key: "status",
      header: t("masters.dieCopies.columns.status"),
      cell: (r) => {
        const view = dieCopyStatusView(r.status as DieCopyStatus);
        return <Chip tone={view.tone ?? "neutral"}>{t(view.key)}</Chip>;
      },
    },
  ];

  return (
    <>
      <PageHeader
        back={{ to: "/masters", label: t("masters.backToMasters") }}
        title={t("masters.dieCopies.title")}
        subtitle={t("masters.dieCopies.subtitle")}
        actions={
          <Can do={DIE_CARD_EDITORS}>
            <Button onClick={() => setSheet({ open: true })} aria-haspopup="dialog">
              <Plus aria-hidden="true" strokeWidth={2} />
              {t("masters.dieCopies.add")}
            </Button>
          </Can>
        }
      />
      <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,220px)_auto]">
        <Field label={t("masters.dieCopies.filters.section")}>
          <SectionPicker
            value={search.section ?? null}
            valueLabel={section.data?.sectionCode}
            placeholder={t("masters.dieCopies.filters.sectionPlaceholder")}
            onChange={(id) => onSearch({ ...search, section: id, offset: undefined })}
          />
        </Field>
        <Field label={t("masters.dieCopies.filters.status")} id={statusId}>
          <NativeSelect
            id={statusId}
            value={search.status ?? ""}
            onChange={(e) =>
              onSearch({ ...search, status: (e.currentTarget.value || undefined) as DieCopyStatus | undefined, offset: undefined })
            }
          >
            <option value="">{t("masters.dieCopies.filters.allStatuses")}</option>
            {DIE_COPY_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`masters.dieCopies.status.${s}`)}
              </option>
            ))}
          </NativeSelect>
        </Field>
        {filtered ? (
          <Button variant="ghost" onClick={() => onSearch({})}>
            {t("masters.dieCopies.filters.clear")}
          </Button>
        ) : null}
      </div>
      {list.isError && !list.data ? (
        <MastersLoadError onRetry={() => void list.refetch()} />
      ) : (
        <ResponsiveList
          rows={rows}
          columns={columns}
          rowKey={(r) => r.id}
          loading={list.isLoading || list.isFetching}
          total={list.data?.total}
          page={{ offset, limit: PAGE, onChange: (next) => onSearch({ ...search, offset: next || undefined }) }}
          label={t("masters.dieCopies.title")}
          empty={
            filtered ? (
              <EmptyState title={t("masters.dieCopies.emptyFiltered")} />
            ) : (
              <EmptyState
                title={t("masters.dieCopies.empty")}
                body={t("masters.dieCopies.emptyBody")}
                action={
                  <Can do={DIE_CARD_EDITORS}>
                    <Button onClick={() => setSheet({ open: true })} aria-haspopup="dialog">
                      {t("masters.dieCopies.add")}
                    </Button>
                  </Can>
                }
              />
            )
          }
        />
      )}
      <DieCopySheet
        open={sheet.open}
        onOpenChange={(open) => setSheet((s) => ({ ...s, open }))}
        row={sheet.row}
        defaultSection={search.section && section.data ? { id: search.section, label: section.data.sectionCode } : null}
      />
    </>
  );
}

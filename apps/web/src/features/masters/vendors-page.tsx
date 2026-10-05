import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Field, TextInput } from "@orrn/ui/components/field";
import { PageHeader } from "@orrn/ui/components/page-header";
import { ResponsiveList, type ResponsiveListColumn } from "@orrn/ui/components/responsive-list";
import { SegmentedControl } from "@orrn/ui/components/segmented-control";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Merge, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Can } from "@/shared/components/can";
import { trpc } from "@/shared/utils/trpc";

import { formatDay, vendorStatusView, type VendorStatus } from "./masters-model";
import { companyToday, MasterNote, MastersLoadError, MastersNoAccess } from "./masters-ui";
import { MergeVendorsSheet } from "./merge-vendors-sheet";
import { useMastersAccess, type VendorRow } from "./use-masters";
import { VendorSheet } from "./vendor-sheet";

export type VendorFilter = "all" | "draft" | "archived" | "merged";
export type VendorsSearch = { q?: string; status?: Exclude<VendorFilter, "all">; offset?: number };

const PAGE = 50;

export function vendorPath(id: string): string {
  return `/vendors/${encodeURIComponent(id)}`;
}

/** Search box that pushes the term to the URL a moment after typing stops (Back keeps it). */
function VendorSearch({ value, onChange }: { value: string; onChange(q: string): void }) {
  const { t } = useT();
  const [text, setText] = useState(value);
  const latest = useRef(value);
  useEffect(() => {
    if (value !== latest.current) {
      latest.current = value;
      setText(value);
    }
  }, [value]);
  useEffect(() => {
    if (text.trim() === latest.current) return;
    const id = setTimeout(() => {
      latest.current = text.trim();
      onChange(text.trim());
    }, 300);
    return () => clearTimeout(id);
  }, [text, onChange]);
  return (
    <Field label={t("vendors.search")} hint={t("vendors.searchHint")}>
      <TextInput type="search" value={text} onChangeText={setText} autoComplete="off" enterKeyHint="search" />
    </Field>
  );
}

/**
 * Vendors (route /vendors?q&status&offset): who sells the plant scrap. Search covers other
 * spellings; the filter shows the vendors the yard added at the kanta (to confirm), archived and
 * merged ones. Publishers add vendors and merge duplicates from here.
 */
export function VendorsPage({ search, onSearch }: { search: VendorsSearch; onSearch(next: VendorsSearch): void }) {
  const { t } = useT();
  const navigate = useNavigate();
  const access = useMastersAccess();
  const offset = search.offset ?? 0;
  const filter: VendorFilter = search.status ?? "all";
  const list = useQuery({
    ...trpc.vendor.list.queryOptions({ q: search.q || undefined, status: search.status, limit: PAGE, offset }),
    enabled: access.canReadVendors,
    placeholderData: (prev) => prev,
  });
  const drafts = useQuery({
    ...trpc.vendor.list.queryOptions({ status: "draft", limit: 1, offset: 0 }),
    enabled: access.canReadVendors && access.canPublish && filter !== "draft",
  });
  const [adding, setAdding] = useState(false);
  const [merging, setMerging] = useState(false);
  const today = companyToday(access.me?.company?.settings?.timezone);

  const header = (
    <PageHeader
      back={{ to: "/masters", label: t("masters.backToMasters") }}
      title={t("vendors.title")}
      subtitle={t("vendors.subtitle")}
      actions={
        <Can do="masters.publish">
          <Button variant="secondary" onClick={() => setMerging(true)} aria-haspopup="dialog">
            <Merge aria-hidden="true" strokeWidth={2} />
            {t("vendors.merge")}
          </Button>
          <Button onClick={() => setAdding(true)} aria-haspopup="dialog">
            <Plus aria-hidden="true" strokeWidth={2} />
            {t("vendors.add")}
          </Button>
        </Can>
      }
    />
  );

  if (!access.canReadVendors) {
    return (
      <>
        {header}
        <MastersNoAccess titleKey="vendors.noAccess" bodyKey="vendors.noAccessBody" />
      </>
    );
  }

  const columns: ResponsiveListColumn<VendorRow>[] = [
    { key: "vendor", header: t("vendors.columns.vendor"), cell: (r) => <span className="break-words">{r.name}</span> },
    {
      key: "gstin",
      header: t("vendors.columns.gstin"),
      cell: (r) =>
        r.gstin ? (
          <span className="font-mono text-[13px] whitespace-nowrap">{r.gstin}</span>
        ) : (
          <span className="text-muted-foreground">{t("vendors.unregistered")}</span>
        ),
    },
    {
      key: "city",
      header: t("vendors.columns.city"),
      hideOnPhone: true,
      cell: (r) => (r.city ? <span className="break-words">{r.city}</span> : <span className="text-muted-foreground">-</span>),
    },
    {
      key: "lastLot",
      header: t("vendors.columns.lastLot"),
      cell: (r) =>
        r.lastLotDate ? (
          <span className="whitespace-nowrap tabular-nums">{formatDay(r.lastLotDate, today)}</span>
        ) : (
          <span className="text-muted-foreground">{t("vendors.noLots")}</span>
        ),
    },
    {
      key: "status",
      header: t("vendors.columns.status"),
      cell: (r) => {
        const view = vendorStatusView(r.status as VendorStatus);
        return view.tone ? (
          <Chip tone={view.tone}>{t(view.key)}</Chip>
        ) : (
          <span className="text-[14px] text-muted-foreground">{t(view.key)}</span>
        );
      },
    },
  ];

  const emptyFor = () => {
    if (search.q) return <EmptyState title={t("common.noResults", { query: search.q })} />;
    if (filter === "draft") return <EmptyState title={t("vendors.emptyDraft")} />;
    if (filter === "archived") return <EmptyState title={t("vendors.emptyArchived")} />;
    if (filter === "merged") return <EmptyState title={t("vendors.emptyMerged")} />;
    return (
      <EmptyState
        title={t("vendors.empty")}
        body={t("vendors.emptyBody")}
        action={
          <Can do="masters.publish">
            <Button onClick={() => setAdding(true)} aria-haspopup="dialog">
              {t("vendors.add")}
            </Button>
          </Can>
        }
      />
    );
  };

  const draftCount = drafts.data?.total ?? 0;

  return (
    <>
      {header}
      {draftCount > 0 && filter !== "draft" ? (
        <MasterNote
          tone="attention"
          body={`${t("vendors.toConfirm", { count: draftCount })}. ${t("vendors.toConfirmBody")}`}
          action={
            <Button variant="secondary" onClick={() => onSearch({ status: "draft" })}>
              {t("vendors.showThem")}
            </Button>
          }
        />
      ) : null}
      <div className="flex min-w-0 flex-col gap-4">
        <div className="grid grid-cols-1 items-end gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
          <VendorSearch value={search.q ?? ""} onChange={(q) => onSearch({ ...search, q: q || undefined, offset: undefined })} />
          <SegmentedControl<VendorFilter>
            label={t("vendors.show")}
            value={filter}
            onChange={(v) => onSearch({ ...search, status: v === "all" ? undefined : v, offset: undefined })}
            options={[
              { value: "all", label: t("vendors.showAll") },
              { value: "draft", label: t("vendors.showDraft") },
              { value: "archived", label: t("vendors.showArchived") },
              { value: "merged", label: t("vendors.showMerged") },
            ]}
          />
        </div>
        {list.isError && !list.data ? (
          <MastersLoadError onRetry={() => void list.refetch()} />
        ) : (
          <ResponsiveList
            rows={list.data?.items ?? []}
            columns={columns}
            rowKey={(r) => r.id}
            rowHref={(r) => vendorPath(r.id)}
            loading={list.isLoading || list.isFetching}
            total={list.data?.total}
            page={{ offset, limit: PAGE, onChange: (next) => onSearch({ ...search, offset: next || undefined }) }}
            label={t("vendors.title")}
            empty={emptyFor()}
          />
        )}
      </div>
      <VendorSheet open={adding} onOpenChange={setAdding} onCreated={(id) => void navigate({ to: "/vendors/$id", params: { id } })} />
      <MergeVendorsSheet open={merging} onOpenChange={setMerging} />
    </>
  );
}

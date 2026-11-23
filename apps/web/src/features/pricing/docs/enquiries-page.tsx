import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { PageHeader } from "@orrn/ui/components/page-header";
import { ResponsiveList, type ResponsiveListColumn } from "@orrn/ui/components/responsive-list";
import { SegmentedControl } from "@orrn/ui/components/segmented-control";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useState } from "react";

import { Can } from "@/shared/components/can";
import { RouterLink } from "@/shared/components/router-link";
import { useFmt } from "@/shared/lib/fmt";
import { kgGrouped1, massUnit } from "@/shared/lib/fmt-text";
import { trpc } from "@/shared/utils/trpc";

import { daysOverdue, enquiryBadge } from "./docs-model";
import { canMakeQuote, enquiryParty, enquirySection, type EnquiryRow } from "./enquiry-model";
import { EnquirySheet } from "./enquiry-sheet";
import { ENQUIRY_VIEWS, type EnquiryView } from "./search";

type Row = EnquiryRow & { overdue: boolean; quoteId: string | null; quoteNumber: string | null };

const STATUS_TONE: Record<string, "blue" | "amber" | "green" | "red" | "neutral"> = { open: "blue", quoted: "amber", won: "green", lost: "red", dropped: "neutral" };

/**
 * `/pricing/enquiries`: the enquiries with their follow-up dates, the overdue ones marked and first. Open, overdue or
 * all (`?overdue=1` or `?view=all`). A row opens the edit sheet; "Make quote" starts a quote from it.
 */
export function EnquiriesPage({ view, onView }: { view: EnquiryView; onView(view: EnquiryView): void }) {
  const { t } = useT();
  const fmt = useFmt();
  const [sheet, setSheet] = useState<{ open: boolean; row?: Row }>({ open: false });
  const list = useQuery({
    ...trpc.pricing.enquiries.list.queryOptions({ limit: 100, ...(view === "overdue" ? { overdue: true } : view === "open" ? { open: true } : {}) }),
    placeholderData: keepPreviousData,
  });
  const today = list.data?.today ?? "";
  const rows = (list.data?.items ?? []) as unknown as Row[];

  const columns: ResponsiveListColumn<Row>[] = [
    {
      key: "party",
      header: t("price.enquiries.columns.party"),
      cell: (r) => (
        <Can do="enquiry.manage" fallback={<span className="font-semibold">{enquiryParty(r)}</span>}>
          <button type="button" onClick={() => setSheet({ open: true, row: r })} aria-haspopup="dialog" className="min-h-11 text-left font-semibold underline-offset-2 hover:underline">
            {enquiryParty(r)}
          </button>
        </Can>
      ),
    },
    { key: "contact", header: t("price.enquiries.columns.contact"), hideOnPhone: true, cell: (r) => r.contact ?? <span className="text-muted-foreground">-</span> },
    { key: "section", header: t("price.enquiries.columns.section"), cell: (r) => enquirySection(r) || <span className="text-muted-foreground">-</span> },
    { key: "kg", header: `${t("price.enquiries.columns.weight")} ${massUnit(fmt)}`, align: "end", hideOnPhone: true, cell: (r) => (r.kgG != null ? <span className="font-mono tabular-nums">{kgGrouped1(fmt, r.kgG)}</span> : <span className="text-muted-foreground">-</span>) },
    {
      key: "followUp",
      header: t("price.enquiries.columns.followUp"),
      phoneWide: true,
      cell: (r) => {
        const badge = enquiryBadge(r, today);
        const late = daysOverdue(r.followUpDate, today);
        return (
          <span className="flex flex-wrap items-center gap-1.5" data-enquiry-badge={badge}>
            <span className="whitespace-nowrap">{r.followUpDate ? fmt.day(r.followUpDate) : "-"}</span>
            {badge === "overdue" ? (
              <Chip tone="red" truncate={false}>
                {t("price.enquiries.overdue", { days: late })}
              </Chip>
            ) : badge === "dueToday" ? (
              <Chip tone="amber" truncate={false}>
                {t("price.enquiries.dueToday")}
              </Chip>
            ) : null}
          </span>
        );
      },
    },
    {
      key: "status",
      header: t("price.enquiries.columns.status"),
      cell: (r) => (
        <Chip tone={STATUS_TONE[r.status] ?? "neutral"} truncate={false}>
          {t(`price.enquiries.status.${(r.status in STATUS_TONE ? r.status : "open") as "open"}`)}
        </Chip>
      ),
    },
    {
      key: "actions",
      header: t("price.enquiries.columns.actions"),
      headerHidden: true,
      cell: (r) =>
        canMakeQuote(r.status) ? (
          <Can do="quote.manage">
            <Button variant="secondary" asChild>
              <Link to="/pricing/quotes/new" search={{ enquiryId: r.id }}>
                {t("price.enquiries.makeQuote")}
              </Link>
            </Button>
          </Can>
        ) : r.quoteId ? (
          <RouterLink to={`/pricing/quotes/${r.quoteId}`} className="font-mono text-[14px] font-semibold underline">
            {r.quoteNumber}
          </RouterLink>
        ) : null,
    },
  ];

  return (
    <>
      <PageHeader
        title={t("price.enquiries.title")}
        subtitle={t("price.enquiries.subtitle")}
        actions={
          <Can do="enquiry.manage">
            <Button size="lg" onClick={() => setSheet({ open: true })} aria-haspopup="dialog" data-add-enquiry="">
              <Plus aria-hidden="true" strokeWidth={2} />
              {t("price.enquiries.add")}
            </Button>
          </Can>
        }
      />
      <div className="flex min-w-0 flex-col gap-4">
        <SegmentedControl<EnquiryView>
          label={t("price.enquiries.filters.label")}
          value={view}
          onChange={onView}
          options={ENQUIRY_VIEWS.map((v) => ({ value: v, label: t(`price.enquiries.filters.${v}`) }))}
        />
        {list.isError && !list.data ? (
          <div role="alert" className="rounded-card border border-border bg-card">
            <EmptyState title={t("price.enquiries.loadFailed")} action={<Button onClick={() => void list.refetch()}>{t("common.retry")}</Button>} />
          </div>
        ) : (
          <ResponsiveList
            rows={rows}
            columns={columns}
            rowKey={(r) => r.id}
            loading={list.isLoading}
            label={t("price.enquiries.title")}
            empty={<EmptyState title={view === "overdue" ? t("price.enquiries.noneOverdue") : t("price.enquiries.empty")} />}
          />
        )}
        {list.data?.nextOffset != null ? <p className="m-0 text-[13px] text-muted-foreground">{t("price.enquiries.cut")}</p> : null}
      </div>
      <EnquirySheet open={sheet.open} onOpenChange={(open) => setSheet((s) => ({ ...s, open }))} row={sheet.row} />
    </>
  );
}

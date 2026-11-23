import { useT } from "@orrn/i18n";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { PageHeader } from "@orrn/ui/components/page-header";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";

import { Can } from "@/shared/components/can";
import { INLINE_ERROR_META } from "@/shared/lib/query-errors";
import { trpc } from "@/shared/utils/trpc";

import { nextLineKey, QuoteForm, type QuoteFormInitial } from "./quote-form";
import { newQuoteLine, prefillFromEnquiry } from "./quote-model";

/**
 * `/pricing/quotes/new?enquiryId=`: a new quote. From an enquiry the customer, the section and the kg are filled in
 * as far as the enquiry has them (there is no single-enquiry read, so the list is searched; the quote is linked to the
 * enquiry either way).
 */
export function NewQuotePage({ enquiryId }: { enquiryId?: string }) {
  const { t } = useT();
  return (
    <>
      <PageHeader title={t("price.quotes.new")} subtitle={t("price.quotes.form.subtitle")} back={{ to: "/pricing/quotes", label: t("price.quotes.title") }} />
      <Can
        do="quote.manage"
        fallback={
          <div role="alert" className="rounded-card border border-border bg-card">
            <EmptyState title={t("errors.forbidden")} />
          </div>
        }
      >
        {enquiryId ? <FromEnquiry enquiryId={enquiryId} /> : <QuoteForm initial={blank()} />}
      </Can>
    </>
  );
}

function blank(): QuoteFormInitial {
  return { customer: null, note: "", lines: [newQuoteLine(nextLineKey())] };
}

function FromEnquiry({ enquiryId }: { enquiryId: string }) {
  const list = useQuery({ ...trpc.pricing.enquiries.list.queryOptions({ limit: 100 }), meta: INLINE_ERROR_META });
  if (list.isPending) return <Skeleton className="h-40 w-full" />;
  const found = list.data?.items.find((e) => e.id === enquiryId);
  if (!found) return <QuoteForm initial={{ ...blank(), enquiryId }} />;
  const pre = prefillFromEnquiry(found, nextLineKey());
  return <QuoteForm initial={{ customer: pre.customer, note: found.note ?? "", lines: [pre.line], enquiryId }} />;
}

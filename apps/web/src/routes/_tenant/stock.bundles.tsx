import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Field, TextInput } from "@orrn/ui/components/field";
import { PageHeader } from "@orrn/ui/components/page-header";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { BundleList } from "@/features/stock/bundle-list";
import { PAGE_SIZE, offsetOf, pageWithinTotal, validateBundlesSearch } from "@/features/stock/bundle-search";
import { failedWithoutData } from "@/features/stock/section-page";
import { sectionLabel } from "@/features/stock/sections";
import { StatusFilter, type StatusFilterValue } from "@/features/stock/status-filter";
import { StockViewSwitch } from "@/features/stock/stock-view-switch";
import { trpc } from "@/shared/utils/trpc";

const FILTERS: readonly StatusFilterValue[] = ["all", "available", "reserved", "dispatched", "void"];
const SEARCH_DEBOUNCE_MS = 250;

export const Route = createFileRoute("/_tenant/stock/bundles")({
  validateSearch: validateBundlesSearch,
  component: AllBundles,
});

/**
 * `/stock/bundles` (was `/bundles`): every bundle, newest first, 50 a page
 * from the server. Status chips and a serial/PO search live in the URL, so
 * Back and shared links keep the view. Typing waits a moment before it
 * searches and keeps the last page on screen meanwhile (W15).
 */
function AllBundles() {
  const { t } = useT();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const status: StatusFilterValue = search.status ?? "all";
  const [text, setText] = useState(search.q ?? "");

  // Debounce typing into the URL. Back/forward or a cleared filter set `q` from outside: follow it.
  const lastSent = useRef(search.q ?? "");
  useEffect(() => {
    const next = text.trim();
    if (next === lastSent.current) return;
    const id = window.setTimeout(() => {
      lastSent.current = next;
      navigate({ search: (prev) => ({ ...prev, q: next || undefined, page: undefined }), replace: true });
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [text, navigate]);
  useEffect(() => {
    const fromUrl = search.q ?? "";
    if (fromUrl !== lastSent.current) {
      lastSent.current = fromUrl;
      setText(fromUrl);
    }
  }, [search.q]);

  const bundles = useQuery({
    ...trpc.bundle.listBundles.queryOptions({
      status: status === "all" ? undefined : status,
      search: search.q,
      dieId: search.dieId,
      groupId: search.groupId,
      limit: PAGE_SIZE,
      offset: offsetOf(search.page),
    }),
    placeholderData: keepPreviousData,
  });

  // A page past the end (the list shrank, or an old link): go to the last page that has rows.
  const total = bundles.data && !bundles.isPlaceholderData ? Number(bundles.data.total) : undefined;
  useEffect(() => {
    if (total === undefined) return;
    const fixed = pageWithinTotal(search.page, total);
    if (fixed !== search.page) navigate({ search: (prev) => ({ ...prev, page: fixed }), replace: true });
  }, [total, search.page, navigate]);

  const setStatus = (next: StatusFilterValue) =>
    navigate({ search: (prev) => ({ ...prev, status: next === "all" ? undefined : next, page: undefined }) });
  const setOffset = (offset: number) => {
    const page = offset / PAGE_SIZE + 1;
    navigate({ search: (prev) => ({ ...prev, page: page > 1 ? page : undefined }) });
  };
  const clearScope = () => navigate({ search: (prev) => ({ ...prev, dieId: undefined, groupId: undefined, page: undefined }) });
  // Name what an old /bundles?dieId=|groupId= link shows; every row shares it. No rows: the plain wording.
  const first = bundles.isPlaceholderData ? undefined : bundles.data?.items[0];
  const scope = search.groupId
    ? first
      ? t("stock.list.filterGroupNamed", { code: first.groupCode })
      : t("stock.list.filterGroup")
    : search.dieId
      ? first
        ? t("stock.list.filterDieNamed", { section: sectionLabel({ series: first.dieSeries, sectionCode: first.dieSectionCode }) })
        : t("stock.list.filterDie")
      : null;

  return (
    <>
      <PageHeader title={t("stock.list.title")} />
      <StockViewSwitch current="bundles" />

      <div className="flex flex-col gap-3">
        <Field label={t("stock.list.search")} className="md:max-w-sm">
          <TextInput
            type="search"
            value={text}
            onChangeText={setText}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            enterKeyHint="search"
            data-testid="bundle-search"
          />
        </Field>
        <StatusFilter value={status} options={FILTERS} onChange={setStatus} />
        {scope ? (
          <div className="flex flex-wrap items-center gap-2">
            <p className="m-0 text-[14px] font-medium text-muted-foreground">{scope}</p>
            <Button variant="ghost" className="px-3" onClick={clearScope}>
              <X aria-hidden="true" strokeWidth={2} />
              {t("stock.list.clearFilter")}
            </Button>
          </div>
        ) : null}
      </div>

      <BundleList
        rows={bundles.data?.items ?? []}
        total={bundles.data ? Number(bundles.data.total) : undefined}
        page={{ offset: offsetOf(search.page), limit: PAGE_SIZE, onChange: setOffset }}
        loading={bundles.isFetching}
        label={t("stock.list.bundlesLabel")}
        empty={
          failedWithoutData(bundles) ? (
            <EmptyState
              title={t("stock.loadError")}
              action={
                <Button variant="secondary" onClick={() => void bundles.refetch()}>
                  {t("common.retry")}
                </Button>
              }
            />
          ) : search.q ? (
            <EmptyState
              title={t("common.noResults", { query: search.q })}
              action={
                <Button variant="secondary" onClick={() => setText("")}>
                  {t("stock.clearSearch")}
                </Button>
              }
            />
          ) : (
            <EmptyState title={t("stock.list.empty")} />
          )
        }
      />
    </>
  );
}

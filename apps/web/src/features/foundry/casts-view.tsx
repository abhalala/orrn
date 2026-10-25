import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Field, TextInput } from "@orrn/ui/components/field";
import { UiLink } from "@orrn/ui/components/link";
import { PageHeader } from "@orrn/ui/components/page-header";
import { ResponsiveList, type ResponsiveListColumn } from "@orrn/ui/components/responsive-list";
import { SegmentedControl } from "@orrn/ui/components/segmented-control";
import type { AppRouter } from "@orrn/server/routers/index";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import { useState } from "react";

import { kgFromG } from "@/features/press/model";
import { useCompanyWhen } from "@/features/stock/use-company-when";
import { Can } from "@/shared/components/can";
import { INLINE_ERROR_META, showsQueryError } from "@/shared/lib/query-errors";
import { trpc, trpcClient } from "@/shared/utils/trpc";

import { CAST_STATUSES, CAST_TONE, castPeriodText, parseCastsSearch, traceQuery, type CastsSearch, type CastStatus } from "./model";
import { ErrorLine, LoadFailed, Note } from "./ui";

type CastRow = inferRouterOutputs<AppRouter>["foundry"]["casts"]["list"]["items"][number];

export const CASTS_PAGE = 25;

/**
 * `/casts` (FP-FD-02, 17): every cast, newest first, filtered by status; the Open cast button; the
 * spectro inbox and billet stock links; and one box that traces a cast code (`K31`) or a bundle
 * number to the cast it came from.
 */
export function CastsScreen({ search, onSearch }: { search: CastsSearch; onSearch(next: CastsSearch): void }) {
  const { t } = useT();
  const when = useCompanyWhen();
  const [offset, setOffset] = useState(0);
  const query = useQuery({
    ...trpc.foundry.casts.list.queryOptions({
      ...(search.status ? { status: search.status } : {}),
      ...(search.q && traceQuery(search.q)?.kind === "cast" ? { number: search.q } : {}),
      limit: CASTS_PAGE,
      offset,
    }),
    meta: INLINE_ERROR_META,
  });
  const header = (
    <PageHeader
      title={t("foundry.casts.title")}
      subtitle={t("foundry.casts.subtitle")}
      actions={
        <div className="flex flex-wrap gap-2">
          <Can do="cast.enter">
            <Button asChild>
              <UiLink to="/casts/new" data-testid="open-cast">
                {t("foundry.casts.open")}
              </UiLink>
            </Button>
            <Button asChild variant="secondary">
              <UiLink to="/casts/inbox">{t("foundry.inbox.title")}</UiLink>
            </Button>
          </Can>
          <Button asChild variant="secondary">
            <UiLink to="/foundry/stock">{t("foundry.stock.title")}</UiLink>
          </Button>
        </div>
      }
    />
  );

  const columns: ResponsiveListColumn<CastRow>[] = [
    {
      key: "number",
      header: t("foundry.casts.columns.cast"),
      cell: (c) => (
        <span className="flex min-w-0 flex-col">
          <span className="font-mono text-[17px] font-bold whitespace-nowrap" data-testid="cast-number">
            {c.number}
          </span>
          <span className="text-[13px] text-muted-foreground">{castPeriodText(c.year, c.month)}</span>
        </span>
      ),
    },
    { key: "alloy", header: t("foundry.casts.columns.alloy"), cell: (c) => <span className="font-mono font-semibold">{c.alloy}</span> },
    {
      key: "status",
      header: t("foundry.casts.columns.status"),
      phoneWide: true,
      cell: (c) => <Chip tone={CAST_TONE[c.status]}>{t(`foundry.casts.status.${c.status}`)}</Chip>,
    },
    {
      key: "melts",
      header: t("foundry.casts.columns.melts"),
      cell: (c) => (
        <span className="tabular-nums">
          {c.meltCount}
          {c.draftMelts > 0 ? <span className="text-muted-foreground"> · {t("foundry.casts.drafts", { count: c.draftMelts })}</span> : null}
        </span>
      ),
    },
    { key: "logs", header: t("foundry.casts.columns.logs"), align: "end", cell: (c) => <span className="tabular-nums whitespace-nowrap">{kgFromG(c.logsG)} {t("units.kg")}</span> },
    { key: "onHand", header: t("foundry.casts.columns.onHand"), align: "end", cell: (c) => <span className="tabular-nums whitespace-nowrap">{kgFromG(c.billetsOnHandG)} {t("units.kg")}</span> },
    { key: "opened", header: t("foundry.casts.columns.opened"), hideOnPhone: true, cell: (c) => <span className="tabular-nums text-[14px]">{when(c.openedAt)}</span> },
  ];

  return (
    <>
      {header}
      <TraceBox search={search} onSearch={(next) => { setOffset(0); onSearch(next); }} />
      <SegmentedControl
        label={t("foundry.casts.filter.label")}
        value={search.status ?? "all"}
        onChange={(v) => {
          setOffset(0);
          onSearch({ ...search, status: v === "all" ? undefined : (v as CastStatus) });
        }}
        options={[{ value: "all", label: t("foundry.casts.filter.all") }, ...CAST_STATUSES.map((s) => ({ value: s, label: t(`foundry.casts.status.${s}`) }))]}
      />
      {showsQueryError(query) ? (
        <LoadFailed title={t("foundry.casts.loadFailed")} onRetry={() => void query.refetch()} />
      ) : (
        <ResponsiveList
          rows={query.data?.items ?? []}
          columns={columns}
          rowKey={(c) => c.id}
          rowHref={(c) => `/casts/${c.id}`}
          loading={query.isLoading}
          label={t("foundry.casts.title")}
          total={query.data?.total}
          page={{ offset, limit: CASTS_PAGE, onChange: setOffset }}
          empty={
            <EmptyState
              title={search.q || search.status ? t("foundry.casts.emptyFiltered") : t("foundry.casts.empty")}
              description={search.q || search.status ? undefined : t("foundry.casts.emptyHint")}
              action={
                <Can do="cast.enter">
                  <Button asChild>
                    <UiLink to="/casts/new">{t("foundry.casts.open")}</UiLink>
                  </Button>
                </Can>
              }
            />
          }
        />
      )}
    </>
  );
}

/** One box for "K31" or "26J1842": a cast code filters the list, a bundle number says which cast it came from. */
function TraceBox({ search, onSearch }: { search: CastsSearch; onSearch(next: CastsSearch): void }) {
  const { t } = useT();
  const [text, setText] = useState(search.q ?? "");
  const [problem, setProblem] = useState<"code" | null>(null);
  const bundle = useMutation({ mutationFn: (serial: string) => trpcClient.foundry.casts.traceBundle.query({ serial }) });
  const submit = () => {
    const q = traceQuery(text);
    bundle.reset();
    if (!q) {
      setProblem("code");
      return;
    }
    setProblem(null);
    if (q.kind === "cast") onSearch({ ...search, q: q.number });
    else {
      onSearch({ status: search.status });
      bundle.mutate(q.serial);
    }
  };
  const result = bundle.data;
  return (
    <form
      className="flex min-w-0 flex-col gap-2"
      role="search"
      aria-label={t("foundry.casts.trace.label")}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[12rem] flex-1 sm:max-w-sm">
          <Field label={t("foundry.casts.trace.label")} error={problem ? t("foundry.casts.trace.notCode") : undefined}>
            <TextInput
              value={text}
              autoCapitalize="characters"
              autoComplete="off"
              placeholder={t("foundry.casts.trace.placeholder")}
              data-testid="trace-input"
              onChange={(e) => {
                setText(e.currentTarget.value);
                setProblem(null);
              }}
            />
          </Field>
        </div>
        <Button type="submit" variant="secondary" loading={bundle.isPending} data-testid="trace-go">
          {t("foundry.casts.trace.go")}
        </Button>
        {search.q ? (
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setText("");
              onSearch({ status: search.status });
            }}
          >
            {t("reports.clear")}
          </Button>
        ) : null}
      </div>
      {bundle.error ? <ErrorLine error={bundle.error} /> : null}
      {result ? (
        result.chain ? (
          <Note tone="green" testId="trace-bundle-result">
            {t("foundry.casts.trace.bundleFrom", { serial: result.bundle.serial, number: result.chain.cast.number })}{" "}
            <UiLink to={`/casts/${result.chain.cast.id}?tab=trace&bundle=${encodeURIComponent(result.bundle.serial)}`} className="font-semibold underline underline-offset-4">
              {t("foundry.casts.trace.openTrace")}
            </UiLink>
          </Note>
        ) : (
          <Note tone="amber" testId="trace-bundle-result">
            {t("foundry.casts.trace.noCast", { serial: result.bundle.serial })}
          </Note>
        )
      ) : null}
    </form>
  );
}

export { parseCastsSearch };

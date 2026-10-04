import { formatKgTotal, gToKg } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { ActionTile } from "@orrn/ui/components/action-tile";
import { BigNumber } from "@orrn/ui/components/big-number";
import { Button } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { TextInput } from "@orrn/ui/components/field";
import { HowToButton } from "@orrn/ui/components/how-to-button";
import { UiLink } from "@orrn/ui/components/link";
import { PageHeader } from "@orrn/ui/components/page-header";
import { ResponsiveList, type ResponsiveListColumn } from "@orrn/ui/components/responsive-list";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { cn } from "@orrn/ui/lib/utils";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Plus, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { packedWhen } from "@/features/pack/format";
import { timezoneOf } from "@/features/pack/pack-ui";
import { readDraft } from "@/features/pack/use-pack-draft";
import { Can } from "@/shared/components/can";
import { can, useMe } from "@/shared/lib/me";
import { trpc } from "@/shared/utils/trpc";

export const Route = createFileRoute("/_tenant/pack/")({
  component: PackList,
});

const PAGE = 25;

type SessionRow = {
  id: string;
  code: string;
  dieSeries: string;
  dieSectionCode: string;
  purchaseOrderRef: string | null;
  createdAt: Date | string | number;
  createdByName: string | null;
  bundleCount: number;
  totalWeightG: number;
};

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

/** sessionStorage, or null where reading it throws. */
function sessionStore(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/**
 * `/pack`: packing sessions, newest first (so today's are on top). The one
 * loud element is the blue "New packing session" tile (Pack's colour on
 * Today); next to it a quiet count of what was packed today. An unsaved
 * session in this tab shows as an amber "Not saved" row to continue.
 */
function PackList() {
  const { t, locale } = useT();
  const { data: me } = useMe();
  const timeZone = timezoneOf(me?.company?.settings);
  const canPack = can(me, "bundle.pack");
  const [text, setText] = useState("");
  const search = useDebounced(text.trim(), 250);
  const [offset, setOffset] = useState(0);

  useEffect(() => setOffset(0), [search]);

  const sessions = useQuery({
    ...trpc.bundle.listGroups.queryOptions({ search: search || undefined, limit: PAGE, offset }),
    placeholderData: keepPreviousData,
  });
  const today = useQuery(trpc.dashboard.today.queryOptions());

  const draft = useMemo(
    () => (me?.company && canPack ? readDraft(sessionStore(), me.company.id) : null),
    [me?.company, canPack],
  );

  const when = (at: SessionRow["createdAt"]) => {
    const w = packedWhen(at instanceof Date ? at : new Date(at), { timeZone, locale });
    if (w.day === "today") return t("pack.whenToday", { time: w.time });
    if (w.day === "yesterday") return t("pack.whenYesterday", { time: w.time });
    return t("pack.whenDate", { date: w.date, time: w.time });
  };

  const columns: ResponsiveListColumn<SessionRow>[] = [
    {
      key: "code",
      header: t("pack.columns.session"),
      cell: (r) => <span className="font-mono font-semibold whitespace-nowrap">{r.code}</span>,
    },
    {
      key: "die",
      header: t("pack.columns.die"),
      cell: (r) => (
        <span className="inline-flex flex-wrap items-baseline gap-x-2">
          <span className="font-mono font-semibold">{r.dieSectionCode}</span>
          <span className="text-[13px] text-muted-foreground">{r.dieSeries}</span>
        </span>
      ),
    },
    {
      key: "bundles",
      header: t("pack.columns.bundles"),
      align: "end",
      cell: (r) => <span className="font-mono tabular-nums">{r.bundleCount}</span>,
    },
    {
      key: "kg",
      header: t("pack.columns.kg"),
      align: "end",
      cell: (r) => <span className="font-mono tabular-nums">{formatKgTotal(gToKg(r.totalWeightG))}</span>,
    },
    {
      key: "po",
      header: t("pack.columns.po"),
      hideOnPhone: true,
      cell: (r) => (r.purchaseOrderRef ? <span className="font-mono break-all">{r.purchaseOrderRef}</span> : null),
    },
    {
      key: "by",
      header: t("pack.columns.packedBy"),
      cell: (r) => r.createdByName ?? <span className="text-muted-foreground">{t("pack.unknownPacker")}</span>,
    },
    {
      key: "when",
      header: t("pack.columns.when"),
      cell: (r) => <span className="whitespace-nowrap tabular-nums">{when(r.createdAt)}</span>,
    },
  ];

  const rows = (sessions.data?.items ?? []) as SessionRow[];
  const packedToday = today.data?.packedToday;

  return (
    <>
      <PageHeader title={t("pack.title")} actions={<HowToButton slug="pack-session" />} />

      <div className={cn("grid gap-3", canPack && "md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]")}>
        <Can do="bundle.pack">
          <ActionTile
            tone="blue"
            title={t("pack.newSession")}
            hint={t("pack.newSessionHint")}
            icon={<Plus />}
            to="/pack/new"
            className="min-h-[152px] animate-rise"
          />
        </Can>
        <div
          data-slot="packed-today"
          className={cn(
            "flex min-w-0 flex-col justify-between gap-3 rounded-block border border-border bg-card p-4 shadow-sm sm:p-5",
            !canPack && "md:max-w-[420px]",
          )}
        >
          <span className="text-[15px] font-semibold">{t("pack.packedToday")}</span>
          {today.isPending ? (
            <div className="flex flex-col gap-2" aria-hidden="true">
              <Skeleton className="h-11 w-24" />
              <Skeleton className="h-4 w-32" />
            </div>
          ) : today.isError || !packedToday ? (
            <span className="text-[14px] text-muted-foreground">{t("pack.loadFailed")}</span>
          ) : (
            <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
              <span className="flex items-baseline gap-2">
                <BigNumber value={packedToday.bundles} className="text-[44px]" />
                <span className="text-[14px] font-semibold text-muted-foreground">
                  {t("pack.bundlesWord", { count: packedToday.bundles })}
                </span>
              </span>
              <span className="flex items-baseline gap-1.5">
                <span data-no-truncate="" className="font-mono text-[20px] font-semibold tabular-nums">
                  {formatKgTotal(gToKg(packedToday.weightG))}
                </span>
                <span className="text-[14px] font-semibold text-muted-foreground">{t("units.kg")}</span>
              </span>
            </div>
          )}
        </div>
      </div>

      {draft && draft.bundles.length > 0 ? (
        <div
          data-slot="pack-draft"
          className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-card border border-border bg-card px-4 py-3"
        >
          <Chip tone="amber">{t("pack.draft.chip")}</Chip>
          <p className="m-0 min-w-0 flex-1 basis-[14rem] text-[14px] font-medium">
            {t("pack.draft.body", { count: draft.bundles.length })}
          </p>
          <Button asChild variant="secondary">
            <UiLink to="/pack/new">{t("pack.draft.resume")}</UiLink>
          </Button>
        </div>
      ) : null}

      <section aria-labelledby="pack-sessions-title" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 id="pack-sessions-title" className="m-0 text-[17px] font-semibold">
            {t("pack.listLabel")}
          </h2>
          <div className="flex w-full flex-col gap-1.5 sm:w-[320px]">
            <label htmlFor="pack-search" className="text-[13px] font-medium text-muted-foreground">
              {t("pack.search")}
            </label>
            <div className="relative">
              <Search
                aria-hidden="true"
                strokeWidth={2}
                className="pointer-events-none absolute top-1/2 left-3.5 size-[18px] -translate-y-1/2 text-muted-foreground"
              />
              <TextInput
                id="pack-search"
                type="search"
                value={text}
                onChange={(e) => setText(e.currentTarget.value)}
                autoComplete="off"
                enterKeyHint="search"
                className="pl-10"
              />
            </div>
          </div>
        </div>

        {sessions.isError ? (
          <div className="rounded-card border border-border bg-card">
            <EmptyState
              title={t("pack.loadFailed")}
              action={
                <Button variant="secondary" onClick={() => void sessions.refetch()}>
                  {t("common.retry")}
                </Button>
              }
            />
          </div>
        ) : (
          <ResponsiveList
            rows={rows}
            columns={columns}
            rowKey={(r) => r.id}
            rowHref={(r) => `/pack/${r.id}`}
            label={t("pack.listLabel")}
            loading={sessions.isFetching}
            total={sessions.data?.total}
            page={{ offset, limit: PAGE, onChange: setOffset }}
            empty={
              search ? (
                <EmptyState title={t("pack.noMatch", { query: search })} />
              ) : (
                <EmptyState
                  title={t("pack.empty")}
                  action={
                    <Can do="bundle.pack">
                      <Button asChild>
                        <UiLink to="/pack/new">{t("pack.emptyAction")}</UiLink>
                      </Button>
                    </Can>
                  }
                />
              )
            }
          />
        )}
      </section>
    </>
  );
}

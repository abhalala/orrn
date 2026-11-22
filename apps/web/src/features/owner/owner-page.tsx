import { bpPercent1 } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { PageHeader } from "@orrn/ui/components/page-header";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { Can } from "@/shared/components/can";
import { useFmt } from "@/shared/lib/fmt";
import { kgGrouped3 } from "@/shared/lib/fmt-text";
import { INLINE_ERROR_META, showsQueryError } from "@/shared/lib/query-errors";
import { trpc } from "@/shared/utils/trpc";

import { MorningMailCard } from "./morning-mail-card";
import { ownerTiles, shiftDay } from "./model";
import { isDay, type OwnerSearch } from "./search";

/** `/owner`: yesterday at the plant in six tiles, the same figures as the morning mail (`reports.morning`, `mis.view`), and the mail setting below. */
export function OwnerPage({ search, onSearch }: { search: OwnerSearch; onSearch: (next: OwnerSearch) => void }) {
  const { t } = useT();
  return (
    <Can
      do="mis.view"
      fallback={
        <div className="rounded-card border border-border bg-card" data-testid="owner-no-access">
          <EmptyState title={t("reg.owner.noAccess")} />
        </div>
      }
    >
      <OwnerBody search={search} onSearch={onSearch} />
    </Can>
  );
}

function OwnerBody({ search, onSearch }: { search: OwnerSearch; onSearch: (next: OwnerSearch) => void }) {
  const { t } = useT();
  const fmt = useFmt();
  const query = useQuery({ ...trpc.reports.morning.queryOptions(search.day ? { day: search.day } : {}), meta: INLINE_ERROR_META });
  const data = query.data;
  const tiles = useMemo(
    () => (data ? ownerTiles(data, { kg: (g) => `${kgGrouped3(fmt, g)} kg`, pct: (bp) => `${bpPercent1(bp)} %` }, t) : []),
    [data, fmt, t],
  );
  const day = data?.day ?? search.day;

  return (
    <>
      <PageHeader title={t("reg.owner.title")} subtitle={t("reg.owner.subtitle")} />
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" disabled={!day} onClick={() => day && onSearch({ day: shiftDay(day, -1) })} aria-label={day ? t("reg.owner.day", { day: shiftDay(day, -1) }) : t("reg.owner.pickDay")} data-testid="owner-prev">
          &lt;
        </Button>
        <label className="flex items-center gap-2 text-[14px] font-semibold">
          {t("reg.owner.pickDay")}
          <input
            type="date"
            value={day ?? ""}
            onChange={(e) => {
              const v = e.currentTarget.value;
              if (isDay(v)) onSearch({ day: v });
            }}
            className="h-11 rounded-card border border-border bg-card px-3 text-[15px]"
            data-testid="owner-day"
          />
        </label>
        <Button variant="secondary" disabled={!day} onClick={() => day && onSearch({ day: shiftDay(day, 1) })} aria-label={day ? t("reg.owner.day", { day: shiftDay(day, 1) }) : t("reg.owner.pickDay")} data-testid="owner-next">
          &gt;
        </Button>
        {data ? <span className="text-[14px] text-muted-foreground">{t("reg.owner.day", { day: data.day })}</span> : null}
      </div>

      {showsQueryError(query) ? (
        <div className="rounded-card border border-border bg-card">
          <EmptyState title={t("reg.owner.loadFailed")} action={<Button variant="secondary" onClick={() => void query.refetch()}>{t("common.retry")}</Button>} />
        </div>
      ) : !data ? (
        <Skeleton className="h-48 rounded-card" />
      ) : (
        <div className="grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-3" data-testid="owner-tiles">
          {tiles.map((tile) => (
            <section key={tile.id} data-testid={`owner-tile-${tile.id}`} className="flex min-w-0 flex-col gap-2 rounded-card border border-border bg-card p-5">
              <h2 className="m-0 text-[14px] font-semibold text-muted-foreground">{tile.label}</h2>
              <p className="m-0 font-display text-[36px] leading-none font-extrabold tracking-[-0.04em] tabular-nums" data-no-truncate="">
                {tile.value}
              </p>
              {tile.notes.map((n) => (
                <p key={n} className="m-0 text-[14px] text-muted-foreground">
                  {n}
                </p>
              ))}
              {tile.lines && tile.lines.length > 0 ? (
                <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[14px]">
                  {tile.lines.map((l) => (
                    <li key={l} className="break-words">
                      {l}
                    </li>
                  ))}
                </ul>
              ) : null}
              {tile.empty ? <p className="m-0 text-[14px] text-muted-foreground">{tile.empty}</p> : null}
            </section>
          ))}
        </div>
      )}

      <MorningMailCard />
    </>
  );
}

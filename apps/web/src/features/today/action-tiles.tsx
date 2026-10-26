import { useT } from "@orrn/i18n";
import { ActionTile, type ActionTileProps } from "@orrn/ui/components/action-tile";
import { riseDelay } from "@orrn/ui/components/motion";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { cn } from "@orrn/ui/lib/utils";
import { useId } from "react";

import { useMe } from "@/shared/lib/me";

import { tileHint, tileLayout, todayTiles, type TodayTile } from "./today-model";

/** Each tile keeps its area colour in the icon well (spec: Pack blue, Dispatch red, Stock amber, Guides black). */
const ACCENT: Record<TodayTile["key"], NonNullable<ActionTileProps["accent"]>> = {
  orders: "green",
  dieRoom: "amber",
  press: "blue",
  pack: "blue",
  dispatch: "red",
  stock: "amber",
  store: "green",
  approvals: "ink",
  guides: "ink",
};

/**
 * Shortcuts by role (BACKLOG 35, FP-PF-15): the server's tiles for this role
 * (`dashboard.today.tiles`), each with the count it acts on (orders open, runs to
 * issue, the press queue, dispatches open, approvals waiting). Viewers get none
 * (spec section 3: "Viewers see no action tiles, only numbers"). Quiet white
 * tiles: the KPI row above is the screen's one loud element (design brief).
 * Without the server's answer (loading or error) the same role table is used and
 * counted tiles read a plain line instead of a count. Columns follow the tile
 * count (`tileLayout`), so office's three tiles fill their row.
 */
export function TodayTiles({ tiles: served, startIndex = 0 }: { tiles?: readonly { key: string; count: number | null }[]; startIndex?: number }) {
  const { t } = useT();
  const { data: me } = useMe();
  const headingId = useId();
  const tiles = todayTiles(me, served);
  if (tiles.length === 0) return null;
  const layout = tileLayout(tiles.length);
  const countOf = (key: string) => served?.find((x) => x.key === key)?.count;

  return (
    <section aria-labelledby={headingId} data-testid="today-tiles">
      <h2 id={headingId} className="sr-only">
        {t("today.shortcutsHeading")}
      </h2>
      <ul className={cn("m-0 grid list-none gap-3 p-0", layout.grid)}>
        {tiles.map((tile, i) => {
          const Icon = tile.icon;
          const hint = tileHint(tile, countOf(tile.key));
          const spans = layout.spanLast && i === tiles.length - 1;
          return (
            <li
              key={tile.key}
              data-tile={tile.key}
              className={cn("animate-rise flex min-w-0", spans && "col-span-2 md:col-span-1")}
              style={riseDelay(startIndex + i)}
            >
              <ActionTile
                tone="neutral"
                accent={ACCENT[tile.key]}
                to={tile.to}
                title={t(tile.labelKey)}
                hint={t(hint.key, hint.vars)}
                icon={<Icon aria-hidden="true" strokeWidth={2} />}
                className="w-full"
              />
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Loading shape of the tile row: same columns and about the real tiles' height (two-line hints on a phone). */
export function TodayTilesSkeleton({ count }: { count: number }) {
  const layout = tileLayout(count);
  return (
    <div aria-hidden="true" className={cn("grid gap-3", layout.grid)}>
      {Array.from({ length: count }, (_, i) => (
        <Skeleton
          key={i}
          className={cn(
            "min-h-[154px] rounded-block md:min-h-[146px]",
            layout.spanLast && i === count - 1 && "col-span-2 md:col-span-1",
          )}
        />
      ))}
    </div>
  );
}

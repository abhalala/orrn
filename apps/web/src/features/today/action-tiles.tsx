import { useT } from "@orrn/i18n";
import { ActionTile, type ActionTileProps } from "@orrn/ui/components/action-tile";
import { riseDelay } from "@orrn/ui/components/motion";
import { useId } from "react";

import { useMe } from "@/shared/lib/me";

import { tileHint, todayTiles, type TodayTile } from "./today-model";

/** Each tile keeps its area colour in the icon well (spec: Pack blue, Dispatch red, Stock amber, Guides black). */
const ACCENT: Record<TodayTile["key"], NonNullable<ActionTileProps["accent"]>> = {
  pack: "blue",
  dispatch: "red",
  stock: "amber",
  guides: "ink",
};

/**
 * Shortcuts by role (plan Task 19): Pack for `bundle.create`, Dispatch for
 * `dispatch.create` or `dispatch.addBundle` (with the open count), Stock and
 * Guides alongside (viewers and other read-only roles get no tiles, spec
 * section 3). Quiet white tiles: the KPI row above is the screen's
 * one loud element (design brief), and the tab bar already reaches each area.
 * `openCount` is undefined while unknown (loading or error): Dispatch then
 * reads a plain line ("Load and send a truck") instead of a count.
 */
export function TodayTiles({ openCount, startIndex = 0 }: { openCount?: number; startIndex?: number }) {
  const { t } = useT();
  const { data: me } = useMe();
  const headingId = useId();
  const tiles = todayTiles(me);
  if (tiles.length === 0) return null;

  return (
    <section aria-labelledby={headingId} data-testid="today-tiles">
      <h2 id={headingId} className="sr-only">
        {t("today.shortcutsHeading")}
      </h2>
      <ul className="m-0 grid list-none grid-cols-2 gap-3 p-0 md:grid-cols-4">
        {tiles.map((tile, i) => {
          const Icon = tile.icon;
          const hint = tileHint(tile, openCount);
          return (
            <li key={tile.key} className="animate-rise flex min-w-0" style={riseDelay(startIndex + i)}>
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

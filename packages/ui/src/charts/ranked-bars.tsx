import { useT } from "@orrn/i18n";
import { ArrowDown, ArrowUp, Equal, Sparkle } from "lucide-react";

import { formatShare, movementText } from "./chart-table";
import { OTHER_COLOR, seriesColor } from "./scales";

export type RankedRow = {
  key: string;
  label: string;
  value: number;
  /** Share of the total, 0-100. */
  share?: number;
  /** Places moved since the previous period: + up, - down, 0 same, null new. Omit when unknown. */
  movement?: number | null;
};

export type RankedBarsProps = {
  /** Already sorted, highest first; fold the tail with `foldToOther` and pass it as `other`. */
  rows: RankedRow[];
  format(v: number): string;
  /** The folded tail, drawn last in grey and never ranked. */
  other?: number;
  /** Name of the folded tail, e.g. "Other customers". Default "Other". */
  otherLabel?: string;
  /** Accessible name of the list. */
  label?: string;
};

/**
 * Horizontal leaderboard bars: who is leading. One series, so every bar
 * wears slot 1 (rank is the length, not a colour) and "Other" wears the
 * de-emphasis grey.
 *
 * All bars share ONE scale: the rows are a CSS subgrid, so the share and
 * movement columns are the same width on every row (Other included, with
 * empty cells) and every track is exactly as wide as the others. Every
 * value is direct-labelled, so there is nothing a tooltip would add. The
 * list position is the rank for screen readers (the visual number is
 * hidden from them); share is read as "19.8% of total" and movement as
 * "Up 2 places from the previous period". Other sits after the list, not as
 * a ranked item.
 */
export function RankedBars({ rows, format, other, otherLabel, label }: RankedBarsProps) {
  const { t } = useT();
  const otherValue = other && other > 0 ? other : 0;
  const peak = Math.max(...rows.map((r) => r.value), otherValue, 0) || 1;
  const hasShare = rows.some((r) => r.share !== undefined);
  const hasMovement = rows.some((r) => r.movement !== undefined);
  // Rank, name/track, then the share and movement columns; at least one
  // trailing column so the value always has a cell of its own.
  const tail = Math.max(1, (hasShare ? 1 : 0) + (hasMovement ? 1 : 0));
  const columns = `1.75rem minmax(0,1fr) repeat(${tail}, auto)`;

  return (
    <div
      data-chart-kit=""
      className="orrn-chart-in grid gap-x-2 gap-y-3.5"
      style={{ gridTemplateColumns: columns }}
    >
      {/* role="list": WebKit drops list semantics from list-style: none lists. */}
      <ol role="list" aria-label={label} className="col-span-full m-0 grid list-none grid-cols-subgrid gap-y-3.5 p-0">
        {rows.map((row, i) => (
          <Row
            key={row.key}
            as="li"
            rank={i + 1}
            label={row.label}
            value={row.value}
            text={format(row.value)}
            pct={(row.value / peak) * 100}
            color={seriesColor(0)}
            share={hasShare ? (row.share ?? null) : undefined}
            movement={hasMovement ? row.movement : "none"}
            tail={tail}
          />
        ))}
      </ol>
      {otherValue > 0 ? (
        <Row
          as="div"
          rank={null}
          label={otherLabel ?? t("charts.other")}
          value={otherValue}
          text={format(otherValue)}
          pct={(otherValue / peak) * 100}
          color={OTHER_COLOR}
          share={hasShare ? null : undefined}
          movement={hasMovement ? undefined : "none"}
          tail={tail}
        />
      ) : null}
    </div>
  );
}

function Row({
  as: Tag,
  rank,
  label,
  value,
  text,
  pct,
  color,
  share,
  movement,
  tail,
}: {
  as: "li" | "div";
  rank: number | null;
  label: string;
  value: number;
  text: string;
  pct: number;
  color: string;
  /** undefined: no share column; null: empty cell. */
  share: number | null | undefined;
  /** "none": no movement column; undefined: empty cell (unknown or Other). */
  movement: number | null | undefined | "none";
  tail: number;
}) {
  const { t } = useT();
  return (
    <Tag
      data-slot="ranked-row"
      data-value={value}
      className="col-span-full grid grid-cols-subgrid items-baseline gap-y-1.5"
    >
      <span data-slot="ranked-rank" aria-hidden="true" className="text-right font-mono text-[13px] text-muted-foreground tabular-nums">
        {rank ?? ""}
      </span>
      <span data-slot="ranked-label" className="min-w-0 text-[14px] leading-5 font-medium break-words">
        {label}
      </span>
      <span
        data-slot="ranked-value"
        data-no-truncate=""
        className="text-right font-mono text-[14px] font-semibold whitespace-nowrap"
        style={{ gridColumn: `span ${tail}` }}
      >
        {text}
      </span>
      <span aria-hidden="true" />
      <div data-slot="ranked-track" className="flex h-2.5 min-w-0 items-center self-center">
        <div
          data-slot="ranked-bar"
          aria-hidden="true"
          className="h-full rounded-r-[4px]"
          style={{ width: `${pct.toFixed(4)}%`, minWidth: 2, background: color }}
        />
      </div>
      {share !== undefined ? (
        <span className="self-center text-right font-mono text-[12px] text-muted-foreground tabular-nums">
          {share !== null ? (
            <>
              <span aria-hidden="true">{formatShare(share)}</span>
              <span className="sr-only">{t("charts.shareOfTotal", { share: formatShare(share) })}</span>
            </>
          ) : null}
        </span>
      ) : null}
      {share === undefined && movement === "none" ? <span aria-hidden="true" /> : null}
      {movement !== "none" ? (
        <span className="flex self-center justify-end">
          {movement !== undefined ? (
            <>
              <Movement value={movement} />
              <span className="sr-only">{movementText(t, movement, true)}</span>
            </>
          ) : null}
        </span>
      ) : null}
    </Tag>
  );
}

function Movement({ value }: { value: number | null }) {
  const { t } = useT();
  const Icon = value === null ? Sparkle : value > 0 ? ArrowUp : value < 0 ? ArrowDown : Equal;
  return (
    <span
      data-slot="rank-movement"
      aria-hidden="true"
      className="inline-flex min-h-6 shrink-0 items-center gap-1 rounded-full bg-surface-sunken px-2 text-[12px] leading-none font-semibold whitespace-nowrap text-foreground"
    >
      <Icon className="size-3.5" strokeWidth={2} />
      {movementText(t, value)}
    </span>
  );
}

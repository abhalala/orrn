import { Chip } from "@orrn/ui/components/chip";

import {
  formatLimitRange,
  formatPercentFromPpm,
  verdictTone,
  verdictWord,
  type SpectroSheet,
} from "../fixtures";

export function SpectroTable({ sheet }: { sheet: SpectroSheet }) {
  return (
    <ul className="m-0 list-none p-0">
      {sheet.rows.map((row) => (
        <li
          key={row.element}
          className="flex min-w-0 flex-col gap-1 border-b border-border py-3 last:border-b-0 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
        >
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="w-8 font-mono text-[15px] font-semibold">{row.label}</span>
            <span className="font-mono text-[15px] font-semibold tabular-nums">
              {formatPercentFromPpm(row.ppm)}%
            </span>
            {row.source === "balance" ? (
              <span className="text-[13px] text-muted-foreground">balance</span>
            ) : null}
            <span className="font-mono text-[12px] tabular-nums text-muted-foreground">{row.ppm} ppm</span>
          </div>
          <div className="flex min-w-0 items-center justify-between gap-3 sm:justify-end">
            <span className="font-mono text-[13px] tabular-nums text-muted-foreground">
              {formatLimitRange(row.minPpm, row.maxPpm)}
            </span>
            <Chip tone={verdictTone(row.verdict)}>{verdictWord(row.verdict)}</Chip>
          </div>
        </li>
      ))}
    </ul>
  );
}

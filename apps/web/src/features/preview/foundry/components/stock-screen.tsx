import { BigNumber } from "@orrn/ui/components/big-number";
import { Card } from "@orrn/ui/components/card";
import { Chip } from "@orrn/ui/components/chip";
import { stretchedLink } from "@orrn/ui/components/list-card";
import { cn } from "@orrn/ui/lib/utils";
import { Link } from "@tanstack/react-router";

import {
  ALLOY_CODES,
  formatInches,
  formatKgFromG,
  stockCastRows,
  tailG,
  type StockCast,
} from "../fixtures";
import { useFoundryPreview } from "../store";
import { FoundryScreenNav } from "./screen-nav";

export function StockScreen() {
  const preview = useFoundryPreview();
  const rows = stockCastRows(preview.k31Locked);
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <FoundryScreenNav current="stock" />
      <p className="m-0 text-[14px] leading-5 text-muted-foreground">
        Billet store. A cast with kg left stays here after close. Piece counts come from the log lines.
      </p>
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        {ALLOY_CODES.map((alloy) => (
          <section key={alloy} className="flex min-w-0 flex-col gap-3">
            <h2 className="m-0 font-display text-[22px] font-bold tracking-[-0.02em]">{alloy}</h2>
            {rows.filter((row) => row.alloy === alloy).map((row) => (
              <StockCard key={row.id} row={row} justLocked={row.number === "K31" && preview.k31Locked} />
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}

function StockCard({ row, justLocked }: { row: StockCast; justLocked: boolean }) {
  const tail = tailG(row);
  const title = <span className="font-mono text-[22px] font-bold tabular-nums">{row.number}</span>;
  return (
    <Card className="relative">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          {row.href ? (
            <Link to={row.href} className={cn(stretchedLink, "text-foreground no-underline")}>
              {title}
            </Link>
          ) : (
            title
          )}
          <p className="m-0 mt-1 text-[14px] text-muted-foreground">
            {row.alloy} · {row.pcsLabel} · {row.lengthFt} ft
            {row.diameterMm != null ? ` · ${formatInches(row.diameterMm)} inch` : ""}
          </p>
        </div>
        <Chip tone={row.posted ? "green" : "amber"}>{row.posted ? "On hand" : "Not posted"}</Chip>
      </div>
      <div className="flex min-w-0 flex-wrap items-end gap-2">
        <BigNumber value={row.onHandG / 1000} className="text-[40px] sm:text-[52px]" />
        <span className="pb-1 text-[15px] font-semibold text-muted-foreground">
          {row.posted ? "kg on hand" : "kg — posts when you lock the melt"}
        </span>
      </div>
      <dl className="m-0 grid grid-cols-2 gap-3">
        <div className="min-w-0">
          <dt className="text-[12px] font-medium text-muted-foreground">Credited</dt>
          <dd data-no-truncate="" className="m-0 mt-0.5 font-mono text-[15px] font-semibold tabular-nums">
            {formatKgFromG(row.creditedG)} kg
          </dd>
          {row.creditedCaption ? (
            <p className="m-0 mt-1 text-[13px] leading-5 text-muted-foreground">{row.creditedCaption}</p>
          ) : (
            <p className="m-0 mt-1 text-[13px] text-muted-foreground">0 kg credited</p>
          )}
        </div>
        <div className="min-w-0">
          <dt className="text-[12px] font-medium text-muted-foreground">Logs</dt>
          <dd data-no-truncate="" className="m-0 mt-0.5 font-mono text-[15px] font-semibold tabular-nums">
            {formatKgFromG(row.logsG)} kg
          </dd>
          <p className="m-0 mt-1 text-[13px] leading-5 text-muted-foreground">
            On hand + credited = logs. Tail {formatKgFromG(tail)} kg.
          </p>
        </div>
      </dl>
      {justLocked ? <Chip tone="green">Locked just now</Chip> : null}
    </Card>
  );
}


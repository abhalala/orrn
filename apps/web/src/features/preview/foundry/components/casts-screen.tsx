import { ActionTile } from "@orrn/ui/components/action-tile";
import { Badge } from "@orrn/ui/components/badge";
import { Button } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { DataTable, type DataTableColumn } from "@orrn/ui/components/data-table";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { SegmentedControl } from "@orrn/ui/components/segmented-control";
import { Toolbar } from "@orrn/ui/components/toolbar";
import { stretchedLink } from "@orrn/ui/components/list-card";
import { cn } from "@orrn/ui/lib/utils";
import { Link } from "@tanstack/react-router";
import { Cylinder, FileText, Warehouse } from "lucide-react";
import { useState } from "react";

import {
  castListRows,
  formatBookDate,
  formatInches,
  formatKgFromG,
  formatPercentFromBp,
  FURNACE,
  nextCastNumber,
  type CastListRow,
} from "../fixtures";
import { useFoundryPreview } from "../store";
import { OpenCastSheet } from "./open-cast-sheet";

type CastFilter = "all" | "open" | "closed";

const COLUMNS: DataTableColumn<CastListRow>[] = [
  { id: "number", header: "Cast", cell: (row) => row.number },
  { id: "status", header: "Status", cell: (row) => row.status },
];

export function CastsScreen({
  sheetOpen,
  onSheetOpenChange,
}: {
  sheetOpen: boolean;
  onSheetOpenChange: (open: boolean) => void;
}) {
  const preview = useFoundryPreview();
  const [filter, setFilter] = useState<CastFilter>("all");
  const [empty, setEmpty] = useState(false);
  const rows = castListRows(preview.openedCasts, preview.k31Locked).filter((row) => filter === "all" || row.status === filter);
  const furnaceChip = `${FURNACE.code} · ${FURNACE.capacityG / 1_000_000} t · ${formatInches(FURNACE.diameterMm)} inch`;

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="neutral">{furnaceChip}</Badge>
        <span className="text-[13px] text-muted-foreground">
          {FURNACE.name} · {formatKgFromG(FURNACE.capacityG)} kg · {FURNACE.diameterMm} mm
        </span>
      </div>

      <ul className="m-0 grid list-none grid-cols-1 gap-3 p-0 md:grid-cols-2 xl:grid-cols-3">
        <li className="min-w-0">
          <ActionTile
            tone="ink"
            title="Cast K31"
            hint="Melt 1, draft until you lock it"
            icon={<Cylinder />}
            to="/preview/foundry/cast"
          />
        </li>
        <li className="min-w-0">
          <ActionTile
            tone="blue"
            title="Billet stock"
            hint="On hand and credited"
            icon={<Warehouse />}
            to="/preview/foundry/stock"
          />
        </li>
        <li className="min-w-0">
          <ActionTile
            tone="neutral"
            title="Test certificate"
            hint="Staff print for K31"
            icon={<FileText />}
            to="/preview/foundry/certificate"
          />
        </li>
      </ul>

      <Toolbar
        actions={
          <Button variant="secondary" aria-pressed={empty} onClick={() => setEmpty((value) => !value)}>
            {empty ? "Show casts" : "Show empty list"}
          </Button>
        }
      >
        {empty ? (
          <span className="text-[13px] text-muted-foreground">Demo — empty list.</span>
        ) : (
          <SegmentedControl
            label="Casts"
            value={filter}
            onChange={setFilter}
            options={[
              { value: "all", label: "All" },
              { value: "open", label: "Open" },
              { value: "closed", label: "Closed" },
            ]}
          />
        )}
      </Toolbar>

      {empty ? (
        <EmptyState
          title="Open the first cast."
          body={`Furnace F1 is ready. The next number is ${nextCastNumber(preview.nextSeq)}.`}
          action={<Button onClick={() => onSheetOpenChange(true)}>Open cast</Button>}
        />
      ) : (
        <DataTable
          columns={COLUMNS}
          rows={rows}
          rowKey={(row) => row.id}
          renderCard={(row) => <CastCard row={row} meltLocked={preview.k31Locked && row.id === "cast-k31"} />}
          emptyState={<EmptyState title="No casts in this filter." body="Try All, or open a cast." />}
        />
      )}

      <OpenCastSheet
        open={sheetOpen}
        onOpenChange={onSheetOpenChange}
        onOpened={() => setEmpty(false)}
      />
    </div>
  );
}

function CastCard({ row, meltLocked }: { row: CastListRow; meltLocked: boolean }) {
  const title = (
    <span className="font-mono text-[22px] font-bold tabular-nums leading-none">{row.number}</span>
  );
  return (
    <article
      className={cn(
        "relative flex h-full min-w-0 flex-col gap-3 rounded-card border border-border bg-card p-4 shadow-sm",
        row.href && "transition-[border-color] duration-[var(--dur-fast)] hover:border-control/60",
      )}
    >
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          {row.href ? (
            <Link to={row.href} className={cn(stretchedLink, "text-foreground no-underline")}>
              {title}
            </Link>
          ) : (
            title
          )}
          <p className="m-0 mt-1 text-[13px] text-muted-foreground">{row.year}</p>
        </div>
        <Chip tone={row.status === "open" ? "blue" : "neutral"}>{row.status === "open" ? "Open" : "Closed"}</Chip>
      </div>
      <p className="m-0 text-[14px] leading-5">
        {formatBookDate(row.openedOn)} · {row.alloy} · {row.furnace ?? "No furnace yet"} · {meltCount(row.melts)}
      </p>
      <dl className="m-0 grid grid-cols-2 gap-x-3 gap-y-3 sm:grid-cols-4">
        <Fact label="In" value={row.metalInG == null ? "—" : `${formatKgFromG(row.metalInG)} kg`} />
        <Fact label="Logs" value={`${formatKgFromG(row.logsG)} kg`} />
        <Fact label="On hand" value={`${formatKgFromG(row.onHandG)} kg`} />
        <Fact label="Yield" value={row.yieldBp == null ? "—" : formatPercentFromBp(row.yieldBp)} />
      </dl>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="text-[13px] text-muted-foreground">Spectro</span>
        <Chip tone={row.spectroTone}>{row.spectroLabel}</Chip>
        {row.spectroNote ? <span className="text-[13px] text-muted-foreground">{row.spectroNote}</span> : null}
        {meltLocked ? <Chip tone="green">Melt locked</Chip> : null}
      </div>
    </article>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[12px] font-medium text-muted-foreground">{label}</dt>
      <dd data-no-truncate="" className="m-0 mt-0.5 font-mono text-[15px] font-semibold tabular-nums break-words">
        {value}
      </dd>
    </div>
  );
}

function meltCount(melts: number): string {
  if (melts === 0) return "No melt yet";
  if (melts === 1) return "1 melt";
  return `${melts} melts`;
}

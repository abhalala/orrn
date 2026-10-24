import { Button } from "@orrn/ui/components/button";
import { Sheet } from "@orrn/ui/components/sheet";

import { lengthLabel, matchStock, type StockGroupId, type StockRow, type YardLot } from "../fixtures";

const GROUP_LABEL: Record<StockGroupId, string> = {
  other_po: "Another party's PO",
  plant: "Plant stock",
  unassigned: "Unassigned",
};

export function StockSheet({
  open,
  onOpenChange,
  sectionCode,
  lengthFt,
  yard,
  holdError,
  onHold,
  onLeave,
  onPlanRest,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sectionCode: string;
  lengthFt: number | null;
  yard: readonly YardLot[];
  holdError: string | null;
  onHold: (row: StockRow | null) => void;
  onLeave: () => void;
  onPlanRest: () => void;
}) {
  const matched = lengthFt == null ? { lead: null, rows: [] } : matchStock(yard, sectionCode, lengthFt);
  const other = matched.rows.find((row) => row.group === "other_po" && row.matches);
  const description =
    other?.title ??
    matched.lead ??
    (lengthFt == null
      ? "Enter a cut length to see what is already in the yard."
      : `Owners in the yard for ${sectionCode} at ${lengthLabel(lengthFt)}.`);

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="In stock for this die and length"
      description={description}
      footer={
        <>
          <Button variant="secondary" onClick={onLeave}>
            Leave them
          </Button>
          <Button variant="secondary" onClick={onPlanRest}>
            Plan only the rest
          </Button>
          <Button onClick={() => onHold(other ?? null)}>Hold</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {holdError ? (
          <p role="status" className="m-0 text-[13px] font-medium leading-5 text-destructive">
            {holdError}
          </p>
        ) : null}
        {(["other_po", "plant", "unassigned"] as const).map((group) => {
          const rows = matched.rows.filter((row) => row.group === group);
          return (
            <section key={group} className="flex min-w-0 flex-col gap-2">
              <h3 className="m-0 text-[13px] font-semibold text-muted-foreground">{GROUP_LABEL[group]}</h3>
              {rows.length === 0 ? (
                <p className="m-0 text-[14px] leading-5 text-muted-foreground">None in this sample.</p>
              ) : (
                <ul className="m-0 flex list-none flex-col gap-2 p-0">
                  {rows.map((row) => (
                    <li key={row.id} className="min-w-0 rounded-card border border-border bg-card px-3 py-3">
                      <p className="m-0 text-[14px] font-medium leading-5 break-words">{row.title}</p>
                      <p className="m-0 mt-1 font-mono text-[12px] text-muted-foreground tabular-nums">
                        {row.detail} · {row.note}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </Sheet>
  );
}

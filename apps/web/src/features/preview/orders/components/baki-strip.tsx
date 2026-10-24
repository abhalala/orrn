import { cn } from "@orrn/ui/lib/utils";

import { formatOrderKg, formatPcs, type Strip } from "../fixtures";

const CELLS: { key: keyof Strip; pcs: keyof Strip; label: string; balance?: boolean }[] = [
  { key: "orderedG", pcs: "orderedPcs", label: "Ordered" },
  { key: "plannedG", pcs: "plannedPcs", label: "Planned" },
  { key: "pressedG", pcs: "pressedPcs", label: "Pressed" },
  { key: "agedG", pcs: "agedPcs", label: "Aged" },
  { key: "packedG", pcs: "packedPcs", label: "Packed" },
  { key: "inStockG", pcs: "inStockPcs", label: "In stock" },
  { key: "dispatchedG", pcs: "dispatchedPcs", label: "Dispatched" },
  { key: "bakiG", pcs: "bakiPcs", label: "Balance", balance: true },
];

export function BakiStrip({ strip }: { strip: Strip }) {
  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
      {CELLS.map((cell) => {
        const grams = strip[cell.key];
        const pcs = strip[cell.pcs];
        const open = cell.balance && grams > 0;
        return (
          <div
            key={cell.label}
            className={cn(
              "min-w-0 rounded-card px-3 py-3",
              open ? "bg-tone-amber-tint text-tone-amber-ink" : "bg-surface-sunken text-foreground",
            )}
          >
            <p className={cn("m-0 text-xs font-medium", open ? "text-tone-amber-ink" : "text-muted-foreground")}>
              {cell.label}
            </p>
            <p className="m-0 mt-1 font-mono text-[15px] font-semibold tabular-nums leading-5 break-words sm:text-base">
              {formatOrderKg(grams)} kg
            </p>
            <p className={cn("m-0 text-[13px] tabular-nums", open ? "text-tone-amber-ink" : "text-muted-foreground")}>
              {formatPcs(pcs)} pcs
            </p>
          </div>
        );
      })}
    </div>
  );
}

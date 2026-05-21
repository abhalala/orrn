import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";

import { trpc } from "@/utils/trpc";
import { Button } from "@orrn/ui/components/button";
import { Label } from "@orrn/ui/components/label";

const bundleStatuses = ["available", "reserved", "dispatched", "void"] as const;
type BundleStatus = (typeof bundleStatuses)[number];

export const Route = createFileRoute("/receipts/$id")({
  component: ReceiptDetailComponent,
});

function statusBadgeClass(status: BundleStatus | string): string {
  switch (status) {
    case "available":
      return "bg-emerald-100 text-emerald-800";
    case "reserved":
      return "bg-amber-100 text-amber-800";
    case "dispatched":
      return "bg-sky-100 text-sky-800";
    case "void":
      return "bg-zinc-200 text-zinc-700";
    default:
      return "bg-zinc-100 text-zinc-700";
  }
}

function ReceiptDetailComponent() {
  const { id } = Route.useParams();
  const navigate = useNavigate();

  const { data, isLoading } = useQuery({
    ...trpc.bundle.getGroup.queryOptions({ id }),
  });

  if (isLoading) return <div className="p-8">Loading...</div>;
  if (!data) return <div className="p-8">Receipt not found.</div>;

  const { group, die, bundles } = data;
  const totalQuantity = bundles.reduce((s, b) => s + b.quantity, 0);
  const totalWeightG = bundles.reduce((s, b) => s + b.weightG, 0);
  const totalLengthMm = bundles.reduce((s, b) => s + b.lengthMm, 0);

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-6">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-3xl font-bold font-mono">{group.code}</h1>
          <p className="text-muted-foreground">Production Receipt</p>
        </div>
        <Button variant="outline" onClick={() => navigate({ to: "/receipts" })}>
          Back to Receipts
        </Button>
      </div>

      <div className="bg-card border rounded-lg p-6 grid grid-cols-2 gap-4 text-sm">
        <div>
          <Label className="text-xs text-muted-foreground">Die</Label>
          <p className="font-medium">
            {die ? `${die.series} / ${die.sectionCode}${die.name ? ` — ${die.name}` : ""}` : "—"}
          </p>
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Unit</Label>
          <p>{group.unit}</p>
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">PO Reference</Label>
          <p>{group.purchaseOrderRef || "—"}</p>
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Notes</Label>
          <p>{group.notes || "—"}</p>
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Created</Label>
          <p>{format(new Date(group.createdAt), "PP p")}</p>
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Bundles</Label>
          <p>
            {bundles.length} bundles · {totalQuantity} qty · {totalWeightG} g · {totalLengthMm} mm
          </p>
        </div>
      </div>

      <div className="bg-card border rounded-lg overflow-hidden">
        <div className="p-4 border-b flex items-center justify-between">
          <h2 className="text-lg font-semibold">Bundles in this receipt</h2>
          <Link to="/bundles" search={{ status: "all", groupId: group.id, dieId: undefined }}>
            <Button variant="outline" size="sm">
              Open in bundle list
            </Button>
          </Link>
        </div>
        <table className="w-full text-sm text-left">
          <thead className="bg-muted text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">Serial</th>
              <th className="px-4 py-2 font-medium text-right">Qty</th>
              <th className="px-4 py-2 font-medium text-right">Weight (g)</th>
              <th className="px-4 py-2 font-medium text-right">Length (mm)</th>
              <th className="px-4 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {bundles.map((b) => (
              <tr key={b.id} className="hover:bg-muted/50">
                <td className="px-4 py-2 font-mono text-xs">
                  <Link to="/bundles/$id" params={{ id: b.id }} className="hover:underline">
                    {b.serial}
                  </Link>
                </td>
                <td className="px-4 py-2 text-right">{b.quantity}</td>
                <td className="px-4 py-2 text-right">{b.weightG}</td>
                <td className="px-4 py-2 text-right">{b.lengthMm}</td>
                <td className="px-4 py-2">
                  <span className={`text-xs font-medium px-2 py-1 rounded ${statusBadgeClass(b.status)}`}>
                    {b.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import Papa from "papaparse";
import { toast } from "sonner";

import { trpc } from "@/utils/trpc";
import { Button } from "@orrn/ui/components/button";
import { Input } from "@orrn/ui/components/input";
import { Label } from "@orrn/ui/components/label";

export const Route = createFileRoute("/receipts/new")({
  component: NewReceiptComponent,
});

type Row = { quantity: string; weightG: string; lengthMm: string };

const emptyRow = (): Row => ({ quantity: "", weightG: "", lengthMm: "" });

function NewReceiptComponent() {
  const navigate = useNavigate();
  const [dieId, setDieId] = useState("");
  const [unit, setUnit] = useState("pcs");
  const [purchaseOrderRef, setPurchaseOrderRef] = useState("");
  const [notes, setNotes] = useState("");
  const [rows, setRows] = useState<Row[]>([emptyRow()]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: diesData } = useQuery({
    ...trpc.die.list.queryOptions({ limit: 100, offset: 0 }),
  });

  const createMutation = useMutation({
    ...trpc.bundle.createReceipt.mutationOptions(),
    onSuccess: (res: any) => {
      toast.success(`Created receipt ${res.code} with ${res.bundleCount} bundles`);
      navigate({ to: "/receipts/$id", params: { id: res.groupId } });
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to create receipt");
    },
  });

  const updateRow = (idx: number, patch: Partial<Row>) => {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  };
  const addRow = () => setRows((prev) => [...prev, emptyRow()]);
  const removeRow = (idx: number) =>
    setRows((prev) => (prev.length === 1 ? prev : prev.filter((_, i) => i !== idx)));

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const ext = file.name.split(".").pop()?.toLowerCase();

    const ingest = (parsed: any[]) => {
      const mapped: Row[] = parsed
        .map((row: any) => ({
          quantity: String(row.quantity ?? row.Quantity ?? "").trim(),
          weightG: String(row.weightG ?? row.weight_g ?? row["Weight (g)"] ?? "").trim(),
          lengthMm: String(row.lengthMm ?? row.length_mm ?? row["Length (mm)"] ?? "").trim(),
        }))
        .filter((r) => r.quantity && r.weightG && r.lengthMm);
      if (mapped.length === 0) {
        toast.error("No valid rows found. Expected columns: quantity, weightG, lengthMm");
        return;
      }
      setRows(mapped);
      toast.success(`Loaded ${mapped.length} rows from file`);
    };

    if (ext === "json") {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = JSON.parse(e.target?.result as string);
          if (!Array.isArray(data)) throw new Error("JSON must be an array of rows");
          ingest(data);
        } catch (err: any) {
          toast.error(err.message || "Invalid JSON file");
        }
      };
      reader.readAsText(file);
    } else if (ext === "csv") {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => ingest(results.data as any[]),
        error: (error) => toast.error(`CSV parse error: ${error.message}`),
      });
    } else {
      toast.error("Unsupported file type. Use CSV or JSON.");
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const totalQuantity = rows.reduce((sum, r) => sum + (Number(r.quantity) || 0), 0);
  const totalWeightG = rows.reduce((sum, r) => sum + (Number(r.weightG) || 0), 0);

  const handleSubmit = () => {
    if (!dieId) {
      toast.error("Select a die");
      return;
    }
    if (!unit.trim()) {
      toast.error("Unit is required");
      return;
    }
    const parsedRows = rows.map((r, i) => {
      const q = Number(r.quantity);
      const w = Number(r.weightG);
      const l = Number(r.lengthMm);
      if (!Number.isInteger(q) || q < 1) throw new Error(`Row ${i + 1}: quantity must be a positive integer`);
      if (!Number.isInteger(w) || w < 0) throw new Error(`Row ${i + 1}: weight must be a non-negative integer`);
      if (!Number.isInteger(l) || l < 0) throw new Error(`Row ${i + 1}: length must be a non-negative integer`);
      return { quantity: q, weightG: w, lengthMm: l };
    });
    try {
      createMutation.mutate({
        dieId,
        unit: unit.trim(),
        purchaseOrderRef: purchaseOrderRef.trim() || null,
        notes: notes.trim() || null,
        rows: parsedRows,
      });
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">New Production Receipt</h1>
          <p className="text-muted-foreground">
            Records a production run as one immutable receipt with N bundles. Serials are
            auto-generated.
          </p>
        </div>
        <Button variant="outline" onClick={() => navigate({ to: "/receipts" })}>
          Cancel
        </Button>
      </div>

      <section className="bg-card border rounded-lg p-6 space-y-4">
        <h2 className="text-lg font-semibold">Receipt details</h2>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="die">Die *</Label>
            <select
              id="die"
              className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
              value={dieId}
              onChange={(e) => setDieId(e.target.value)}
            >
              <option value="">Select a die...</option>
              {diesData?.items.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.series} / {d.sectionCode}
                  {d.name ? ` — ${d.name}` : ""}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="unit">Unit *</Label>
            <Input
              id="unit"
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              placeholder="pcs, kg, m..."
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="po">PO Reference</Label>
            <Input
              id="po"
              value={purchaseOrderRef}
              onChange={(e) => setPurchaseOrderRef(e.target.value)}
              placeholder="Optional"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="notes">Notes</Label>
            <Input
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional"
            />
          </div>
        </div>
      </section>

      <section className="bg-card border rounded-lg p-6 space-y-4">
        <div className="flex justify-between items-center">
          <h2 className="text-lg font-semibold">
            Bundles <span className="text-muted-foreground text-sm">({rows.length})</span>
          </h2>
          <div className="flex items-center gap-2">
            <input
              type="file"
              accept=".csv,.json"
              className="hidden"
              ref={fileInputRef}
              onChange={handleFileUpload}
            />
            <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
              Import CSV / JSON
            </Button>
            <Button variant="outline" size="sm" onClick={addRow}>
              Add row
            </Button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-muted-foreground">
              <tr>
                <th className="px-2 py-2 text-left font-medium w-12">#</th>
                <th className="px-2 py-2 text-left font-medium">Quantity *</th>
                <th className="px-2 py-2 text-left font-medium">Weight (g) *</th>
                <th className="px-2 py-2 text-left font-medium">Length (mm) *</th>
                <th className="px-2 py-2 w-16"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => (
                <tr key={idx} className="border-t">
                  <td className="px-2 py-2 text-muted-foreground">{idx + 1}</td>
                  <td className="px-2 py-2">
                    <Input
                      type="number"
                      min={1}
                      value={row.quantity}
                      onChange={(e) => updateRow(idx, { quantity: e.target.value })}
                    />
                  </td>
                  <td className="px-2 py-2">
                    <Input
                      type="number"
                      min={0}
                      value={row.weightG}
                      onChange={(e) => updateRow(idx, { weightG: e.target.value })}
                    />
                  </td>
                  <td className="px-2 py-2">
                    <Input
                      type="number"
                      min={0}
                      value={row.lengthMm}
                      onChange={(e) => updateRow(idx, { lengthMm: e.target.value })}
                    />
                  </td>
                  <td className="px-2 py-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeRow(idx)}
                      disabled={rows.length === 1}
                    >
                      Remove
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="text-muted-foreground text-xs">
              <tr className="border-t">
                <td className="px-2 py-2"></td>
                <td className="px-2 py-2">Total: {totalQuantity}</td>
                <td className="px-2 py-2">Total: {totalWeightG} g</td>
                <td className="px-2 py-2"></td>
                <td className="px-2 py-2"></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => navigate({ to: "/receipts" })}>
          Cancel
        </Button>
        <Button onClick={handleSubmit} disabled={createMutation.isPending}>
          {createMutation.isPending ? "Saving..." : "Create receipt"}
        </Button>
      </div>
    </div>
  );
}

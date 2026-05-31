import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import Papa from "papaparse";
import { toast } from "sonner";

import { trpc } from "@/shared/utils/trpc";
import { Button } from "@orrn/ui/components/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@orrn/ui/components/card";
import { DataTable, type DataTableColumn } from "@orrn/ui/components/data-table";
import { Input } from "@orrn/ui/components/input";
import { Label } from "@orrn/ui/components/label";
import { PageHeader } from "@orrn/ui/components/page-header";
import { Toolbar } from "@orrn/ui/components/toolbar";
import { requireCompanyMe } from "@/shared/lib/guards";
import { useLengthUnit } from "@/shared/lib/length";

export const Route = createFileRoute("/_tenant/receipts/new")({
  component: NewReceiptComponent,
  beforeLoad: requireCompanyMe,
});

type Row = { id: string; quantity: string; weightG: string; lengthMm: string };

let rowSeq = 0;
const emptyRow = (): Row => ({
  id: `row-${++rowSeq}`,
  quantity: "",
  weightG: "",
  lengthMm: "",
});

function NewReceiptComponent() {
  const navigate = useNavigate();
  const [dieId, setDieId] = useState("");
  const [unit, setUnit] = useState("pcs");
  const [purchaseOrderRef, setPurchaseOrderRef] = useState("");
  const [notes, setNotes] = useState("");
  const [rows, setRows] = useState<Row[]>([emptyRow()]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lu = useLengthUnit();

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

  const updateRow = (id: string, patch: Partial<Omit<Row, "id">>) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };
  const addRow = () => setRows((prev) => [...prev, emptyRow()]);
  const removeRow = (id: string) =>
    setRows((prev) => (prev.length === 1 ? prev : prev.filter((r) => r.id !== id)));

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const ext = file.name.split(".").pop()?.toLowerCase();

    const ingest = (parsed: Record<string, unknown>[]) => {
      const mapped: Row[] = parsed
        .map((row) => ({
          id: `row-${++rowSeq}`,
          quantity: String(row.quantity ?? row.Quantity ?? "").trim(),
          weightG: String(row.weightG ?? row.weight_g ?? row["Weight (g)"] ?? "").trim(),
          lengthMm: String(
            row.lengthMm ?? row.length_mm ?? row["Length (mm)"] ?? row["Length (in)"] ?? "",
          ).trim(),
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
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "Invalid JSON file");
        }
      };
      reader.readAsText(file);
    } else if (ext === "csv") {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => ingest(results.data as Record<string, unknown>[]),
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
    try {
      const parsedRows = rows.map((r, i) => {
        const q = Number(r.quantity);
        const w = parseInt(r.weightG, 10);
        const l = lu.parseLength(r.lengthMm);
        if (!Number.isInteger(q) || q < 1)
          throw new Error(`Row ${i + 1}: quantity must be a positive integer`);
        if (!Number.isInteger(w) || w < 0 || isNaN(w))
          throw new Error(`Row ${i + 1}: weight must be a non-negative integer`);
        if (l < 0)
          throw new Error(`Row ${i + 1}: length must be a non-negative integer`);
        return { quantity: q, weightG: w, lengthMm: l };
      });
      createMutation.mutate({
        dieId,
        unit: unit.trim(),
        purchaseOrderRef: purchaseOrderRef.trim() || null,
        notes: notes.trim() || null,
        rows: parsedRows,
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Validation failed");
    }
  };

  const rowIndex = useMemo(() => {
    const map = new Map<string, number>();
    rows.forEach((r, i) => map.set(r.id, i + 1));
    return map;
  }, [rows]);

  const columns = useMemo((): DataTableColumn<Row>[] => {
    return [
      {
        id: "index",
        header: "#",
        flex: 0.3,
        cell: (row) => rowIndex.get(row.id) ?? "—",
      },
      {
        id: "quantity",
        header: "Quantity *",
        flex: 1,
        cell: (row) => (
          <Input
            type="number"
            min={1}
            value={row.quantity}
            onChange={(e) => updateRow(row.id, { quantity: e.target.value })}
          />
        ),
      },
      {
        id: "weightG",
        header: "Weight (g) *",
        flex: 1,
        cell: (row) => (
          <Input
            type="number"
            min={0}
            value={row.weightG}
            onChange={(e) => updateRow(row.id, { weightG: e.target.value })}
          />
        ),
      },
      {
        id: "lengthMm",
        header: `Length (${lu.label}) *`,
        flex: 1,
        cell: (row) => (
          <Input
            type="number"
            min={0}
            value={row.lengthMm}
            onChange={(e) => updateRow(row.id, { lengthMm: e.target.value })}
          />
        ),
      },
      {
        id: "actions",
        header: "",
        flex: 0.6,
        align: "right",
        cell: (row) => (
          <Button variant="ghost" size="sm" onPress={() => removeRow(row.id)} disabled={rows.length === 1}>
            Remove
          </Button>
        ),
      },
    ];
  }, [rowIndex, rows.length]);

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <PageHeader
        eyebrow="Receipts"
        title="New production receipt"
        description="Records a production run as one immutable receipt with N bundles. Serials are auto-generated."
        actions={
          <Button variant="outline" onClick={() => navigate({ to: "/receipts" })}>
            Cancel
          </Button>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Receipt details</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="die">Die *</Label>
            <select
              id="die"
              className="flex h-10 w-full items-center justify-between rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              value={dieId}
              onChange={(e) => setDieId(e.target.value)}
            >
              <option value="">Select a die…</option>
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
            <Input id="unit" value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="pcs, kg, m…" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="po">PO reference</Label>
            <Input
              id="po"
              value={purchaseOrderRef}
              onChange={(e) => setPurchaseOrderRef(e.target.value)}
              placeholder="Optional"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="notes">Notes</Label>
            <Input id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <CardTitle>Bundles ({rows.length})</CardTitle>
          <Toolbar>
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
          </Toolbar>
        </CardHeader>
        <CardContent>
          <DataTable columns={columns} rows={rows} rowKey={(r) => r.id} />
          <p className="text-xs text-muted-foreground mt-4">
            Totals: {totalQuantity} qty · {totalWeightG} g
          </p>
        </CardContent>
        <CardFooter className="justify-end gap-2">
          <Button variant="outline" onClick={() => navigate({ to: "/receipts" })}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={createMutation.isPending}>
            {createMutation.isPending ? "Saving…" : "Create receipt"}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}

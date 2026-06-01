import { Dialog, DialogCloseButton } from "@orrn/ui/components/dialog";
import { ImportDropzone } from "@orrn/ui/components/import-dropzone";
import { useMutation } from "@tanstack/react-query";
import { Info, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { useLengthUnit } from "../lib/length";
import { trpc } from "../utils/trpc";

type ImportRow = {
  dieSeries: string;
  dieSectionCode: string;
  quantity: number;
  weightG: number;
  lengthMm: number;
};

/**
 * Modal for bulk-importing bundles from legacy systems.
 *
 * Unlike production receipts (which capture an operator's intake event with
 * unit + PO ref + die-locked rows), legacy imports just put existing bundles
 * "on the shelf" in inventory. The server lazily creates a `LEGACY-…` bundle
 * group per die so each imported bundle still has a parent receipt to satisfy
 * the bundle→group foreign key — but those groups are visually distinct from
 * real production receipts in the receipts list.
 */
export function ImportBundlesModal({
  onClose,
  onSuccess,
}: {
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [selectedFile, setSelectedFile] = useState<{ name: string; size: number } | null>(null);
  const [phase, setPhase] = useState<"upload" | "processing">("upload");
  const lu = useLengthUnit();

  const importMutation = useMutation({
    ...trpc.bundle.bulkImport.mutationOptions(),
    onSuccess: (res) => {
      const groupsNote =
        res.newGroups > 0
          ? ` Created ${res.newGroups} legacy receipt${res.newGroups === 1 ? "" : "s"}.`
          : "";
      toast.success(
        `Imported ${res.bundleCount} bundle${res.bundleCount === 1 ? "" : "s"} across ${res.dieCount} die${res.dieCount === 1 ? "" : "s"}.${groupsNote}`,
      );
      onSuccess();
    },
    onError: (err) => {
      toast.error(err.message || "Failed to import bundles");
      setPhase("upload");
      setSelectedFile(null);
    },
  });

  const handleFile = async (file: File) => {
    setSelectedFile({ name: file.name, size: file.size });

    const ext = file.name.split(".").pop()?.toLowerCase();
    if (ext !== "csv" && ext !== "json") {
      toast.error("Unsupported file type — please upload a .csv or .json file");
      setSelectedFile(null);
      return;
    }

    try {
      const rows = await parseFile(file, ext, lu.parseLengthDecimal);
      if (rows.length === 0) {
        toast.error("No valid rows found. Required columns: dieSeries, dieSectionCode, quantity, weightG, lengthMm.");
        setSelectedFile(null);
        return;
      }

      setPhase("processing");
      importMutation.mutate({ rows });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to parse file");
      setSelectedFile(null);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Import bundles"
      description="Bring bundles from a legacy system into ORRN. Each row identifies its die by series + section code."
      maxWidth={680}
      actions={
        phase === "upload" ? <DialogCloseButton onPress={onClose}>Close</DialogCloseButton> : null
      }
    >
      {phase === "upload" ? (
        <div className="space-y-4">
          <ImportDropzone
            accept=".csv,.json"
            onFile={handleFile}
            loading={importMutation.isPending}
            selectedFile={selectedFile}
            onClear={() => setSelectedFile(null)}
            samples={[
              { label: "Sample CSV", href: "/samples/bundles.csv" },
              { label: "Sample JSON", href: "/samples/bundles.json" },
            ]}
            heading="Drop your bundles file here"
            hint={`or click to browse — required columns: dieSeries, dieSectionCode, quantity, weightG, lengthMm (${lu.label})`}
          />

          <LegacyReceiptNotice />
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
          <Loader2 className="size-6 animate-spin text-muted-foreground" aria-hidden="true" />
          <p className="m-0 text-sm font-medium text-foreground">Importing bundles…</p>
          <p className="m-0 text-xs text-muted-foreground">
            Up to 2,000 bundles per import. Hang tight.
          </p>
        </div>
      )}
    </Dialog>
  );
}

function LegacyReceiptNotice() {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/40 px-3 py-2.5">
      <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="space-y-0.5">
        <p className="m-0 text-xs font-medium text-foreground">
          Bundles are filed under a per-die legacy receipt
        </p>
        <p className="m-0 text-xs text-muted-foreground">
          ORRN keeps every bundle linked to a receipt. Imported bundles join a
          single auto-created <span className="font-mono">LEGACY-…</span>{" "}
          receipt per die so they don't clutter your production receipt history.
        </p>
      </div>
    </div>
  );
}

async function parseFile(
  file: File,
  ext: string,
  parseLength: (raw: string) => number | undefined,
): Promise<ImportRow[]> {
  if (ext === "json") {
    const text = await file.text();
    const parsed = JSON.parse(text);
    const list = Array.isArray(parsed) ? parsed : [parsed];
    return list
      .map((row: Record<string, unknown>) => normalizeRow(row, parseLength))
      .filter(isValidRow);
  }

  const Papa = (await import("papaparse")).default;
  return new Promise<ImportRow[]>((resolve, reject) => {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const rows = results.data
          .map((row) => normalizeRow(row, parseLength))
          .filter(isValidRow);
        resolve(rows);
      },
      error: (err) => reject(new Error(`CSV parsing error: ${err.message}`)),
    });
  });
}

function normalizeRow(
  row: Record<string, unknown>,
  parseLength: (raw: string) => number | undefined,
): Partial<ImportRow> {
  // CSVs come in with everything as strings; JSON can have native numbers.
  // Support both `lengthMm` (canonical) and `lengthIn` (operator-friendly via
  // the active unit's parser) so the importer matches the rest of the app.
  const lengthRaw = row.lengthMm ?? row.lengthIn ?? row.length;
  const length = typeof lengthRaw === "number"
    ? lengthRaw
    : typeof lengthRaw === "string" && lengthRaw.length > 0
      ? parseLength(lengthRaw)
      : undefined;

  return {
    dieSeries: String(row.dieSeries ?? row.series ?? "").trim(),
    dieSectionCode: String(row.dieSectionCode ?? row.sectionCode ?? "").trim(),
    quantity: Number(row.quantity ?? 0),
    weightG: Number(row.weightG ?? row.weight ?? 0),
    lengthMm: typeof length === "number" ? Math.round(length) : 0,
  };
}

function isValidRow(row: Partial<ImportRow>): row is ImportRow {
  return (
    !!row.dieSeries &&
    !!row.dieSectionCode &&
    typeof row.quantity === "number" &&
    row.quantity > 0 &&
    typeof row.weightG === "number" &&
    row.weightG >= 0 &&
    typeof row.lengthMm === "number" &&
    row.lengthMm >= 0
  );
}

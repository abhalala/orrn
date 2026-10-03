import { Button } from "@orrn/ui/components/button";
import { Dialog, DialogCloseButton } from "@orrn/ui/components/dialog";
import { ImportDropzone } from "@orrn/ui/components/import-dropzone";
import { useMutation } from "@tanstack/react-query";
import { Info, Loader2 } from "lucide-react";
import { useState } from "react";
import Papa from "papaparse";
import { toast } from "sonner";

import {
  describeSkipped,
  normalizeRow,
  partitionRows,
  type ImportRow,
  type ParsedFile,
} from "../lib/bundle-import-rows";
import { useLengthUnit } from "../lib/length";
import { trpc } from "../utils/trpc";

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
  const [phase, setPhase] = useState<"upload" | "review" | "processing">("upload");
  const [pending, setPending] = useState<{ rows: ImportRow[]; skipped: number[] } | null>(null);
  const lu = useLengthUnit();

  const importMutation = useMutation({
    ...trpc.bundle.bulkImport.mutationOptions(),
    onSuccess: (res) => {
      const diesNote =
        res.newDies > 0
          ? ` Created ${res.newDies} legacy die${res.newDies === 1 ? "" : "s"} — review on the dies page.`
          : "";
      const groupsNote =
        res.newGroups > 0
          ? ` Created ${res.newGroups} legacy receipt${res.newGroups === 1 ? "" : "s"}.`
          : "";
      toast.success(
        `Imported ${res.bundleCount} bundle${res.bundleCount === 1 ? "" : "s"} across ${res.dieCount} die${res.dieCount === 1 ? "" : "s"}.${diesNote}${groupsNote}`,
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
      const { rows, skipped } = await parseFile(file, ext, lu.parseLengthDecimal);
      if (rows.length === 0) {
        toast.error(
          skipped.length > 0
            ? `No valid rows found — ${describeSkipped(skipped)} Quantity, weightG and length must be greater than 0.`
            : "No valid rows found. Required columns: dieSeries, dieSectionCode, quantity, weightG, lengthMm.",
        );
        setSelectedFile(null);
        return;
      }

      // Rows the server would reject (blank/zero weight or length, no die) are never sent. When
      // any were dropped, show which before importing the rest.
      if (skipped.length > 0) {
        setPending({ rows, skipped });
        setPhase("review");
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
        phase === "upload" ? (
          <DialogCloseButton onPress={onClose}>Close</DialogCloseButton>
        ) : phase === "review" && pending ? (
          <>
            <DialogCloseButton
              onPress={() => {
                setPending(null);
                setSelectedFile(null);
                setPhase("upload");
              }}
            >
              Choose another file
            </DialogCloseButton>
            <Button
              onPress={() => {
                setPhase("processing");
                importMutation.mutate({ rows: pending.rows });
              }}
            >
              {`Import ${pending.rows.length} valid row${pending.rows.length === 1 ? "" : "s"}`}
            </Button>
          </>
        ) : null
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
            hint={`or click to browse — required columns: dieSeries, dieSectionCode, quantity, weightG, lengthMm (${lu.label}); optional poNumber`}
          />

          <LegacyReceiptNotice />
        </div>
      ) : phase === "review" && pending ? (
        <div className="space-y-2" role="alert">
          <p className="m-0 text-sm font-medium text-foreground">
            {pending.skipped.length} row{pending.skipped.length === 1 ? "" : "s"} will be skipped
          </p>
          <p className="m-0 text-xs text-muted-foreground">
            {describeSkipped(pending.skipped)} Each needs a die series, section code, and a quantity,
            weight and length greater than 0.
          </p>
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
      <div className="space-y-1">
        <p className="m-0 text-xs font-medium text-foreground">
          Missing dies and receipts are auto-created
        </p>
        <p className="m-0 text-xs text-muted-foreground">
          Bundles are filed under a single{" "}
          <span className="font-mono">LEGACY-…</span> receipt per die so they
          don't clutter your production receipt history.
        </p>
        <p className="m-0 text-xs text-muted-foreground">
          Any die that isn't in your catalog yet is created on the fly with a{" "}
          <span className="font-mono">LEGACY ·</span> name prefix — review and
          fill in dimensions and weight ranges on the dies page after the
          import.
        </p>
      </div>
    </div>
  );
}

async function parseFile(
  file: File,
  ext: string,
  parseLength: (raw: string) => number | undefined,
): Promise<ParsedFile> {
  if (ext === "json") {
    const text = await file.text();
    const parsed = JSON.parse(text);
    const list = Array.isArray(parsed) ? parsed : [parsed];
    return partitionRows(
      list.map((row: Record<string, unknown>) => normalizeRow(row ?? {}, parseLength)),
    );
  }

  return new Promise<ParsedFile>((resolve, reject) => {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        resolve(partitionRows(results.data.map((row) => normalizeRow(row, parseLength))));
      },
      error: (err) => reject(new Error(`CSV parsing error: ${err.message}`)),
    });
  });
}

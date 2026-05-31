import { useState, useRef } from "react";
import { toast } from "sonner";
import { useMutation } from "@tanstack/react-query";

import { useLengthUnit } from "../lib/length";
import { Button } from "@orrn/ui/components/button";
import { Dialog, DialogCloseButton } from "@orrn/ui/components/dialog";
import { trpc } from "../utils/trpc";

export function ImportDiesModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [step, setStep] = useState<"upload" | "resolving" | "processing">("upload");
  const [validRows, setValidRows] = useState<any[]>([]);
  const [duplicateRows, setDuplicateRows] = useState<any[]>([]);
  const [resolvedRows, setResolvedRows] = useState<any[]>([]);
  const lu = useLengthUnit();
  const validateMutation = useMutation(trpc.die.validateImport.mutationOptions());
  const processMutation = useMutation(trpc.die.processImport.mutationOptions());
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const ext = file.name.split(".").pop()?.toLowerCase();

    if (ext === "json") {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const parsedData = JSON.parse(e.target?.result as string);
          const data = Array.isArray(parsedData) ? parsedData : [parsedData];
          const normalized = data.map((row: any) => {
            const dims = row.dimensions || {};
            const widthRaw = dims.widthIn ?? dims.widthMm;
            const heightRaw = dims.heightIn ?? dims.heightMm;
            const thicknessRaw = dims.thicknessIn ?? dims.thicknessMm;
            return {
              series: row.series,
              sectionCode: row.sectionCode,
              name: row.name || "",
              weightMinG: Number(row.weightMinG) || 0,
              weightMaxG: Number(row.weightMaxG) || 0,
              dimensions: {
                widthMm: widthRaw != null ? lu.parseLengthDecimal(String(widthRaw)) : undefined,
                heightMm: heightRaw != null ? lu.parseLengthDecimal(String(heightRaw)) : undefined,
                thicknessMm: thicknessRaw != null ? lu.parseLengthDecimal(String(thicknessRaw)) : undefined,
              },
              notes: row.notes || "",
              status: row.status || "active",
            };
          });
          validateData(normalized);
        } catch {
          toast.error("Invalid JSON file");
        }
      };
      reader.readAsText(file);
    } else if (ext === "csv") {
      const Papa = (await import("papaparse")).default;

      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          const parsedData = results.data
            .map((row: any) => {
              const widthRaw = Number(row.dimensionsWidthIn ?? row.dimensionsWidthMm) || undefined;
              const heightRaw = Number(row.dimensionsHeightIn ?? row.dimensionsHeightMm) || undefined;
              const thicknessRaw =
                Number(row.dimensionsThicknessIn ?? row.dimensionsThicknessMm) || undefined;
              return {
                series: row.series,
                sectionCode: row.sectionCode,
                name: row.name || "",
                weightMinG: Number(row.weightMinG) || 0,
                weightMaxG: Number(row.weightMaxG) || 0,
                dimensions: {
                  widthMm: widthRaw != null ? lu.parseLengthDecimal(String(widthRaw)) : undefined,
                  heightMm: heightRaw != null ? lu.parseLengthDecimal(String(heightRaw)) : undefined,
                  thicknessMm:
                    thicknessRaw != null ? lu.parseLengthDecimal(String(thicknessRaw)) : undefined,
                },
                notes: row.notes || "",
                status: row.status || "active",
              };
            })
            .filter((r) => !!r.series && !!r.sectionCode);

          validateData(parsedData);
        },
        error: (error) => {
          toast.error(`CSV Parsing error: ${error.message}`);
        },
      });
    } else {
      toast.error("Unsupported file type");
    }
  };

  const validateData = (data: any[]) => {
    if (data.length === 0) {
      toast.error("No valid rows found in the file.");
      return;
    }

    validateMutation.mutate(data, {
      onSuccess: (res) => {
        setValidRows(res.validRows);
        setDuplicateRows(res.duplicates);

        if (res.duplicates.length > 0) {
          setStep("resolving");
        } else {
          processFinal(res.validRows, []);
        }
      },
      onError: (err) => toast.error(err.message || "Failed to validate file"),
    });
  };

  const handleResolve = (index: number, action: "overwrite" | "skip") => {
    const row = duplicateRows[index];
    const nextResolved = action === "overwrite" ? [...resolvedRows, row] : resolvedRows;

    const nextDuplicates = [...duplicateRows];
    nextDuplicates.splice(index, 1);
    setDuplicateRows(nextDuplicates);

    if (nextDuplicates.length === 0) {
      processFinal(validRows, nextResolved);
    } else {
      setResolvedRows(nextResolved);
    }
  };

  const handleResolveAll = (action: "overwrite" | "skip") => {
    if (action === "overwrite") {
      processFinal(validRows, [...resolvedRows, ...duplicateRows]);
    } else {
      processFinal(validRows, resolvedRows);
    }
    setDuplicateRows([]);
  };

  const processFinal = (newRows: any[], updatedRows: any[]) => {
    setStep("processing");
    processMutation.mutate(
      { newRows, updatedRows },
      {
        onSuccess: (res) => {
          toast.success(`Successfully imported ${res.count} dies`);
          onSuccess();
        },
        onError: (err) => {
          toast.error(err.message || "Failed to import");
          setStep("resolving");
        },
      },
    );
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Import dies"
      description="Upload a CSV or JSON file. Duplicates can be skipped or overwritten."
      maxWidth={640}
      actions={
        step === "upload" ? (
          <DialogCloseButton onPress={onClose}>Close</DialogCloseButton>
        ) : step === "resolving" ? (
          <>
            <DialogCloseButton onPress={onClose}>Cancel</DialogCloseButton>
            <Button variant="outline" size="sm" onPress={() => handleResolveAll("skip")}>
              Skip all remaining
            </Button>
          </>
        ) : null
      }
    >
      <div className="max-h-[min(60vh,520px)] overflow-y-auto">
        {step === "upload" && (
          <div className="space-y-6">
            <div className="flex flex-wrap gap-4">
              <a
                href="/samples/dies.csv"
                download
                className="text-sm font-medium text-primary hover:underline"
              >
                Download sample CSV
              </a>
              <a
                href="/samples/dies.json"
                download
                className="text-sm font-medium text-primary hover:underline"
              >
                Download sample JSON
              </a>
            </div>

            <div className="space-y-4 rounded-lg border-2 border-dashed border-border p-8 text-center sm:p-12">
              <input
                type="file"
                accept=".csv,.json"
                className="hidden"
                ref={fileInputRef}
                onChange={handleFileUpload}
              />
              <p className="text-sm text-muted-foreground">Upload your .csv or .json file to begin.</p>
              <Button onClick={() => fileInputRef.current?.click()} disabled={validateMutation.isPending}>
                {validateMutation.isPending ? "Validating…" : "Select file"}
              </Button>
            </div>
          </div>
        )}

        {step === "resolving" && (
          <div className="space-y-6">
            <div className="rounded-md bg-yellow-50 p-4 text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-200">
              <h3 className="mb-1 font-semibold">Duplicates found</h3>
              <p className="text-sm">
                {duplicateRows.length} item(s) match an existing series and section code.
              </p>
            </div>

            {duplicateRows.length > 0 ? (
              <div className="space-y-4 rounded-md border border-border p-4">
                <div>
                  <p className="font-semibold">
                    {duplicateRows[0].series} — {duplicateRows[0].sectionCode}
                  </p>
                  <p className="text-sm text-muted-foreground">{duplicateRows[0].name}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" onClick={() => handleResolve(0, "skip")}>
                    Skip
                  </Button>
                  <Button onClick={() => handleResolve(0, "overwrite")}>Overwrite existing</Button>
                  <Button variant="secondary" size="sm" onClick={() => handleResolveAll("overwrite")}>
                    Overwrite all remaining
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        )}

        {step === "processing" && (
          <div className="space-y-4 py-8 text-center">
            <p className="text-lg font-medium">Processing import…</p>
            <p className="text-sm text-muted-foreground">Please wait while we save your data.</p>
          </div>
        )}
      </div>
    </Dialog>
  );
}

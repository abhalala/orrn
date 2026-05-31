import { useState, useRef } from "react";
import { toast } from "sonner";
import { useMutation } from "@tanstack/react-query";

import { useLengthUnit } from "../lib/length";
import { Button } from "@orrn/ui/components/button";
import { trpc } from "../utils/trpc";
import { dimensionsSchema } from "@orrn/server/routers/die"; // we might need to export this properly or duplicate type

export function ImportDiesModal({ onClose, onSuccess }: { onClose: () => void, onSuccess: () => void }) {
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

    const ext = file.name.split('.').pop()?.toLowerCase();

    if (ext === 'json') {
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
        } catch (err) {
          toast.error("Invalid JSON file");
        }
      };
      reader.readAsText(file);
    } else if (ext === 'csv') {
      const Papa = (await import("papaparse")).default;

      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          const parsedData = results.data.map((row: any) => {
            const widthRaw = Number(row.dimensionsWidthIn ?? row.dimensionsWidthMm) || undefined;
            const heightRaw = Number(row.dimensionsHeightIn ?? row.dimensionsHeightMm) || undefined;
            const thicknessRaw = Number(row.dimensionsThicknessIn ?? row.dimensionsThicknessMm) || undefined;
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
          }).filter(r => !!r.series && !!r.sectionCode);

          validateData(parsedData);
        },
        error: (error) => {
          toast.error(`CSV Parsing error: ${error.message}`);
        }
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
          // Process directly if no duplicates
          processFinal(res.validRows, []);
        }
      },
      onError: (err) => toast.error(err.message || "Failed to validate file")
    });
  };

  const handleResolve = (index: number, action: "overwrite" | "skip") => {
    const row = duplicateRows[index];
    if (action === "overwrite") {
      setResolvedRows(prev => [...prev, row]);
    }
    
    // Move to next duplicate or finish
    const nextDuplicates = [...duplicateRows];
    nextDuplicates.splice(index, 1);
    setDuplicateRows(nextDuplicates);
    
    if (nextDuplicates.length === 0) {
      processFinal(validRows, action === "overwrite" ? [...resolvedRows, row] : resolvedRows);
    }
  };

  const handleResolveAll = (action: "overwrite" | "skip") => {
      if(action === "overwrite") {
          processFinal(validRows, [...resolvedRows, ...duplicateRows]);
      } else {
          processFinal(validRows, resolvedRows);
      }
      setDuplicateRows([]);
  };

  const processFinal = (newRows: any[], updatedRows: any[]) => {
    setStep("processing");
    processMutation.mutate({ newRows, updatedRows }, {
      onSuccess: (res) => {
        toast.success(`Successfully imported ${res.count} dies`);
        onSuccess();
      },
      onError: (err) => {
        toast.error(err.message || "Failed to import");
        setStep("resolving"); // Let them retry or go back
      }
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-card w-full max-w-2xl rounded-lg shadow-lg overflow-hidden flex flex-col max-h-[90vh]">
        <div className="p-6 border-b flex justify-between items-center">
          <h2 className="text-xl font-bold">Import Dies</h2>
          <Button variant="ghost" size="sm" onClick={onClose}>✕</Button>
        </div>

        <div className="p-6 overflow-y-auto">
          {step === "upload" && (
            <div className="space-y-6">
              <div className="flex gap-4">
                <a href="/samples/dies.csv" download className="text-primary hover:underline text-sm font-medium">
                  Download Sample CSV
                </a>
                <a href="/samples/dies.json" download className="text-primary hover:underline text-sm font-medium">
                  Download Sample JSON
                </a>
              </div>
              
              <div className="border-2 border-dashed rounded-lg p-12 text-center space-y-4">
                <input 
                  type="file" 
                  accept=".csv,.json" 
                  className="hidden" 
                  ref={fileInputRef} 
                  onChange={handleFileUpload} 
                />
                <p className="text-muted-foreground">Upload your .csv or .json file to begin.</p>
                <Button onClick={() => fileInputRef.current?.click()} disabled={validateMutation.isPending}>
                  {validateMutation.isPending ? "Validating..." : "Select File"}
                </Button>
              </div>
            </div>
          )}

          {step === "resolving" && (
            <div className="space-y-6">
              <div className="p-4 bg-yellow-50 dark:bg-yellow-900/20 text-yellow-800 dark:text-yellow-200 rounded-md">
                <h3 className="font-semibold mb-1">Duplicates Found</h3>
                <p className="text-sm">{duplicateRows.length} item(s) match an existing Series and Section Code. Choose how to handle them.</p>
              </div>

              <div className="flex justify-between items-center pb-2 border-b">
                 <span className="font-medium text-sm">Bulk actions:</span>
                 <div className="space-x-2">
                    <Button variant="outline" size="sm" onClick={() => handleResolveAll('skip')}>Skip All Remaining</Button>
                    <Button variant="default" size="sm" onClick={() => handleResolveAll('overwrite')}>Overwrite All Remaining</Button>
                 </div>
              </div>

              {duplicateRows.length > 0 && (
                <div className="border rounded-md p-4 space-y-4">
                  <div>
                    <p className="font-semibold">{duplicateRows[0].series} - {duplicateRows[0].sectionCode}</p>
                    <p className="text-sm text-muted-foreground">{duplicateRows[0].name}</p>
                  </div>
                  <div className="flex space-x-2">
                    <Button variant="outline" onClick={() => handleResolve(0, "skip")}>Skip</Button>
                    <Button variant="default" onClick={() => handleResolve(0, "overwrite")}>Overwrite Existing</Button>
                  </div>
                </div>
              )}
            </div>
          )}

          {step === "processing" && (
            <div className="py-12 text-center space-y-4">
              <p className="text-lg font-medium">Processing Import...</p>
              <p className="text-muted-foreground text-sm">Please wait while we save your data.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

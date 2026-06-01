import { Dialog, DialogCloseButton } from "@orrn/ui/components/dialog";
import { ImportDropzone } from "@orrn/ui/components/import-dropzone";
import { useMutation } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { trpc } from "../utils/trpc";

type Row = {
  name: string;
  email: string;
  phone: string;
  taxId: string;
  notes: string;
};

export function ImportCustomersModal({
  onClose,
  onSuccess,
}: {
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [selectedFile, setSelectedFile] = useState<{ name: string; size: number } | null>(null);
  const [phase, setPhase] = useState<"upload" | "processing">("upload");

  const importMutation = useMutation({
    ...trpc.customer.importCsv.mutationOptions(),
    onSuccess: (res) => {
      toast.success(`Imported ${res.count} customer${res.count === 1 ? "" : "s"}`);
      onSuccess();
    },
    onError: (error) => {
      toast.error(error.message || "Failed to import customers");
      setPhase("upload");
      setSelectedFile(null);
    },
  });

  const handleFile = async (file: File) => {
    setSelectedFile({ name: file.name, size: file.size });

    const ext = file.name.split(".").pop()?.toLowerCase();
    if (ext !== "csv") {
      toast.error("Unsupported file type — please upload a .csv file");
      setSelectedFile(null);
      return;
    }

    const Papa = (await import("papaparse")).default;
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const parsed: Row[] = results.data
          .map((row) => ({
            name: (row.name || row.Name || "").trim(),
            email: (row.email || row.Email || "").trim(),
            phone: (row.phone || row.Phone || "").trim(),
            taxId: (row.taxId || row["Tax ID"] || "").trim(),
            notes: (row.notes || row.Notes || "").trim(),
          }))
          .filter((r) => !!r.name);

        if (parsed.length === 0) {
          toast.error("No valid rows found — ensure your file has a 'name' column.");
          setSelectedFile(null);
          return;
        }

        setPhase("processing");
        importMutation.mutate(parsed);
      },
      error: (err) => {
        toast.error(`CSV parsing error: ${err.message}`);
        setSelectedFile(null);
      },
    });
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Import customers"
      description="Upload a CSV with your customers. We'll skip rows that don't have a name."
      maxWidth={640}
      actions={
        phase === "upload" ? <DialogCloseButton onPress={onClose}>Close</DialogCloseButton> : null
      }
    >
      {phase === "upload" ? (
        <ImportDropzone
          accept=".csv"
          onFile={handleFile}
          loading={importMutation.isPending}
          selectedFile={selectedFile}
          onClear={() => setSelectedFile(null)}
          samples={[{ label: "Sample CSV", href: "/samples/customers.csv" }]}
          heading="Drop your customers CSV here"
          hint="or click to browse — required columns: name. Optional: email, phone, taxId, notes."
        />
      ) : (
        <ProcessingState message="Importing customers…" />
      )}
    </Dialog>
  );
}

function ProcessingState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
      <Loader2 className="size-6 animate-spin text-muted-foreground" aria-hidden="true" />
      <p className="m-0 text-sm font-medium text-foreground">{message}</p>
      <p className="m-0 text-xs text-muted-foreground">Hang tight while we save your data.</p>
    </div>
  );
}

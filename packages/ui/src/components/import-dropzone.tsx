import { Download, FileText, Loader2, UploadCloud, X } from "lucide-react";
import { useCallback, useId, useRef, useState, type DragEvent } from "react";

import { cn } from "@orrn/ui/lib/utils";

import { Button } from "./button";

/**
 * Minimal, modern drag-and-drop file picker used by every bulk-import dialog
 * in the app (dies, customers, bundles, …). The entire dashed surface is the
 * drop target AND a click target; the embedded `<Button>` is just a visual
 * affordance. We keep behaviour standard:
 *   • Drop anywhere on the zone -> picks the file
 *   • Click anywhere on the zone -> opens the native file picker
 *   • Keyboard: focus the zone + space/enter -> opens the file picker
 *   • Once a file is picked, the zone shows the file name + a clear button so
 *     the user can re-upload without closing the dialog.
 *
 * The component is purely presentational + an `onFile` callback. Validation,
 * parsing, and progress live in the caller so each entity can keep its own
 * resolve-duplicates / per-row logic without leaking knobs into here.
 */
export type ImportSample = {
  label: string;
  /** Absolute URL or `/samples/foo.csv`-style public path. */
  href: string;
};

export type ImportDropzoneProps = {
  /** Accepts the same string a native `<input type="file">` would. */
  accept?: string;
  /** Called with the picked file. Caller is responsible for parsing/validating. */
  onFile: (file: File) => void;
  /**
   * Sample download chips rendered above the dropzone. We surface these as
   * proper outlined buttons (not blue text links) so they read as "take this
   * action" rather than "in-prose link".
   */
  samples?: ImportSample[];
  /** Optional headline shown inside the dropzone above the CTA. */
  heading?: string;
  /** Optional subtitle shown inside the dropzone under the CTA. */
  hint?: string;
  /** Disables interactions (e.g. while validating). */
  disabled?: boolean;
  /** Shown next to the CTA when the upstream job is running. */
  loading?: boolean;
  /** When non-null, the dropzone shows "file ready" with a clear button. */
  selectedFile?: { name: string; size?: number } | null;
  /** Called when the user clears the chosen file. */
  onClear?: () => void;
};

export function ImportDropzone({
  accept = ".csv,.json",
  onFile,
  samples,
  heading = "Drag & drop your file here",
  hint = "or click anywhere in this zone to browse",
  disabled,
  loading,
  selectedFile,
  onClear,
}: ImportDropzoneProps) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const openPicker = useCallback(() => {
    if (disabled || loading) return;
    inputRef.current?.click();
  }, [disabled, loading]);

  const handleDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragOver(false);
      if (disabled || loading) return;
      const file = e.dataTransfer.files?.[0];
      if (file) onFile(file);
    },
    [disabled, loading, onFile],
  );

  const handleDragOver = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      if (disabled || loading) return;
      setDragOver(true);
    },
    [disabled, loading],
  );

  const handleDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    // Only clear when we actually leave the zone (not when entering a child).
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    setDragOver(false);
  }, []);

  return (
    <div className="space-y-4">
      {samples && samples.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {samples.map((s) => (
            <Button
              key={s.href}
              asChild
              variant="outline"
              size="sm"
              className="gap-1.5"
            >
              <a href={s.href} download>
                <Download className="size-3.5" aria-hidden="true" />
                {s.label}
              </a>
            </Button>
          ))}
        </div>
      ) : null}

      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled || undefined}
        aria-label="Upload data file"
        onClick={openPicker}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            openPicker();
          }
        }}
        onDragOver={handleDragOver}
        onDragEnter={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={cn(
          "group relative flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          dragOver
            ? "border-primary bg-primary/5"
            : "border-border bg-muted/30 hover:border-primary/60 hover:bg-muted/50",
          (disabled || loading) && "pointer-events-none opacity-60",
          !disabled && !loading && "cursor-pointer",
        )}
      >
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          accept={accept}
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onFile(file);
            // Reset so picking the same file again still fires `change`.
            e.target.value = "";
          }}
        />

        {selectedFile ? (
          <SelectedFileBadge file={selectedFile} onClear={onClear} loading={loading} />
        ) : (
          <>
            <div
              className={cn(
                "flex size-12 items-center justify-center rounded-full transition-colors",
                dragOver ? "bg-primary/15 text-primary" : "bg-background text-muted-foreground",
              )}
            >
              {loading ? (
                <Loader2 className="size-5 animate-spin" />
              ) : (
                <UploadCloud className="size-5" />
              )}
            </div>
            <div className="space-y-1">
              <p className="m-0 text-sm font-medium text-foreground">
                {loading ? "Working on it…" : heading}
              </p>
              <p className="m-0 text-xs text-muted-foreground">{hint}</p>
            </div>
            <p className="m-0 text-[11px] uppercase tracking-wider text-muted-foreground/80">
              {acceptToHint(accept)}
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function SelectedFileBadge({
  file,
  onClear,
  loading,
}: {
  file: { name: string; size?: number };
  onClear?: () => void;
  loading?: boolean;
}) {
  return (
    <div className="flex w-full max-w-md items-center gap-3 rounded-lg border border-border bg-background px-3 py-2 text-left">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
        {loading ? <Loader2 className="size-4 animate-spin" /> : <FileText className="size-4" />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="m-0 truncate text-sm font-medium text-foreground">{file.name}</p>
        {typeof file.size === "number" ? (
          <p className="m-0 text-xs text-muted-foreground">{formatBytes(file.size)}</p>
        ) : null}
      </div>
      {onClear && !loading ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onClear();
          }}
          aria-label="Remove selected file"
          className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      ) : null}
    </div>
  );
}

function acceptToHint(accept: string): string {
  const tokens = accept
    .split(",")
    .map((s) => s.trim().replace(/^\./, "").toUpperCase())
    .filter(Boolean);
  if (tokens.length === 0) return "Any file";
  if (tokens.length === 1) return `${tokens[0]} file`;
  return `${tokens.slice(0, -1).join(", ")} or ${tokens[tokens.length - 1]}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

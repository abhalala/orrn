import { formatKg, formatLength, type LengthUnit } from "@orrn/domain";
import { useT, type Translate } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { motionClass } from "@orrn/ui/components/motion";
import { SegmentedControl } from "@orrn/ui/components/segmented-control";
import { Sheet } from "@orrn/ui/components/sheet";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { StatusBlock } from "@orrn/ui/components/status-block";
import { cn } from "@orrn/ui/lib/utils";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Download, FileSpreadsheet, Info, Loader2, UploadCloud } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type DragEvent, type ReactNode } from "react";

import { useLengthUnit } from "@/shared/lib/length";
import { trpc } from "@/shared/utils/trpc";

import {
  IMPORT_CHUNK_SIZE,
  IMPORT_FIELDS,
  parseImport,
  type BundleImportRow,
  type CustomerImportRow,
  type DieImportRow,
  type ImportKind,
  type MatchedColumn,
  type ParsedRow,
  type ParseResult,
  type RejectedRow,
} from "./parse";
import { ACCEPT, fileKind, readSheetFile, type SheetRows } from "./read-file";
import { dieChunkInput, planDies, runChunks, type DieCheck, type DieOp } from "./submit";
import { columnGuide, downloadCsv, problemsCsv, rowsCsv, sampleCsv } from "./templates";

export type ImportSheetProps = {
  kind: ImportKind;
  open: boolean;
  onOpenChange(open: boolean): void;
  /** Called once a run finishes, with the number of rows saved. */
  onImported?(count: number): void;
};

type FileMeta = { name: string; size: number };
type Loaded = { file: FileMeta; sheet: SheetRows; parsed: ParseResult<ParsedRow> };
type Progress = { done: number; total: number };

type Stage =
  | { name: "pick"; error?: string }
  | { name: "reading"; file: FileMeta }
  | ({ name: "checking" } & Loaded)
  | ({ name: "review"; dieCheck?: DieCheck } & Loaded)
  | ({ name: "saving"; dieCheck?: DieCheck } & Loaded & Progress)
  | ({ name: "failed"; dieCheck?: DieCheck; failedChunk: number; message: string } & Loaded & Progress)
  | { name: "done"; count: number; newDies: number; sheet: SheetRows; rejected: readonly RejectedRow[] };

type Op = { row: number; data: ParsedRow; existingId?: string };

/** Footer: 56px on touch, 44px with a mouse; the secondary matches the primary's height. */
const PRIMARY_FOOTER = "pointer-fine:h-11 pointer-fine:px-5 pointer-fine:text-[15px]";
const SECONDARY_FOOTER = "pointer-coarse:h-14 pointer-coarse:text-[17px]";

/**
 * Bounds on one file (AGENTS.md: large imports are bounded). 20,000 rows is
 * 40 calls of 500; a bigger file should be split. 10 MB keeps Excel parsing
 * in the browser quick on an office PC.
 */
export const MAX_FILE_ROWS = 20_000;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

/** Rows shown in the problem list; the download has every one. */
const PROBLEMS_SHOWN = 50;
const PREVIEW_ROWS = 3;

function errorMessage(error: unknown, t: Translate): string {
  const e = error as { message?: unknown; data?: { code?: unknown } | null } | null;
  const code = e?.data?.code;
  if (code === "FORBIDDEN") return t("errors.forbidden");
  if (code === "UNAUTHORIZED") return t("errors.sessionExpired");
  if (!e?.data) return t("errors.network");
  const message = typeof e.message === "string" ? e.message : "";
  // A raw validation dump is no use to a person; the parser should have caught it anyway.
  return message && !message.trimStart().startsWith("[") ? message : t("errors.generic");
}

function describeRejected(r: RejectedRow, t: Translate) {
  return t(r.reason, { column: r.column, ...r.vars });
}

function downloadProblems(kind: ImportKind, sheet: SheetRows, rejected: readonly RejectedRow[], t: Translate) {
  downloadCsv(
    `orrn-${kind}-problems.csv`,
    problemsCsv(sheet, rejected, { row: t("imports.preview.row"), problem: t("imports.problemColumn") }, (r) =>
      describeRejected(r, t),
    ),
  );
}

/**
 * Import a sheet (CSV or Excel) of old bundles, dies or customers. Drop or
 * choose a file; orrn reads it in the browser and shows how many rows are
 * ready and which rows need fixing (with the reason) before anything is
 * saved. Saving goes 500 rows per call; if a call fails, the rows already
 * saved stay saved and "Try the rest again" continues from there.
 */
export function ImportSheet({ kind, open, onOpenChange, onImported }: ImportSheetProps) {
  const { t } = useT();
  const { unit } = useLengthUnit();
  const queryClient = useQueryClient();
  const [stage, setStage] = useState<Stage>({ name: "pick" });
  const [dieMode, setDieMode] = useState<"skip" | "update">("skip");
  const runId = useRef(0);

  const bundleImport = useMutation(trpc.bundle.bulkImport.mutationOptions());
  const customerImport = useMutation(trpc.customer.importCsv.mutationOptions());
  const dieValidate = useMutation(trpc.die.validateImport.mutationOptions());
  const dieProcess = useMutation(trpc.die.processImport.mutationOptions());

  // A fresh sheet every time it opens.
  useEffect(() => {
    if (!open) return;
    runId.current += 1;
    setStage({ name: "pick" });
    setDieMode("skip");
  }, [open]);

  const busy = stage.name === "saving" || stage.name === "reading" || stage.name === "checking";
  const handleOpenChange = (next: boolean) => {
    // Closing mid-save would leave the person unsure what was saved.
    if (!next && stage.name === "saving") return;
    onOpenChange(next);
  };

  const sectionColumn = (parsed: ParseResult<ParsedRow>) =>
    parsed.columns.find((c) => c.field === "sectionCode")?.header ?? "Section code";

  const plan = useMemo(() => {
    if (!("parsed" in stage)) return null;
    const { parsed } = stage;
    if (kind === "dies" && "dieCheck" in stage && stage.dieCheck) {
      const p = planDies(parsed.ok as DieImportRow[], parsed.okRows, stage.dieCheck, dieMode, sectionColumn(parsed));
      return { ops: p.ops as Op[], rejected: [...parsed.rejected, ...p.blocked].sort((a, b) => a.row - b.row), existing: p.existing };
    }
    return {
      ops: parsed.ok.map((data, i) => ({ row: parsed.okRows[i]!, data })),
      rejected: parsed.rejected,
      existing: 0,
    };
  }, [stage, kind, dieMode]);

  const readFile = useCallback(
    async (file: File) => {
      const id = runId.current;
      const meta = { name: file.name, size: file.size };
      if (!fileKind(file.name)) {
        setStage({ name: "pick", error: t("imports.wrongType") });
        return;
      }
      if (file.size > MAX_FILE_BYTES) {
        setStage({ name: "pick", error: t("imports.tooBig", { size: formatBytes(MAX_FILE_BYTES) }) });
        return;
      }
      setStage({ name: "reading", file: meta });
      let sheet: SheetRows;
      try {
        sheet = await readSheetFile(file);
      } catch {
        if (id === runId.current) setStage({ name: "pick", error: t("imports.readFailed") });
        return;
      }
      if (id !== runId.current) return;
      if (sheet.rows.length === 0) {
        setStage({ name: "pick", error: t("imports.noRows") });
        return;
      }
      if (sheet.rows.length > MAX_FILE_ROWS) {
        setStage({
          name: "pick",
          error: t("imports.tooManyRows", {
            count: sheet.rows.length.toLocaleString("en-IN"),
            max: MAX_FILE_ROWS.toLocaleString("en-IN"),
          }),
        });
        return;
      }
      const parsed = parseImport(kind, sheet.rows, { companyUnit: unit, firstDataRow: sheet.firstDataRow });
      const loaded: Loaded = { file: meta, sheet, parsed };
      if (kind !== "dies" || parsed.missingColumns.length > 0 || parsed.ok.length === 0) {
        setStage({ name: "review", ...loaded });
        return;
      }
      // Dies: ask the server which codes already exist (or belong to a deleted die) before showing counts.
      setStage({ name: "checking", ...loaded });
      const duplicates: DieCheck["duplicates"][number][] = [];
      const errors: DieImportRow[] = [];
      const run = await runChunks(parsed.ok as DieImportRow[], async (rows) => {
        const res = await dieValidate.mutateAsync(rows);
        duplicates.push(...(res.duplicates as DieCheck["duplicates"][number][]));
        errors.push(...(res.errors as DieImportRow[]));
      });
      if (id !== runId.current) return;
      if (!run.ok) {
        setStage({ name: "pick", error: errorMessage(run.error, t) });
        return;
      }
      setStage({ name: "review", ...loaded, dieCheck: { duplicates, errors } });
    },
    [kind, unit, t, dieValidate],
  );

  const save = async (startChunk = 0) => {
    if (!plan || !("parsed" in stage) || stage.name === "checking") return;
    const id = runId.current;
    const loaded: Loaded = { file: stage.file, sheet: stage.sheet, parsed: stage.parsed };
    const dieCheck = "dieCheck" in stage ? stage.dieCheck : undefined;
    const ops = plan.ops;
    const total = ops.length;
    let newDies = 0;
    setStage({ name: "saving", ...loaded, dieCheck, done: Math.min(total, startChunk * IMPORT_CHUNK_SIZE), total });

    const run = await runChunks(
      ops,
      async (chunkOps) => {
        if (kind === "bundles") {
          const res = await bundleImport.mutateAsync({ rows: chunkOps.map((o) => o.data as BundleImportRow) });
          newDies += res.newDies;
        } else if (kind === "customers") {
          await customerImport.mutateAsync(chunkOps.map((o) => o.data as CustomerImportRow));
        } else {
          await dieProcess.mutateAsync(dieChunkInput(chunkOps as DieOp[]));
        }
      },
      {
        startChunk,
        onProgress: (done) => {
          if (id === runId.current) setStage((s) => (s.name === "saving" ? { ...s, done } : s));
        },
      },
    );

    // Whatever was saved is real: refresh the lists behind the sheet either way.
    const filters =
      kind === "bundles"
        ? [trpc.bundle.pathFilter(), trpc.die.pathFilter(), trpc.dashboard.pathFilter()]
        : kind === "dies"
          ? [trpc.die.pathFilter()]
          : [trpc.customer.pathFilter()];
    for (const f of filters) void queryClient.invalidateQueries(f);
    if (id !== runId.current) return;

    if (!run.ok) {
      setStage({
        name: "failed",
        ...loaded,
        dieCheck,
        done: run.done,
        total,
        failedChunk: run.failedChunk,
        message: errorMessage(run.error, t),
      });
      return;
    }
    setStage({ name: "done", count: run.done, newDies, sheet: loaded.sheet, rejected: plan.rejected });
    onImported?.(run.done);
  };

  // One live region that stays mounted for the whole sheet, so every stage change is read out
  // (a region inserted together with its text is often skipped by screen readers).
  const announcement = (() => {
    switch (stage.name) {
      case "reading":
        return t("imports.reading", { name: stage.file.name });
      case "checking":
        return t("imports.checking");
      case "review": {
        if (stage.parsed.missingColumns.length > 0) return t("imports.missingTitle");
        const ready = plan?.ops.length ?? 0;
        const problems = plan?.rejected.length ?? 0;
        return problems > 0
          ? `${t("settings.data.rowsOk", { count: ready })}. ${t("settings.data.rowsRejected", { count: problems })}.`
          : t("settings.data.rowsOk", { count: ready });
      }
      case "saving":
        return t("imports.saving", { done: stage.done.toLocaleString("en-IN"), total: stage.total.toLocaleString("en-IN") });
      case "done":
        return t("settings.data.imported", { count: stage.count });
      default:
        // Pick errors and a failed save use role="alert" in place.
        return "";
    }
  })();

  const footer = (() => {
    switch (stage.name) {
      case "review": {
        const ready = plan?.ops.length ?? 0;
        if (stage.parsed.missingColumns.length > 0 || ready === 0) {
          return (
            <Button variant="secondary" className={SECONDARY_FOOTER} onClick={() => handleOpenChange(false)}>
              {t("common.close")}
            </Button>
          );
        }
        return (
          <>
            <Button variant="secondary" className={SECONDARY_FOOTER} onClick={() => handleOpenChange(false)}>
              {t("common.cancel")}
            </Button>
            <Button size="lg" className={PRIMARY_FOOTER} onClick={() => void save(0)}>
              {t("settings.data.submit", { count: ready.toLocaleString("en-IN") })}
            </Button>
          </>
        );
      }
      case "saving":
        return (
          <Button size="lg" loading disabled aria-busy="true" className={PRIMARY_FOOTER}>
            {t("common.saving")}
          </Button>
        );
      case "failed":
        return (
          <>
            <Button variant="secondary" className={SECONDARY_FOOTER} onClick={() => handleOpenChange(false)}>
              {t("common.close")}
            </Button>
            <Button size="lg" className={PRIMARY_FOOTER} onClick={() => void save(stage.failedChunk)}>
              {t("imports.retry")}
            </Button>
          </>
        );
      case "done":
        return (
          <Button size="lg" className={PRIMARY_FOOTER} onClick={() => handleOpenChange(false)}>
            {t("common.done")}
          </Button>
        );
      default:
        return undefined;
    }
  })();

  return (
    <Sheet
      open={open}
      onOpenChange={handleOpenChange}
      title={t(`imports.title.${kind}`)}
      description={t(`imports.about.${kind}`)}
      footer={footer}
      className="lg:w-[520px]"
    >
      <p role="status" data-slot="import-announce" className="sr-only">
        {announcement}
      </p>
      <div data-slot="import-sheet" data-stage={stage.name} aria-busy={busy || undefined} className="flex flex-col gap-6 pt-1">
        {stage.name === "pick" ? (
          <PickStage kind={kind} unit={unit} error={stage.error} onFile={(f) => void readFile(f)} />
        ) : stage.name === "reading" || stage.name === "checking" ? (
          <ReadingStage name={stage.file.name} checking={stage.name === "checking"} />
        ) : stage.name === "done" ? (
          <DoneStage
            count={stage.count}
            newDies={stage.newDies}
            problems={stage.rejected.length}
            onDownloadProblems={() => downloadProblems(kind, stage.sheet, stage.rejected, t)}
          />
        ) : (
          <>
            <FileRow
              file={stage.file}
              onChooseAnother={stage.name === "saving" ? undefined : () => setStage({ name: "pick" })}
            />
            {stage.name === "saving" ? (
              <SavingStage done={stage.done} total={stage.total} />
            ) : stage.name === "failed" ? (
              <FailedStage
                done={stage.done}
                total={stage.total}
                message={stage.message}
                onDownload={() => {
                  const rows = (plan?.ops ?? []).slice(stage.failedChunk * IMPORT_CHUNK_SIZE).map((o) => o.row);
                  downloadCsv(`orrn-${kind}-not-saved.csv`, rowsCsv(stage.sheet, rows));
                }}
              />
            ) : stage.parsed.missingColumns.length > 0 ? (
              <MissingColumns kind={kind} unit={unit} missing={stage.parsed.missingColumns} />
            ) : plan ? (
              <ReviewStage
                kind={kind}
                unit={unit}
                loaded={stage}
                ops={plan.ops}
                rejected={plan.rejected}
                existing={plan.existing}
                dieMode={dieMode}
                onDieMode={setDieMode}
              />
            ) : null}
          </>
        )}
      </div>
    </Sheet>
  );
}

/* -------------------------------------------------------------------------- */
/* Pick                                                                        */
/* -------------------------------------------------------------------------- */

function PickStage({
  kind,
  unit,
  error,
  onFile,
}: {
  kind: ImportKind;
  unit: LengthUnit;
  error?: string;
  onFile(file: File): void;
}) {
  const { t } = useT();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const errorId = useId();
  const guideId = useId();
  const guide = columnGuide(kind, unit);
  const hasLength = guide.some((c) => IMPORT_FIELDS[kind].find((f) => f.id === c.field)?.type === "length");
  const hasWeight = guide.some((c) => IMPORT_FIELDS[kind].find((f) => f.id === c.field)?.type === "weight");

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) onFile(file);
  };

  return (
    <>
      <div className="flex flex-col gap-2">
        <div
          data-slot="import-drop"
          data-dragging={dragging || undefined}
          onDragEnter={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={(e) => {
            if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
            setDragging(false);
          }}
          onDrop={onDrop}
          className={cn(
            "flex flex-col items-center gap-3 rounded-card border-2 border-dashed px-5 py-8 text-center transition-colors duration-[var(--dur-fast)]",
            dragging ? "border-foreground bg-surface-sunken" : "border-control/60 bg-surface-sunken/60",
          )}
        >
          <span
            aria-hidden="true"
            className={cn(
              "flex size-12 items-center justify-center rounded-full transition-colors duration-[var(--dur-fast)]",
              dragging ? "bg-primary text-primary-foreground" : "bg-card text-foreground shadow-sm",
            )}
          >
            <UploadCloud className="size-6" strokeWidth={2} />
          </span>
          <p className="m-0 font-display text-[19px] font-bold leading-tight tracking-[-0.02em] text-foreground break-words">
            {dragging ? t("imports.drop.dragging") : t("imports.drop.title")}
          </p>
          <p className="m-0 text-[14px] text-muted-foreground">{t("imports.drop.or")}</p>
          <Button
            variant="secondary"
            onClick={() => inputRef.current?.click()}
            aria-describedby={error ? `${errorId} ${guideId}` : guideId}
          >
            <FileSpreadsheet aria-hidden="true" strokeWidth={2} />
            {t("imports.drop.choose")}
          </Button>
          <p id={guideId} className="m-0 text-[13px] text-muted-foreground">
            {t("imports.drop.types")}
          </p>
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            tabIndex={-1}
            aria-hidden="true"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              // Reset so choosing the same file again still fires `change`.
              e.target.value = "";
              if (file) onFile(file);
            }}
          />
        </div>
        {error ? (
          <p id={errorId} role="alert" className="m-0 flex items-start gap-2 text-[14px] font-medium leading-5 text-destructive">
            <AlertCircle aria-hidden="true" strokeWidth={2} className="mt-0.5 size-[18px] shrink-0" />
            <span className="min-w-0 break-words">{error}</span>
          </p>
        ) : null}
      </div>

      <section aria-labelledby={`${guideId}-h`} className="flex flex-col gap-3">
        <h3 id={`${guideId}-h`} className="m-0 font-display text-[17px] font-bold leading-tight tracking-[-0.02em]">
          {t("imports.columns.heading")}
        </h3>
        <ul className="m-0 flex list-none flex-col divide-y divide-border rounded-card border border-border bg-card p-0">
          {guide.map((c) => (
            <li key={c.field} className="flex min-h-11 items-center justify-between gap-3 px-4 py-2">
              <span className="min-w-0 text-[15px] font-semibold break-words text-foreground">{c.header}</span>
              <span
                className={cn(
                  "shrink-0 text-[13px]",
                  c.required ? "font-semibold text-foreground" : "text-muted-foreground",
                )}
              >
                {c.required ? t("imports.columns.required") : t("imports.columns.optional")}
              </span>
            </li>
          ))}
        </ul>
        {hasLength || hasWeight ? (
          <div className="flex flex-col gap-1.5 text-[14px] leading-5 text-muted-foreground">
            <p className="m-0">{t("imports.columns.unitRule")}</p>
            {hasLength ? (
              <p className="m-0">
                {unit === "mm" ? t("imports.columns.lengthFallbackMm") : t("imports.columns.lengthFallbackInch")}
              </p>
            ) : null}
            {hasWeight ? <p className="m-0">{t("imports.columns.weightFallback")}</p> : null}
          </div>
        ) : null}
        <div>
          <Button
            variant="ghost"
            className="-ml-3"
            onClick={() => downloadCsv(`orrn-${kind}-sample.csv`, sampleCsv(kind, unit))}
          >
            <Download aria-hidden="true" strokeWidth={2} />
            {t("imports.columns.sample")}
          </Button>
        </div>
        {kind === "bundles" ? (
          <p className="m-0 flex items-start gap-2 text-[14px] leading-5 text-foreground">
            <Info aria-hidden="true" strokeWidth={2} className="mt-0.5 size-[18px] shrink-0 text-muted-foreground" />
            <span className="min-w-0 break-words">{t("imports.legacyDies")}</span>
          </p>
        ) : null}
      </section>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Reading / file row                                                          */
/* -------------------------------------------------------------------------- */

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Number((bytes / 1024).toFixed(1))} KB`;
  return `${Number((bytes / (1024 * 1024)).toFixed(1))} MB`;
}

function FileRow({ file, onChooseAnother }: { file: FileMeta; onChooseAnother?: () => void }) {
  const { t } = useT();
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <span aria-hidden="true" className="flex size-11 shrink-0 items-center justify-center rounded-full bg-surface-sunken">
        <FileSpreadsheet className="size-5" strokeWidth={2} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="m-0 text-[15px] font-semibold leading-5 break-all text-foreground">{file.name}</p>
        <p className="m-0 font-mono text-[13px] tabular-nums text-muted-foreground">{formatBytes(file.size)}</p>
      </div>
      {onChooseAnother ? (
        <Button variant="ghost" size="sm" onClick={onChooseAnother}>
          {t("imports.chooseAnother")}
        </Button>
      ) : null}
    </div>
  );
}

function ReadingStage({ name, checking }: { name: string; checking: boolean }) {
  const { t } = useT();
  return (
    <div className="flex flex-col gap-4">
      <p className="m-0 flex items-start gap-2 text-[15px] font-semibold leading-6 text-muted-foreground">
        <Loader2 aria-hidden="true" className="mt-0.5 size-[18px] shrink-0 animate-spin motion-reduce:animate-none" />
        <span className="min-w-0 break-all">{checking ? t("imports.checking") : t("imports.reading", { name })}</span>
      </p>
      <div className="grid grid-cols-2 gap-3">
        <Skeleton className="h-[168px] rounded-block" />
        <Skeleton className="h-[168px] rounded-block" />
      </div>
      <Skeleton className="h-28 rounded-card" />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Review                                                                      */
/* -------------------------------------------------------------------------- */

function MissingColumns({ kind, unit, missing }: { kind: ImportKind; unit: LengthUnit; missing: readonly string[] }) {
  const { t } = useT();
  const guide = columnGuide(kind, unit);
  return (
    <div role="alert" className="flex flex-col gap-3 rounded-card border border-destructive/40 bg-tone-red-tint p-4">
      <p className="m-0 flex items-center gap-2 font-display text-[17px] font-bold leading-tight text-tone-red-ink">
        <AlertCircle aria-hidden="true" strokeWidth={2} className="size-5 shrink-0" />
        {t("imports.missingTitle")}
      </p>
      <p className="m-0 text-[15px] leading-6 text-foreground">{t("imports.missingBody", { count: missing.length })}</p>
      <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-[15px] font-semibold text-foreground">
        {missing.map((field) => (
          <li key={field}>{guide.find((c) => c.field === field)?.header ?? field}</li>
        ))}
      </ul>
    </div>
  );
}

function ReviewStage({
  kind,
  unit,
  loaded,
  ops,
  rejected,
  existing,
  dieMode,
  onDieMode,
}: {
  kind: ImportKind;
  unit: LengthUnit;
  loaded: Loaded;
  ops: readonly Op[];
  rejected: readonly RejectedRow[];
  existing: number;
  dieMode: "skip" | "update";
  onDieMode(mode: "skip" | "update"): void;
}) {
  const { t } = useT();
  const { parsed, sheet } = loaded;
  const ready = ops.length;
  const problems = rejected.length;
  const problemsId = useId();

  return (
    <>
      <div className={cn("grid gap-3", problems > 0 ? "grid-cols-2" : "grid-cols-1")}>
        <StatusBlock
          tone="green"
          title={t("imports.ready")}
          value={ready}
          unit={t("imports.rows", { count: ready })}
          className={cn(motionClass.pop, "min-h-[148px]")}
        />
        {problems > 0 ? (
          <StatusBlock
            tone="amber"
            title={t("imports.problems")}
            value={problems}
            unit={t("imports.rows", { count: problems })}
            className={cn(motionClass.pop, "min-h-[148px]")}
          />
        ) : null}
      </div>

      {ready === 0 && existing === 0 ? (
        <p className="m-0 text-[15px] font-medium leading-6 text-foreground">{t("imports.nothingReady")}</p>
      ) : null}

      {kind === "dies" && existing > 0 ? (
        <section className="flex flex-col gap-3" aria-labelledby={`${problemsId}-existing`}>
          <h3 id={`${problemsId}-existing`} className="m-0 text-[15px] font-semibold leading-6 text-foreground">
            {t("imports.existing.title", { count: existing })}
          </h3>
          <SegmentedControl
            label={t("imports.existing.label")}
            value={dieMode}
            onChange={onDieMode}
            options={[
              { value: "skip", label: t("imports.existing.skip") },
              { value: "update", label: t("imports.existing.update") },
            ]}
          />
        </section>
      ) : null}

      <ColumnsRead columns={parsed.columns} ignored={parsed.ignoredColumns} unit={unit} />

      {ready > 0 ? <Preview kind={kind} unit={unit} ops={ops.slice(0, PREVIEW_ROWS)} /> : null}

      {problems > 0 ? (
        <section aria-labelledby={problemsId} className="flex flex-col gap-3">
          <h3 id={problemsId} className="m-0 font-display text-[17px] font-bold leading-tight tracking-[-0.02em]">
            {t("imports.problemList")}
          </h3>
          <ul className="m-0 flex list-none flex-col divide-y divide-border rounded-card border border-border bg-card p-0">
            {rejected.slice(0, PROBLEMS_SHOWN).map((r) => (
              <li key={`${r.row}-${r.column}`} className="flex items-start gap-3 px-4 py-2.5 text-[14px] leading-5">
                <span aria-hidden="true" className="w-14 shrink-0 font-mono font-semibold tabular-nums text-tone-amber-ink">
                  {r.row}
                </span>
                <span className="min-w-0 flex-1 break-words text-foreground">
                  <span className="sr-only">{t("settings.data.rowProblem", { row: r.row, reason: "" })}</span>
                  {describeRejected(r, t)}
                </span>
              </li>
            ))}
          </ul>
          {problems > PROBLEMS_SHOWN ? (
            <p className="m-0 text-[14px] text-muted-foreground">
              {t("imports.problemMore", { count: (problems - PROBLEMS_SHOWN).toLocaleString("en-IN") })}
            </p>
          ) : null}
          <div>
            <Button
              variant="secondary"
              onClick={() => downloadProblems(kind, sheet, rejected, t)}
            >
              <Download aria-hidden="true" strokeWidth={2} />
              {t("imports.downloadProblems")}
            </Button>
          </div>
        </section>
      ) : null}
    </>
  );
}

function ColumnsRead({
  columns,
  ignored,
  unit,
}: {
  columns: readonly MatchedColumn[];
  ignored: readonly string[];
  unit: LengthUnit;
}) {
  const { t } = useT();
  const headingId = useId();
  const describe = (c: MatchedColumn) => {
    const field = t(`imports.field.${c.field}` as Parameters<Translate>[0]);
    if (c.unit) return t("imports.readAs.unit", { field, unit: t(`imports.unit.${c.unit}`) });
    const isLength = ["length", "width", "height", "thickness", "oblique", "leg"].includes(c.field);
    const isWeight = ["weight", "weightMin", "weightMax"].includes(c.field);
    if (isLength) return t("imports.readAs.fallback", { field, unit: t(unit === "mm" ? "imports.unit.mm" : "imports.unit.in") });
    if (isWeight) return t("imports.readAs.unit", { field, unit: t("imports.unit.kg") });
    return t("imports.readAs.plain", { field });
  };
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <h3 id={headingId} className="m-0 font-display text-[17px] font-bold leading-tight tracking-[-0.02em]">
        {t("imports.readAs.heading")}
      </h3>
      <dl className="m-0 flex flex-col divide-y divide-border rounded-card border border-border bg-card">
        {columns.map((c) => (
          <div key={c.field} className="grid gap-x-4 gap-y-0.5 px-4 py-2.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
            <dt className="min-w-0 text-[15px] font-semibold break-words text-foreground">{c.header}</dt>
            <dd className="m-0 min-w-0 text-[14px] leading-5 break-words text-muted-foreground sm:text-[15px] sm:leading-6">
              {describe(c)}
            </dd>
          </div>
        ))}
      </dl>
      {ignored.length > 0 ? (
        <p className="m-0 text-[14px] leading-5 break-words text-muted-foreground">
          {t("imports.readAs.notUsed", { columns: ignored.join(", ") })}
        </p>
      ) : null}
    </section>
  );
}

function Preview({ kind, unit, ops }: { kind: ImportKind; unit: LengthUnit; ops: readonly Op[] }) {
  const { t } = useT();
  const headingId = useId();
  const lines = ops.map((op) => {
    let title: ReactNode;
    let facts: ReactNode[];
    if (kind === "bundles") {
      const b = op.data as BundleImportRow;
      title = (
        <span className="font-mono">
          {b.dieSeries} / {b.dieSectionCode}
        </span>
      );
      facts = [
        `${b.quantity.toLocaleString("en-IN")} ${t("units.pcs")}`,
        `${formatKg(b.weightG / 1000)} ${t("units.kg")}`,
        formatLength(b.lengthMm, unit),
      ];
    } else if (kind === "dies") {
      const d = op.data as DieImportRow;
      title = (
        <span className="font-mono">
          {d.series} / {d.sectionCode}
        </span>
      );
      facts = [`${formatKg(d.weightMinG / 1000)}-${formatKg(d.weightMaxG / 1000)} ${t("units.kgPer12ft")}`];
      if (d.name) facts.unshift(<span className="font-sans">{d.name}</span>);
    } else {
      const c = op.data as CustomerImportRow;
      title = <span>{c.name}</span>;
      facts = [c.phone, c.taxId].filter((v): v is string => Boolean(v));
    }
    return { row: op.row, title, facts };
  });

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <h3 id={headingId} className="m-0 font-display text-[17px] font-bold leading-tight tracking-[-0.02em]">
        {t("imports.preview.heading")}
      </h3>
      <ul className="m-0 flex list-none flex-col divide-y divide-border rounded-card border border-border bg-card p-0">
        {lines.map((line) => (
          <li key={line.row} className="flex items-start gap-3 px-4 py-2.5">
            <span className="w-14 shrink-0 pt-px text-[13px] leading-5 text-muted-foreground">
              {t("imports.preview.row")} <span className="font-mono tabular-nums">{line.row}</span>
            </span>
            <div className="min-w-0 flex-1">
              <p className="m-0 text-[15px] font-semibold leading-5 break-words text-foreground">{line.title}</p>
              {line.facts.length > 0 ? (
                <p className="m-0 mt-0.5 flex flex-wrap gap-x-4 gap-y-0.5 font-mono text-[14px] leading-5 tabular-nums text-muted-foreground">
                  {line.facts.map((fact, i) => (
                    <span key={i} className="break-words">
                      {fact}
                    </span>
                  ))}
                </p>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Saving / failed / done                                                      */
/* -------------------------------------------------------------------------- */

function SavingStage({ done, total }: Progress) {
  const { t } = useT();
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  const label = t("imports.saving", { done: done.toLocaleString("en-IN"), total: total.toLocaleString("en-IN") });
  return (
    <div className="flex flex-col gap-3">
      <p className="m-0 font-display text-[28px] font-extrabold leading-tight tracking-[-0.03em] tabular-nums text-foreground break-words">
        {label}
      </p>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        className="h-2 overflow-hidden rounded-full bg-surface-sunken"
      >
        <div
          className="h-full origin-left rounded-full bg-primary transition-transform duration-[var(--dur-base)] motion-reduce:transition-none"
          style={{ transform: `scaleX(${pct / 100})` }}
        />
      </div>
      <p className="m-0 text-[14px] text-muted-foreground">{t("imports.keepOpen")}</p>
    </div>
  );
}

function FailedStage({
  done,
  total,
  message,
  onDownload,
}: Progress & { message: string; onDownload(): void }) {
  const { t } = useT();
  return (
    <div className="flex flex-col gap-4">
      <div role="alert" className="flex flex-col gap-2 rounded-card border border-destructive/40 bg-tone-red-tint p-4">
        <p className="m-0 flex items-start gap-2 text-[15px] font-semibold leading-6 text-foreground">
          <AlertCircle aria-hidden="true" strokeWidth={2} className="mt-1 size-[18px] shrink-0 text-tone-red-ink" />
          <span className="min-w-0 break-words">
            {t("imports.partial", { done: done.toLocaleString("en-IN"), total: total.toLocaleString("en-IN") })}
          </span>
        </p>
        <p className="m-0 pl-[26px] text-[15px] leading-6 break-words text-tone-red-ink">{message}</p>
      </div>
      <div>
        <Button variant="secondary" onClick={onDownload}>
          <Download aria-hidden="true" strokeWidth={2} />
          {t("imports.downloadUnsaved")}
        </Button>
      </div>
    </div>
  );
}

function DoneStage({
  count,
  newDies,
  problems,
  onDownloadProblems,
}: {
  count: number;
  newDies: number;
  problems: number;
  onDownloadProblems(): void;
}) {
  const { t } = useT();
  return (
    <div className="flex flex-col gap-4">
      <StatusBlock
        tone="green"
        title={t("imports.done")}
        value={count}
        unit={t("imports.rows", { count })}
        className={motionClass.pop}
      />
      {newDies > 0 ? (
        <p className="m-0 flex items-start gap-2 text-[15px] leading-6 text-foreground">
          <Info aria-hidden="true" strokeWidth={2} className="mt-1 size-[18px] shrink-0 text-muted-foreground" />
          <span className="min-w-0 break-words">{t("imports.newDies", { count: newDies })}</span>
        </p>
      ) : null}
      {problems > 0 ? (
        <div className="flex flex-col items-start gap-2">
          <p className="m-0 text-[15px] leading-6 text-foreground">{t("settings.data.rowsRejected", { count: problems })}</p>
          <Button variant="secondary" onClick={onDownloadProblems}>
            <Download aria-hidden="true" strokeWidth={2} />
            {t("imports.downloadProblems")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

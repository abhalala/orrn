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
import { useMe } from "@/shared/lib/me";
import { trpc } from "@/shared/utils/trpc";

import { loadImportedRows, rememberImportedRows, splitAlreadyImported } from "./imported-rows";
import {
  IMPORT_CHUNK_SIZE,
  IMPORT_FIELDS,
  parseImport,
  readHeader,
  type BundleImportRow,
  type ColumnConflict,
  type CustomerImportRow,
  type DieImportRow,
  type ImportKind,
  type MatchedColumn,
  type ParsedRow,
  type ParseResult,
  type RejectedRow,
} from "./parse";
import { ACCEPT, fileProblem, formatBytes, readSheetFile, rowsProblem, type SheetRows } from "./read-file";
import {
  chunkRequestId,
  dieChunkInput,
  IMPORT_INVALIDATES,
  importFailure,
  planBundles,
  planDies,
  runChunks,
  uniqueDies,
  type BundleCheck,
  type DieCheck,
  type DieOp,
  type DieRef,
  type ImportFailure,
  type ImportOp,
} from "./submit";
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
/** What the server said about the sheet before saving (dies already in orrn, deleted dies). */
type Checks = { dieCheck?: DieCheck; bundleCheck?: BundleCheck };
/**
 * What a run has done so far, carried across "Try the rest again" so the done
 * screen counts every call, not only the resumed ones.
 * `already`: rows the server had from an earlier import of this same sheet.
 */
type Tally = { saved: number; already: number; newDies: number; created: number; updated: number };
const NO_TALLY: Tally = { saved: 0, already: 0, newDies: 0, created: 0, updated: 0 };

type Stage =
  | { name: "pick"; error?: string }
  | { name: "reading"; file: FileMeta }
  | ({ name: "checking" } & Loaded)
  | ({ name: "review" } & Loaded & Checks)
  | ({ name: "saving"; from: number; tally: Tally } & Loaded & Checks & Progress)
  | ({
      name: "failed";
      failedChunk: number;
      failure: ImportFailure;
      tally: Tally;
      /** The person asked to close: show what closing means first. */
      confirmClose: boolean;
    } & Loaded &
      Checks &
      Progress)
  | { name: "done"; tally: Tally; sheet: SheetRows; rejected: readonly RejectedRow[] };

type Op = ImportOp;

/** Footer: 56px on touch, 44px with a mouse; the secondary matches the primary's height. */
const PRIMARY_FOOTER = "pointer-fine:h-11 pointer-fine:px-5 pointer-fine:text-[15px]";
const SECONDARY_FOOTER = "pointer-coarse:h-14 pointer-coarse:text-[17px]";

/** Rows shown in the problem list; the download has every one. */
const PROBLEMS_SHOWN = 50;
const PREVIEW_ROWS = 3;
/** `bundle.importCheck` takes up to 2000 dies per call. */
const DIE_CHECK_CHUNK = 2000;

/** The element a stage puts focus on when it appears (its status, error or result). */
const STAGE_FOCUS = "[data-stage-focus]";

const fmt = (n: number) => n.toLocaleString("en-IN");

/** `window.localStorage`, or null where reading it throws (blocked site data). */
function localStore(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** Nothing is read or saved while a field is filled by two columns or a required one is missing. */
const isBlocked = (parsed: ParseResult<ParsedRow>) => parsed.missingColumns.length > 0 || parsed.conflictColumns.length > 0;

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

function invalidateAfterImport(kind: ImportKind, queryClient: ReturnType<typeof useQueryClient>) {
  const filters = {
    bundle: () => trpc.bundle.pathFilter(),
    die: () => trpc.die.pathFilter(),
    dashboard: () => trpc.dashboard.pathFilter(),
    stock: () => trpc.stock.pathFilter(),
    analytics: () => trpc.analytics.pathFilter(),
    customer: () => trpc.customer.pathFilter(),
  } as const;
  for (const name of IMPORT_INVALIDATES[kind]) void queryClient.invalidateQueries(filters[name]());
}

/**
 * Import a sheet (CSV or Excel) of old bundles, dies or customers. Drop or
 * choose a file; orrn reads it in the browser, asks the server about dies
 * that already exist or were deleted, and shows how many rows are ready and
 * which rows need fixing (with the reason) before anything is saved.
 *
 * Saving goes 500 rows per call, each with a request id derived from its
 * rows, so a call sent twice (a reply lost on plant Wi-Fi, or the same sheet
 * chosen again later) never saves its rows twice. If a call fails, the rows
 * already saved stay saved; the sheet says which rows, and "Try the rest
 * again" continues from the failed call. Nothing in the failed state starts
 * the file over.
 */
export function ImportSheet({ kind, open, onOpenChange, onImported }: ImportSheetProps) {
  const { t } = useT();
  const { unit } = useLengthUnit();
  const queryClient = useQueryClient();
  const { data: me } = useMe();
  const companyId = me?.company?.id ?? "";
  /** Rows this browser already saved for this company (see imported-rows.ts), read when a file is chosen. */
  const importedRef = useRef<ReadonlySet<string>>(new Set());
  const [stage, setStage] = useState<Stage>({ name: "pick" });
  const [dieMode, setDieMode] = useState<"skip" | "update">("skip");
  const runId = useRef(0);
  const bodyRef = useRef<HTMLDivElement>(null);

  const bundleImport = useMutation(trpc.bundle.bulkImport.mutationOptions());
  const bundleCheck = useMutation(trpc.bundle.importCheck.mutationOptions());
  const customerImport = useMutation(trpc.customer.importCsv.mutationOptions());
  const dieValidate = useMutation(trpc.die.validateImport.mutationOptions());
  const dieProcess = useMutation(trpc.die.processImport.mutationOptions());

  // A fresh sheet every time it opens. Radix puts the first focus; stage focus starts after that.
  const focusKey = useRef<string | null>(null);
  useEffect(() => {
    if (!open) return;
    runId.current += 1;
    focusKey.current = null;
    setStage({ name: "pick" });
    setDieMode("skip");
  }, [open]);

  // Each new stage puts focus on its own status, error or result, so keyboard and
  // screen-reader users land on what changed instead of the top of the dialog.
  const stageKey = `${stage.name}|${stage.name === "pick" ? (stage.error ?? "") : ""}|${stage.name === "failed" && stage.confirmClose ? "confirm" : ""}`;
  useEffect(() => {
    if (!open) return;
    if (focusKey.current === null) {
      // Just opened: wait for the fresh pick stage, and leave the first focus to the dialog.
      if (stageKey === "pick||") focusKey.current = stageKey;
      return;
    }
    if (focusKey.current === stageKey) return;
    focusKey.current = stageKey;
    bodyRef.current?.closest("[role='dialog']")?.querySelector<HTMLElement>(STAGE_FOCUS)?.focus();
  }, [open, stageKey]);

  // A file dropped anywhere outside the drop zone must not make the browser open it (and leave orrn).
  useEffect(() => {
    if (!open) return;
    const stop = (e: globalThis.DragEvent) => {
      if (e.dataTransfer?.types.includes("Files")) e.preventDefault();
    };
    window.addEventListener("dragover", stop);
    window.addEventListener("drop", stop);
    return () => {
      window.removeEventListener("dragover", stop);
      window.removeEventListener("drop", stop);
    };
  }, [open]);

  const busy = stage.name === "saving" || stage.name === "reading" || stage.name === "checking";
  const handleOpenChange = (next: boolean) => {
    if (next) {
      onOpenChange(true);
      return;
    }
    // Closing mid-save would leave the person unsure what was saved.
    if (stage.name === "saving") return;
    // After a failed save, say what closing leaves behind before closing.
    if (stage.name === "failed" && !stage.confirmClose) {
      setStage({ ...stage, confirmClose: true });
      return;
    }
    onOpenChange(false);
  };

  const sectionColumn = (parsed: ParseResult<ParsedRow>) =>
    parsed.columns.find((c) => c.field === "sectionCode" || c.field === "dieSectionCode")?.header ?? "Section code";
  const nameColumn = (parsed: ParseResult<ParsedRow>) => parsed.columns.find((c) => c.field === "name")?.header ?? "Name";

  const plan = useMemo(() => {
    if (!("parsed" in stage)) return null;
    const { parsed } = stage;
    const byRow = (a: RejectedRow, b: RejectedRow) => a.row - b.row;
    if (kind === "dies" && "dieCheck" in stage && stage.dieCheck) {
      const p = planDies(parsed.ok as DieImportRow[], parsed.okRows, stage.dieCheck, dieMode, sectionColumn(parsed));
      return { ops: p.ops as Op[], rejected: [...parsed.rejected, ...p.blocked].sort(byRow), existing: p.existing };
    }
    if (kind === "bundles" && "bundleCheck" in stage && stage.bundleCheck) {
      const p = planBundles(parsed.ok as BundleImportRow[], parsed.okRows, stage.bundleCheck, sectionColumn(parsed));
      const fresh = splitAlreadyImported(kind, p.ops, importedRef.current, sectionColumn(parsed));
      return { ops: fresh.ops as Op[], rejected: [...parsed.rejected, ...p.blocked, ...fresh.blocked].sort(byRow), existing: 0 };
    }
    const all = parsed.ok.map((data, i) => ({ row: parsed.okRows[i]!, data })) as Op[];
    if (kind === "customers") {
      const fresh = splitAlreadyImported(kind, all, importedRef.current, nameColumn(parsed));
      return { ops: fresh.ops, rejected: [...parsed.rejected, ...fresh.blocked].sort(byRow), existing: 0 };
    }
    return { ops: all, rejected: parsed.rejected, existing: 0 };
  }, [stage, kind, dieMode]);

  const readFile = useCallback(
    async (file: File) => {
      const id = runId.current;
      const meta = { name: file.name, size: file.size };
      // Every file starts from the safe choice for dies already in orrn.
      setDieMode("skip");
      const refused = fileProblem(meta);
      if (refused) {
        setStage({ name: "pick", error: t(refused.key, refused.vars) });
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
      const tooMany = rowsProblem(sheet.rows.length);
      if (tooMany) {
        setStage({ name: "pick", error: t(tooMany.key, tooMany.vars) });
        return;
      }
      const parsed = parseImport(kind, sheet.rows, { companyUnit: unit, firstDataRow: sheet.firstDataRow });
      const loaded: Loaded = { file: meta, sheet, parsed };
      importedRef.current = loadImportedRows(localStore(), companyId, kind);
      if (kind === "customers" || isBlocked(parsed) || parsed.ok.length === 0) {
        setStage({ name: "review", ...loaded });
        return;
      }
      // Ask the server before showing counts: dies already in orrn, and dies that were deleted
      // (the server refuses a whole call that names one, so those rows become problem rows now).
      setStage({ name: "checking", ...loaded });
      if (kind === "dies") {
        const duplicates: DieCheck["duplicates"][number][] = [];
        const errors: DieImportRow[] = [];
        const run = await runChunks(parsed.ok as DieImportRow[], async (rows) => {
          const res = await dieValidate.mutateAsync(rows);
          duplicates.push(...(res.duplicates as DieCheck["duplicates"][number][]));
          errors.push(...(res.errors as DieImportRow[]));
        });
        if (id !== runId.current) return;
        if (!run.ok) {
          setStage({ name: "pick", error: t(importFailure(run.error).message) });
          return;
        }
        setStage({ name: "review", ...loaded, dieCheck: { duplicates, errors } });
        return;
      }
      const deleted: DieRef[] = [];
      const run = await runChunks(
        uniqueDies(parsed.ok as BundleImportRow[]),
        async (dies) => {
          const res = await bundleCheck.mutateAsync({ dies });
          deleted.push(...res.deleted);
        },
        { size: DIE_CHECK_CHUNK },
      );
      if (id !== runId.current) return;
      if (!run.ok) {
        setStage({ name: "pick", error: t(importFailure(run.error).message) });
        return;
      }
      setStage({ name: "review", ...loaded, bundleCheck: { deleted } });
    },
    [kind, unit, t, dieValidate, bundleCheck, companyId],
  );

  /** Sends the plan from `startChunk`. `resume` is set by "Try the rest again" after a failed call. */
  const save = async (startChunk: number, prev: Tally, resume: boolean) => {
    if (!plan || !("parsed" in stage) || stage.name === "checking") return;
    const id = runId.current;
    const loaded: Loaded = { file: stage.file, sheet: stage.sheet, parsed: stage.parsed };
    const checks: Checks = {
      ...("dieCheck" in stage ? { dieCheck: stage.dieCheck } : {}),
      ...("bundleCheck" in stage ? { bundleCheck: stage.bundleCheck } : {}),
    };
    const ops = plan.ops;
    const total = ops.length;
    const tally: Tally = { ...prev };
    const from = Math.min(total, startChunk * IMPORT_CHUNK_SIZE);
    setStage({ name: "saving", ...loaded, ...checks, done: from, from, total, tally });

    const run = await runChunks(
      ops,
      async (chunkOps, index) => {
        const clientRequestId = await chunkRequestId(kind, chunkOps);
        let replayed: boolean;
        let created = 0;
        let updated = 0;
        if (kind === "bundles") {
          const res = await bundleImport.mutateAsync({ rows: chunkOps.map((o) => o.data as BundleImportRow), clientRequestId });
          replayed = res.replayed;
          tally.newDies += res.newDies;
        } else if (kind === "customers") {
          const res = await customerImport.mutateAsync({ rows: chunkOps.map((o) => o.data as CustomerImportRow), clientRequestId });
          replayed = res.replayed;
        } else {
          const input = dieChunkInput(chunkOps as DieOp[]);
          const res = await dieProcess.mutateAsync({ ...input, clientRequestId });
          replayed = res.replayed;
          created = input.newRows.length;
          updated = input.updatedRows.length;
        }
        // These rows are in orrn now: a corrected copy of this sheet must not add them again.
        if (kind !== "dies") rememberImportedRows(localStore(), companyId, kind, chunkOps);
        // A replay of the call this resume starts with is that call's own lost reply: saved by
        // this run. Any other replay means the rows came in from an earlier import of this sheet.
        if (replayed && !(resume && index === startChunk)) {
          tally.already += chunkOps.length;
        } else {
          tally.saved += chunkOps.length;
          tally.created += created;
          tally.updated += updated;
        }
      },
      {
        startChunk,
        onProgress: (done) => {
          if (id === runId.current) setStage((s) => (s.name === "saving" ? { ...s, done, tally: { ...tally } } : s));
        },
      },
    );

    // Whatever was saved is real: refresh the lists behind the sheet either way.
    invalidateAfterImport(kind, queryClient);
    if (id !== runId.current) return;

    if (!run.ok) {
      setStage({
        name: "failed",
        ...loaded,
        ...checks,
        done: run.done,
        total,
        failedChunk: run.failedChunk,
        failure: importFailure(run.error),
        tally: { ...tally },
        confirmClose: false,
      });
      return;
    }
    setStage({ name: "done", tally: { ...tally }, sheet: loaded.sheet, rejected: plan.rejected });
    onImported?.(tally.saved);
  };

  // Stage changes are read out by moving focus to the new stage (see STAGE_FOCUS). The live
  // region only carries saving progress, which changes while focus stays put.
  const announcement =
    stage.name === "saving" && stage.done > stage.from
      ? t("imports.saving", { done: fmt(stage.done), total: fmt(stage.total) })
      : "";

  const footer = (() => {
    switch (stage.name) {
      case "review": {
        const ready = plan?.ops.length ?? 0;
        if (isBlocked(stage.parsed) || ready === 0) {
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
            <Button size="lg" className={PRIMARY_FOOTER} onClick={() => void save(0, NO_TALLY, false)}>
              {t("settings.data.submit", { count: fmt(ready) })}
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
        if (stage.confirmClose) {
          return (
            <>
              <Button variant="secondary" className={SECONDARY_FOOTER} onClick={() => onOpenChange(false)}>
                {t("imports.confirmClose.close")}
              </Button>
              <Button size="lg" className={PRIMARY_FOOTER} onClick={() => setStage({ ...stage, confirmClose: false })}>
                {t("imports.confirmClose.keepOpen")}
              </Button>
            </>
          );
        }
        return (
          <>
            <Button variant="secondary" className={SECONDARY_FOOTER} onClick={() => handleOpenChange(false)}>
              {t("common.close")}
            </Button>
            {stage.failure.retry ? (
              <Button size="lg" className={PRIMARY_FOOTER} onClick={() => void save(stage.failedChunk, stage.tally, true)}>
                {t("imports.retry")}
              </Button>
            ) : null}
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
      dismissible={stage.name !== "saving"}
      className="lg:w-[520px]"
    >
      <p role="status" data-slot="import-announce" className="sr-only">
        {announcement}
      </p>
      <div
        ref={bodyRef}
        data-slot="import-sheet"
        data-stage={stage.name}
        aria-busy={busy || undefined}
        className="flex flex-col gap-6 pt-1"
      >
        {stage.name === "pick" ? (
          <PickStage kind={kind} unit={unit} error={stage.error} onFile={(f) => void readFile(f)} />
        ) : stage.name === "reading" || stage.name === "checking" ? (
          <ReadingStage name={stage.file.name} checking={stage.name === "checking"} />
        ) : stage.name === "done" ? (
          <DoneStage
            kind={kind}
            tally={stage.tally}
            problems={stage.rejected.length}
            onDownloadProblems={() => downloadProblems(kind, stage.sheet, stage.rejected, t)}
          />
        ) : (
          <>
            <FileRow
              file={stage.file}
              // Only before saving: after a failed save, starting the file over is never offered.
              onChooseAnother={stage.name === "review" ? () => setStage({ name: "pick" }) : undefined}
            />
            {stage.name === "saving" ? (
              <SavingStage done={stage.done} total={stage.total} />
            ) : stage.name === "failed" ? (
              <FailedStage
                stage={stage}
                ops={plan?.ops ?? []}
                problems={plan?.rejected.length ?? 0}
                onDownloadUnsaved={() => {
                  const rows = (plan?.ops ?? []).slice(stage.failedChunk * IMPORT_CHUNK_SIZE).map((o) => o.row);
                  downloadCsv(`orrn-${kind}-not-saved.csv`, rowsCsv(stage.sheet, rows));
                }}
                onDownloadProblems={() => downloadProblems(kind, stage.sheet, plan?.rejected ?? [], t)}
              />
            ) : isBlocked(stage.parsed) ? (
              <MissingColumns
                kind={kind}
                unit={unit}
                missing={stage.parsed.missingColumns}
                badUnit={stage.parsed.badUnitColumns}
                conflicts={stage.parsed.conflictColumns}
              />
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
            {dragging ? (
              t("imports.drop.dragging")
            ) : (
              <>
                {/* Phones and tablets have nothing to drag from: ask them to choose. */}
                <span className="pointer-coarse:hidden">{t("imports.drop.title")}</span>
                <span className="hidden pointer-coarse:inline">{t("imports.drop.titleTouch")}</span>
              </>
            )}
          </p>
          <p className="m-0 text-[14px] text-muted-foreground pointer-coarse:hidden">{t("imports.drop.or")}</p>
          <Button
            data-stage-focus
            className="pointer-coarse:h-14 pointer-coarse:px-7 pointer-coarse:text-[17px]"
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
          // Focus returns to "Choose file", which this error describes: read once, with the way out.
          <p id={errorId} data-slot="import-error" className="m-0 flex items-start gap-2 text-[14px] font-medium leading-5 text-destructive">
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

function FileRow({ file, onChooseAnother }: { file: FileMeta; onChooseAnother?: () => void }) {
  const { t } = useT();
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span aria-hidden="true" className="flex size-11 shrink-0 items-center justify-center rounded-full bg-surface-sunken">
        <FileSpreadsheet className="size-5" strokeWidth={2} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="m-0 text-[15px] font-semibold leading-5 [overflow-wrap:anywhere] text-foreground">{file.name}</p>
        <p className="m-0 font-mono text-[13px] tabular-nums text-muted-foreground">{formatBytes(file.size)}</p>
      </div>
      {onChooseAnother ? (
        // Phones: under the name, so a long file name keeps the full width.
        <div className="max-sm:basis-full max-sm:pl-11">
          <Button variant="ghost" onClick={onChooseAnother}>
            {t("imports.chooseAnother")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function ReadingStage({ name, checking }: { name: string; checking: boolean }) {
  const { t } = useT();
  const label = checking ? t("imports.checking") : t("imports.reading", { name });
  return (
    <div className="flex flex-col gap-4">
      <p
        data-stage-focus
        tabIndex={-1}
        className="m-0 flex items-start gap-2 text-[15px] font-semibold leading-6 text-muted-foreground"
      >
        <Loader2 aria-hidden="true" className="mt-0.5 size-[18px] shrink-0 animate-spin motion-reduce:animate-none" />
        <span className="min-w-0 [overflow-wrap:anywhere]">{label}</span>
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

function MissingColumns({
  kind,
  unit,
  missing,
  badUnit,
  conflicts,
}: {
  kind: ImportKind;
  unit: LengthUnit;
  missing: readonly string[];
  badUnit: readonly string[];
  conflicts: readonly ColumnConflict[];
}) {
  const { t } = useT();
  const guide = columnGuide(kind, unit);
  const headers = missing.map((field) => guide.find((c) => c.field === field)?.header ?? field);
  const conflictLines = conflicts.map((c) =>
    t("imports.conflictItem", {
      field: guide.find((g) => g.field === c.field)?.header ?? c.field,
      columns: c.headers.join(", "),
    }),
  );
  const badUnitText = badUnit.length > 0 ? t("imports.readAs.badUnit", { columns: badUnit.join(", ") }) : null;
  const title = missing.length > 0 ? t("imports.missingTitle") : t("imports.conflictTitle");
  const label = [
    title,
    missing.length > 0 ? `${t("imports.missingBody", { count: missing.length })} ${headers.join(", ")}` : null,
    conflictLines.length > 0 ? `${t("imports.conflictBody")} ${conflictLines.join(". ")}` : null,
    badUnitText,
  ]
    .filter(Boolean)
    .join(". ");
  return (
    <div
      data-stage-focus
      data-slot="import-missing"
      tabIndex={-1}
      role="group"
      aria-label={label}
      className="flex flex-col gap-3 rounded-card border border-destructive/40 bg-tone-red-tint p-4"
    >
      <p className="m-0 flex items-center gap-2 font-display text-[17px] font-bold leading-tight text-tone-red-ink">
        <AlertCircle aria-hidden="true" strokeWidth={2} className="size-5 shrink-0" />
        {title}
      </p>
      {missing.length > 0 ? (
        <>
          <p className="m-0 text-[15px] leading-6 text-foreground">{t("imports.missingBody", { count: missing.length })}</p>
          <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-[15px] font-semibold text-foreground">
            {headers.map((header) => (
              <li key={header}>{header}</li>
            ))}
          </ul>
        </>
      ) : null}
      {conflictLines.length > 0 ? (
        <div data-slot="import-conflict" className="flex flex-col gap-3">
          {missing.length > 0 ? <p className="m-0 font-semibold text-tone-red-ink">{t("imports.conflictTitle")}</p> : null}
          <p className="m-0 text-[15px] leading-6 text-foreground">{t("imports.conflictBody")}</p>
          <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-[15px] font-semibold break-words text-foreground">
            {conflictLines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {badUnitText ? <p className="m-0 text-[14px] leading-5 break-words text-foreground">{badUnitText}</p> : null}
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
  const summary =
    problems > 0
      ? `${t("settings.data.rowsOk", { count: ready })}. ${t("settings.data.rowsRejected", { count: problems })}.`
      : t("settings.data.rowsOk", { count: ready });

  return (
    <>
      <div
        data-stage-focus
        data-slot="import-counts"
        tabIndex={-1}
        role="group"
        aria-label={summary}
        className={cn("grid gap-3 rounded-block", problems > 0 ? "grid-cols-2" : "grid-cols-1")}
      >
        <StatusBlock
          tone="green"
          title={t("imports.ready")}
          value={ready}
          unit={t("imports.rows", { count: ready })}
          className={cn(motionClass.pop, "min-h-[148px]")}
        />
        {problems > 0 ? (
          // Problems are not a success: no pop.
          <StatusBlock
            tone="amber"
            title={t("imports.problems")}
            value={problems}
            unit={t("imports.rows", { count: problems })}
            className="min-h-[148px]"
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
          <p className="m-0 text-[14px] leading-5 text-muted-foreground">{t("imports.existing.help")}</p>
        </section>
      ) : null}

      <ColumnsRead
        kind={kind}
        columns={parsed.columns}
        ignored={parsed.ignoredColumns}
        badUnit={parsed.badUnitColumns}
        unit={unit}
      />

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
              {t("imports.problemMore", { count: fmt(problems - PROBLEMS_SHOWN) })}
            </p>
          ) : null}
          <div>
            <Button variant="secondary" onClick={() => downloadProblems(kind, sheet, rejected, t)}>
              <Download aria-hidden="true" strokeWidth={2} />
              {t("imports.downloadProblems")}
            </Button>
          </div>
        </section>
      ) : null}
    </>
  );
}

const LENGTH_FIELDS = new Set(["length", "width", "height", "thickness", "leg"]);
const PER_12FT_FIELDS = new Set(["weightMin", "weightMax"]);

function ColumnsRead({
  kind,
  columns,
  ignored,
  badUnit,
  unit,
}: {
  kind: ImportKind;
  columns: readonly MatchedColumn[];
  ignored: readonly string[];
  badUnit: readonly string[];
  unit: LengthUnit;
}) {
  const { t } = useT();
  const headingId = useId();
  const guide = columnGuide(kind, unit);
  const describe = (c: MatchedColumn) => {
    const field = t(`imports.field.${c.field}` as Parameters<Translate>[0]);
    // Die weight bands are per 12 ft piece; say so once.
    if (PER_12FT_FIELDS.has(c.field) && c.unit !== "g") return t("imports.readAs.perTwelve", { field });
    if (c.unit) return t("imports.readAs.unit", { field, unit: t(`imports.unit.${c.unit}`) });
    if (LENGTH_FIELDS.has(c.field)) {
      return t("imports.readAs.fallback", { field, unit: t(unit === "mm" ? "imports.unit.mm" : "imports.unit.in") });
    }
    if (c.field === "weight") return t("imports.readAs.unit", { field, unit: t("imports.unit.kg") });
    // A column named like the guide's own header was used as it is, in any language; only a
    // renamed column ("Qty" for Pieces) needs its field named.
    const guideHeader = guide.find((g) => g.field === c.field)?.header;
    if (guideHeader && readHeader(guideHeader).name === readHeader(c.header).name) return t("imports.readAs.same");
    return t("imports.readAs.plain", { field });
  };
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <h3 id={headingId} className="m-0 font-display text-[17px] font-bold leading-tight tracking-[-0.02em]">
        {t("imports.readAs.heading")}
      </h3>
      <dl className="m-0 flex flex-col divide-y divide-border rounded-card border border-border bg-card">
        {columns.map((c) => (
          <div key={c.header} className="grid gap-x-4 gap-y-0.5 px-4 py-2.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
            <dt className="min-w-0 text-[15px] font-semibold break-words text-foreground">{c.header}</dt>
            <dd className="m-0 min-w-0 text-[14px] leading-5 break-words text-muted-foreground sm:text-[15px] sm:leading-6">
              {describe(c)}
            </dd>
          </div>
        ))}
      </dl>
      {badUnit.length > 0 ? (
        <p className="m-0 flex items-start gap-2 text-[14px] leading-5 text-foreground">
          <AlertCircle aria-hidden="true" strokeWidth={2} className="mt-0.5 size-[18px] shrink-0 text-tone-amber-ink" />
          <span className="min-w-0 break-words">{t("imports.readAs.badUnit", { columns: badUnit.join(", ") })}</span>
        </p>
      ) : null}
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
      facts = [`${fmt(b.quantity)} ${t("units.pcs")}`, `${formatKg(b.weightG / 1000)} ${t("units.kg")}`, formatLength(b.lengthMm, unit)];
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
  const label = t("imports.saving", { done: fmt(done), total: fmt(total) });
  return (
    <div className="flex flex-col gap-3">
      <p
        data-stage-focus
        tabIndex={-1}
        className="m-0 font-display text-[28px] font-extrabold leading-tight tracking-[-0.03em] tabular-nums text-foreground break-words"
      >
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
  stage,
  ops,
  problems,
  onDownloadUnsaved,
  onDownloadProblems,
}: {
  stage: Extract<Stage, { name: "failed" }>;
  ops: readonly Op[];
  problems: number;
  onDownloadUnsaved(): void;
  onDownloadProblems(): void;
}) {
  const { t } = useT();
  const { done, total, failure, failedChunk, confirmClose } = stage;
  const first = failedChunk * IMPORT_CHUNK_SIZE;
  const fromRow = ops[first]?.row ?? 0;
  const toRow = ops[Math.min(ops.length, first + IMPORT_CHUNK_SIZE) - 1]?.row ?? fromRow;
  const lastSavedRow = done > 0 ? ops[done - 1]?.row : undefined;
  const unsaved = total - done;
  const unknown = failure.outcome === "unknown";

  const sentInCall = Math.min(ops.length, first + IMPORT_CHUNK_SIZE) - first;
  // After a lost reply "no rows were saved" would contradict "can't tell yet if they were".
  const saved =
    lastSavedRow !== undefined
      ? t("imports.failed.savedUpTo", { done: fmt(done), total: fmt(total), row: lastSavedRow })
      : unknown
        ? ""
        : t("imports.failed.nothingSaved");
  const what = unknown
    ? t("imports.failed.unknown", { count: sentInCall, from: fromRow, to: toRow })
    : t("imports.failed.refusedRows", { from: fromRow });
  const why = t(failure.message);
  const help = unknown ? t("imports.failed.unknownHelp") : t("imports.failed.refusedHelp");
  const confirmText = unknown
    ? t("imports.confirmClose.unknown", { count: unsaved })
    : t("imports.confirmClose.refused", { count: unsaved });

  return (
    <div className="flex flex-col gap-4">
      {confirmClose ? (
        <div
          data-stage-focus
          data-slot="import-confirm-close"
          tabIndex={-1}
          role="group"
          aria-label={`${t("imports.confirmClose.title")} ${confirmText}`}
          className="flex flex-col gap-2 rounded-card border border-border bg-card p-4"
        >
          <p className="m-0 font-display text-[17px] font-bold leading-tight tracking-[-0.02em] text-foreground">
            {t("imports.confirmClose.title")}
          </p>
          <p className="m-0 text-[15px] leading-6 text-foreground">{confirmText}</p>
        </div>
      ) : null}
      <div
        data-stage-focus={confirmClose ? undefined : true}
        data-slot="import-failed"
        tabIndex={-1}
        role="group"
        aria-label={[saved, what, why, help].filter(Boolean).join(" ")}
        className="flex flex-col gap-2 rounded-card border border-destructive/40 bg-tone-red-tint p-4"
      >
        <p className="m-0 flex items-start gap-2 text-[15px] font-semibold leading-6 text-foreground">
          <AlertCircle aria-hidden="true" strokeWidth={2} className="mt-1 size-[18px] shrink-0 text-tone-red-ink" />
          <span className="min-w-0 break-words">{[saved, what].filter(Boolean).join(" ")}</span>
        </p>
        <p className="m-0 pl-[26px] text-[15px] leading-6 break-words text-tone-red-ink">{why}</p>
        <p className="m-0 pl-[26px] text-[15px] leading-6 break-words text-foreground">{help}</p>
      </div>
      {/* After an unknown outcome the next rows may be saved already: no "not saved" file to re-import. */}
      {!unknown || problems > 0 ? (
        <div className="flex flex-wrap gap-2">
          {!unknown ? (
            <Button variant="secondary" onClick={onDownloadUnsaved}>
              <Download aria-hidden="true" strokeWidth={2} />
              {t("imports.downloadUnsaved")}
            </Button>
          ) : null}
          {problems > 0 ? (
            <Button variant="secondary" onClick={onDownloadProblems}>
              <Download aria-hidden="true" strokeWidth={2} />
              {t("imports.downloadProblems")}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function DoneStage({
  kind,
  tally,
  problems,
  onDownloadProblems,
}: {
  kind: ImportKind;
  tally: Tally;
  problems: number;
  onDownloadProblems(): void;
}) {
  const { t } = useT();
  const notes: string[] = [];
  if (tally.already > 0) notes.push(t("imports.already", { count: tally.already }));
  if (kind === "dies" && tally.updated > 0) notes.push(t("imports.diesDone", { created: tally.created, updated: tally.updated }));
  if (tally.newDies > 0) notes.push(t("imports.newDies", { count: tally.newDies }));
  const nothingNew = tally.saved === 0 && tally.already > 0;
  const label = [nothingNew ? t("imports.alreadyTitle") : t("settings.data.imported", { count: tally.saved }), ...notes].join(". ");
  return (
    <div className="flex flex-col gap-4">
      <div data-stage-focus data-slot="import-result" tabIndex={-1} role="group" aria-label={label} className="flex flex-col gap-4 rounded-block">
        {nothingNew ? (
          <p className="m-0 font-display text-[22px] font-bold leading-tight tracking-[-0.025em] text-foreground">
            {t("imports.alreadyTitle")}
          </p>
        ) : (
          <StatusBlock
            tone="green"
            title={t("imports.done")}
            value={tally.saved}
            unit={t("imports.rows", { count: tally.saved })}
            className={motionClass.pop}
          />
        )}
        {notes.map((note) => (
          <p key={note} className="m-0 flex items-start gap-2 text-[15px] leading-6 text-foreground">
            <Info aria-hidden="true" strokeWidth={2} className="mt-1 size-[18px] shrink-0 text-muted-foreground" />
            <span className="min-w-0 break-words">{note}</span>
          </p>
        ))}
      </div>
      {problems > 0 ? (
        <div className="flex flex-col items-start gap-2">
          <p className="m-0 text-[15px] leading-6 text-foreground">{t("settings.data.rowsRejected", { count: problems })}</p>
          <p data-slot="import-done-help" className="m-0 text-[15px] leading-6 font-semibold text-foreground">
            {t("imports.doneProblemsHelp")}
          </p>
          <Button variant="secondary" onClick={onDownloadProblems}>
            <Download aria-hidden="true" strokeWidth={2} />
            {t("imports.downloadProblems")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

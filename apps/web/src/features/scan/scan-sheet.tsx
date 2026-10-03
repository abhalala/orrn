import { parseScan } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { Field } from "@orrn/ui/components/field";
import { ScanField } from "@orrn/ui/components/scan-field";
import { Sheet } from "@orrn/ui/components/sheet";
import { useMediaQuery } from "@orrn/ui/hooks/use-media-query";
import { cn } from "@orrn/ui/lib/utils";
import type { StatusTone } from "@orrn/domain";
import { useNavigate } from "@tanstack/react-router";
import { AlertCircle, CheckCircle2, Info, Loader2 } from "lucide-react";
import { forwardRef, useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { toast } from "sonner";

import { trpcClient } from "@/shared/utils/trpc";

import { CameraScanner } from "./camera-scanner";
import { createDeduper } from "./dedupe";
import { addOutcome, renderScanMessage, scanErrorKey, type AddBundlesReport } from "./scan-outcome";
import { isStoredNumber, resolveScan, useResolveScan, type ScanCandidate } from "./use-resolve-scan";

export type { AddBundlesReport } from "./scan-outcome";

/**
 * Where a scan goes. `lookup` (the tab bar, rail and sidebar Scan) opens the
 * bundle page. `dispatch` (a dispatch's Build step) adds every scan to that
 * dispatch and stays open; `onAdded` gets each report with added bundles so
 * the screen behind can refresh. `dispatchCode` titles the sheet.
 */
export type ScanMode =
  | { kind: "lookup" }
  | { kind: "dispatch"; dispatchId: string; dispatchCode?: string; onAdded(report: AddBundlesReport): void };

type ScanSheetProps = { mode: ScanMode; open: boolean; onOpenChange(open: boolean): void };

/** Haptic tick where the device has one. Never the only feedback: text and the pop always come with it. */
function buzz(pattern: number | number[]) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // Some browsers throw without a user gesture; the visible feedback is enough.
  }
}

/**
 * The scan sheet: camera (phones and iPads, camera first) and the manual /
 * wedge-scanner field (laptops, field first and focused) feed one handler.
 */
export function ScanSheet({ mode, open, onOpenChange }: ScanSheetProps) {
  const { t } = useT();
  const close = useCallback(() => onOpenChange(false), [onOpenChange]);
  const title =
    mode.kind === "dispatch" && mode.dispatchCode ? t("scan.continuous.title", { code: mode.dispatchCode }) : t("scan.title");
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      footer={
        mode.kind === "dispatch" ? (
          <Button size="lg" onClick={close}>
            {t("scan.continuous.done")}
          </Button>
        ) : undefined
      }
    >
      {mode.kind === "dispatch" ? (
        <DispatchPanel mode={mode} active={open} />
      ) : (
        <LookupPanel active={open} onDone={close} />
      )}
    </Sheet>
  );
}

/* -------------------------------------------------------------------------- */
/* Inputs: camera + field                                                      */
/* -------------------------------------------------------------------------- */

type ScanWindow = Window & { __orrnFakeScan?: (value: string) => void };

/** Phones and iPads: camera first, keyboard kept down. Laptops: the field first and focused. */
function useCoarsePointer() {
  return useMediaQuery("(pointer: coarse)");
}

/**
 * Camera and field, with the panel's feedback (count, status) placed where the
 * eye already is: right under the viewfinder on phones and iPads, so a small
 * screen shows the result without scrolling while the camera runs; under the
 * field on laptops, where a wedge scanner types into it.
 */
function ScanInputs({
  onScan,
  active,
  fieldRef,
  feedback,
}: {
  onScan(raw: string): void;
  active: boolean;
  fieldRef: RefObject<HTMLInputElement | null>;
  feedback: ReactNode;
}) {
  const { t } = useT();
  const coarse = useCoarsePointer();
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;
  const dedupe = useMemo(() => createDeduper(), []);

  // Camera reads repeat every frame: one per value per 1.5 s. The key is the
  // parsed code, so the same label read as a link and as a bare number (or in
  // another case) counts once. Typed and wedge entries are deliberate and
  // always go through.
  const onDetect = useCallback(
    (raw: string) => {
      const value = raw.trim();
      if (!value) return;
      const parsed = parseScan(value);
      if (!dedupe.accept(parsed.kind === "serial" ? parsed.serial : value)) return;
      onScanRef.current(value);
    },
    [dedupe],
  );

  // Test seam (dev server only; the branch is dropped from production builds):
  // stands in for a camera read, through the same de-dupe.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const w = window as ScanWindow;
    w.__orrnFakeScan = onDetect;
    return () => {
      if (w.__orrnFakeScan === onDetect) delete w.__orrnFakeScan;
    };
  }, [onDetect]);

  const camera = (
    <CameraScanner
      onDetect={onDetect}
      active={active}
      autoStart={coarse}
      emphasis={coarse ? "primary" : "secondary"}
    />
  );
  const field = (
    <Field label={t("scan.manualLabel")} hint={t("scan.manualHint")}>
      <ScanField ref={fieldRef} onScan={(raw) => onScanRef.current(raw)} placeholder="26I4086" autoFocus={!coarse} />
    </Field>
  );
  return (
    <div className={cn("flex flex-col", coarse ? "gap-3" : "gap-4")}>
      {coarse ? camera : field}
      {feedback}
      {coarse ? field : camera}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Status line (the polite live region)                                        */
/* -------------------------------------------------------------------------- */

type LineTone = "progress" | "success" | "neutral" | "error";

type Line = { id: number; tone: LineTone; message: string; serial?: string; extra?: string };

const LINE_ICON: Record<LineTone, ReactNode> = {
  progress: <Loader2 aria-hidden="true" className="mt-0.5 size-[18px] shrink-0 animate-spin text-muted-foreground" />,
  success: <CheckCircle2 aria-hidden="true" strokeWidth={2} className="mt-0.5 size-[18px] shrink-0 text-tone-green-ink" />,
  neutral: <Info aria-hidden="true" strokeWidth={2} className="mt-0.5 size-[18px] shrink-0 text-muted-foreground" />,
  error: <AlertCircle aria-hidden="true" strokeWidth={2} className="mt-0.5 size-[18px] shrink-0 text-destructive" />,
};

const LINE_TEXT: Record<LineTone, string> = {
  progress: "text-muted-foreground",
  success: "text-tone-green-ink",
  neutral: "text-foreground",
  error: "text-destructive",
};

/**
 * One polite live region for every result. Each new result replaces the
 * inner node (keyed), so a repeat ("Already in this dispatch" twice) is
 * announced again. Progress ("Searching", "Adding X") is shown next to it but
 * outside the region: only outcomes are announced.
 */
const StatusLine = forwardRef<HTMLDivElement, { line: Line | null }>(function StatusLine({ line }, ref) {
  const progress = line?.tone === "progress" ? line : null;
  const result = line && line.tone !== "progress" ? line : null;
  return (
    <div ref={ref} tabIndex={-1} className="min-h-6 min-w-0 text-[15px] leading-6 outline-none">
      {progress ? (
        <p className="m-0 flex min-w-0 items-start gap-2">
          {LINE_ICON.progress}
          <span className={cn("min-w-0 flex-1 break-words font-semibold", LINE_TEXT.progress)}>{progress.message}</span>
        </p>
      ) : null}
      <StatusRegion line={result} />
    </div>
  );
});

function StatusRegion({ line }: { line: Line | null }) {
  return (
    <p role="status" aria-live="polite" className="m-0 min-w-0">
      {line ? (
        <span key={line.id} className="flex min-w-0 items-start gap-2">
          {LINE_ICON[line.tone]}
          <span className="min-w-0 flex-1 break-words">
            <span className={cn("font-semibold", LINE_TEXT[line.tone])}>{line.message}</span>
            {line.serial ? (
              <>
                {" "}
                <span className="font-mono text-muted-foreground [overflow-wrap:anywhere]">{line.serial}</span>
              </>
            ) : null}
            {line.extra ? <span className="sr-only">. {line.extra}</span> : null}
          </span>
        </span>
      ) : null}
    </p>
  );
}

function CandidateList({ candidates, onPick }: { candidates: ScanCandidate[]; onPick(c: ScanCandidate): void }) {
  const { t } = useT();
  return (
    <ul aria-label={t("scan.ambiguous")} className="m-0 flex list-none flex-col gap-2 p-0">
      {candidates.map((c) => (
        <li key={c.bundleId}>
          <Button variant="secondary" className="h-14 w-full justify-between px-5" onClick={() => onPick(c)}>
            <span className="font-mono text-[17px]">{c.number}</span>
            <span className="text-[14px] font-medium text-muted-foreground">{t("scan.madeIn", { year: c.year })}</span>
          </Button>
        </li>
      ))}
    </ul>
  );
}

/* -------------------------------------------------------------------------- */
/* Lookup: open the bundle page                                                */
/* -------------------------------------------------------------------------- */

function LookupPanel({ active, onDone }: { active: boolean; onDone(): void }) {
  const { t } = useT();
  const navigate = useNavigate();
  const resolve = useResolveScan();
  const fieldRef = useRef<HTMLInputElement>(null);
  const [line, setLine] = useState<Line | null>(null);
  const [candidates, setCandidates] = useState<ScanCandidate[] | null>(null);
  // Only the newest scan may act (a wedge scanner or the camera can fire twice quickly).
  const latest = useRef(0);

  const go = (number: string) => {
    onDone();
    void navigate({ to: "/b/$serial", params: { serial: number } });
  };

  const onScan = async (raw: string) => {
    const ticket = ++latest.current;
    setCandidates(null);
    setLine({ id: ticket, tone: "progress", message: t("ui.searching") });
    try {
      const result = await resolve(raw);
      if (ticket !== latest.current) return;
      if (result.ok) {
        buzz(20);
        go(result.bundle.number);
      } else if (result.reason === "unrecognised") {
        buzz([30, 50, 30]);
        setLine({ id: ticket, tone: "error", message: t("scan.unrecognised") });
      } else if (result.reason === "not_found") {
        buzz([30, 50, 30]);
        setLine({ id: ticket, tone: "error", message: t("scan.notFound"), serial: result.code });
      } else {
        setLine({ id: ticket, tone: "neutral", message: t("scan.ambiguous"), serial: result.code });
        setCandidates(result.candidates);
      }
    } catch (error) {
      if (ticket !== latest.current) return;
      setLine({ id: ticket, tone: "error", message: t(scanErrorKey(error, "lookup")) });
    }
  };

  return (
    <div className="flex flex-col gap-4 pt-1">
      <ScanInputs
        onScan={(raw) => void onScan(raw)}
        active={active}
        fieldRef={fieldRef}
        feedback={
          <>
            <StatusLine line={line} />
            {candidates ? <CandidateList candidates={candidates} onPick={(c) => go(c.number)} /> : null}
          </>
        }
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Dispatch: continuous add with pop and a running count                       */
/* -------------------------------------------------------------------------- */

type ResultKind = "added" | "already" | "rejected" | "notFound";

type Recent = { id: number; serial: string; kind: ResultKind };

const RESULT_TONE: Record<ResultKind, StatusTone> = {
  added: "green",
  already: "neutral",
  rejected: "red",
  notFound: "amber",
};

const RECENT_LIMIT = 8;

function DispatchPanel({ mode, active }: { mode: Extract<ScanMode, { kind: "dispatch" }>; active: boolean }) {
  const { t } = useT();
  const coarse = useCoarsePointer();
  const fieldRef = useRef<HTMLInputElement>(null);
  const statusRef = useRef<HTMLDivElement>(null);
  const [count, setCount] = useState(0);
  const [lastAdded, setLastAdded] = useState<string | null>(null);
  const [line, setLine] = useState<Line | null>(null);
  const [recent, setRecent] = useState<Recent[]>([]);
  const [candidates, setCandidates] = useState<ScanCandidate[] | null>(null);
  const seq = useRef(0);
  const countRef = useRef(0);
  const modeRef = useRef(mode);
  modeRef.current = mode;
  // Scans are added one after another, in the order they were read, so a fast
  // wedge burst never races itself on the server.
  const queue = useRef<Promise<void>>(Promise.resolve());

  const remember = (serial: string, kind: ResultKind) =>
    setRecent((list) => [{ id: ++seq.current, serial, kind }, ...list].slice(0, RECENT_LIMIT));

  const process = async (raw: string) => {
    const id = ++seq.current;
    const parsed = parseScan(raw);
    if (parsed.kind !== "serial") {
      buzz([30, 50, 30]);
      setLine({ id, tone: "error", message: t("scan.unrecognised") });
      return;
    }
    let serial = parsed.serial;
    setLine({ id, tone: "progress", message: t("scan.continuous.adding", { serial }) });
    let addedReport: AddBundlesReport | null = null;
    try {
      // Old month-only numbers and legacy ids: find the bundle's own number first.
      if (!isStoredNumber(serial)) {
        const found = await resolveScan(serial);
        if (!found.ok) {
          if (found.reason === "ambiguous") {
            setLine({ id, tone: "neutral", message: t("scan.ambiguous"), serial });
            setCandidates(found.candidates);
          } else {
            buzz([30, 50, 30]);
            setLine({ id, tone: "error", message: t("scan.notFound"), serial });
            remember(serial, "notFound");
          }
          return;
        }
        serial = found.bundle.number;
      }
      const report = await trpcClient.dispatch.addBundlesBySerial.mutate({ id: modeRef.current.dispatchId, serials: [serial] });
      const outcome = addOutcome(report, serial);
      switch (outcome.kind) {
        case "added": {
          countRef.current += 1;
          setCount(countRef.current);
          setLastAdded(serial);
          buzz(25);
          setLine({
            id,
            tone: "success",
            message: t("scan.continuous.added", { serial }),
            extra: t("scan.continuous.count", { count: countRef.current }),
          });
          remember(serial, "added");
          addedReport = report;
          break;
        }
        case "already": {
          // Calm: a second read of a bundle already on the list is not an error.
          // The status line announces it; the toast is visual only (hidden from
          // assistive tech) so it isn't said twice.
          setLine({ id, tone: "neutral", message: t("scan.continuous.already"), serial });
          // At the top: a bottom toast would sit on the sheet's field and Done button.
          toast(<span aria-hidden="true">{t("scan.continuous.already")}</span>, {
            description: <span aria-hidden="true">{serial}</span>,
            id: `scan-already-${serial}`,
            position: "top-center",
            duration: 2500,
          });
          remember(serial, "already");
          break;
        }
        case "rejected": {
          buzz([30, 50, 30]);
          setLine({ id, tone: "error", message: renderScanMessage(t, outcome.message), serial });
          remember(serial, "rejected");
          break;
        }
        case "notFound": {
          buzz([30, 50, 30]);
          setLine({ id, tone: "error", message: t("scan.notFound"), serial });
          remember(serial, "notFound");
          break;
        }
      }
    } catch (error) {
      buzz([30, 50, 30]);
      setLine({ id, tone: "error", message: t(scanErrorKey(error, "dispatch")), serial });
    }
    // Outside the try: a problem in the screen behind must not read as a failed add.
    if (addedReport) {
      try {
        modeRef.current.onAdded(addedReport);
      } catch (error) {
        console.error("scan: onAdded failed", error);
      }
    }
  };

  const onScan = (raw: string) => {
    setCandidates(null);
    // One scan that throws must never stall the ones queued behind it.
    queue.current = queue.current
      .then(() => process(raw))
      .catch((error: unknown) => console.error("scan: processing failed", error));
  };

  const resultWord: Record<ResultKind, string> = {
    added: t("scan.continuous.result.added"),
    already: t("scan.continuous.result.already"),
    rejected: t("scan.continuous.result.rejected"),
    notFound: t("scan.continuous.result.notFound"),
  };

  return (
    <div className="flex flex-col gap-4 pt-1">
      <ScanInputs
        onScan={onScan}
        active={active}
        fieldRef={fieldRef}
        feedback={
          <>
            {/* The one loud element: the running count, which pops on every add. */}
            <div
              key={count}
              data-slot="scan-count-block"
              className={cn(
                // Compact on phones so count and status stay above the fold under a live camera.
                "flex min-h-[72px] min-w-0 flex-wrap items-end justify-between gap-x-4 gap-y-1 p-[14px] sm:min-h-[88px] sm:p-[18px]",
                count > 0 ? "orrn-block orrn-block-green animate-pop" : "rounded-block border border-border bg-card",
              )}
            >
              <p
                data-testid="scan-count"
                data-no-truncate=""
                className="m-0 font-display text-[30px] font-extrabold leading-none tracking-[-0.035em] tabular-nums sm:text-[34px]"
              >
                {t("scan.continuous.count", { count })}
              </p>
              {lastAdded ? (
                <p className="m-0 min-w-0 font-mono text-[15px] font-semibold [overflow-wrap:anywhere]">{lastAdded}</p>
              ) : null}
            </div>

            <StatusLine ref={statusRef} line={line} />

            {candidates ? (
              <CandidateList
                candidates={candidates}
                onPick={(c) => {
                  onScan(c.number);
                  // Keep focus in the sheet; on a phone, not on the field (no keyboard over the camera).
                  if (coarse) statusRef.current?.focus();
                  else fieldRef.current?.focus();
                }}
              />
            ) : null}
          </>
        }
      />

      {recent.length > 0 ? (
        <ul aria-label={t("scan.recent")} className="m-0 flex list-none flex-col divide-y divide-border p-0">
          {recent.map((r) => (
            <li key={r.id} className="flex min-h-12 min-w-0 items-center justify-between gap-3 py-2">
              <span className="min-w-0 font-mono text-[15px] [overflow-wrap:anywhere]">{r.serial}</span>
              <Chip tone={RESULT_TONE[r.kind]}>{resultWord[r.kind]}</Chip>
            </li>
          ))}
        </ul>
      ) : (
        <p className="m-0 text-[14px] leading-5 text-muted-foreground">{t("scan.continuous.empty")}</p>
      )}
    </div>
  );
}

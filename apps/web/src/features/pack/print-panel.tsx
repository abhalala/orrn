import { useT } from "@orrn/i18n";
import { Button, IconButton } from "@orrn/ui/components/button";
import { cn } from "@orrn/ui/lib/utils";
import { AlertTriangle, CheckCircle2, Printer, X } from "lucide-react";
import { useEffect, useState } from "react";

import { Can } from "@/shared/components/can";

import { printErrorKey, type PrintState } from "./print-labels";

/**
 * Label printing progress for one session: "Printing 3 of 40" with a bar
 * while it runs, then either "40 labels sent to printer" or the labels that
 * didn't print, each with the reason in plain words and one "Retry failed
 * labels" button. Progress is not chatty for screen readers: the start and
 * the result are announced, not every label.
 */
export function PrintPanel({ state, onRetry }: { state: PrintState; onRetry(): void }) {
  const { t } = useT();
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (state.status === "running") setDismissed(false);
  }, [state.status]);

  const running = state.status === "running";
  const failed = state.failed.length;
  const sent = state.done - failed;
  const pct = state.total > 0 ? Math.round((state.done / state.total) * 100) : 0;
  const progressLabel = t("pack.new.printingProgress", { done: state.done, total: state.total });

  const summary = running
    ? ""
    : failed > 0
      ? t("pack.new.printFailed", { count: failed })
      : t("pack.print.allSent", { count: sent });

  // The live region stays in the page while nothing prints, so the first
  // "Printing 1 of 40" is read out (a region that mounts with its text is not).
  const spoken = state.status === "idle" ? "" : running ? (state.done === 0 ? progressLabel : "") : summary;
  const live = (
    <p aria-live="polite" className="sr-only" data-slot="print-live">
      {spoken}
    </p>
  );

  if (state.status === "idle" || dismissed) return live;

  return (
    <>
      {live}
      <section
        aria-labelledby="pack-print-title"
        data-slot="print-panel"
        data-status={state.status}
        className="flex flex-col gap-3 rounded-card border border-border bg-card p-4 shadow-sm sm:p-5"
      >
        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className={cn(
              "flex size-10 shrink-0 items-center justify-center rounded-full",
              running && "bg-tone-blue-tint text-tone-blue-ink",
              !running && failed === 0 && "bg-tone-green-tint text-tone-green-ink",
              !running && failed > 0 && "bg-tone-amber-tint text-tone-amber-ink",
            )}
          >
            {running ? (
              <Printer className="size-5" strokeWidth={2} />
            ) : failed > 0 ? (
              <AlertTriangle className="size-5" strokeWidth={2} />
            ) : (
              <CheckCircle2 className="size-5" strokeWidth={2} />
            )}
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <h2 id="pack-print-title" className="m-0 text-[15px] font-semibold">
              {t("pack.print.title")}
            </h2>
            <p className="m-0 text-[15px] font-medium tabular-nums">{running ? progressLabel : summary}</p>
            {!running && failed > 0 && sent > 0 ? (
              <p className="m-0 text-[13px] text-muted-foreground">{t("pack.print.allSent", { count: sent })}</p>
            ) : null}
          </div>
          {!running ? (
            <IconButton label={t("common.close")} icon={<X strokeWidth={2} />} onClick={() => setDismissed(true)} />
          ) : null}
        </div>

        {running ? (
          <div
            role="progressbar"
            aria-label={t("pack.print.title")}
            aria-valuemin={0}
            aria-valuemax={state.total}
            aria-valuenow={state.done}
            aria-valuetext={progressLabel}
            className="h-2 overflow-hidden rounded-full bg-surface-sunken"
          >
            <div
              className="h-full origin-left rounded-full bg-[linear-gradient(90deg,var(--tone-blue-from),var(--tone-blue-to))] transition-transform duration-[var(--dur-base)]"
              style={{ transform: `scaleX(${pct / 100})` }}
            />
          </div>
        ) : null}

        {!running && failed > 0 ? (
          <>
            <ul className="m-0 flex list-none flex-col divide-y divide-border rounded-input bg-surface-sunken p-0">
              {state.failed.map((f) => (
                <li key={f.bundleId} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-3 py-2">
                  <span className="font-mono text-[14px] font-semibold">{f.serial}</span>
                  <span className="min-w-0 flex-1 text-[13px] text-muted-foreground">{t(printErrorKey(f.error))}</span>
                </li>
              ))}
            </ul>
            <Can do="spool.create_jobs">
              <Button size="lg" onClick={onRetry} className="self-start max-sm:w-full">
                {t("pack.new.retryFailed")}
              </Button>
            </Can>
          </>
        ) : null}
      </section>
    </>
  );
}

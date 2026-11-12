import { useT, type MessageKey, type Translate } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { PageHeader } from "@orrn/ui/components/page-header";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { UiLink } from "@orrn/ui/components/link";
import { useToastLift } from "@orrn/ui/hooks/use-toast-lift";
import { cn } from "@orrn/ui/lib/utils";
import { useId, useLayoutEffect, useRef, type ReactNode, type RefObject } from "react";

import { Can } from "@/shared/components/can";
import { showsQueryError } from "@/shared/lib/query-errors";

import { ingestErrorWords, reasonPieces, type Tone } from "../lib";

export const ingestKey = (key: string) => key as MessageKey;
export const translateKey = (t: Translate, key: string, vars?: Record<string, string | number>) =>
  t(ingestKey(key), vars as never);

const CHIP_TONES = { neutral: "neutral", info: "blue", success: "green", warning: "amber", danger: "red" } as const;
export const chipTone = (tone: Tone) => CHIP_TONES[tone];

export function IngestAccess({ children }: { children: ReactNode }) {
  const { t } = useT();
  return (
    <Can
      do={["ingest.upload", "ingest.merge"]}
      fallback={
        <>
          <PageHeader title={t("ingest.title")} subtitle={t("ingest.lead")} />
          <div className="rounded-card border border-border bg-card">
            <EmptyState title={t("settings.data.noAccess")} />
          </div>
        </>
      }
    >
      {children}
    </Can>
  );
}

export function Panel({
  title,
  children,
  className,
  actions,
}: {
  title: string;
  children: ReactNode;
  className?: string;
  actions?: ReactNode;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} className={cn("flex min-w-0 flex-col gap-3 rounded-card border border-border bg-card p-4 sm:p-5", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={id} className="m-0 font-display text-[19px] font-bold leading-tight tracking-[-0.02em] break-words">
          {title}
        </h2>
        {actions}
      </div>
      {children}
    </section>
  );
}

export function QueryPanel({ query, children }: { query: { isLoading: boolean; isError: boolean; error?: unknown; data: unknown; refetch(): unknown }; children: ReactNode }) {
  const { t } = useT();
  if (query.isLoading) {
    return (
      <div role="status" aria-busy="true" className="flex flex-col gap-3 rounded-card border border-border bg-card p-4">
        <span className="sr-only">{t("common.loading")}</span>
        <Skeleton className="h-5 w-2/5" />
        <Skeleton className="h-4 w-4/5" />
        <Skeleton className="h-28 w-full" />
      </div>
    );
  }
  if (showsQueryError(query)) {
    return (
      <div role="alert" className="rounded-card border border-border bg-card">
        <EmptyState
          title={translateKey(t, ingestErrorWords(query.error, "load").key)}
          action={
            <Button variant="secondary" onClick={() => void query.refetch()}>
              {t("common.retry")}
            </Button>
          }
        />
      </div>
    );
  }
  return <>{children}</>;
}

/**
 * A bar with a visible label. It keeps `role="progressbar"` and `aria-valuenow` and says nothing aloud by itself: the
 * screen's one status region announces a long read at 0, 25, 50, 75 and 100 percent (`progressStep`, `useAnnouncer`).
 * Without a value it is moving; under reduced motion it shows the word "Working" instead of a fill.
 */
export function ProgressBar({ value, label }: { value: number | null; label: string }) {
  const { t } = useT();
  const percent = value === null ? null : Math.max(0, Math.min(100, Math.round(value * 100)));
  return (
    <div className="flex flex-col gap-2">
      <p className="m-0 text-[14px] font-medium leading-5 break-words text-foreground">{label}</p>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent ?? undefined}
        aria-valuetext={percent === null ? label : undefined}
        className="h-1.5 overflow-hidden rounded-full bg-control/40"
      >
        <div
          className={cn("h-full origin-left rounded-full bg-primary", percent === null && "w-1/3 animate-pulse motion-reduce:hidden")}
          style={percent === null ? undefined : { transform: `scaleX(${percent / 100})` }}
        />
      </div>
      {percent === null ? <span className="hidden text-[13px] text-muted-foreground motion-reduce:inline">{t("ingest.read.working")}</span> : null}
    </div>
  );
}

export function InlineNotice({ children, tone = "neutral" }: { children: ReactNode; tone?: Tone }) {
  return (
    <div
      data-tone={tone}
      className={cn(
        "rounded-card border px-4 py-3 text-[14px] leading-6 break-words",
        tone === "danger" ? "border-destructive/40 bg-tone-red-tint text-tone-red-ink" : "border-border bg-surface-sunken text-foreground",
      )}
    >
      {children}
    </div>
  );
}

/** A held or failed reason in amber ink. The server's own English detail sits in a `lang="en"` span (work order M17). */
export function ReasonText({ code, detail }: { code: string | null; detail: string | null }) {
  const { t } = useT();
  const pieces = reasonPieces((key, vars) => translateKey(t, key, vars), code, detail);
  if (pieces.length === 0) return null;
  return (
    <p className="m-0 text-[14px] leading-6 break-words text-tone-amber-ink">
      {pieces.map((piece, index) => (piece.lang ? <span key={index} lang={piece.lang}>{piece.text}</span> : <span key={index}>{piece.text}</span>))}
    </p>
  );
}

export function CandidateLink({ id, children, className }: { id: string; children: ReactNode; className?: string }) {
  return (
    <UiLink to={`/ingest/review/${id}`} className={cn("inline-flex min-h-11 items-center font-semibold text-foreground underline-offset-4 hover:underline", className)}>
      {children}
    </UiLink>
  );
}

/** The words for a failed write, in an alert line. Nothing renders while `error` is null. */
export function ActionError({ error, kind = "action" }: { error: unknown; kind?: "load" | "action" }) {
  const { t } = useT();
  if (error === null || error === undefined || error === false) return null;
  return (
    <p role="alert" className="m-0 text-[13px] text-destructive">
      {translateKey(t, ingestErrorWords(error, kind).key)}
    </p>
  );
}

/**
 * A number in mono with its unit after it in muted sans ("58.4 kg"). Never wraps between the two. An empty unit
 * (feet and inches, where the text carries it) shows the number alone.
 */
export function Measure({ value, unit, className }: { value: string; unit: string; className?: string }) {
  return (
    <span data-no-truncate="" className={cn("whitespace-nowrap", className)}>
      <span className="font-mono tabular-nums">{value}</span>
      {unit ? <span className="ml-1 text-[0.85em] text-muted-foreground">{unit}</span> : null}
    </span>
  );
}

/**
 * The sticky action bar of the list and the review page (work order 3.2 and S9): above the phone tab bar, pinned to
 * the bottom while the page scrolls, a summary on the left and the buttons on the right. It is the same bar as the
 * pack flow's `PackBar`, copied here so no feature imports another. While it is mounted, the page keeps a focused
 * control above it (`scroll-padding-bottom`), and a toast rises above it.
 */
export function IngestBar({ summary, notice, children, className }: { summary?: ReactNode; notice?: ReactNode; children?: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useFocusClearance(ref);
  useToastLift(ref);
  return (
    <div
      ref={ref}
      data-slot="ingest-bar"
      className={cn(
        "sticky bottom-[calc(var(--shell-tabbar-offset)+12px)] z-20 mt-2 flex items-center gap-x-4 gap-y-2 rounded-card border border-border bg-card/95 p-2 pl-4 shadow-md backdrop-blur-md supports-[backdrop-filter]:bg-card/85",
        summary && !notice ? "flex-wrap sm:flex-nowrap" : "flex-wrap",
        className,
      )}
    >
      {notice ? <div className="-ml-2 w-full min-w-0">{notice}</div> : null}
      {summary ? <div className="min-w-0 flex-1 max-sm:basis-full">{summary}</div> : <div className="flex-1 max-sm:hidden" />}
      <div className={cn("flex min-w-0 flex-wrap justify-end gap-2", summary ? "max-sm:w-full max-sm:[&>*:last-child]:flex-1 sm:shrink-0" : "max-sm:w-full max-sm:[&>*:last-child]:flex-1")}>{children}</div>
    </div>
  );
}

function useFocusClearance(ref: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const root = document.documentElement;
    const apply = () => {
      const height = el.offsetHeight;
      const bottom = Number.parseFloat(getComputedStyle(el).bottom) || 0;
      root.style.scrollPaddingBottom = height > 0 ? `${Math.ceil(height + bottom + 8)}px` : "";
    };
    apply();
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(apply);
    resize?.observe(el);
    window.addEventListener("resize", apply);
    return () => {
      resize?.disconnect();
      window.removeEventListener("resize", apply);
      root.style.scrollPaddingBottom = "";
    };
  }, [ref]);
}

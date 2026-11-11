import { useT, type MessageKey, type Translate } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { PageHeader } from "@orrn/ui/components/page-header";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { UiLink } from "@orrn/ui/components/link";
import { cn } from "@orrn/ui/lib/utils";
import { useId, type ReactNode } from "react";

import { Can } from "@/shared/components/can";
import { showsQueryError } from "@/shared/lib/query-errors";

import { reasonLine, type Tone } from "../lib";

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

export function QueryPanel({ query, children }: { query: { isLoading: boolean; isError: boolean; data: unknown; refetch(): unknown }; children: ReactNode }) {
  const { t } = useT();
  if (query.isLoading) {
    return (
      <div aria-busy="true" aria-label={t("common.loading")} className="flex flex-col gap-3 rounded-card border border-border bg-card p-4">
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
          title={t("ingest.read.failed")}
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

export function ProgressBar({ value, label, announce = true }: { value: number | null; label: string; announce?: boolean }) {
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
        className="h-2 overflow-hidden rounded-full bg-surface-sunken"
      >
        <div
          className={cn("h-full origin-left rounded-full bg-primary", percent === null && "w-1/3 animate-pulse motion-reduce:animate-none")}
          style={percent === null ? undefined : { transform: `scaleX(${percent / 100})` }}
        />
      </div>
      {announce ? (
        <p role="status" aria-live="polite" aria-atomic="true" className="sr-only">
          {label}
        </p>
      ) : null}
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

export function ReasonText({ code, detail }: { code: string | null; detail: string | null }) {
  const { t } = useT();
  const reason = reasonLine(code, detail);
  if (!reason) return null;
  return <p className="m-0 text-[14px] leading-6 break-words text-tone-amber-ink">{reason.key ? translateKey(t, reason.key, reason.vars) : detail}</p>;
}

export function CandidateLink({ id, children, className }: { id: string; children: ReactNode; className?: string }) {
  return (
    <UiLink to={`/ingest/review/${id}`} className={cn("inline-flex min-h-11 items-center font-semibold text-foreground underline-offset-4 hover:underline", className)}>
      {children}
    </UiLink>
  );
}

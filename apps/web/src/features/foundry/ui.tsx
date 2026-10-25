import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { useFieldControl } from "@orrn/ui/components/field";
import { NativeSelect, type NativeSelectProps } from "@orrn/ui/components/native-select";
import { cn } from "@orrn/ui/lib/utils";
import type { ReactNode } from "react";

import { useMe } from "@/shared/lib/me";
import { DEFAULT_TIMEZONE } from "@/features/stock/format";

import { foundryError } from "./errors";

/** The plant's zone (`settings.timezone`), Asia/Kolkata when none is set. */
export function useTimeZone(): string {
  const { data: me } = useMe();
  const tz = (me?.company?.settings as { timezone?: unknown } | undefined)?.timezone;
  return typeof tz === "string" && tz ? tz : DEFAULT_TIMEZONE;
}

/** A refused write, in the person's language, where the form can see it. */
export function ErrorLine({ error, fallbackKey = "foundry.common.failed", className }: { error: unknown; fallbackKey?: "foundry.common.failed"; className?: string }) {
  const { t } = useT();
  if (!error) return null;
  return (
    <p role="alert" className={cn("m-0 rounded-card bg-tone-red-tint px-4 py-3 text-[14px] font-medium text-tone-red-ink break-words", className)} data-testid="foundry-error">
      {foundryError(t, error) || t(fallbackKey)}
    </p>
  );
}

/** A plain sentence in a tinted box (info / warning), never an error role. */
export function Note({ tone = "neutral", children, testId }: { tone?: "neutral" | "amber" | "red" | "green"; children: ReactNode; testId?: string }) {
  const toneClass =
    tone === "amber"
      ? "bg-tone-amber-tint text-tone-amber-ink"
      : tone === "red"
        ? "bg-tone-red-tint text-tone-red-ink"
        : tone === "green"
          ? "bg-tone-green-tint text-tone-green-ink"
          : "bg-surface-sunken text-foreground";
  return (
    <p className={cn("m-0 rounded-card px-4 py-3 text-[14px] leading-5 break-words", toneClass)} data-testid={testId}>
      {children}
    </p>
  );
}

export function LoadFailed({ title, onRetry }: { title: string; onRetry(): void }) {
  const { t } = useT();
  return (
    <div className="rounded-card border border-border bg-card">
      <EmptyState title={title} action={<Button variant="secondary" onClick={onRetry}>{t("common.retry")}</Button>} />
    </div>
  );
}

/** A titled card. */
export function Panel({ id, title, actions, children, className, testId }: { id: string; title: string; actions?: ReactNode; children: ReactNode; className?: string; testId?: string }) {
  return (
    <section aria-labelledby={id} className={cn("flex min-w-0 flex-col gap-3 rounded-card border border-border bg-card p-4 sm:p-5", className)} data-testid={testId}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={id} className="m-0 text-[17px] font-semibold">
          {title}
        </h2>
        {actions}
      </div>
      {children}
    </section>
  );
}

/** One labelled figure. */
export function Figure({ label, value, hint, strong, testId }: { label: string; value: ReactNode; hint?: string; strong?: boolean; testId?: string }) {
  return (
    <div className="min-w-0" data-testid={testId}>
      <dt className="text-[13px] text-muted-foreground">{label}</dt>
      <dd className="m-0">
        <span className={cn("block font-mono tabular-nums break-words", strong ? "text-[22px] font-bold" : "text-[17px] font-semibold")}>{value}</span>
        {hint ? <span className="block text-[12px] text-muted-foreground">{hint}</span> : null}
      </dd>
    </div>
  );
}

/** A select tied to its surrounding `Field` (label, hint, error), like `TextInput`. */
export function FieldSelect(props: NativeSelectProps) {
  const a11y = useFieldControl({ id: props.id, "aria-describedby": props["aria-describedby"], "aria-invalid": props["aria-invalid"] });
  return <NativeSelect {...props} {...a11y} />;
}

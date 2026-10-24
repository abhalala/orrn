import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { cn } from "@orrn/ui/lib/utils";
import { AlertCircle, Check } from "lucide-react";
import { useId, type KeyboardEvent, type Ref } from "react";

import type { YardOption } from "./pack-math";

/**
 * The yard a packing session's bundles go to: one big tile per active yard
 * (six on the demo plant), not a dropdown, so a gloved thumb picks it in one
 * tap. A native radio group: Tab lands on the chosen yard (or the first),
 * arrow keys move and choose, and Enter chooses and moves on like every
 * other Pack field.
 */
export function YardPicker({
  yards,
  value,
  onChange,
  loading,
  failed,
  onRetry,
  error,
  firstRef,
}: {
  yards: readonly YardOption[];
  value: string | undefined;
  onChange(id: string): void;
  loading: boolean;
  failed: boolean;
  onRetry(): void;
  error?: string;
  /** The tile focus goes to when the yard is missing (the chosen one, else the first). */
  firstRef?: Ref<HTMLInputElement>;
}) {
  const { t } = useT();
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hintId, error ? errorId : null].filter(Boolean).join(" ");
  const focusIndex = Math.max(
    0,
    yards.findIndex((y) => y.id === value),
  );

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>, yardId: string) => {
    if (e.key !== "Enter") return;
    // Enter on a tile chooses it and submits the form (Next), like Enter in the cut length.
    e.preventDefault();
    onChange(yardId);
    const form = e.currentTarget.form;
    // Let React commit the choice before the form reads it.
    requestAnimationFrame(() => form?.requestSubmit());
  };

  return (
    <fieldset
      data-slot="yard-picker"
      aria-describedby={describedBy}
      className="m-0 flex min-w-0 flex-col gap-1.5 border-0 p-0"
    >
      <legend className="mb-1.5 p-0 text-[14px] leading-5 font-semibold">{t("pack.new.yard")}</legend>
      {failed ? (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-card bg-tone-red-tint px-4 py-2.5 text-tone-red-ink"
        >
          <p className="m-0 min-w-0 flex-1 text-[14px] font-medium">{t("pack.new.yardsFailed")}</p>
          <Button variant="secondary" onClick={onRetry}>
            {t("common.retry")}
          </Button>
        </div>
      ) : loading ? (
        <div aria-hidden="true" className="grid grid-cols-3 gap-2 sm:grid-cols-6">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-14 rounded-input" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-[repeat(auto-fill,minmax(7rem,1fr))]">
          {yards.map((y, i) => {
            const checked = y.id === value;
            return (
              <label
                key={y.id}
                className={cn(
                  "animate-press relative flex min-h-14 min-w-0 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-input border px-2 py-2 text-center",
                  "transition-[background-color,border-color,color,scale] duration-[var(--dur-fast)]",
                  "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring has-[:focus-visible]:outline-solid",
                  checked
                    ? "border-primary bg-primary text-primary-foreground shadow-button"
                    : "border-input bg-card text-foreground hover:border-foreground/60 hover:bg-surface-sunken/60",
                  error && !checked && "border-destructive",
                )}
              >
                <input
                  ref={i === focusIndex ? firstRef : undefined}
                  type="radio"
                  name={`${id}-yard`}
                  value={y.id}
                  checked={checked}
                  onChange={() => onChange(y.id)}
                  onKeyDown={(e) => onKeyDown(e, y.id)}
                  aria-describedby={describedBy}
                  className="sr-only"
                />
                {checked ? (
                  <Check aria-hidden="true" strokeWidth={2} className="absolute top-1.5 right-1.5 size-3.5" />
                ) : null}
                <span className="font-mono text-[18px] leading-6 font-semibold tracking-[-0.01em]">{y.code}</span>
                {y.name && y.name !== y.code ? (
                  <span
                    className={cn(
                      "max-w-full text-[12px] leading-4 font-medium break-words",
                      checked ? "text-primary-foreground/80" : "text-muted-foreground",
                    )}
                  >
                    {y.name}
                  </span>
                ) : null}
              </label>
            );
          })}
        </div>
      )}
      <p id={hintId} className="m-0 text-[13px] leading-5 text-muted-foreground">
        {t("pack.new.yardHint")}
      </p>
      {error ? (
        <p id={errorId} className="m-0 flex items-start gap-1.5 text-[13px] font-medium text-destructive">
          <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" strokeWidth={2} />
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}

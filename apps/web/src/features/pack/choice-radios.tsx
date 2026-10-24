import { cn } from "@orrn/ui/lib/utils";
import { AlertCircle, Check } from "lucide-react";
import { useId, type ReactNode } from "react";

export type Choice = {
  value: string;
  label: ReactNode;
  /** A second line (smaller, muted). */
  detail?: ReactNode;
  disabled?: boolean;
  /** Plain-text name for assistive tech when `label` is not text. */
  ariaLabel?: string;
};

/**
 * A vertical list of big radio rows (order line, die copy, cast on the Source step). A native radio
 * group: Tab lands on the chosen row, arrows move and choose. `value` "" is "nothing chosen".
 */
export function ChoiceRadios({
  legend,
  hint,
  error,
  choices,
  value,
  onChange,
  slot,
}: {
  legend: string;
  hint?: string;
  error?: string;
  choices: readonly Choice[];
  value: string;
  onChange(value: string): void;
  slot: string;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ") || undefined;
  return (
    <fieldset data-slot={slot} aria-describedby={describedBy} className="m-0 flex min-w-0 flex-col gap-1.5 border-0 p-0">
      <legend className="mb-1.5 p-0 text-[14px] leading-5 font-semibold">{legend}</legend>
      <div className="flex flex-col gap-2">
        {choices.map((c) => {
          const checked = c.value === value;
          return (
            <label
              key={c.value}
              className={cn(
                "animate-press relative flex min-h-12 min-w-0 cursor-pointer items-start gap-3 rounded-input border px-3 py-2.5",
                "transition-[background-color,border-color,scale] duration-[var(--dur-fast)]",
                "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring has-[:focus-visible]:outline-solid",
                checked ? "border-primary bg-primary/5" : "border-input bg-card hover:border-foreground/60 hover:bg-surface-sunken/60",
                c.disabled && "cursor-not-allowed opacity-55",
                error && !checked && "border-destructive/60",
              )}
            >
              <input
                type="radio"
                name={`${id}-choice`}
                value={c.value}
                checked={checked}
                disabled={c.disabled}
                aria-label={c.ariaLabel}
                onChange={() => onChange(c.value)}
                className="sr-only"
              />
              <span
                aria-hidden="true"
                className={cn(
                  "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border",
                  checked ? "border-primary bg-primary text-primary-foreground" : "border-input bg-background",
                )}
              >
                {checked ? <Check className="size-3.5" strokeWidth={3} /> : null}
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="min-w-0 text-[15px] leading-5 font-semibold break-words">{c.label}</span>
                {c.detail ? <span className="min-w-0 text-[13px] leading-5 break-words text-muted-foreground">{c.detail}</span> : null}
              </span>
            </label>
          );
        })}
      </div>
      {hint ? (
        <p id={hintId} className="m-0 text-[13px] leading-5 text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="m-0 flex items-start gap-1.5 text-[13px] font-medium text-destructive">
          <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" strokeWidth={2} />
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}

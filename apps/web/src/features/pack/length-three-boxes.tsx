import { useT, type MessageKey } from "@orrn/i18n";
import { NumberInput } from "@orrn/ui/components/field";
import { cn } from "@orrn/ui/lib/utils";
import { type Ref } from "react";

import { lengthBoxTexts, type LengthBox, type LengthTyped } from "./length-three";

const BOXES: { box: LengthBox; label: MessageKey; suffix: MessageKey }[] = [
  { box: "ft", label: "pack.new.cutLengthBoxFt", suffix: "units.ft" },
  { box: "in", label: "pack.new.cutLengthBoxIn", suffix: "units.inch" },
  { box: "mm", label: "pack.new.cutLengthBoxMm", suffix: "units.mm" },
];

/**
 * Cut length in feet, inch or mm. One box is the typed one (blue, marked); typing in another makes that the typed one
 * and the first becomes derived. Enter calls `onEnter` (as the old single mm box did).
 */
export function LengthThreeBoxes({
  value,
  onChange,
  idPrefix,
  invalid,
  describedBy,
  firstRef,
  size = "lg",
  onEnter,
}: {
  value: LengthTyped;
  onChange(v: LengthTyped): void;
  idPrefix: string;
  invalid?: boolean;
  describedBy?: string;
  firstRef?: Ref<HTMLInputElement>;
  size?: "lg" | "md";
  onEnter?(): void;
}) {
  const { t } = useT();
  const texts = lengthBoxTexts(value);
  const hasText = value.text.trim() !== "";
  return (
    <div className="grid grid-cols-3 gap-2 sm:max-w-[480px]">
      {BOXES.map(({ box, label, suffix }, i) => {
        const typed = value.typed === box;
        const derived = hasText && !typed;
        return (
          <div key={box} className="flex min-w-0 flex-col gap-1">
            <label htmlFor={`${idPrefix}-${box}`} className="flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground">
              {t(label)}
              {typed && hasText ? (
                <span data-slot="typed-marker" className="rounded bg-primary/10 px-1 text-[11px] font-semibold text-primary">
                  {t("pack.new.cutLengthTyped")}
                </span>
              ) : null}
            </label>
            <NumberInput
              id={`${idPrefix}-${box}`}
              ref={i === 0 ? firstRef : undefined}
              value={texts[box]}
              onValueChange={(text) => onChange({ typed: box, text })}
              suffix={t(suffix)}
              enterKeyHint="go"
              onKeyDown={(e) => {
                if (e.key !== "Enter" || !onEnter) return;
                e.preventDefault();
                onEnter();
              }}
              data-typed={typed && hasText ? "true" : undefined}
              aria-invalid={invalid ? true : undefined}
              aria-describedby={describedBy}
              className={cn(
                size === "lg" ? "h-14 text-[22px]" : "h-12",
                typed && hasText && "border-primary ring-1 ring-primary",
                derived && "bg-muted/50 text-muted-foreground",
              )}
            />
          </div>
        );
      })}
    </div>
  );
}

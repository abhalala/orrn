import { resolveField, type FieldId, type Kind, type QuantityField } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { Field, useFieldControl } from "@orrn/ui/components/field";
import { Input } from "@orrn/ui/components/input";
import { cn } from "@orrn/ui/lib/utils";
import { useEffect, useId, useRef, useState } from "react";

import { useFmt } from "@/shared/lib/fmt";
import { stepUnitText, unitEntryText } from "@/shared/lib/unit-input";

export type UnitFieldProps = {
  /** Which quantity this is (`order.weight`, `bundle.length`, `order.rate` ...). It names the kind and the stored unit. */
  field: FieldId | QuantityField;
  /** The canonical integer the form holds (grams, mm, paise per kg ...), or null while empty or refused. */
  value: number | null;
  /** Called with the canonical integer, or null when the text is blank or refused. Never a float. */
  onValueChange(value: number | null): void;
  /** Caption. Wrapped in a `Field`; leave out to supply your own label and `aria-label`. */
  label?: string;
  hint?: string;
  required?: boolean;
  disabled?: boolean;
  id?: string;
  className?: string;
  "aria-label"?: string;
  "data-testid"?: string;
};

/**
 * A number field in the plant's own unit. It shows the unit (kg, lb, mm, ft and in ...), takes typing in that
 * unit, refuses text finer than the unit can store with a plain message, and hands the form the exact integer.
 * Feet and inches read "12 ft 6 in", "12' 6" and "12-6". The text is the person's own until the stored value
 * changes from outside, so "1." never turns into "1" while typing.
 */
export function UnitField({ field, value, onValueChange, label, hint, required, disabled, id, className, ...rest }: UnitFieldProps) {
  const fmt = useFmt();
  const { t } = useT();
  const kind = resolveField(field).kind;
  const [text, setText] = useState(() => unitEntryText(fmt, field, value));
  const [problem, setProblem] = useState<string | null>(null);
  const emitted = useRef<number | null>(value);
  const seenKey = useRef(fmt.key);

  // The stored value moved under us (a reset, a load) or the plant's unit changed: show it again in the plant's unit.
  useEffect(() => {
    if (value === emitted.current && seenKey.current === fmt.key) return;
    emitted.current = value;
    seenKey.current = fmt.key;
    setText(unitEntryText(fmt, field, value));
    setProblem(null);
  }, [value, fmt, field]);

  const change = (next: string) => {
    setText(next);
    const step = stepUnitText(t, fmt, field, next, required);
    emitted.current = step.value;
    setProblem(step.problem);
    onValueChange(step.value);
  };

  if (!label) {
    return <BareUnitBox text={text} onText={change} kind={kind} disabled={disabled} className={className} id={id} problem={problem} {...rest} />;
  }
  const control = <UnitControl text={text} onText={change} kind={kind} disabled={disabled} className={className} id={id} invalid={problem !== null} {...rest} />;
  return (
    <Field label={label} hint={hint} required={required} error={problem ?? undefined} id={id}>
      {control}
    </Field>
  );
}

/**
 * A unit box with no `Field` around it (the caller supplies the label as `aria-label`): the refusal sentence is shown under it,
 * tied to the box, in a live region that stays in the tree so it is announced when it appears.
 */
export function BareUnitBox({
  problem,
  ...box
}: {
  problem: string | null;
  text: string;
  onText(text: string): void;
  kind: Kind;
  disabled?: boolean;
  className?: string;
  id?: string;
  "aria-label"?: string;
  "data-testid"?: string;
}) {
  const problemId = `unit-problem-${useId().replace(/:/g, "")}`;
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <UnitControl {...box} invalid={problem !== null} describedBy={problem ? problemId : undefined} />
      <div aria-live="polite" className="empty:-mt-1">
        {problem ? (
          <p id={problemId} className="m-0 text-[13px] font-medium leading-5 text-destructive">
            {problem}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function UnitControl({
  text,
  onText,
  kind,
  disabled,
  className,
  id,
  invalid,
  describedBy,
  ...rest
}: {
  describedBy?: string;
  text: string;
  onText(text: string): void;
  kind: Kind;
  disabled?: boolean;
  className?: string;
  id?: string;
  invalid: boolean;
  "aria-label"?: string;
  "data-testid"?: string;
}) {
  const fmt = useFmt();
  const suffixId = `unit-${useId().replace(/:/g, "")}`;
  const unit = fmt.unitOf(kind);
  const composite = Boolean(unit.composite);
  const a11y = useFieldControl({ id, "aria-describedby": describedBy, "aria-invalid": invalid ? true : undefined }, suffixId);
  return (
    <div data-slot="unit-field" className="relative min-w-0">
      <Input
        type="text"
        inputMode={composite ? "text" : "decimal"}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        value={text}
        disabled={disabled}
        onChange={(e) => onText(e.currentTarget.value)}
        className={cn("pointer-coarse:h-12 font-mono text-[16px] tabular-nums", composite ? "pr-16" : "pr-14", className)}
        {...a11y}
        {...rest}
      />
      <span id={suffixId} className="pointer-events-none absolute inset-y-0 right-3.5 flex items-center text-[14px] font-medium text-muted-foreground">
        {composite ? "ft in" : unit.symbol}
      </span>
    </div>
  );
}

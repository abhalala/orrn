import { UNITS, type ParseProblem } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { NumberInput, useFieldControl, type NumberInputProps } from "@orrn/ui/components/field";
import { Input } from "@orrn/ui/components/input";
import { cn } from "@orrn/ui/lib/utils";
import { useEffect, useId, useRef, useState, type Ref } from "react";

import { useFmt } from "@/shared/lib/fmt";
import { draftToTyped, followsPlant, kindOf, typedToDraft, type EntrySpec } from "@/shared/lib/plant-input";
import { unitProblemText } from "@/shared/lib/unit-input";

export type PlantInputProps = Omit<NumberInputProps, "suffix"> & {
  /** Which quantity this box takes and which unit the form's draft text is in. */
  spec: EntrySpec;
  ref?: Ref<HTMLInputElement>;
  /**
   * For a form that edits the text itself (an on-screen keypad): the text as the person sees it, in the plant's unit.
   * Give both props or neither. The box then shows `typed`, reports every change through `onTypedChange` as well as
   * `onValueChange`, and works out the refusal sentence from `typed`.
   */
  typed?: string;
  onTypedChange?: (typed: string) => void;
};

/**
 * A weight, length or section-weight box that takes the plant's unit. It shows that unit, accepts typing in it, refuses
 * text finer than the unit can store with a sentence that says what to type, and keeps the form's draft in the unit the
 * form model reads (so the model and its checks run on canonical values, unchanged). For a plant whose unit already is
 * the draft's unit it is the plain `NumberInput`, so nothing changes for a plant that changed nothing.
 */
export function PlantInput({ spec, value, onValueChange, decimal, typed, onTypedChange, ...rest }: PlantInputProps) {
  const fmt = useFmt();
  const { t } = useT();
  const unit = fmt.unitOf(kindOf(spec));
  const suffix = unit.composite ? "ft in" : unit.symbol;
  const native = followsPlant(fmt, spec);
  const controlled = typed !== undefined && onTypedChange !== undefined;
  const [ownText, setText] = useState(() => draftToTyped(fmt, spec, value));
  const [ownProblem, setProblem] = useState<ParseProblem | "kind" | null>(null);
  const text = controlled ? typed : ownText;
  const problem = controlled ? (native ? null : typedToDraft(fmt, spec, typed).problem) : ownProblem;
  const emitted = useRef(value);
  const seen = useRef(fmt.key);

  useEffect(() => {
    if (native || controlled) return;
    if (value === emitted.current && seen.current === fmt.key) return;
    emitted.current = value;
    seen.current = fmt.key;
    setText(draftToTyped(fmt, spec, value));
    setProblem(null);
  }, [native, controlled, value, fmt, spec]);

  if (native) {
    // The draft is in the box's own unit (grams for a nitriding box, inches for a gauge), so that is the word beside it.
    return <NumberInput {...rest} value={value} onValueChange={onValueChange} decimal={decimal} suffix={UNITS[spec.native].symbol} />;
  }

  const change = (next: string) => {
    if (controlled) onTypedChange(next);
    else setText(next);
    const step = typedToDraft(fmt, spec, next);
    emitted.current = step.draft;
    setProblem(step.problem);
    onValueChange(step.draft);
  };
  const composite = Boolean(unit.composite);
  // A model that keeps whole kg: say what was kept when the typed figure was rounded to it.
  let storedNote: string | null = null;
  if (spec.wholeNative && !problem && text.trim() !== "") {
    const kept = typedToDraft(fmt, spec, text).value;
    const keptText = kept === null ? null : fmt.entryText(spec.field, kept);
    if (keptText !== null && keptText !== text.trim()) storedNote = t("units.storedAs", { value: keptText, unit: suffix });
  }
  return (
    <ConvertingBox
      {...rest}
      composite={composite}
      text={text}
      onText={change}
      suffix={suffix}
      problem={problem}
      problemText={problem ? unitProblemText(t, fmt, spec.field, problem) : null}
      storedNote={storedNote}
    />
  );
}

/**
 * The box of a plant that is not on the draft's unit, with its sentences below. A component of its own so that a plant that
 * changed nothing (the plain `NumberInput` above) takes no extra hook, and its markup stays the old box, character for character.
 */
function ConvertingBox({
  composite,
  text,
  onText,
  suffix,
  problem,
  problemText,
  storedNote,
  ...rest
}: Omit<NumberInputProps, "value" | "onValueChange" | "suffix"> & {
  composite: boolean;
  text: string;
  onText(text: string): void;
  suffix: string;
  problem: ParseProblem | "kind" | null;
  problemText: string | null;
  storedNote: string | null;
}) {
  const problemId = `plant-input-problem-${useId().replace(/:/g, "")}`;
  // The refusal sentence is tied to the box, so a screen reader reads why when the person returns to it.
  const describedBy = [rest["aria-describedby"], problem ? problemId : undefined].filter(Boolean).join(" ") || undefined;
  return (
    <div className="flex min-w-0 flex-col gap-1">
      {composite ? (
        <FreeTextBox {...rest} aria-describedby={describedBy} text={text} onText={onText} suffix={suffix} invalid={problem !== null} />
      ) : (
        <NumberInput {...rest} aria-describedby={describedBy} value={text} onValueChange={onText} decimal suffix={suffix} aria-invalid={problem ? true : rest["aria-invalid"]} />
      )}
      {/* The live region stays in the tree, so a sentence that appears is announced; empty, it takes no space (as Field's does). */}
      <div aria-live="polite" className="empty:-mt-1">
        {problem ? (
          <p id={problemId} className="m-0 text-[13px] font-medium leading-5 text-destructive">
            {problemText}
          </p>
        ) : null}
        {storedNote ? <p className="m-0 text-[13px] leading-5 text-muted-foreground">{storedNote}</p> : null}
      </div>
    </div>
  );
}

/** Feet and inches are typed as words ("12 ft 6 in", "12' 6\""): a free-text box with the unit beside it. */
function FreeTextBox({ text, onText, suffix, invalid, className, id, ref, ...rest }: Omit<NumberInputProps, "value" | "onValueChange" | "suffix"> & { ref?: Ref<HTMLInputElement>; text: string; onText(text: string): void; suffix: string; invalid: boolean }) {
  const suffixId = `plant-input-unit-${useId().replace(/:/g, "")}`;
  // What the caller set (a form's own error id, aria-invalid, aria-required) is merged in, never overridden; the unit word is read with the box.
  const { decimal: _decimal, "aria-describedby": describedBy, "aria-invalid": ariaInvalid, "aria-required": ariaRequired, ...input } = rest as Record<string, unknown> & {
    "aria-describedby"?: string;
    "aria-invalid"?: boolean | "true" | "false" | "grammar" | "spelling";
    "aria-required"?: boolean | "true" | "false";
  };
  const a11y = useFieldControl(
    { id, "aria-describedby": describedBy, "aria-invalid": invalid || (ariaInvalid !== undefined && ariaInvalid !== false && ariaInvalid !== "false") ? true : undefined, "aria-required": ariaRequired },
    suffixId,
  );
  return (
    <div data-slot="number-input" className="relative min-w-0">
      <Input
        ref={ref}
        {...(input as object)}
        type="text"
        inputMode="text"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        value={text}
        onChange={(e) => onText(e.currentTarget.value)}
        className={cn("pointer-coarse:h-12 pr-16 font-mono text-[16px] tabular-nums", className)}
        {...a11y}
      />
      <span id={suffixId} className="pointer-events-none absolute inset-y-0 right-3.5 flex items-center text-[14px] font-medium text-muted-foreground">{suffix}</span>
    </div>
  );
}

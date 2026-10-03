import { AlertCircle } from "lucide-react";
import {
  createContext,
  forwardRef,
  useContext,
  useId,
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
} from "react";

import { cn } from "@orrn/ui/lib/utils";

import { Input, type InputProps } from "./input";

/* -------------------------------------------------------------------------- */
/* Field: visible label above, hint and inline error below                     */
/* -------------------------------------------------------------------------- */

type FieldContextValue = {
  id: string;
  describedBy: string | undefined;
  invalid: boolean;
};

const FieldContext = createContext<FieldContextValue | null>(null);

type ControlA11yProps = {
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean | "true" | "false" | "grammar" | "spelling";
};

/**
 * Props that tie a control to its surrounding `Field` (id for the label,
 * hint and error in `aria-describedby`, `aria-invalid`). Explicit props win.
 * Controls in this library call it; use it for custom controls too.
 */
export function useFieldControl(own: ControlA11yProps = {}, extraDescribedBy?: string): ControlA11yProps {
  const field = useContext(FieldContext);
  const describedBy = [own["aria-describedby"], field?.describedBy, extraDescribedBy].filter(Boolean).join(" ");
  return {
    id: own.id ?? field?.id,
    "aria-describedby": describedBy || undefined,
    "aria-invalid": own["aria-invalid"] ?? (field?.invalid ? true : undefined),
  };
}

export type FieldProps = {
  label: string;
  hint?: string;
  /** What went wrong and how to fix it. Sets aria-invalid on the control. */
  error?: string;
  children: ReactNode;
  className?: string;
  /** Use a specific id for the control (default: generated). */
  id?: string;
};

export function Field({ label, hint, error, children, className, id: idProp }: FieldProps) {
  const generated = useId();
  const id = idProp ?? `field-${generated.replace(/:/g, "")}`;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <FieldContext.Provider value={{ id, describedBy, invalid: Boolean(error) }}>
      <div data-slot="field" className={cn("flex min-w-0 flex-col gap-1.5", className)}>
        <label htmlFor={id} className="text-[14px] font-semibold leading-5 text-foreground">
          {label}
        </label>
        {children}
        {hint ? (
          <p id={hintId} className="m-0 text-[13px] leading-5 text-muted-foreground">
            {hint}
          </p>
        ) : null}
        {error ? (
          <p id={errorId} className="m-0 flex items-start gap-1.5 text-[13px] font-medium leading-5 text-destructive">
            <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" strokeWidth={2} />
            <span>{error}</span>
          </p>
        ) : null}
      </div>
    </FieldContext.Provider>
  );
}

/* -------------------------------------------------------------------------- */
/* TextInput                                                                  */
/* -------------------------------------------------------------------------- */

const TOUCH_INPUT = "pointer-coarse:h-12";

export type TextInputProps = InputProps;

/** Text field. Inside a `Field` it picks up the label, hint and error. */
export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(function TextInput(
  { className, id, "aria-describedby": describedBy, "aria-invalid": invalid, ...rest },
  ref,
) {
  const a11y = useFieldControl({ id, "aria-describedby": describedBy, "aria-invalid": invalid });
  return <Input ref={ref} className={cn(TOUCH_INPUT, className)} {...a11y} {...rest} />;
});

/* -------------------------------------------------------------------------- */
/* NumberInput (W9: raw text, never reformatted while typing)                 */
/* -------------------------------------------------------------------------- */

export type NumberInputProps = Omit<
  InputProps,
  "value" | "defaultValue" | "onChange" | "onChangeText" | "type" | "inputMode"
> & {
  /** The raw text, exactly as typed. Parse it with `parseDecimal` on blur or submit. */
  value: string;
  onValueChange(text: string): void;
  /** Unit shown inside the field ("kg", "ft"). Also read out with the field. */
  suffix?: string;
  /** Allow one decimal point. Default true. */
  decimal?: boolean;
};

const DECIMAL_TEXT = /^[0-9,]*\.?[0-9]*$/;
const INTEGER_TEXT = /^[0-9,]*$/;

/**
 * Number field that keeps exactly what the person typed: "1." stays "1.",
 * "1.0" stays "1.0". Characters that can't be part of a positive number
 * (letters, minus, a second point) are refused instead of reformatted.
 * Commas are allowed as digit grouping (`parseDecimal` strips them).
 */
export const NumberInput = forwardRef<HTMLInputElement, NumberInputProps>(function NumberInput(
  {
    value,
    onValueChange,
    suffix,
    decimal = true,
    className,
    id,
    "aria-describedby": describedBy,
    "aria-invalid": invalid,
    onBeforeInput,
    ...rest
  },
  ref,
) {
  const suffixId = useId();
  const suffixDomId = suffix ? `num-suffix-${suffixId.replace(/:/g, "")}` : undefined;
  const a11y = useFieldControl({ id, "aria-describedby": describedBy, "aria-invalid": invalid }, suffixDomId);
  const allowed = decimal ? DECIMAL_TEXT : INTEGER_TEXT;

  const handleBeforeInput = (e: FormEvent<HTMLInputElement> & { data?: string | null }) => {
    onBeforeInput?.(e as any);
    const data = e.data ?? (e.nativeEvent as InputEvent | undefined)?.data;
    if (!data) return;
    const el = e.currentTarget;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const next = el.value.slice(0, start) + data + el.value.slice(end);
    if (!allowed.test(next)) e.preventDefault();
  };

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const next = e.currentTarget.value;
    // Paste or autofill that slipped past beforeinput: refuse, keep the old text.
    if (allowed.test(next)) onValueChange(next);
  };

  return (
    <div data-slot="number-input" className="relative min-w-0">
      <Input
        ref={ref}
        type="text"
        inputMode={decimal ? "decimal" : "numeric"}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        value={value}
        onBeforeInput={handleBeforeInput}
        onChange={handleChange}
        className={cn(TOUCH_INPUT, "font-mono text-[16px] tabular-nums", suffix && "pr-12", className)}
        {...a11y}
        {...rest}
      />
      {suffix ? (
        <span
          id={suffixDomId}
          className="pointer-events-none absolute inset-y-0 right-3.5 flex items-center text-[14px] font-medium text-muted-foreground"
        >
          {suffix}
        </span>
      ) : null}
    </div>
  );
});

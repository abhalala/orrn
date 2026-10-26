import { ScanLine } from "lucide-react";
import { forwardRef, useState, type KeyboardEvent } from "react";

import { cn } from "@orrn/ui/lib/utils";

import { useFieldControl } from "./field";

export type ScanFieldProps = {
  /** Called with the trimmed text when Enter is pressed (wedge scanners send Enter). */
  onScan(raw: string): void;
  placeholder: string;
  autoFocus?: boolean;
  /** Accessible name when the field isn't inside a `Field`. */
  label?: string;
  disabled?: boolean;
  className?: string;
};

/**
 * Entry for serials and label links, from a keyboard-wedge scanner or typed.
 * Enter submits and clears, so the next scan can follow straight away; empty
 * input is ignored. It renders no <form> of its own and stops Enter from
 * submitting a surrounding one, so it can sit inside any form. Announcing
 * the result is the caller's job (toast or a
 * polite live region), because only the caller knows what the scan found.
 */
export const ScanField = forwardRef<HTMLInputElement, ScanFieldProps>(function ScanField(
  { onScan, placeholder, autoFocus, label, disabled, className },
  ref,
) {
  const [text, setText] = useState("");
  const a11y = useFieldControl();

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    // Ignore the Enter that confirms an IME composition.
    if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
    e.preventDefault();
    const raw = text.trim();
    if (!raw) return;
    setText("");
    onScan(raw);
  };

  return (
    <div data-slot="scan-field" className={cn("relative min-w-0", className)}>
      <ScanLine
        aria-hidden="true"
        strokeWidth={2}
        className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-muted-foreground"
      />
      <input
        ref={ref}
        {...a11y}
        type="text"
        aria-label={label}
        value={text}
        onChange={(e) => setText(e.currentTarget.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        // The scan field is the screen's purpose when it asks for focus.
        // eslint-disable-next-line jsx-a11y/no-autofocus
        autoFocus={autoFocus}
        disabled={disabled}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="characters"
        spellCheck={false}
        enterKeyHint="search"
        className="flex h-14 w-full min-w-0 truncate rounded-input border border-input bg-card pr-4 pl-12 font-mono text-[17px] tracking-[0.01em] text-foreground transition-[border-color,box-shadow] duration-[var(--dur-fast)] placeholder:font-sans placeholder:tracking-normal placeholder:text-muted-foreground hover:border-foreground/70 focus-visible:border-foreground disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive"
      />
    </div>
  );
});

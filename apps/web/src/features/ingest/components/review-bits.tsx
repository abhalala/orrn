import { useT } from "@orrn/i18n";
import { Button, type ButtonProps } from "@orrn/ui/components/button";
import { useFieldControl } from "@orrn/ui/components/field";
import { NativeSelect, type NativeSelectProps } from "@orrn/ui/components/native-select";
import { cn } from "@orrn/ui/lib/utils";
import { forwardRef, useCallback, useEffect, useId, useMemo, useState, type ReactNode, type Ref } from "react";

import { sayWords, type Preview, type SampleView, type Words } from "../lib";
import { translateKey } from "./shared";

/**
 * Small pieces the review page and the mapping editor share. Nothing here decides anything: each one draws what a view
 * model gave it.
 */

/** `say(key, vars)` and `words(w)`: the screen's translate function in the shape the view models take. */
export function useSay() {
  const { t, locale } = useT();
  const say = useCallback((key: string, vars?: Record<string, string | number>) => translateKey(t, key, vars), [t]);
  const words = useCallback((w: Words) => sayWords(say, w), [say]);
  return { t, say, words, locale };
}

/** The language of a date field, so the browser may write the day first (31/03/2026) the way a plant in India reads it. */
export function dateLang(locale: string): string {
  return locale === "hi" ? "hi-IN" : locale === "gu" ? "gu-IN" : "en-IN";
}

/** File names, sheet names and column headers are the file's own text. On a Hindi screen they are marked English (WCAG 3.1.2). */
export function Foreign({ children, className }: { children: ReactNode; className?: string }) {
  const { locale } = useT();
  return (
    <span lang={locale === "en" ? undefined : "en"} className={className}>
      {children}
    </span>
  );
}

/**
 * A button for a write. While a write runs it is `aria-disabled` and ignores a press, never `disabled`: a disabled button
 * drops keyboard focus, and the person loses their place (WCAG 2.4.3).
 */
export const ActionButton = forwardRef<HTMLButtonElement, Omit<ButtonProps, "loading" | "disabled" | "onPress"> & { busy?: boolean; working?: boolean }>(
  function ActionButton({ busy = false, working = false, onClick, className, ...rest }, ref) {
    return (
      <Button
        ref={ref}
        aria-disabled={busy || undefined}
        aria-busy={working || undefined}
        className={cn("aria-disabled:cursor-progress aria-disabled:opacity-60", className)}
        onClick={(event) => {
          if (busy) {
            event.preventDefault();
            return;
          }
          onClick?.(event);
        }}
        {...rest}
      />
    );
  },
);

/** The platform select, wired to the `Field` around it (label, hint, error) like `TextInput`. */
export const FieldSelect = forwardRef<HTMLSelectElement, NativeSelectProps>(function FieldSelect(
  { id, "aria-describedby": describedBy, "aria-invalid": invalid, ...rest },
  ref,
) {
  const a11y = useFieldControl({ id, "aria-describedby": describedBy, "aria-invalid": invalid });
  return <NativeSelect ref={ref} {...a11y} {...rest} />;
});

/** Sample values of one column: the first three, comma separated, mono for numbers. A masked rate says Hidden. */
export function SampleCell({ samples }: { samples: SampleView }) {
  const { t } = useT();
  if (samples.masked) return <span className="text-[13px] text-muted-foreground">{t("ingest.rate.hidden")}</span>;
  if (samples.values.length === 0) return null;
  return (
    <span className={cn("block min-w-0 text-[13px] break-words", samples.mono ? "font-mono tabular-nums" : "")}>
      {samples.values.join(", ")}
    </span>
  );
}

/** What orrn would store for the first sample: the number in the plant's unit, or why nothing is stored. */
export function PreviewCell({ preview }: { preview: Preview }) {
  const { t, words } = useSay();
  switch (preview.kind) {
    case "willNotImport":
      return <span className="text-[13px] text-muted-foreground">{t("ingest.shape.willNotImport")}</span>;
    case "hidden":
      return <span className="text-[13px] text-muted-foreground">{t("ingest.rate.hidden")}</span>;
    case "ask":
      return <span className="text-[13px] text-tone-amber-ink">{t("ingest.shape.unitAsk")}</span>;
    case "error":
      return <span className="text-[13px] text-tone-amber-ink">{words(preview.words)}</span>;
    case "value":
      return (
        <span className="text-[14px] break-words">
          <span className={preview.mono ? "font-mono tabular-nums" : ""}>{preview.textKey ? t(preview.textKey as never) : preview.text}</span>
          {preview.unit ? <span className="ml-1 text-[0.85em] text-muted-foreground">{preview.unit}</span> : null}
        </span>
      );
  }
}

/** The header of a file column, bold, with what it holds muted under it. A blank header reads "Column 3". */
export function ColumnHeaderCell({ header, headerBlank, n, kindKey, muted }: { header: string; headerBlank: boolean; n: number; kindKey: string; muted?: boolean }) {
  const { t } = useT();
  return (
    <span className="flex min-w-0 flex-col">
      <span className={cn("text-[14px] font-semibold break-words", muted && "text-muted-foreground")}>
        {headerBlank ? t("ingest.rows.column", { n }) : <Foreign>{header}</Foreign>}
      </span>
      <span className="text-[13px] font-normal text-muted-foreground">{t(kindKey as never)}</span>
    </span>
  );
}

/**
 * True while the element is out of view. Used by the sticky bar under 1024 px: it repeats the decision bar's buttons once
 * the bar has scrolled out. Without `IntersectionObserver` (tests, old browsers) it is false and the sticky bar stays away.
 */
export function useScrolledOut(): [(el: HTMLElement | null) => void, boolean] {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [out, setOut] = useState(false);
  useEffect(() => {
    if (!el || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => setOut(entry ? !entry.isIntersecting : false), { threshold: 0 });
    observer.observe(el);
    return () => observer.disconnect();
  }, [el]);
  return [useMemo(() => setEl, []), out];
}

/** A muted one-line text. */
export function Muted({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("m-0 text-[14px] leading-5 break-words text-muted-foreground", className)}>{children}</p>;
}

/**
 * An evidence panel of the review page: the shared `Panel` card with a 17 px title (work order N1) and a title that can
 * take focus, so the page can move a keyboard user to the rows or the editor. 16 px between panels, 32 px under the bar.
 */
export function EvidencePanel({
  title,
  children,
  actions,
  headingRef,
  className,
}: {
  title: string;
  children: ReactNode;
  actions?: ReactNode;
  headingRef?: Ref<HTMLHeadingElement>;
  className?: string;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} className={cn("flex min-w-0 flex-col gap-3 rounded-card border border-border bg-card p-4 sm:p-5", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2
          id={id}
          ref={headingRef}
          tabIndex={headingRef ? -1 : undefined}
          className="m-0 font-display text-[17px] font-bold leading-tight tracking-[-0.02em] break-words outline-none"
        >
          {title}
        </h2>
        {actions}
      </div>
      {children}
    </section>
  );
}

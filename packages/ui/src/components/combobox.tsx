import { useT } from "@orrn/i18n";
import { Check, Loader2, Search } from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

import { cn } from "@orrn/ui/lib/utils";

import { useFieldControl } from "./field";

export type ComboboxOption<T> = { value: T; label: string; hint?: string };

export type ComboboxProps<T> = {
  value: T | null;
  onChange(v: T): void;
  /** Server-side search (W8): never filter a truncated client list. Called 200ms after typing stops. */
  search(q: string): Promise<ComboboxOption<T>[]>;
  placeholder: string;
  /** Shown first, before anything is typed (recently used dies, customers). */
  recent?: ComboboxOption<T>[];
  /** Label for a `value` that isn't in `recent` or the results yet (a record loaded for editing). */
  valueLabel?: string;
  /** Accessible name when the combobox isn't inside a `Field`. */
  label?: string;
  disabled?: boolean;
  className?: string;
};

const DEBOUNCE_MS = 200;

/**
 * Searchable picker on the ARIA 1.2 combobox pattern: the input keeps focus,
 * arrow keys move through the options (`aria-activedescendant`), Enter picks,
 * Escape closes and restores the current choice. Results come from `search`
 * (debounced 200ms, stale responses dropped); with an empty query it shows
 * `recent`. Status ("Searching", "Nothing matches") is announced politely.
 */
export function Combobox<T>({
  value,
  onChange,
  search,
  placeholder,
  recent,
  valueLabel,
  label,
  disabled,
  className,
}: ComboboxProps<T>) {
  const { t } = useT();
  const uid = useId().replace(/:/g, "");
  const listId = `combobox-list-${uid}`;
  const a11y = useFieldControl();

  const labels = useRef(new Map<T, string>());
  const remember = (opts: ComboboxOption<T>[] | undefined) => {
    for (const o of opts ?? []) labels.current.set(o.value, o.label);
  };
  remember(recent);

  const selectedLabel = value === null ? "" : (labels.current.get(value) ?? valueLabel ?? "");

  const [text, setText] = useState(selectedLabel);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<ComboboxOption<T>[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(-1);
  const [editing, setEditing] = useState(false);
  const requestRef = useRef(0);

  // Keep the field showing the chosen label when the value changes from outside.
  useEffect(() => {
    if (!editing) setText(selectedLabel);
  }, [selectedLabel, editing]);

  // Debounced server search.
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      requestRef.current += 1;
      setResults(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const id = ++requestRef.current;
    const timer = setTimeout(() => {
      search(q)
        .then((found) => {
          if (requestRef.current !== id) return;
          remember(found);
          setResults(found);
          setActive(-1);
        })
        .catch(() => {
          if (requestRef.current === id) setResults([]);
        })
        .finally(() => {
          if (requestRef.current === id) setLoading(false);
        });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // `search` is usually an inline closure; re-running on its identity would refetch every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const showingRecent = query.trim() === "";
  const options = useMemo(
    () => (showingRecent ? (recent ?? []) : (results ?? [])),
    [showingRecent, recent, results],
  );
  const hasPopup = open && (options.length > 0 || (!showingRecent && (loading || results !== null)));

  const close = useCallback(() => {
    setOpen(false);
    setActive(-1);
    setEditing(false);
    setQuery("");
    setText(selectedLabel);
  }, [selectedLabel]);

  const pick = (opt: ComboboxOption<T>) => {
    labels.current.set(opt.value, opt.label);
    onChange(opt.value);
    setText(opt.label);
    setQuery("");
    setOpen(false);
    setActive(-1);
    setEditing(false);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    switch (e.key) {
      case "ArrowDown": {
        e.preventDefault();
        if (!open) setOpen(true);
        if (options.length) setActive((i) => (i + 1) % options.length);
        break;
      }
      case "ArrowUp": {
        e.preventDefault();
        if (!open) setOpen(true);
        if (options.length) setActive((i) => (i <= 0 ? options.length - 1 : i - 1));
        break;
      }
      case "Enter": {
        if (open && active >= 0 && options[active]) {
          e.preventDefault();
          pick(options[active]);
        }
        break;
      }
      case "Escape": {
        if (open || editing) {
          e.preventDefault();
          close();
        }
        break;
      }
      case "Tab":
        if (open) close();
        break;
    }
  };

  const status = loading
    ? t("ui.searching")
    : !showingRecent && results && results.length === 0
      ? t("common.noResults", { query: query.trim() })
      : "";

  return (
    <div data-slot="combobox" className={cn("relative min-w-0", className)}>
      <div className="relative">
        <Search
          aria-hidden="true"
          strokeWidth={2}
          className="pointer-events-none absolute top-1/2 left-3.5 size-[18px] -translate-y-1/2 text-muted-foreground"
        />
        <input
          {...a11y}
          type="text"
          role="combobox"
          aria-label={label}
          aria-expanded={hasPopup}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={hasPopup && active >= 0 ? `${listId}-${active}` : undefined}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          disabled={disabled}
          placeholder={placeholder}
          value={text}
          onChange={(e) => {
            const next = e.currentTarget.value;
            setText(next);
            setQuery(next);
            setEditing(true);
            setOpen(true);
            setActive(-1);
          }}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onBlur={() => close()}
          onKeyDown={onKeyDown}
          className="flex h-11 w-full rounded-input border border-input bg-card py-2 pr-10 pl-10 text-[15px] text-foreground transition-[border-color] duration-[var(--dur-fast)] placeholder:text-muted-foreground hover:border-foreground/70 focus-visible:border-foreground disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive pointer-coarse:h-12 pointer-coarse:text-base"
        />
        {loading ? (
          <Loader2
            aria-hidden="true"
            strokeWidth={2}
            className="absolute top-1/2 right-3.5 size-[18px] -translate-y-1/2 animate-spin text-muted-foreground"
          />
        ) : null}
      </div>

      <span role="status" aria-live="polite" className="sr-only">
        {open ? status : ""}
      </span>

      <div
        hidden={!hasPopup}
        className="absolute top-full right-0 left-0 z-50 mt-1.5 max-h-80 overflow-y-auto overscroll-contain rounded-card border border-border bg-popover p-1.5 text-popover-foreground shadow-md"
      >
        {showingRecent && options.length > 0 ? (
          <p aria-hidden="true" className="m-0 px-3 pt-1.5 pb-1 text-[13px] font-medium text-muted-foreground">
            {t("ui.recent")}
          </p>
        ) : null}
        <ul
          id={listId}
          role="listbox"
          aria-label={label ?? placeholder}
          hidden={options.length === 0}
          className="m-0 list-none p-0"
        >
          {options.map((opt, i) => {
            const isActive = i === active;
            const isChosen = value !== null && Object.is(opt.value, value);
            return (
              <li
                key={`${i}-${opt.label}`}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={isActive}
                // Keep focus in the input; pick on press.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(opt)}
                onMouseMove={() => setActive(i)}
                className={cn(
                  "flex min-h-11 cursor-pointer items-center gap-3 rounded-input px-3 py-2",
                  isActive && "bg-accent",
                )}
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-[15px] font-medium">{opt.label}</span>
                  {opt.hint ? (
                    <span className="truncate text-[13px] text-muted-foreground tabular-nums">{opt.hint}</span>
                  ) : null}
                </span>
                {isChosen ? <Check aria-hidden="true" strokeWidth={2} className="size-[18px] shrink-0" /> : null}
              </li>
            );
          })}
        </ul>
        {status && options.length === 0 ? (
          <p aria-hidden="true" className="m-0 px-3 py-2.5 text-[14px] text-muted-foreground">
            {status}
          </p>
        ) : null}
      </div>
    </div>
  );
}

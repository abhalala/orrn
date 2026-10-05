import { useT } from "@orrn/i18n";
import { Check, Loader2, Search } from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";

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
  /** Heading over `recent` (default "Recent"), for a short list shown whole instead ("Items"). */
  recentLabel?: string;
  /** Label for a `value` that isn't in `recent` or the results yet (a record loaded for editing). */
  valueLabel?: string;
  /** Accessible name when the combobox isn't inside a `Field`. */
  label?: string;
  disabled?: boolean;
  className?: string;
};

const DEBOUNCE_MS = 200;
const POPUP_MAX = 320;
const GAP = 6;
const EDGE = 12;

type Placement = { container: HTMLElement; style: CSSProperties };

/** Inputs being focused by `focusComboboxQuietly`: that focus does not open the list. */
const quietFocus = new WeakSet<HTMLElement>();

/**
 * Focus a combobox input without opening its list, e.g. a form moving focus to its first invalid
 * field after a failed submit (the open list would cover the other fields' errors). A tap, a click
 * or typing still opens it.
 */
export function focusComboboxQuietly(input: HTMLElement, options?: FocusOptions): void {
  quietFocus.add(input);
  try {
    input.focus(options);
  } finally {
    quietFocus.delete(input);
  }
}

/**
 * Where the list goes: into the nearest open dialog/sheet (so Radix's focus
 * trap and outside-click handling treat it as inside) or into <body>.
 * Positioned against the input in that container's coordinates, below the
 * input or above it when there's more room there, never taller than the
 * space available, so every option stays reachable.
 */
function place(input: HTMLElement): Placement {
  const container = (input.closest("[role='dialog']") as HTMLElement | null) ?? document.body;
  const r = input.getBoundingClientRect();
  const below = window.innerHeight - r.bottom - GAP - EDGE;
  const above = r.top - GAP - EDGE;
  const up = below < Math.min(POPUP_MAX, 200) && above > below;
  const maxHeight = Math.max(120, Math.min(POPUP_MAX, up ? above : below));

  let originX = window.scrollX;
  let originY = window.scrollY;
  if (container !== document.body) {
    const c = container.getBoundingClientRect();
    originX = -(c.left + container.clientLeft) + container.scrollLeft;
    originY = -(c.top + container.clientTop) + container.scrollTop;
  }
  const style: CSSProperties = {
    position: "absolute",
    left: r.left + originX,
    width: r.width,
    maxHeight,
    ...(up
      ? { top: r.top + originY - GAP, transform: "translateY(-100%)" }
      : { top: r.bottom + originY + GAP }),
  };
  return { container, style };
}

/**
 * Searchable picker on the ARIA 1.2 combobox pattern: the input keeps focus,
 * arrow keys move through the options (`aria-activedescendant`), Enter picks,
 * Escape closes the list (a second Escape reaches the sheet or dialog around
 * it) and restores the current choice. Results come from `search` (debounced
 * 200ms; old results are cleared while a new query loads and stale responses
 * are dropped, so Enter can never pick an option from an earlier query). With
 * an empty query it shows `recent`. The list is portalled, so a scrolling
 * sheet body never clips it. Status is announced politely.
 */
export function Combobox<T>({
  value,
  onChange,
  search,
  placeholder,
  recent,
  recentLabel,
  valueLabel,
  label,
  disabled,
  className,
}: ComboboxProps<T>) {
  const { t } = useT();
  const uid = useId().replace(/:/g, "");
  const listId = `combobox-list-${uid}`;
  const a11y = useFieldControl();
  const inputRef = useRef<HTMLInputElement | null>(null);

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
  const [placement, setPlacement] = useState<Placement | null>(null);
  const requestRef = useRef(0);

  // Keep the field showing the chosen label when the value changes from outside.
  useEffect(() => {
    if (!editing) setText(selectedLabel);
  }, [selectedLabel, editing]);

  // Debounced server search. Old results go away at once so nothing stale is pickable.
  useEffect(() => {
    const q = query.trim();
    requestRef.current += 1;
    const id = requestRef.current;
    setResults(null);
    setActive(-1);
    if (!q) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const timer = setTimeout(() => {
      search(q)
        .then((found) => {
          if (requestRef.current !== id) return;
          remember(found);
          setResults(found);
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
    () => (showingRecent ? (recent ?? []) : loading ? [] : (results ?? [])),
    [showingRecent, recent, results, loading],
  );
  const hasPopup = open && (options.length > 0 || (!showingRecent && (loading || results !== null)));

  // Follow the input while the list is open (sheet scroll, keyboard resize)
  // with one measurement per frame, no scroll listeners.
  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    if (!hasPopup) {
      setPlacement((p) => p ?? place(input));
      return;
    }
    let frame = 0;
    let last = "";
    const tick = () => {
      const next = place(input);
      const key = `${next.style.left}|${next.style.top}|${next.style.width}|${next.style.maxHeight}|${next.style.transform ?? ""}`;
      if (key !== last) {
        last = key;
        setPlacement(next);
      }
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [hasPopup]);

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
        // A surrounding Sheet/Dialog ignores this Escape while the list is
        // open (see `escapeUnlessComboboxOpen`), so this only closes the list.
        if (hasPopup || editing) {
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

  const popup = (
    <div
      data-slot="combobox-popup"
      hidden={!hasPopup}
      style={placement?.style}
      className="z-[60] overflow-y-auto overscroll-contain rounded-card border border-border bg-popover p-1.5 text-popover-foreground shadow-md"
    >
      {showingRecent && options.length > 0 ? (
        <p aria-hidden="true" className="m-0 px-3 pt-1.5 pb-1 text-[13px] font-medium text-muted-foreground">
          {recentLabel ?? t("ui.recent")}
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
                <span title={opt.label} className="truncate text-[15px] font-medium">
                  {opt.label}
                </span>
                {opt.hint ? (
                  <span title={opt.hint} className="truncate text-[13px] text-muted-foreground tabular-nums">
                    {opt.hint}
                  </span>
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
  );

  return (
    <div data-slot="combobox" className={cn("relative min-w-0", className)}>
      <div className="relative">
        <Search
          aria-hidden="true"
          strokeWidth={2}
          className="pointer-events-none absolute top-1/2 left-3.5 size-[18px] -translate-y-1/2 text-muted-foreground"
        />
        <input
          ref={inputRef}
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
          title={text || undefined}
          onChange={(e) => {
            const next = e.currentTarget.value;
            setText(next);
            setQuery(next);
            setEditing(true);
            setOpen(true);
          }}
          onFocus={(e) => {
            if (!quietFocus.has(e.currentTarget)) setOpen(true);
          }}
          onClick={() => setOpen(true)}
          onBlur={() => close()}
          onKeyDown={onKeyDown}
          className="flex h-11 w-full min-w-0 truncate rounded-input border border-input bg-card py-2 pr-10 pl-10 text-[15px] text-foreground transition-[border-color] duration-[var(--dur-fast)] placeholder:text-muted-foreground hover:border-foreground/70 focus-visible:border-foreground disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive pointer-coarse:h-12 pointer-coarse:text-base"
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

      {/* Before the first measurement the list renders hidden in place, so `aria-controls` always resolves. */}
      {placement ? createPortal(popup, placement.container) : popup}
    </div>
  );
}

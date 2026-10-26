import { useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";

import { cn } from "@orrn/ui/lib/utils";

export type SegmentedControlProps<T extends string> = {
  value: T;
  // NoInfer: `T` comes from `value`, so string-literal state types survive.
  options: { value: NoInfer<T>; label: string }[];
  onChange(v: NoInfer<T>): void;
  /** Accessible name for the group, e.g. "Show". Recommended. */
  label?: string;
  className?: string;
};

/**
 * iOS-style segmented control for filters and modes (2-4 options). Segments
 * share the sunken pill track (longer labels get more room, nothing is cut
 * off at 375px); the selected segment is a raised thumb that slides to it.
 * A radio group: Tab lands on the selected segment, arrow keys move and
 * select, Home/End jump.
 */
export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  label,
  className,
}: SegmentedControlProps<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [thumb, setThumb] = useState<{ x: number; width: number } | null>(null);
  // Slide only after the first placement, so the thumb doesn't fly in on mount.
  const [settled, setSettled] = useState(false);
  useLayoutEffect(() => {
    if (!thumb || settled) return;
    const frame = requestAnimationFrame(() => setSettled(true));
    return () => cancelAnimationFrame(frame);
  }, [thumb, settled]);
  const selected = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );

  // Measure the selected segment so the thumb can sit under it at any width.
  // The segments are watched as well as the track: a full-width track on a
  // phone keeps its size while new labels (a language switch) or a late web
  // font resize the segments, and the thumb must follow them.
  useLayoutEffect(() => {
    const measure = () => {
      const el = refs.current[selected];
      if (!el) return;
      const next = { x: el.offsetLeft, width: el.offsetWidth };
      setThumb((prev) => (prev && prev.x === next.x && prev.width === next.width ? prev : next));
    };
    measure();
    const track = trackRef.current;
    if (!track || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(track);
    for (const el of refs.current.slice(0, options.length)) if (el) ro.observe(el);
    return () => ro.disconnect();
  }, [selected, options.length]);

  const move = (to: number) => {
    const i = (to + options.length) % options.length;
    const next = options[i];
    if (!next) return;
    onChange(next.value);
    refs.current[i]?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    switch (e.key) {
      case "ArrowRight":
      case "ArrowDown":
        e.preventDefault();
        move(i + 1);
        break;
      case "ArrowLeft":
      case "ArrowUp":
        e.preventDefault();
        move(i - 1);
        break;
      case "Home":
        e.preventDefault();
        move(0);
        break;
      case "End":
        e.preventDefault();
        move(options.length - 1);
        break;
    }
  };

  return (
    <div
      ref={trackRef}
      role="radiogroup"
      aria-label={label}
      data-slot="segmented-control"
      className={cn(
        "relative flex w-full max-w-full rounded-full bg-surface-sunken p-1 sm:w-auto sm:self-start dark:bg-background dark:ring-1 dark:ring-border",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute top-1 bottom-1 left-0 rounded-full bg-card shadow-sm dark:bg-surface-sunken dark:ring-1 dark:ring-control/40",
          settled && "transition-[transform,width] duration-[var(--dur-base)] ease-[var(--ease-spring)]",
          !thumb && "opacity-0",
        )}
        style={thumb ? { width: thumb.width, transform: `translateX(${thumb.x}px)` } : undefined}
      />
      {options.map((opt, i) => {
        const active = i === selected;
        return (
          <button
            key={opt.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(opt.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cn(
              "relative z-[1] inline-flex h-9 min-w-0 flex-auto items-center justify-center rounded-full px-3 text-[14px] sm:px-4 font-semibold whitespace-nowrap transition-colors duration-[var(--dur-fast)] pointer-coarse:h-11",
              active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <span className="truncate" title={opt.label}>
              {opt.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

import { parseScan } from "@orrn/domain";
import { useT, type MessageKey } from "@orrn/i18n";
import { CommandDialog } from "@orrn/ui/components/command-dialog";
import { cn } from "@orrn/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { CornerDownLeft, Cylinder, Loader2, Package, Search, Truck, Users, type LucideIcon } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";

import { useMe } from "@/shared/lib/me";
import { trpc } from "@/shared/utils/trpc";

import { TENANT_MORE, TENANT_PRIMARY, visibleItems } from "./nav-items";

type PaletteContextValue = { open(): void; available: boolean };

const PaletteContext = createContext<PaletteContextValue>({ open: () => {}, available: false });

/** Opens the "Scan or search" palette (sidebar field, rail button). */
export function usePalette() {
  return useContext(PaletteContext);
}

/** "⌘K" on Apple keyboards, "Ctrl K" elsewhere. */
export function paletteShortcutLabel(): string {
  if (typeof navigator === "undefined") return "Ctrl K";
  return /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent) ? "⌘K" : "Ctrl K";
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);
}

/**
 * Tenant-only. ⌘K / Ctrl+K toggles the palette and `/` opens it (when the
 * person isn't typing in a field); both are ignored while another dialog or
 * sheet is open.
 */
export function CommandPaletteProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const openRef = useRef(false);
  openRef.current = open;

  useEffect(() => {
    const otherDialogOpen = () =>
      !openRef.current && !!document.querySelector("[role='dialog'], [role='alertdialog']");
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k") {
        // A sheet or dialog is in the middle of something: don't stack the palette on it.
        if (otherDialogOpen()) return;
        e.preventDefault();
        setOpen((v) => !v);
        return;
      }
      if (
        e.key === "/" &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        !isTypingTarget(e.target) &&
        !openRef.current &&
        !otherDialogOpen()
      ) {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const value = useMemo<PaletteContextValue>(() => ({ open: () => setOpen(true), available: true }), []);

  return (
    <PaletteContext.Provider value={value}>
      {children}
      <CommandPalette open={open} onOpenChange={setOpen} />
    </PaletteContext.Provider>
  );
}

type Group = "bundle" | "dispatches" | "dies" | "customers" | "pages";

const GROUP_LABEL: Record<Group, MessageKey> = {
  bundle: "nav.paletteBundles",
  dispatches: "nav.paletteDispatches",
  dies: "nav.paletteDies",
  customers: "nav.paletteCustomers",
  pages: "nav.palettePages",
};

const GROUP_ORDER: readonly Group[] = ["bundle", "dispatches", "dies", "customers", "pages"];

type Result = {
  id: string;
  group: Group;
  label: string;
  meta?: string;
  /** Serials and codes read in Geist Mono. */
  mono?: boolean;
  icon: LucideIcon;
  /** C2 path. */
  to: string;
};

const DISPATCH_STATUS: Record<string, MessageKey> = {
  draft: "status.dispatch.draft",
  reserved: "status.dispatch.reserved",
  completed: "status.dispatch.completed",
  cancelled: "status.dispatch.cancelled",
};

/** A serial worth offering as "Open bundle": parses as one, has a digit, isn't a dispatch code. */
function bundleSerial(query: string): string | null {
  const parsed = parseScan(query);
  if (parsed.kind !== "serial") return null;
  if (!/\d/.test(parsed.serial) || /^DSP-/i.test(parsed.serial)) return null;
  return parsed.serial;
}

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), ms);
    return () => window.clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange(open: boolean): void }) {
  const { t } = useT();
  const navigate = useNavigate();
  const { data: me } = useMe();
  const [query, setQuery] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const listId = useId();
  const listRef = useRef<HTMLUListElement | null>(null);

  // Fresh palette every time it opens.
  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveId(null);
    }
  }, [open]);

  const trimmed = query.trim();
  const debounced = useDebounced(trimmed, 160);
  const settled = debounced === trimmed;
  const searchable = open && debounced.length >= 2;

  const modules = (me?.company?.modules ?? []).map((m) => m.toLowerCase());
  const hasModule = (m: string) => modules.length === 0 || modules.includes(m);

  const dispatches = useQuery({
    ...trpc.dispatch.listDispatches.queryOptions({ search: debounced, limit: 5 }),
    enabled: searchable && hasModule("dispatches"),
    staleTime: 30_000,
  });
  const dies = useQuery({
    ...trpc.die.list.queryOptions({ search: debounced, limit: 5 }),
    enabled: searchable && hasModule("dies"),
    staleTime: 30_000,
  });
  const customers = useQuery({
    ...trpc.customer.list.queryOptions({ search: debounced, limit: 5 }),
    enabled: searchable && hasModule("customers"),
    staleTime: 30_000,
  });
  // Partial serials and PO numbers (Task 21): the bundles whose serial or PO contains the text.
  const bundles = useQuery({
    ...trpc.bundle.listBundles.queryOptions({ search: debounced, limit: 5 }),
    enabled: searchable && hasModule("bundles"),
    staleTime: 30_000,
  });
  const loading =
    trimmed.length >= 2 &&
    (!settled || bundles.isFetching || dispatches.isFetching || dies.isFetching || customers.isFetching);

  const results = useMemo<Result[]>(() => {
    const out: Result[] = [];
    const serial = bundleSerial(trimmed);
    if (serial && hasModule("bundles")) {
      out.push({
        id: `bundle-${serial}`,
        group: "bundle",
        label: t("nav.paletteOpenBundle", { serial }),
        icon: Package,
        to: `/b/${encodeURIComponent(serial)}`,
      });
    }
    // Remote groups only for the query they were fetched for, so Enter never opens a stale row.
    if (settled && debounced.length >= 2) {
      for (const b of bundles.data?.items ?? []) {
        if (b.serial === serial) continue;
        out.push({
          id: `bundle-row-${b.id}`,
          group: "bundle",
          label: b.serial,
          mono: true,
          meta: [[b.dieSeries, b.dieSectionCode].filter(Boolean).join(" "), t(`status.bundle.${b.status}`)].join(" · "),
          icon: Package,
          to: `/b/${encodeURIComponent(b.serial)}`,
        });
      }
      for (const d of dispatches.data?.items ?? []) {
        const status = DISPATCH_STATUS[d.status];
        out.push({
          id: `dispatch-${d.id}`,
          group: "dispatches",
          label: d.code,
          mono: true,
          meta: [d.customerName, status ? t(status) : null].filter(Boolean).join(" · "),
          icon: Truck,
          to: `/dispatch/${d.id}`,
        });
      }
      for (const d of dies.data?.items ?? []) {
        out.push({
          id: `die-${d.id}`,
          group: "dies",
          label: d.sectionCode || d.series,
          mono: true,
          meta: [d.series, d.name].filter((x) => x && x !== d.sectionCode).join(" · "),
          icon: Cylinder,
          to: `/dies/${d.id}`,
        });
      }
      for (const c of customers.data?.items ?? []) {
        out.push({ id: `customer-${c.id}`, group: "customers", label: c.name, icon: Users, to: `/customers/${c.id}` });
      }
    }
    const needle = trimmed.toLowerCase();
    for (const item of visibleItems([...TENANT_PRIMARY, ...TENANT_MORE], me)) {
      const label = t(item.labelKey);
      if (needle && !label.toLowerCase().includes(needle) && !item.key.includes(needle)) continue;
      out.push({ id: `page-${item.key}`, group: "pages", label, icon: item.icon, to: item.to });
    }
    return out;
    // `hasModule` derives from `me`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trimmed, settled, debounced, bundles.data, dispatches.data, dies.data, customers.data, me, t]);

  // Keep the highlighted row when it survives a refresh, else the first one.
  const active = results.find((r) => r.id === activeId) ?? results[0] ?? null;

  useEffect(() => {
    if (!active) return;
    listRef.current
      ?.querySelector(`[data-result-id="${CSS.escape(active.id)}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const choose = useCallback(
    (result: Result) => {
      onOpenChange(false);
      void navigate({ to: result.to as never });
    },
    [navigate, onOpenChange],
  );

  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    const index = active ? results.indexOf(active) : -1;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!results.length) return;
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActiveId(results[(index + step + results.length) % results.length]!.id);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (active) choose(active);
    }
  };

  const optionId = (r: Result) => `${listId}-${r.id}`;
  const grouped = GROUP_ORDER.map((g) => ({ group: g, items: results.filter((r) => r.group === g) })).filter(
    (g) => g.items.length > 0,
  );
  const showEmpty = trimmed.length >= 2 && !loading && results.length === 0;

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} label={t("nav.scanOrSearch")}>
      <div className="flex items-center gap-3 border-b border-border px-4">
        <Search aria-hidden="true" strokeWidth={2} className="size-5 shrink-0 text-muted-foreground" />
        <input
          role="combobox"
          aria-label={t("nav.scanOrSearch")}
          aria-expanded={results.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={active ? optionId(active) : undefined}
          value={query}
          onChange={(e) => {
            setQuery(e.currentTarget.value);
            setActiveId(null);
          }}
          onKeyDown={onKeyDown}
          placeholder={t("nav.paletteHint")}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          enterKeyHint="go"
          className="h-14 min-w-0 flex-1 truncate bg-transparent text-[17px] text-foreground outline-none placeholder:text-muted-foreground focus-visible:outline-none"
        />
        {loading ? (
          <Loader2 aria-hidden="true" className="size-5 shrink-0 animate-spin text-muted-foreground" />
        ) : null}
      </div>

      <ul
        ref={listRef}
        id={listId}
        role="listbox"
        aria-label={t("nav.scanOrSearch")}
        className={cn("m-0 min-h-0 flex-1 list-none overflow-y-auto overscroll-contain p-2", !grouped.length && "hidden")}
      >
        {grouped.map(({ group, items }) => (
          <li key={group} role="presentation" className="pb-1">
            <ul role="group" aria-labelledby={`${listId}-${group}`} className="m-0 list-none p-0">
              <li
                role="presentation"
                aria-hidden="true"
                id={`${listId}-${group}`}
                className="px-3 pt-2 pb-1 text-[13px] font-medium text-muted-foreground"
              >
                {t(GROUP_LABEL[group])}
              </li>
              {items.map((r) => {
                const Icon = r.icon;
                const isActive = r.id === active?.id;
                return (
                  <li
                    key={r.id}
                    id={optionId(r)}
                    data-result-id={r.id}
                    role="option"
                    aria-selected={isActive}
                    onMouseMove={() => {
                      if (!isActive) setActiveId(r.id);
                    }}
                    onClick={() => choose(r)}
                    className={cn(
                      "flex min-h-12 cursor-pointer items-center gap-3 rounded-input px-3 py-2",
                      isActive ? "bg-accent text-accent-foreground" : "text-foreground",
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className="flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-sunken text-foreground dark:bg-background"
                    >
                      <Icon className="size-4" strokeWidth={2} />
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span
                        className={cn("truncate text-[15px] font-semibold", r.mono && "font-mono")}
                        title={r.label}
                      >
                        {r.label}
                      </span>
                      {r.meta ? (
                        <span className="truncate text-[13px] text-muted-foreground" title={r.meta}>
                          {r.meta}
                        </span>
                      ) : null}
                    </span>
                    {isActive ? (
                      <CornerDownLeft aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ul>
      {showEmpty ? (
        <p className="m-0 px-4 pt-2 pb-8 text-center text-[15px] text-muted-foreground">
          {t("common.noResults", { query: trimmed })}
        </p>
      ) : null}

      <p aria-live="polite" className="sr-only">
        {trimmed.length >= 2 && !loading ? t("nav.paletteResults", { count: results.length }) : ""}
      </p>

      <div
        aria-hidden="true"
        className="hidden items-center gap-4 border-t border-border px-4 py-2.5 text-[13px] text-muted-foreground sm:flex"
      >
        <span className="flex items-center gap-1.5">
          <Kbd>↑</Kbd>
          <Kbd>↓</Kbd>
          {t("nav.paletteMove")}
        </span>
        <span className="flex items-center gap-1.5">
          <Kbd>Enter</Kbd>
          {t("nav.paletteOpen")}
        </span>
        <span className="flex items-center gap-1.5">
          <Kbd>Esc</Kbd>
          {t("common.close")}
        </span>
      </div>
    </CommandDialog>
  );
}

function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-6 min-w-6 items-center justify-center rounded-md border border-border bg-surface-sunken px-1.5 font-sans text-[12px] font-medium text-foreground dark:bg-background">
      {children}
    </kbd>
  );
}

import { anyModuleOn, parseScan, type BundleStatus } from "@orrn/domain";
import { createI18n, useT, type MessageKey } from "@orrn/i18n";
import type { Me } from "@orrn/server/lib/permissions";
import { CommandDialog } from "@orrn/ui/components/command-dialog";
import { cn } from "@orrn/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useRouterState } from "@tanstack/react-router";
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
  type MutableRefObject,
  type ReactNode,
} from "react";

import { useScan } from "@/features/scan/scan-context";
import { useTheme } from "@/shared/components/theme-provider";
import { useMe } from "@/shared/lib/me";
import { trpc } from "@/shared/utils/trpc";

import { useSignOut } from "./more-menu";
import { TENANT_MORE, TENANT_PRIMARY, visibleItems, type NavItem } from "./nav-items";
import { buildCommands, visibleSections, type CommandEffects, type PaletteCommand, type ThemeChoice } from "./palette/actions";
import { PAGE_ALIASES, type PageSection } from "./palette/page-index";
import {
  bundleRecent,
  clearRecents,
  notePaletteVisit,
  pushRecent,
  readRecents,
  takePaletteVisit,
  type RecentItem,
} from "./palette/recents";
import { rankItems, type Searchable } from "./palette/search";
import { usePlantSwitch } from "./plant-switcher";

type PaletteContextValue = {
  open(): void;
  available: boolean;
  /** The shell's "Arrange menu" opener, set by `usePaletteArrange`. */
  arrangeRef: MutableRefObject<(() => void) | undefined>;
};

const PaletteContext = createContext<PaletteContextValue>({ open: () => {}, available: false, arrangeRef: { current: undefined } });

/** Opens the "Scan or search" palette (sidebar field, rail button). */
export function usePalette() {
  return useContext(PaletteContext);
}

/** The shell hands the palette its existing "Arrange menu" opener (undefined when the person cannot arrange). */
export function usePaletteArrange(openArrange: (() => void) | undefined) {
  const { arrangeRef } = useContext(PaletteContext);
  useEffect(() => {
    arrangeRef.current = openArrange;
  });
  useEffect(
    () => () => {
      arrangeRef.current = undefined;
    },
    [arrangeRef],
  );
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
 * A sheet or dialog that is in the middle of something: the palette's shortcuts wait. A non-modal one
 * (`aria-modal="false"`, the Buddy panel beside the page from 768 px) does not block them: the page is still in use.
 */
export function blockingDialogOpen(doc: Pick<Document, "querySelector">): boolean {
  return !!doc.querySelector("[role='dialog']:not([aria-modal='false']), [role='alertdialog']");
}

/**
 * Tenant-only. ⌘K / Ctrl+K toggles the palette and `/` opens it (when the
 * person isn't typing in a field); both are ignored while another modal dialog
 * or sheet is open.
 */
export function CommandPaletteProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const openRef = useRef(false);
  openRef.current = open;
  const arrangeRef = useRef<(() => void) | undefined>(undefined);

  useEffect(() => {
    const otherDialogOpen = () => !openRef.current && blockingDialogOpen(document);
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

  useRecordVisits();

  const value = useMemo<PaletteContextValue>(() => ({ open: () => setOpen(true), available: true, arrangeRef }), []);

  return (
    <PaletteContext.Provider value={value}>
      {children}
      <CommandPalette open={open} onOpenChange={setOpen} arrangeRef={arrangeRef} />
    </PaletteContext.Provider>
  );
}

/**
 * Pages visited by any route count as recent too. Bundles are recorded by the bundle page once it has loaded the
 * bundle (`useRecordBundleVisit`), so a mistyped serial never becomes a recent (QA F1). Dispatches, dies and
 * customers are recorded when opened from the palette only: their paths carry an id, not a name to show.
 */
function useRecordVisits() {
  const { data: me } = useMe();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const userId = me?.impersonation ? undefined : me?.user.id;
  const companyId = me?.company?.id;
  useEffect(() => {
    if (!userId || !companyId) return;
    const recent = pageVisitRecent(pathname, me);
    if (recent) pushRecent(userId, companyId, recent);
    // `me` only matters through the ids and the gating at the moment of the visit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, userId, companyId]);
}

/**
 * What a route visit adds to recents: the nav page at this exact path, unless the palette opened this path and
 * already recorded what was chosen (a section on that page, QA F2). Every call clears the palette's mark.
 */
export function pageVisitRecent(pathname: string, me: Me | null | undefined): RecentItem | null {
  if (takePaletteVisit(pathname)) return null;
  const item = visibleItems([...TENANT_PRIMARY, ...TENANT_MORE], me).find((i) => i.to === pathname);
  return item ? { kind: "page", ref: item.key } : null;
}

type Group = "recent" | "bundle" | "commands" | "pages" | "sections" | "dispatches" | "dies" | "customers";

const GROUP_LABEL: Record<Group, MessageKey> = {
  recent: "nav.cmd.groupRecent",
  bundle: "nav.paletteBundles",
  commands: "nav.cmd.groupCommands",
  pages: "nav.palettePages",
  sections: "nav.cmd.groupSections",
  dispatches: "nav.paletteDispatches",
  dies: "nav.paletteDies",
  customers: "nav.paletteCustomers",
};

/** Local groups (commands, pages, sections) sit between these, ordered by their best match. */
const LEADING: readonly Group[] = ["recent", "bundle"];
const TRAILING: readonly Group[] = ["dispatches", "dies", "customers"];

type Action = { kind: "go"; to: string; search?: Readonly<Record<string, string>> } | { kind: "run"; command: PaletteCommand };

export type Result = {
  id: string;
  group: Group;
  label: string;
  meta?: string;
  /** The alias or term that matched, when it was not the label. */
  matched?: string;
  /** Serials and codes read in Geist Mono. */
  mono?: boolean;
  icon: LucideIcon;
  hint?: string;
  action: Action;
  /** Remembered as recent when chosen. */
  recent?: RecentItem;
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

function moduleOn(me: Me | null | undefined, m: string): boolean {
  return anyModuleOn(me?.company?.modules, [m]);
}

type RemoteGates = { bundles: boolean; dispatches: boolean; dies: boolean; customers: boolean };

type RemoteData = {
  bundles?: { items: readonly { id: string; serial: string; status: BundleStatus; dieSeries?: string | null; dieSectionCode?: string | null }[] };
  dispatches?: { items: readonly { id: string; code: string; status: string; customerName?: string | null }[] };
  dies?: { items: readonly { id: string; series: string; sectionCode?: string | null; name?: string | null }[] };
  customers?: { items: readonly { id: string; name: string }[] };
};

/** Remote search rows, only for modules that are on (cached data of a switched-off module never shows). */
export function remoteRows(data: RemoteData, on: RemoteGates, t: ReturnType<typeof useT>["t"]): Result[] {
  const out: Result[] = [];
  for (const b of on.bundles ? (data.bundles?.items ?? []) : []) {
    const to = `/b/${encodeURIComponent(b.serial)}`;
    const meta = [[b.dieSeries, b.dieSectionCode].filter(Boolean).join(" "), t(`status.bundle.${b.status}`)].join(" · ");
    out.push({
      id: `bundle-row-${b.id}`,
      group: "bundle",
      label: b.serial,
      mono: true,
      meta,
      icon: Package,
      action: { kind: "go", to },
      recent: bundleRecent(b.serial),
    });
  }
  for (const d of on.dispatches ? (data.dispatches?.items ?? []) : []) {
    const status = DISPATCH_STATUS[d.status];
    const to = `/dispatch/${d.id}`;
    const meta = [d.customerName, status ? t(status) : null].filter(Boolean).join(" · ");
    out.push({
      id: `dispatch-${d.id}`,
      group: "dispatches",
      label: d.code,
      mono: true,
      meta,
      icon: Truck,
      action: { kind: "go", to },
      recent: { kind: "dispatch", ref: d.id, label: d.code, mono: true, to, ...(d.customerName ? { meta: d.customerName } : {}) },
    });
  }
  for (const d of on.dies ? (data.dies?.items ?? []) : []) {
    const to = `/dies/${d.id}`;
    const label = d.sectionCode || d.series;
    const meta = [d.series, d.name].filter((x) => x && x !== d.sectionCode).join(" · ");
    out.push({
      id: `die-${d.id}`,
      group: "dies",
      label,
      mono: true,
      meta,
      icon: Cylinder,
      action: { kind: "go", to },
      recent: { kind: "die", ref: d.id, label, mono: true, to, ...(meta ? { meta } : {}) },
    });
  }
  for (const c of on.customers ? (data.customers?.items ?? []) : []) {
    const to = `/customers/${c.id}`;
    out.push({
      id: `customer-${c.id}`,
      group: "customers",
      label: c.name,
      icon: Users,
      action: { kind: "go", to },
      recent: { kind: "customer", ref: c.id, label: c.name, to },
    });
  }
  return out;
}

export type RemoteSearch = (query: string, enabled: boolean, me: Me | null | undefined) => { rows: Result[]; fetching: boolean };

/** Server-side search: bundles, dispatches, dies and customers whose code or name contains the text. */
const useRemoteGroups: RemoteSearch = (query, enabled, me) => {
  const { t } = useT();
  const modules = me?.company?.modules;
  // A switched-off module's query stops but keeps its cached rows: the same gates filter the rows too.
  const on = useMemo<RemoteGates>(
    () => ({
      bundles: moduleOn(me, "bundles"),
      dispatches: moduleOn(me, "dispatches"),
      dies: moduleOn(me, "dies"),
      customers: moduleOn(me, "customers"),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [modules?.join(",")],
  );
  const dispatches = useQuery({
    ...trpc.dispatch.listDispatches.queryOptions({ search: query, limit: 5 }),
    enabled: enabled && on.dispatches,
    staleTime: 30_000,
  });
  const dies = useQuery({
    ...trpc.die.list.queryOptions({ search: query, limit: 5 }),
    enabled: enabled && on.dies,
    staleTime: 30_000,
  });
  const customers = useQuery({
    ...trpc.customer.list.queryOptions({ search: query, limit: 5 }),
    enabled: enabled && on.customers,
    staleTime: 30_000,
  });
  // Partial serials and PO numbers (Task 21): the bundles whose serial or PO contains the text.
  const bundles = useQuery({
    ...trpc.bundle.listBundles.queryOptions({ search: query, limit: 5 }),
    enabled: enabled && on.bundles,
    staleTime: 30_000,
  });
  const fetching = bundles.isFetching || dispatches.isFetching || dies.isFetching || customers.isFetching;

  const rows = useMemo<Result[]>(
    () =>
      enabled
        ? remoteRows(
            { bundles: bundles.data, dispatches: dispatches.data, dies: dies.data, customers: customers.data },
            on,
            t,
          )
        : [],
    [enabled, on, bundles.data, dispatches.data, dies.data, customers.data, t],
  );

  return { rows, fetching };
};

function CommandPalette({
  open,
  onOpenChange,
  arrangeRef,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  arrangeRef: MutableRefObject<(() => void) | undefined>;
}) {
  const { setLocale } = useT();
  const navigate = useNavigate();
  const { data: me } = useMe();
  const scan = useScan();
  const { theme, setTheme } = useTheme();
  const plant = usePlantSwitch();
  const signOut = useSignOut();
  const location = useRouterState({ select: (s) => s.location });

  const effects: Omit<CommandEffects, "clearRecent"> & { go(to: string, search?: Readonly<Record<string, string>>): void } = {
    go: (to, search) => void navigate({ to: to as never, ...(search ? { search: search as never } : {}) }),
    navigate: (to) => void navigate({ to: to as never }),
    openScan: () => scan.open({ kind: "lookup" }),
    switchPlant: plant.pick,
    setLocale,
    setTheme: (value: ThemeChoice) => setTheme(value),
    openArrange: () => arrangeRef.current?.(),
    signOut,
  };

  return (
    <PaletteBody
      open={open}
      onOpenChange={onOpenChange}
      me={me}
      theme={theme}
      scanAvailable={scan.available}
      arrangeAvailable={!!arrangeRef.current}
      effects={effects}
      useRemote={useRemoteGroups}
      here={{ pathname: location.pathname, search: location.search as Record<string, unknown> }}
    />
  );
}

type Item = Searchable & { result: Result };

export type PaletteBodyProps = {
  open: boolean;
  onOpenChange(open: boolean): void;
  me: Me | null | undefined;
  theme: string | undefined;
  scanAvailable: boolean;
  arrangeAvailable: boolean;
  effects: Omit<CommandEffects, "clearRecent"> & { go(to: string, search?: Readonly<Record<string, string>>): void };
  /** A hook: server-side search groups. Tests pass a stub. */
  useRemote: RemoteSearch;
  /** Where the person is now: that page or section is left out of Recent. */
  here?: { pathname: string; search: Readonly<Record<string, unknown>> };
};

const ROW_PX = 48;

/** The palette without router, tRPC or theme wiring, so its behaviour is testable. */
export function PaletteBody({ open, onOpenChange, me, theme, scanAvailable, arrangeAvailable, effects, useRemote, here }: PaletteBodyProps) {
  const { t, locale } = useT();
  const tEn = useMemo(() => createI18n("en").t, []);
  const [query, setQuery] = useState("");
  const [commandMode, setCommandMode] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [recents, setRecents] = useState<RecentItem[]>([]);
  const listId = useId();
  const listRef = useRef<HTMLUListElement | null>(null);
  // A command that opens a sheet or dialog, waiting for the palette to finish closing (QA F0).
  const pendingRef = useRef<(() => void) | null>(null);
  // No recents while impersonating: a support session must not leave a plant's names in the staff browser.
  const userId = me?.impersonation ? undefined : me?.user.id;
  const companyId = me?.company?.id;

  // Fresh palette every time it opens. Reset while rendering the opening (not in an effect), so the very first
  // committed render, and the live region's first announcement, already have the empty query, search mode and the
  // stored recents, never the last session's text.
  const [openedFor, setOpenedFor] = useState(false);
  if (open !== openedFor) {
    setOpenedFor(open);
    if (open) {
      setQuery("");
      setCommandMode(false);
      setActiveId(null);
      setRecents(userId && companyId ? readRecents(userId, companyId) : []);
    }
  }
  useEffect(() => {
    if (open) pendingRef.current = null;
  }, [open]);
  // A plant switch or the end of impersonation while open: read that person's and plant's list.
  useEffect(() => {
    if (open) setRecents(userId && companyId ? readRecents(userId, companyId) : []);
    // `open` is handled above; this only follows the identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, companyId]);

  const trimmed = query.trim();
  const debounced = useDebounced(trimmed, 160);
  const settled = debounced === trimmed;
  const remoteOn = open && !commandMode && debounced.length >= 2;
  const remote = useRemote(debounced, remoteOn, me);
  const loading = !commandMode && trimmed.length >= 2 && (!settled || remote.fetching);

  // Searchable items stay the same objects across keystrokes (search.ts caches folded text per object).
  const navItems = useMemo(() => visibleItems([...TENANT_PRIMARY, ...TENANT_MORE], me), [me]);
  const sections = useMemo(() => visibleSections(me), [me]);
  const navByKey = useMemo(() => new Map(navItems.map((i) => [i.key, i])), [navItems]);

  const commands = useMemo(
    () => buildCommands({ me, locale, theme, scanAvailable, arrangeAvailable, hasRecents: recents.length > 0 }),
    [me, locale, theme, scanAvailable, arrangeAvailable, recents.length],
  );
  // A section that opens the same route as a visible command (pack.new, dispatch.new, ...) is not listed twice:
  // the command row takes over its words.
  const commandRoutes = useMemo(() => new Set(commands.flatMap((c) => (c.to ? [c.to] : []))), [commands]);
  const isCommandRoute = (s: PageSection) => !s.search && commandRoutes.has(s.to);

  const commandItems = useMemo<Item[]>(
    () =>
      commands.map((command) => ({
        id: `cmd-${command.id}`,
        group: "commands",
        label: t(command.labelKey, command.labelVars),
        labelEn: tEn(command.labelKey, command.labelVars),
        aliases: [
          ...(command.aliases ?? []),
          ...sections.filter((s) => !s.search && s.to === command.to).flatMap((s) => s.terms),
        ],
        result: {
          id: `cmd-${command.id}`,
          group: "commands",
          label: t(command.labelKey, command.labelVars),
          icon: command.icon,
          hint: command.hint,
          action: { kind: "run", command },
        },
      })),
    [commands, sections, t, tEn],
  );

  const pageItems = useMemo<Item[]>(
    () =>
      navItems.map((item) => ({
        id: `page-${item.key}`,
        group: "pages",
        label: t(item.labelKey),
        labelEn: tEn(item.labelKey),
        aliases: [...(PAGE_ALIASES[item.key] ?? []), item.key],
        result: pageResult(item, `page-${item.key}`, "pages", t),
      })),
    [navItems, t, tEn],
  );

  const sectionItems = useMemo<Item[]>(
    () =>
      sections.flatMap((section) => {
        const parent = navByKey.get(section.parentKey);
        if (!parent || isCommandRoute(section)) return [];
        const result = sectionResult(section, parent, `section-${section.id}`, "sections", t);
        return [
          {
            id: result.id,
            group: "sections" as const,
            label: result.label,
            labelEn: section.labelKey ? tEn(section.labelKey) : section.label,
            terms: section.terms,
            result,
          },
        ];
      }),
    // `isCommandRoute` reads `commandRoutes`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sections, navByKey, commandRoutes, t, tEn],
  );

  const herePath = here?.pathname;
  const hereTab = typeof here?.search.tab === "string" ? here.search.tab : undefined;
  const recentResults = useMemo<Result[]>(() => {
    const out: Result[] = [];
    // The page or section on screen right now is not "recent": it is where you are.
    const isHere = (to: string, search?: Readonly<Record<string, string>>) =>
      to === herePath && (search?.tab ?? undefined) === hereTab;
    for (const r of recents) {
      const id = `recent-${r.kind}-${r.ref}`;
      if (r.kind === "page") {
        const item = navByKey.get(r.ref);
        if (item && !isHere(item.to)) out.push({ ...pageResult(item, id, "recent", t), recent: r });
      } else if (r.kind === "section") {
        const section = sections.find((s) => s.id === r.ref);
        const parent = section && navByKey.get(section.parentKey);
        if (section && parent && !isHere(section.to, section.search)) out.push({ ...sectionResult(section, parent, id, "recent", t), recent: r });
      } else if (r.label && r.to && !isHere(r.to)) {
        const remoteModule = { bundle: "bundles", dispatch: "dispatches", die: "dies", customer: "customers" }[r.kind];
        if (!moduleOn(me, remoteModule)) continue;
        const icon = { bundle: Package, dispatch: Truck, die: Cylinder, customer: Users }[r.kind];
        out.push({ id, group: "recent", label: r.label, meta: r.meta, mono: r.mono, icon, action: { kind: "go", to: r.to }, recent: r });
      }
    }
    return out;
  }, [recents, navByKey, sections, me, t, herePath, hereTab]);

  const grouped = useMemo<{ group: Group; items: Result[] }[]>(() => {
    const byGroup = new Map<Group, Result[]>();
    const add = (r: Result) => {
      const list = byGroup.get(r.group);
      if (list) list.push(r);
      else byGroup.set(r.group, [r]);
    };
    const localOrder: Group[] = [];

    if (commandMode) {
      for (const r of rankItems(trimmed, commandItems)) add({ ...r.result, matched: r.match.matched });
      localOrder.push("commands");
    } else if (!trimmed) {
      for (const r of recentResults) add(r);
      for (const p of pageItems) add(p.result);
      localOrder.push("pages");
    } else {
      const serial = bundleSerial(trimmed);
      if (serial && moduleOn(me, "bundles")) {
        const to = `/b/${encodeURIComponent(serial)}`;
        add({
          id: `bundle-${serial}`,
          group: "bundle",
          label: t("nav.paletteOpenBundle", { serial }),
          icon: Package,
          action: { kind: "go", to },
          // No `recent`: the serial was typed and may not exist. The bundle page records it once it loads (QA F1).
        });
      }
      // Remote groups only for the query they were fetched for, so Enter never opens a stale row.
      if (settled) {
        for (const r of remote.rows) {
          if (r.group === "bundle" && r.label === serial) continue;
          add(r);
        }
      }
      // Local groups follow their best match. Ties on score and label length go to search.ts's group order.
      for (const r of rankItems(trimmed, [...pageItems, ...sectionItems, ...commandItems])) {
        add({ ...r.result, matched: r.match.matched });
        if (!localOrder.includes(r.result.group)) localOrder.push(r.result.group);
      }
    }
    return [...LEADING, ...localOrder, ...TRAILING]
      .map((group) => ({ group, items: byGroup.get(group) ?? [] }))
      .filter((g) => g.items.length > 0);
  }, [commandMode, trimmed, settled, commandItems, recentResults, pageItems, sectionItems, remote.rows, me, t]);

  // Keyboard order is display order.
  const flat = useMemo(() => grouped.flatMap((g) => g.items), [grouped]);

  // Keep the highlighted row when it survives a refresh, else the first one.
  const active = flat.find((r) => r.id === activeId) ?? flat[0] ?? null;

  useEffect(() => {
    if (!active) return;
    document.getElementById(`${listId}-${active.id}`)?.scrollIntoView?.({ block: "nearest" });
  }, [active, listId]);

  const choose = useCallback(
    (result: Result) => {
      onOpenChange(false);
      if (result.recent && userId && companyId) {
        pushRecent(userId, companyId, result.recent);
        // The route-visit hook must not record this visit a second time (as the section's parent page, QA F2).
        if (result.action.kind === "go") notePaletteVisit(result.action.to);
      }
      if (result.action.kind === "go") {
        effects.go(result.action.to, result.action.search);
        return;
      }
      const fx: CommandEffects = {
        ...effects,
        clearRecent: () => {
          if (userId && companyId) clearRecents(userId, companyId);
          setRecents([]);
        },
      };
      const command = result.action.command;
      // A command that opens a sheet or dialog runs once the palette has closed and handed focus back to its opener
      // (`onClosed`), so the new sheet's own focus comes last and stays there (QA F0).
      if (command.deferred) pendingRef.current = () => command.run(fx);
      else command.run(fx);
    },
    [effects, onOpenChange, userId, companyId],
  );

  const pageSize = () => {
    const height = listRef.current?.clientHeight ?? 0;
    return height > 0 ? Math.max(1, Math.floor(height / ROW_PX)) : 5;
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    const index = active ? flat.indexOf(active) : -1;
    const last = flat.length - 1;
    const moveTo = (i: number) => {
      e.preventDefault();
      if (flat.length) setActiveId(flat[Math.min(last, Math.max(0, i))]!.id);
    };
    switch (e.key) {
      case "ArrowDown":
      case "ArrowUp": {
        e.preventDefault();
        if (!flat.length) return;
        const step = e.key === "ArrowDown" ? 1 : -1;
        setActiveId(flat[(index + step + flat.length) % flat.length]!.id);
        return;
      }
      // Home and End move through the list while it has rows; with no rows they move the caret as usual.
      case "Home":
        if (flat.length && !e.shiftKey) moveTo(0);
        return;
      case "End":
        if (flat.length && !e.shiftKey) moveTo(last);
        return;
      case "PageDown":
        moveTo(index + pageSize());
        return;
      case "PageUp":
        moveTo(index - pageSize());
        return;
      case "Enter":
        e.preventDefault();
        if (active) choose(active);
        return;
      case "Backspace":
        // Backspace over the ">" returns to normal search.
        if (commandMode && e.currentTarget.value === "") {
          e.preventDefault();
          setCommandMode(false);
          setActiveId(null);
        }
        return;
    }
  };

  const optionId = (r: Result) => `${listId}-${r.id}`;
  const showEmpty = !loading && flat.length === 0 && (commandMode || trimmed.length >= 1);
  const inputLabel = commandMode ? `${t("nav.scanOrSearch")}. ${t("nav.cmd.commandLabel")}` : t("nav.scanOrSearch");
  const announcement = useAnnouncement({ open, commandMode, trimmed, settled, loading, count: flat.length, t });
  const onClosed = useCallback(() => {
    const run = pendingRef.current;
    pendingRef.current = null;
    run?.();
  }, []);

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} label={t("nav.scanOrSearch")} onClosed={onClosed}>
      <div className="flex items-center gap-3 border-b border-border px-4 focus-within:outline-2 focus-within:-outline-offset-2 focus-within:outline-solid focus-within:outline-ring">
        <Search aria-hidden="true" strokeWidth={2} className="size-5 shrink-0 text-muted-foreground" />
        {commandMode ? (
          <span
            aria-hidden="true"
            data-testid="palette-command-mode"
            className="inline-flex h-7 shrink-0 items-center rounded-md bg-surface-sunken px-2 font-mono text-[15px] font-semibold text-foreground dark:bg-background"
          >
            &gt;
          </span>
        ) : null}
        <input
          role="combobox"
          aria-label={inputLabel}
          aria-expanded={flat.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={active ? optionId(active) : undefined}
          value={query}
          onChange={(e) => {
            const value = e.currentTarget.value;
            if (!commandMode && value.startsWith(">")) {
              setCommandMode(true);
              setQuery(value.slice(1).trimStart());
            } else {
              setQuery(value);
            }
            setActiveId(null);
          }}
          onKeyDown={onKeyDown}
          placeholder={commandMode ? t("nav.cmd.commandHint") : t("nav.paletteHint")}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          enterKeyHint="go"
          className="h-14 min-w-0 flex-1 truncate bg-transparent text-[17px] text-foreground outline-none placeholder:text-muted-foreground focus-visible:outline-none"
        />
        {loading ? (
          <Loader2 aria-hidden="true" className="size-5 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none" />
        ) : null}
      </div>

      <ul
        ref={listRef}
        id={listId}
        role="listbox"
        aria-label={inputLabel}
        className={cn("m-0 min-h-0 flex-1 list-none overflow-y-auto overscroll-contain p-2", !grouped.length && "hidden")}
      >
        {grouped.map(({ group, items }) => (
          <li key={group} role="presentation" className="pb-1">
            {/* The group is named by aria-label (announced on entry); the visible heading is a duplicate for sight. */}
            <ul role="group" aria-label={t(GROUP_LABEL[group])} data-group={group} className="m-0 list-none p-0">
              <li role="presentation" aria-hidden="true" className="px-3 pt-2 pb-1 text-[13px] font-medium text-muted-foreground">
                {t(GROUP_LABEL[group])}
              </li>
              {items.map((r) => {
                const Icon = r.icon;
                const isActive = r.id === active?.id;
                const secondary = [r.meta, r.matched ? t("nav.cmd.matched", { word: r.matched }) : null].filter(Boolean).join(" · ");
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
                      // 48px rows: above the 44px touch target.
                      "flex min-h-12 cursor-pointer items-center gap-3 rounded-input px-3 py-2",
                      // Focus stays in the input (aria-activedescendant), so the active row carries its own 3:1 outline, not just a tint.
                      isActive ? "bg-accent text-accent-foreground outline-2 -outline-offset-2 outline-solid outline-ring" : "text-foreground",
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className="flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-sunken text-foreground dark:bg-background"
                    >
                      <Icon className="size-4" strokeWidth={2} />
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className={cn("truncate text-[15px] font-semibold", r.mono && "font-mono")} title={r.label}>
                        {r.label}
                      </span>
                      {secondary ? (
                        <span className="truncate text-[13px] text-muted-foreground" title={secondary} data-testid="palette-secondary">
                          {secondary}
                        </span>
                      ) : null}
                    </span>
                    {r.hint ? <Kbd>{r.hint}</Kbd> : null}
                    {isActive ? <CornerDownLeft aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" /> : null}
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ul>
      {showEmpty ? (
        <p className="m-0 px-4 pt-2 pb-8 text-center text-[15px] text-muted-foreground">
          {t("common.noResults", { query: trimmed || ">" })}
        </p>
      ) : null}

      <p aria-live="polite" data-testid="palette-live" className="sr-only">
        {announcement}
      </p>

      <div
        aria-hidden="true"
        className="hidden flex-wrap items-center gap-x-4 gap-y-1 border-t border-border px-4 py-2.5 text-[13px] text-muted-foreground sm:flex"
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
          <Kbd>&gt;</Kbd>
          {t("nav.cmd.groupCommands")}
        </span>
        <span className="flex items-center gap-1.5">
          <Kbd>Esc</Kbd>
          {t("common.close")}
        </span>
      </div>
    </CommandDialog>
  );
}

type T = ReturnType<typeof useT>["t"];

/**
 * The polite live region (review S3). A live region speaks whenever its text changes, so the text only changes
 * when there is something new to say:
 * - on opening and on each mode change: the mode and its count ("Search. 26 results", "Commands only. 15 commands");
 * - after that, only once the typed text has settled (the remote search debounce) and nothing is loading: the
 *   count ("Search. 4 results", or "3 commands" in command mode, where the mode was already said).
 * Search keeps its 2-letter minimum: one letter says nothing new.
 */
function useAnnouncement({
  open,
  commandMode,
  trimmed,
  settled,
  loading,
  count,
  t,
}: {
  open: boolean;
  commandMode: boolean;
  trimmed: string;
  settled: boolean;
  loading: boolean;
  count: number;
  t: T;
}): string {
  const [text, setText] = useState("");
  // The mode last announced and the query it was announced for; null while closed.
  const said = useRef<{ commandMode: boolean; query: string } | null>(null);
  useEffect(() => {
    if (!open) {
      said.current = null;
      setText("");
      return;
    }
    const modeChanged = said.current?.commandMode !== commandMode;
    if (modeChanged) {
      said.current = { commandMode, query: trimmed };
      setText(commandMode ? t("nav.cmd.announceCommands", { count }) : t("nav.cmd.announceSearch", { count }));
      return;
    }
    if (!settled || loading) return;
    if (commandMode) {
      // Still the query the mode was announced with: the count was just said.
      if (said.current?.query === trimmed) return;
      said.current = { commandMode, query: "\u0000" };
      setText(t("nav.cmd.announceCommandCount", { count }));
      return;
    }
    if (trimmed.length === 1) return;
    setText(t("nav.cmd.announceSearch", { count }));
  }, [open, commandMode, trimmed, settled, loading, count, t]);
  return text;
}

function pageResult(item: NavItem, id: string, group: Group, t: T): Result {
  return { id, group, label: t(item.labelKey), icon: item.icon, action: { kind: "go", to: item.to }, recent: { kind: "page", ref: item.key } };
}

function sectionResult(section: PageSection, parent: NavItem, id: string, group: Group, t: T): Result {
  return {
    id,
    group,
    label: section.labelKey ? t(section.labelKey) : (section.label ?? section.id),
    meta: t(parent.labelKey),
    icon: parent.icon,
    action: { kind: "go", to: section.to, ...(section.search ? { search: section.search } : {}) },
    recent: { kind: "section", ref: section.id },
  };
}

function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-6 min-w-6 shrink-0 items-center justify-center rounded-md border border-border bg-surface-sunken px-1.5 font-sans text-[12px] font-medium text-foreground dark:bg-background">
      {children}
    </kbd>
  );
}

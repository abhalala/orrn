import { describe, expect, test } from "bun:test";

import { COMPANY_MODULES } from "@orrn/domain";
import { can, canAny, type Action, type CompanyRole } from "@orrn/server/lib/permissions";

import { masterEntries } from "@/features/masters/masters-model";

import type { NavModule } from "../nav-items";
import { buildCommands, visibleSections, type PaletteCommand } from "./actions";
import { PAGE_SECTIONS } from "./page-index";
import { gateOf, procedureActions, reportCardModules, routeFile, routerModule, routeTree, settingsTabRequires } from "./source-guards";
import { testMe } from "./test-me";

/**
 * Review B1 to B4: a palette row must never lead someone to a page that refuses them. For every page section and
 * every command, its gate must be at least as strict as what the target page itself checks.
 *
 * The answers are not copied here. The table below only names WHICH check each target page makes (the procedure
 * its main read calls, or the action its `<Can>` / `can()` wraps the page in, or the module its feature belongs
 * to). The test then confirms that check really is in the page's code, reads the procedure's actions from the
 * server router, and asks the permission table which roles pass it. Settings tabs, masters and report cards are
 * read straight from their own models with no table row at all.
 *
 * A new section or command without a row here fails the completeness test, so its author has to look.
 */

type Guard =
  /** The page's main read; its server actions are read from the router source. */
  | { proc: string }
  /** The page wraps its content in `<Can do=...>` / `can(me, ...)` and shows "no access" otherwise. */
  | { can: Action }
  /** The page belongs to a module's feature folder and is only linked from inside that module. */
  | { module: NavModule };

/** What each target checks beyond its nav item. `[]`: nothing stricter than the nav item (checked by review). */
const PAGE_GUARDS: Readonly<Record<string, readonly Guard[]>> = {
  "/pack/new": [{ can: "bundle.pack" }],
  "/stock/lengths": [],
  "/stock/bundles": [],
  "/stock/yards": [],
  "/stock/count": [],
  "/dispatch/new": [{ can: "dispatch.create" }],
  "/orders/new": [{ can: "order.manage" }],
  "/orders/plan": [],
  "/press/alerts": [],
  "/press/lines": [],
  "/press/report": [{ proc: "press.report" }],
  "/press/summary": [{ proc: "press.summary" }],
  "/casts/inbox": [],
  "/casts/inbox?tab=arriving": [],
  "/casts/inbox?tab=handled": [],
  "/casts/new": [{ can: "cast.enter" }],
  "/foundry/stock": [],
  "/ageing/load": [{ can: "ageing.load" }],
  "/ageing/history": [],
  "/reports/production": [],
  "/reports/die-life": [],
  "/reports/stock-age": [],
  "/reports/foundry-yield": [],
  "/reports/orders": [],
  // Not a card on the reports index: only linked from the ageing history page.
  "/reports/ageing": [{ proc: "reports.ageing" }, { module: "ageing" }],
  "/purchase/new": [{ can: "purchase.receipt" }],
  "/dies/issues": [],
  "/dies/makers": [],
  "/store/items": [{ proc: "store.balances" }],
  "/store/issue": [{ can: "store.txn" }],
  "/store/receive": [{ can: "store.txn" }],
  "/store/exchange": [{ can: "store.txn" }],
  "/printing": [{ proc: "spool.queue" }],
  "/printing?tab=printers": [],
  "/printing?tab=labels": [],
  "/vendors": [{ proc: "vendor.list" }],
  "/masters/scrap?tab=items": [],
  "/masters/scrap?tab=grades": [],
  "/masters/scrap?tab=streams": [],
  "/masters/locations": [],
  "/masters/dies": [],
  "/masters/reasons": [],
  "/masters/furnaces": [],
  "/masters/alloys": [],
  "/masters/ovens": [],
  "/masters/trolleys": [],
  "/masters/recipes": [],
  "/ingest": [{ can: "ingest.upload" }],
};

/** Commands that open no route: what they need instead. */
const NON_ROUTE_COMMANDS: Readonly<Record<string, readonly Guard[]>> = {
  "scan-bundle": [{ module: "bundles" }],
  "switch-plant": [],
  language: [],
  theme: [],
  "arrange-menu": [],
  "clear-recent": [],
  "sign-out": [],
};

/** Feature folder of each module, to confirm a `module` guard's page really lives there. */
const MODULE_DIR: Readonly<Record<NavModule, string>> = {
  ageing: "ageing",
  foundry: "foundry",
  press: "press",
  dies: "die-room",
  dispatches: "dispatch",
  customers: "customers",
  bundles: "stock",
  complaints: "complaints",
};

const ROLES = Object.keys({
  owner: 1,
  admin: 1,
  manager: 1,
  office: 1,
  accountant: 1,
  supervisor: 1,
  packer: 1,
  foundry: 1,
  press: 1,
  storekeeper: 1,
  die_room: 1,
  operator: 1,
  viewer: 1,
} satisfies Record<CompanyRole, 1>) as CompanyRole[];

const MODULES = Object.keys(MODULE_DIR) as NavModule[];

/** Module configurations: all on (empty list), and each nav module switched off in turn. */
const MODULE_SETS: readonly string[][] = [[], ...MODULES.map((off) => MODULES.filter((m) => m !== off))];

function targetKey(to: string, search?: Readonly<Record<string, string>>): string {
  const params = search ? new URLSearchParams(search).toString() : "";
  return params ? `${to}?${params}` : to;
}

function commandKey(id: string): string {
  return id.replace(/^(switch-plant|language|theme)-.*$/, "$1");
}

/** First path segments whose router name differs from the path. */
const PATH_ROUTER: Readonly<Record<string, string>> = { casts: "foundry", pack: "bundle", stock: "bundle" };

/** The module of a page's own router: the router named by its first path segment (store, orders, vendor, ...). */
function pageModule(to: string): string | null {
  const segment = to.replace(/^\//, "").split(/[/?]/)[0]!;
  const router = PATH_ROUTER[segment] ?? segment;
  return routerModule(router) ?? routerModule(router.replace(/s$/, ""));
}

function moduleOn(modules: readonly string[], module: string): boolean {
  return modules.length === 0 || modules.includes(module);
}

const settingsTabs = settingsTabRequires();
const reportCards = reportCardModules();
const masterTos = new Set(masterEntries(testMe("owner")).map((e) => e.to));

/** Every guard behind a target, from the table and from the page models. Throws on an unknown target. */
function guardsFor(to: string, search?: Readonly<Record<string, string>>): { actions: string[][]; modules: string[] } {
  const actions: string[][] = [];
  const modules: string[] = [];
  if (to === "/settings") {
    const tab = search?.tab ?? "company";
    const requires = settingsTabs.get(tab);
    if (!requires) throw new Error(`settings tab "${tab}" is not in features/settings/sections.tsx`);
    if (requires.length) actions.push(requires);
    return { actions, modules };
  }
  const key = targetKey(to, search);
  const table = PAGE_GUARDS[key];
  if (!table) throw new Error(`no PAGE_GUARDS row for ${key}`);
  for (const guard of table) {
    if ("proc" in guard) {
      const procActions = procedureActions(guard.proc);
      if (!procActions) throw new Error(`${guard.proc} has no action gate in its router`);
      actions.push(procActions);
      const top = guard.proc.split(".")[0]!;
      const module = routerModule(top);
      if (module && (MODULES as string[]).includes(module)) modules.push(module);
    } else if ("can" in guard) {
      actions.push([guard.can]);
    } else {
      modules.push(guard.module);
    }
  }
  const card = reportCards.get(to);
  if (card) modules.push(card);
  return { actions, modules };
}

function allows(role: CompanyRole, modules: readonly string[], g: { actions: string[][]; modules: string[] }): boolean {
  const me = testMe(role, { modules: [...modules] });
  return g.actions.every((any) => canAny(me, any as Action[])) && g.modules.every((m) => moduleOn(modules, m));
}

function commandsFor(role: CompanyRole, modules: readonly string[]): PaletteCommand[] {
  return buildCommands({
    me: testMe(role, { modules: [...modules], plants: 3 }),
    locale: "en",
    theme: "system",
    scanAvailable: true,
    arrangeAvailable: true,
    hasRecents: true,
  });
}

describe("palette gates match the target page (review B1 to B4)", () => {
  test("every section and command has a guard row (a new one must declare what its page checks)", () => {
    const missing: string[] = [];
    for (const s of PAGE_SECTIONS) {
      try {
        guardsFor(s.to, s.search);
      } catch (error) {
        missing.push(`${s.id}: ${(error as Error).message}`);
      }
    }
    const seen = new Set<string>();
    for (const role of ROLES) for (const c of commandsFor(role, [])) seen.add(c.id);
    for (const id of seen) {
      const command = commandsFor("owner", []).find((c) => c.id === id) ?? commandsFor("storekeeper", []).find((c) => c.id === id);
      if (command?.to) {
        try {
          guardsFor(command.to);
        } catch (error) {
          missing.push(`${id}: ${(error as Error).message}`);
        }
      } else if (!NON_ROUTE_COMMANDS[commandKey(id)]) {
        missing.push(`${id}: no NON_ROUTE_COMMANDS row`);
      }
    }
    expect(missing).toEqual([]);
  });

  test("every named check is really in the page's code", () => {
    const problems: string[] = [];
    for (const [key, guards] of Object.entries(PAGE_GUARDS)) {
      const to = key.split("?")[0]!;
      if (!routeFile(to)) {
        problems.push(`${key}: no route file`);
        continue;
      }
      const { source, files } = routeTree(to);
      for (const guard of guards) {
        if ("proc" in guard && !source.includes(`trpc.${guard.proc}.`)) problems.push(`${key}: page never calls ${guard.proc}`);
        if ("can" in guard && !source.includes(`"${guard.can}"`)) problems.push(`${key}: page never checks ${guard.can}`);
        if ("module" in guard && !files.some((f) => f.includes(`/features/${MODULE_DIR[guard.module]}/`))) {
          problems.push(`${key}: page is not in the ${guard.module} feature folder`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  test("no role sees a section whose page or server would refuse them, with any module switched off", () => {
    const leaks: string[] = [];
    for (const modules of MODULE_SETS) {
      for (const role of ROLES) {
        const me = testMe(role, { modules: [...modules] });
        const masters = new Set(masterEntries(me).map((e) => e.to));
        for (const s of visibleSections(me)) {
          const guard = guardsFor(s.to, s.search);
          const off = modules.length ? ` (modules: ${MODULES.filter((m) => !modules.includes(m)).join(",")} off)` : "";
          if (!allows(role, modules, guard)) leaks.push(`${role} sees ${s.id}${off}`);
          // The Masters hub's own list decides who may open a master; a section must not be looser.
          if (masterTos.has(s.to) && !masters.has(s.to)) leaks.push(`${role} sees ${s.id} but the Masters hub hides it${off}`);
        }
      }
    }
    expect([...new Set(leaks)]).toEqual([]);
  });

  test("no role gets a command whose page or server would refuse them, with any module switched off", () => {
    const leaks: string[] = [];
    for (const modules of MODULE_SETS) {
      for (const role of ROLES) {
        for (const c of commandsFor(role, modules)) {
          const guard = c.to ? guardsFor(c.to) : { actions: [], modules: (NON_ROUTE_COMMANDS[commandKey(c.id)] ?? []).flatMap((g) => ("module" in g ? [g.module] : [])) };
          if (!allows(role, modules, guard)) leaks.push(`${role} gets ${c.id}`);
        }
      }
    }
    expect([...new Set(leaks)]).toEqual([]);
  });

  test("every read a target page makes is allowed for everyone who sees its row (no trust in the table)", () => {
    // The table above can say a page checks nothing. This reads the page's own data calls (the route file and the
    // feature files it imports directly) and asks the server router what each one needs, so an emptied row or a
    // forgotten gate still fails. Mutations are left out: their buttons carry their own gates.
    const leaks = new Set<string>();
    let reads = 0;
    for (const role of ROLES) {
      const me = testMe(role);
      const rows = [
        ...visibleSections(me).map((s) => ({ id: s.id, to: s.to })),
        ...commandsFor(role, []).flatMap((c) => (c.to ? [{ id: c.id, to: c.to }] : [])),
      ];
      for (const row of rows) {
        for (const m of routeTree(row.to, 1).source.matchAll(/trpc\.(\w+)\.(\w+)\.(?:queryOptions|infiniteQueryOptions)/g)) {
          const actions = procedureActions(`${m[1]}.${m[2]}`);
          if (!actions) continue;
          reads++;
          if (!canAny(me, actions as Action[])) leaks.add(`${role} sees ${row.id} but ${m[1]}.${m[2]} needs ${actions.join(" or ")}`);
        }
      }
    }
    expect(reads).toBeGreaterThan(100);
    expect([...leaks]).toEqual([]);
  });

  test("no row shows while its page's own module is off, for every company module (not only the sidebar's)", () => {
    const leaks = new Set<string>();
    const sets = COMPANY_MODULES.map((off) => COMPANY_MODULES.filter((m) => m !== off));
    for (const modules of sets) {
      const off = COMPANY_MODULES.find((m) => !modules.includes(m))!;
      for (const role of ROLES) {
        const me = testMe(role, { modules: [...modules] });
        const rows = [
          ...visibleSections(me).map((s) => ({ id: s.id, to: s.to })),
          ...commandsFor(role, modules).flatMap((c) => (c.to ? [{ id: c.id, to: c.to }] : [])),
        ];
        for (const row of rows) if (pageModule(row.to) === off) leaks.add(`${row.id} shows with ${off} off`);
      }
    }
    expect([...leaks].sort()).toEqual([]);
  });

  test("the source readers find real gates (so a broken reader cannot pass everything)", () => {
    expect(procedureActions("press.report")).toEqual(["reports.read"]);
    expect(procedureActions("store.balances")).toEqual(["store.txn", "masters.publish"]);
    expect(procedureActions("press.nope")).toBeNull();
    expect(routerModule("ageing")).toBe("ageing");
    expect(settingsTabs.get("devices")).toEqual(["users.manage"]);
    expect(reportCards.get("/reports/die-life")).toBe("dies");
    expect(routeTree("/casts/new").source).toContain('"cast.enter"');
    // The press role reads the press nav but not reports: it is the case B1 was about.
    expect(can(testMe("press"), "reports.read")).toBe(false);
    expect(pageModule("/store/issue")).toBe("store");
    expect(pageModule("/vendors")).toBe("purchase");
    expect(pageModule("/orders/plan")).toBe("orders");
    expect(pageModule("/casts/new")).toBe("foundry");
  });

  test("the gate reader resolves spread lists and never returns an empty gate (CodeRabbit)", () => {
    const src = [
      'const READERS = ["purchase.receipt", "reports.read"] as const;',
      "const reader = anyActionProcedure(...READERS);",
      'const writer = actionProcedure("purchase.receipt");',
      "const lost = anyActionProcedure(...MISSING);",
    ].join("\n");
    expect(gateOf(src, "reader.query(")).toEqual(["purchase.receipt", "reports.read"]);
    expect(gateOf(src, "anyActionProcedure(...READERS).query(")).toEqual(["purchase.receipt", "reports.read"]);
    expect(gateOf(src, "writer.mutation(")).toEqual(["purchase.receipt"]);
    expect(gateOf(src, 'actionProcedure("a.b").query(')).toEqual(["a.b"]);
    // Unresolvable: null, so the caller reports it, never [] (which would refuse every role silently).
    expect(gateOf(src, "lost.query(")).toBeNull();
    expect(gateOf(src, "anyActionProcedure(...MISSING).query(")).toBeNull();
    expect(gateOf(src, "protectedProcedure.query(")).toBeNull();
  });
});


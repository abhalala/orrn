/**
 * PROD-GATE (owner rule 2026-11-23): every XE module is opt-in. A plant whose list is empty, or names only
 * the ten standard modules, sees no XE nav entry, no XE masters row, no XE name in Settings > Modules,
 * no quality flag, no price sheet and no XE palette section. `auth.me` sends the EFFECTIVE list
 * (`effectiveModules`), so the screens are tested on what the server sends.
 */
import { describe, expect, test } from "bun:test";

import { COMPANY_MODULES, effectiveModules, isModuleOn, isOptInModule, STANDARD_MODULES } from "@orrn/domain";
import type { CompanyRole, Me } from "@orrn/server/lib/permissions";

import { masterEntries } from "../features/masters/masters-model";
import { showsPriceSheet } from "../features/pricing/line/breakup-rows";
import { moduleStates } from "../features/settings/model";
import { TENANT_MORE, TENANT_PRIMARY, visibleItems } from "./nav-items";
import { visibleSections } from "./palette/actions";

function me(role: CompanyRole, stored: string[]): Me {
  return {
    user: { id: "u1", name: "U", email: "u@orrn.local" },
    company: { id: "c1", name: "Co", slug: "co", status: "active", plan: null, role, modules: effectiveModules(stored) },
    isPlatformAdmin: false,
    platformRole: null,
  } as Me;
}

const ALL_NAV = [...TENANT_PRIMARY, ...TENANT_MORE];
/** Nav entries that belong to an XE module (all of them carry `module`). */
const XE_NAV = ALL_NAV.filter((i) => i.module && isOptInModule(i.module)).map((i) => i.key);
const XE_MASTERS = ["plantLists", "bank", "rules", "documents", "tooling"];
const VARIANTS = [
  { name: "empty list", stored: [] as string[] },
  { name: "standard modules only", stored: [...STANDARD_MODULES] as string[] },
];

describe("XE nav entries are all module-gated", () => {
  test("the XE entries of the menu each name an opt-in module", () => {
    expect([...XE_NAV].sort()).toEqual(["billing", "complaints", "owner", "pricing", "qa", "storeBuying"]);
  });
});

describe.each(VARIANTS)("a plant with $name", ({ stored }) => {
  const roles: CompanyRole[] = ["owner", "admin", "manager", "office", "supervisor", "packer", "accountant"];

  test("no XE nav entry for any role", () => {
    for (const role of roles) {
      const keys = visibleItems(ALL_NAV, me(role, stored)).map((i) => i.key);
      expect({ role, xe: keys.filter((k) => XE_NAV.includes(k)) }).toEqual({ role, xe: [] });
    }
  });

  test("no XE row on the Masters hub", () => {
    for (const role of roles) {
      const keys = masterEntries(me(role, stored)).map((e) => e.key);
      expect({ role, xe: keys.filter((k) => XE_MASTERS.includes(k)) }).toEqual({ role, xe: [] });
    }
  });

  test("Settings > Modules names only the standard modules", () => {
    expect(moduleStates(effectiveModules(stored)).map((s) => s.id)).toEqual([...STANDARD_MODULES]);
    expect(moduleStates(stored).every((s) => s.on)).toBe(true);
  });

  test("quality flags, the price sheet, the office registers and the plant masters stay off", () => {
    const eff = effectiveModules(stored);
    for (const m of COMPANY_MODULES) expect({ m, on: isModuleOn(eff, m) }).toEqual({ m, on: !isOptInModule(m) });
    const breakup = { finalPaisePerKg: 1 } as never;
    expect(showsPriceSheet(breakup, eff)).toBe(false);
  });

  test("the palette offers no section of an XE page", () => {
    const sections = visibleSections(me("owner", stored)).map((s) => s.parentKey);
    expect(sections.filter((k) => XE_NAV.includes(k))).toEqual([]);
  });
});

describe("with every XE key named (the dev demo plant)", () => {
  test("the XE entries come back for the owner", () => {
    const owner = me("owner", [...COMPANY_MODULES]);
    const nav = visibleItems(ALL_NAV, owner).map((i) => i.key);
    for (const k of XE_NAV) expect(nav).toContain(k);
    const masters = masterEntries(owner).map((e) => e.key);
    for (const k of XE_MASTERS) expect(masters).toContain(k);
    expect(moduleStates([...COMPANY_MODULES]).map((s) => s.id)).toEqual([...COMPANY_MODULES]);
  });
});

import { describe, expect, test } from "bun:test";

import { en } from "@orrn/i18n/en";
import { hi } from "@orrn/i18n/hi";
import { canBeCustomBase, NEVER_GRANTABLE_ACTIONS, ROLE_TOGGLE_ACTIONS } from "@orrn/server/lib/permissions";

import {
  actionWordKey,
  areaKey,
  changesAgainstBase,
  choiceValue,
  copyableRoles,
  currentChoice,
  draftChanged,
  draftErrors,
  draftFromBase,
  draftFromRole,
  flip,
  groupActions,
  lackingActions,
  memberCustomRole,
  parseChoice,
  ROLE_AREAS,
  roleWithinMine,
  saveCall,
  switchView,
} from "./roles-model";

const get = (dict: unknown, key: string) => key.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], dict);

describe("role areas", () => {
  test("every switchable action sits in exactly one area, and no area lists an action that cannot be switched", () => {
    const listed = ROLE_AREAS.flatMap((a) => a.actions);
    expect(new Set(listed).size).toBe(listed.length);
    expect([...ROLE_TOGGLE_ACTIONS].filter((a) => !listed.includes(a))).toEqual([]);
    expect(listed.filter((a) => !(ROLE_TOGGLE_ACTIONS as readonly string[]).includes(a))).toEqual([]);
    for (const never of NEVER_GRANTABLE_ACTIONS) expect(listed).not.toContain(never);
  });

  test("every action and area has plain words in English and Hindi", () => {
    for (const action of ROLE_TOGGLE_ACTIONS) {
      const key = actionWordKey(action);
      expect({ key, en: typeof get(en, key) }).toEqual({ key, en: "string" });
      expect({ key, hi: typeof get(hi, key) }).toEqual({ key, hi: "string" });
    }
    for (const area of ROLE_AREAS) {
      expect(typeof get(en, areaKey(area.id))).toBe("string");
      expect(typeof get(hi, areaKey(area.id))).toBe("string");
    }
  });

  test("grouping keeps screen order, drops empty areas and parks an unknown action in people", () => {
    const groups = groupActions(["order.manage", "bundle.pack", "audit.read", "brand.new"]);
    expect(groups.map((g) => g.id)).toEqual(["packing", "orders", "people"]);
    expect(groups.find((g) => g.id === "people")!.actions).toEqual(["audit.read", "brand.new"]);
    expect(groupActions([...ROLE_TOGGLE_ACTIONS]).flatMap((g) => g.actions).length).toBe(ROLE_TOGGLE_ACTIONS.length);
  });
});

describe("switches", () => {
  const base = ["bundle.pack", "stock.move"];
  test("a switch shows on, in the base and changed", () => {
    expect(switchView("bundle.pack", base, base, base)).toMatchObject({ on: true, inBase: true, changed: false, disabled: false });
    expect(switchView("bundle.pack", ["stock.move"], base, base)).toMatchObject({ on: false, inBase: true, changed: true });
    expect(switchView("order.manage", [...base, "order.manage"], base, [...base, "order.manage"])).toMatchObject({ on: true, inBase: false, changed: true });
  });

  test("an action the person lacks cannot be switched on, but one that is on can be switched off", () => {
    const mine = ["bundle.pack"];
    expect(switchView("order.manage", base, base, mine)).toMatchObject({ on: false, disabled: true, reason: "cannotGive" });
    expect(switchView("stock.move", base, base, mine)).toMatchObject({ on: true, disabled: false, reason: null });
    expect(lackingActions(base, mine)).toEqual(["stock.move"]);
  });

  test("changes against the base are the server's on and off lists", () => {
    const toggles = ["bundle.pack", "stock.move", "order.manage", "order.plan"];
    expect(changesAgainstBase(["bundle.pack", "order.manage"], base, toggles)).toEqual({ on: ["order.manage"], off: ["stock.move"] });
    expect(changesAgainstBase(base, base, toggles)).toEqual({ on: [], off: [] });
    expect(flip(["a", "b"], "a")).toEqual(["b"]);
    expect(flip(["a"], "b")).toEqual(["a", "b"]);
  });
});

describe("the form", () => {
  const fixed = { manager: ["order.manage", "stock.move"] };
  test("a new draft copies the base role's actions; an edit starts from the role", () => {
    expect(draftFromBase("manager", fixed)).toEqual({ name: "", baseRole: "manager", enabled: ["order.manage", "stock.move"] });
    expect(draftFromRole({ name: "Night", baseRole: "manager", actions: ["order.manage"] })).toEqual({ name: "Night", baseRole: "manager", enabled: ["order.manage"] });
  });

  test("the name is required and at most 40 characters; actions the person lacks block the save", () => {
    const ok = { name: "Night", baseRole: "manager", enabled: ["order.manage"] };
    expect(draftErrors(ok, ["order.manage"])).toEqual([]);
    expect(draftErrors({ ...ok, name: "  " }, ["order.manage"])).toEqual(["nameRequired"]);
    expect(draftErrors({ ...ok, name: "x".repeat(41) }, ["order.manage"])).toEqual(["tooLong"]);
    expect(draftErrors(ok, [])).toEqual(["cannotGive"]);
  });

  test("changed compares the name and the set, not the order", () => {
    const saved = { name: "Night", baseRole: "manager", enabled: ["a", "b"] };
    expect(draftChanged({ ...saved, enabled: ["b", "a"] }, saved)).toBe(false);
    expect(draftChanged({ ...saved, name: " Night " }, saved)).toBe(false);
    expect(draftChanged({ ...saved, enabled: ["a"] }, saved)).toBe(true);
  });

  test("the owner is never offered as a base, matching the server", () => {
    expect(copyableRoles(["owner", "admin", "viewer"])).toEqual(["admin", "viewer"]);
    expect(canBeCustomBase("owner")).toBe(false);
  });
});

describe("a member's role choice", () => {
  test("values round-trip and junk is refused", () => {
    expect(parseChoice(choiceValue({ kind: "fixed", role: "press" }))).toEqual({ kind: "fixed", role: "press" });
    expect(parseChoice(choiceValue({ kind: "custom", id: "r:1" }))).toEqual({ kind: "custom", id: "r:1" });
    expect(parseChoice("press")).toBeNull();
    expect(parseChoice("custom:")).toBeNull();
    expect(parseChoice("other:x")).toBeNull();
  });

  test("the calls: an own role assigns, a fixed role updates the role, back to the base only drops the own role", () => {
    const fixedPress = currentChoice("press", null);
    const ownPress = currentChoice("press", { id: "r1" });
    expect(saveCall(fixedPress, fixedPress, "press")).toBeNull();
    expect(saveCall({ kind: "custom", id: "r1" }, fixedPress, "press")).toEqual({ call: "assign", customRoleId: "r1" });
    expect(saveCall({ kind: "fixed", role: "manager" }, fixedPress, "press")).toEqual({ call: "updateRole", role: "manager" });
    expect(saveCall({ kind: "fixed", role: "press" }, ownPress, "press")).toEqual({ call: "assign", customRoleId: null });
    expect(saveCall({ kind: "fixed", role: "manager" }, ownPress, "press")).toEqual({ call: "updateRole", role: "manager" });
  });

  test("an own role is offered only when it holds nothing the person lacks", () => {
    expect(roleWithinMine({ actions: ["a"] }, ["a", "b"])).toBe(true);
    expect(roleWithinMine({ actions: ["a", "c"] }, ["a", "b"])).toBe(false);
  });

  test("a member's own role comes from the row, or from auth.me for the person's own row", () => {
    const me = { user: { id: "u1" }, company: { customRole: { id: "r9", name: "Mine" } } };
    expect(memberCustomRole({ userId: "u2", customRole: { id: "r1", name: "Night" } }, me)).toEqual({ id: "r1", name: "Night" });
    expect(memberCustomRole({ userId: "u1" }, me)).toEqual({ id: "r9", name: "Mine" });
    expect(memberCustomRole({ userId: "u2" }, me)).toBeNull();
    expect(memberCustomRole({}, undefined)).toBeNull();
  });
});

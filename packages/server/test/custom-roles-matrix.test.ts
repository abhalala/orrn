/**
 * XE PLATFORM row 79: with no custom role made, every member's rights are byte-for-byte the fixed role's.
 *
 * The fixture `fixtures/role-actions.ebe08f3d.json` is the role x action matrix dumped from origin/main ebe08f3d,
 * before custom roles existed. Comparing against the code's own `ROLE_ACTIONS` would prove nothing, so every check
 * here compares against that file:
 * - the pure rule (`effectiveActions` with no custom role, and with an empty one);
 * - the real request path (`resolveTenantContext` -> `ctx.actions`, which `actionProcedure` reads) and `auth.me`.
 * Actions added after ebe08f3d are listed with their holders; a later lane's new action is not this test's business.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createTestEnv, type CompanyRole, type TestEnv } from "./harness";
import { ACTIONS, can, ctxCan, effectiveActions, type Action } from "../src/lib/permissions";
import { resolveTenantContext } from "../src/lib/tenantContext";

const MATRIX = JSON.parse(readFileSync(join(import.meta.dir, "fixtures/role-actions.ebe08f3d.json"), "utf8")) as Record<CompanyRole, Action[]>;
const ROLES = Object.keys(MATRIX) as CompanyRole[];
const OLD_UNIVERSE = new Set<string>(Object.values(MATRIX).flat());
const TENANT_ACTIONS = ACTIONS.filter((a) => !a.startsWith("platform."));
/** Actions this lane added, with their holders (owner holds every tenant action). */
const NEW_HERE: Record<string, CompanyRole[]> = { "role.manage": ["owner", "admin"], "api.manage": ["owner", "admin"] };

let env: TestEnv;
beforeAll(async () => {
  env = await createTestEnv();
});
afterAll(async () => {
  await env.dispose();
});

describe("fixed roles unchanged (every action x role)", () => {
  test("the fixture covers all 13 roles", () => {
    expect(ROLES.length).toBe(13);
  });

  test("pure rule: effectiveActions(role) and an empty custom role equal the ebe08f3d matrix", () => {
    for (const role of ROLES) {
      const want = new Set(MATRIX[role]);
      const plain = effectiveActions(role);
      const empty = role === "owner" ? plain : effectiveActions(role, { baseRole: role, added: [], removed: [] });
      for (const action of TENANT_ACTIONS) {
        if (!OLD_UNIVERSE.has(action) && !(action in NEW_HERE)) continue;
        const expected = action in NEW_HERE ? NEW_HERE[action]!.includes(role) : want.has(action);
        expect({ role, action, held: plain.has(action) }).toEqual({ role, action, held: expected });
        expect({ role, action, held: empty.has(action) }).toEqual({ role, action, held: expected });
        // `can()` with no actions list (old clients) and with the list (auth.me) agree.
        const me = { company: { role }, isPlatformAdmin: false, platformRole: null };
        expect(can(me, action)).toBe(expected);
        expect(can({ ...me, company: { role, actions: [...plain] } }, action)).toBe(expected);
      }
    }
  });

  test("real path: the request context and auth.me of a member with no custom role hold exactly the fixed set", async () => {
    const { companyId, users } = await env.seedCompany();
    for (const role of ROLES) {
      const tenant = await resolveTenantContext(env.db, { userId: users[role].id });
      expect(tenant.role).toBe(role);
      expect(tenant.customRole).toBeNull();
      for (const action of TENANT_ACTIONS) {
        if (!OLD_UNIVERSE.has(action) && !(action in NEW_HERE)) continue;
        const expected = action in NEW_HERE ? NEW_HERE[action]!.includes(role) : MATRIX[role].includes(action);
        expect({ role, action, held: ctxCan(tenant, action) }).toEqual({ role, action, held: expected });
      }
      const me = await env.callerForUser(users[role].id).auth.me();
      expect(me.company?.id).toBe(companyId);
      const list = new Set(me.company?.actions ?? []);
      for (const action of MATRIX[role]) expect({ role, action, sent: list.has(action) }).toEqual({ role, action, sent: true });
      for (const action of list) {
        if (OLD_UNIVERSE.has(action)) expect(MATRIX[role]).toContain(action as Action);
      }
    }
  });
});

describe("custom role changes (pure rule)", () => {
  test("legacy keys follow their plant key: an admin copy without users.manage loses member, settings and printer keys", () => {
    const set = effectiveActions("admin", { baseRole: "admin", added: [], removed: ["users.manage"] });
    for (const a of ["users.manage", "member.invite", "member.updateRole", "member.remove", "settings.update", "edge.manage", "spool.manage_printers"] as Action[]) {
      expect({ a, held: set.has(a) }).toEqual({ a, held: false });
    }
    // Kept: everything not reached through users.manage.
    expect(set.has("masters.publish")).toBe(true);
    expect(set.has("customer.create")).toBe(true);
  });

  test("switching a plant key on adds the legacy keys that follow it", () => {
    const set = effectiveActions("office", { baseRole: "office", added: ["users.manage"], removed: [] });
    for (const a of ["users.manage", "member.invite", "settings.update", "spool.manage_printers"] as Action[]) expect(set.has(a)).toBe(true);
    expect(effectiveActions("office").has("member.invite")).toBe(false);
  });

  test("a legacy key with another live source survives: packer without bundle.pack keeps spool.create_jobs through dispatch.scan", () => {
    const set = effectiveActions("packer", { baseRole: "packer", added: [], removed: ["bundle.pack"] });
    expect(set.has("bundle.pack")).toBe(false);
    expect(set.has("bundle.create")).toBe(false);
    expect(set.has("spool.create_jobs")).toBe(true);
  });

  test("never grantable: buddy.use, role.manage, api.manage and platform actions are ignored when added", () => {
    const set = effectiveActions("office", { baseRole: "office", added: ["buddy.use", "role.manage", "api.manage", "platform.impersonate"], removed: [] });
    for (const a of ["buddy.use", "role.manage", "api.manage", "platform.impersonate"]) expect(set.has(a as Action)).toBe(false);
  });

  test("a custom role whose base is not the member's role only removes (fail closed)", () => {
    const set = effectiveActions("viewer", { baseRole: "admin", added: ["users.manage"], removed: ["reports.read"] });
    expect(set.has("users.manage")).toBe(false);
    expect(set.has("reports.read")).toBe(false);
  });

  test("the owner is never changed by a custom role", () => {
    const owner = effectiveActions("owner");
    expect(effectiveActions("owner", { baseRole: "owner", added: [], removed: ["users.manage"] })).toBe(owner);
  });
});

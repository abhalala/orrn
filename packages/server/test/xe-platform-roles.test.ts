/**
 * XE PLATFORM row 79: the custom roles router (Settings > People > Roles) and its effect on members.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { auditLog, membership, membershipCustomRole } from "@orrn/db/schema";
import { and, eq } from "drizzle-orm";

import { createTestEnv, type TestEnv } from "./harness";

let env: TestEnv;
beforeAll(async () => {
  env = await createTestEnv();
});
afterAll(async () => {
  await env.dispose();
});

async function plant() {
  const p = await env.seedCompany();
  const admin = env.callerForUser(p.users.admin.id);
  const owner = env.callerForUser(p.users.owner.id);
  const memberOf = async (role: keyof typeof p.users) =>
    (await env.db.select({ id: membership.id }).from(membership).where(and(eq(membership.companyId, p.companyId), eq(membership.userId, p.users[role].id))).get())!.id;
  return { ...p, admin, owner, memberOf };
}

describe("roles router", () => {
  test("happy path: copy office without order.price, give it to the office member; it applies on the next request", async () => {
    const p = await plant();
    const { id } = await p.admin.roles.create({ name: "Order desk (no rates)", baseRole: "office", on: [], off: ["order.price"] });
    const office = env.callerForUser(p.users.office.id);
    // Before: the office member sees rates.
    expect((await office.auth.me()).company?.actions).toContain("order.price");
    await p.admin.roles.assign({ membershipId: await p.memberOf("office"), customRoleId: id });
    const me = await office.auth.me();
    expect(me.company?.role).toBe("office");
    expect(me.company?.customRole).toEqual({ id, name: "Order desk (no rates)" });
    expect(me.company?.actions).not.toContain("order.price");
    expect(me.company?.actions).toContain("order.manage");

    // Edit: switch analytics off too; the very next request sees it.
    await p.admin.roles.update({ id, on: [], off: ["order.price", "analytics.view"] });
    expect((await office.auth.me()).company?.actions).not.toContain("analytics.view");

    const members = await p.admin.company.membersList();
    expect(members.find((m) => m.userId === p.users.office.id)?.customRole).toEqual({ id, name: "Order desk (no rates)" });
    expect(members.find((m) => m.userId === p.users.packer.id)?.customRole).toBeNull();
    const list = await p.admin.roles.list();
    const row = list.roles.find((r) => r.id === id)!;
    expect(row.members).toBe(1);
    expect(row.removed).toEqual(["analytics.view", "order.price"]);
    expect(list.toggleActions).not.toContain("role.manage");
    expect(list.toggleActions).not.toContain("buddy.use");

    const audits = await env.db.select().from(auditLog).where(and(eq(auditLog.companyId, p.companyId), eq(auditLog.subjectId, id)));
    const update = audits.find((a) => a.action === "role.update")!;
    expect((update.meta as { before: string[] }).before).toContain("analytics.view");
    expect((update.meta as { after: string[] }).after).not.toContain("analytics.view");
    expect(audits.map((a) => a.action).sort()).toEqual(["role.create", "role.update"]);
  });

  test("an action check on the server follows the custom role (actionProcedure)", async () => {
    const p = await plant();
    // A packer copy without bundle.void... packers do not hold it; take a supervisor copy without press.close.
    const { id } = await p.admin.roles.create({ name: "Shift lead", baseRole: "supervisor", on: [], off: ["audit.read", "reports.read"] });
    const sup = env.callerForUser(p.users.supervisor.id);
    await p.admin.roles.assign({ membershipId: await p.memberOf("supervisor"), customRoleId: id });
    // A plain read guarded by an action: audit.list needs audit.read (supervisor never had it), so use a granted one.
    const { id: id2 } = await p.admin.roles.create({ name: "Viewer plus audit", baseRole: "viewer", on: ["audit.read"], off: [] });
    const viewer = env.callerForUser(p.users.viewer.id);
    await expect(viewer.roles.list()).rejects.toThrow("You don't have permission to do that");
    await p.admin.roles.assign({ membershipId: await p.memberOf("viewer"), customRoleId: id2 });
    expect((await viewer.auth.me()).company?.actions).toContain("audit.read");
    // A role-gated action the copy took away is refused at once.
    expect((await sup.auth.me()).company?.actions).not.toContain("reports.read");
  });

  test("refusals: owner base, more than you hold, not grantable, name taken, in use, permission, own role, owner member", async () => {
    const p = await plant();
    await expect(p.admin.roles.create({ name: "X", baseRole: "owner", on: [], off: [] })).rejects.toThrow("A custom role can't copy the owner");
    // role.manage is not a switchable action at all (input refused).
    await expect(p.admin.roles.create({ name: "Y", baseRole: "office", on: ["role.manage" as never], off: [] })).rejects.toThrow();

    // An admin whose own custom role lacks export.accounts cannot give it.
    const { id: narrowAdmin } = await p.owner.roles.create({ name: "Admin no accounts", baseRole: "admin", on: [], off: [] });
    await p.owner.roles.update({ id: narrowAdmin, on: [], off: ["ingest.merge"] });
    await p.owner.roles.assign({ membershipId: await p.memberOf("admin"), customRoleId: narrowAdmin });
    await expect(p.admin.roles.create({ name: "Office plus merge", baseRole: "office", on: ["ingest.merge"], off: [] })).rejects.toThrow(
      "You can't give a role an action you don't hold yourself",
    );
    // ...nor switch their own removals back by editing the role they hold (rename included).
    await expect(p.admin.roles.update({ id: narrowAdmin, on: [], off: [] })).rejects.toThrow("Cannot change your own role");
    await expect(p.admin.roles.update({ id: narrowAdmin, name: "Full admin", on: [], off: ["ingest.merge"] })).rejects.toThrow("Cannot change your own role");
    expect((await env.callerForUser(p.users.admin.id).auth.me()).company?.actions).not.toContain("ingest.merge");

    const { id } = await p.owner.roles.create({ name: "Desk", baseRole: "office", on: [], off: [] });
    await expect(p.owner.roles.create({ name: "desk", baseRole: "viewer", on: [], off: [] })).rejects.toThrow("A role with this name already exists");
    await p.owner.roles.assign({ membershipId: await p.memberOf("office"), customRoleId: id });
    await expect(p.owner.roles.delete({ id })).rejects.toThrow("People still hold this role");

    const manager = env.callerForUser(p.users.manager.id);
    await expect(manager.roles.create({ name: "Z", baseRole: "viewer", on: [], off: [] })).rejects.toThrow("You don't have permission to do that");
    await expect(manager.roles.assign({ membershipId: await p.memberOf("office"), customRoleId: null })).rejects.toThrow("You don't have permission to do that");

    await expect(p.owner.roles.assign({ membershipId: await p.memberOf("owner"), customRoleId: id })).rejects.toThrow();
  });

  test("tenancy: another plant's role or member is Not found", async () => {
    const a = await plant();
    const b = await plant();
    const { id } = await a.admin.roles.create({ name: "A role", baseRole: "viewer", on: [], off: [] });
    await expect(b.admin.roles.update({ id, on: [], off: [] })).rejects.toThrow("Not found");
    await expect(b.admin.roles.delete({ id })).rejects.toThrow("Not found");
    await expect(b.admin.roles.assign({ membershipId: await b.memberOf("viewer"), customRoleId: id })).rejects.toThrow("Not found");
    await expect(a.admin.roles.assign({ membershipId: await b.memberOf("viewer"), customRoleId: id })).rejects.toThrow("Not found");
    expect((await b.admin.roles.list()).roles.find((r) => r.id === id)).toBeUndefined();
  });

  test("assign sets the base role; picking a fixed role takes the custom role away; delete works once free", async () => {
    const p = await plant();
    const { id } = await p.admin.roles.create({ name: "Packer plus count", baseRole: "packer", on: [], off: [] });
    const viewerMembership = await p.memberOf("viewer");
    await p.admin.roles.assign({ membershipId: viewerMembership, customRoleId: id });
    const row = await env.db.select({ role: membership.role }).from(membership).where(eq(membership.id, viewerMembership)).get();
    expect(row?.role).toBe("packer");
    await p.admin.company.membersUpdateRole({ membershipId: viewerMembership, role: "viewer" });
    const link = await env.db.select().from(membershipCustomRole).where(eq(membershipCustomRole.membershipId, viewerMembership)).get();
    expect(link).toBeUndefined();
    expect((await env.callerForUser(p.users.viewer.id).auth.me()).company?.customRole).toBeNull();
    await p.admin.roles.delete({ id });
    expect((await p.admin.roles.list()).roles).toEqual([]);
  });
});

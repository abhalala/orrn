/**
 * XE PLATFORM row 79: custom roles (Settings > People > Roles).
 *
 * A custom role copies one fixed role (never the owner), keeps it as its BASE for life, and switches plant actions
 * on or off. A member who holds one keeps `membership.role` = the base, so approver rules, the Today layout and
 * stations are unchanged; every action check reads `effectiveActions` (`lib/permissions.ts`) through `ctx.actions`.
 *
 * Rules (lane brief):
 * - Never grantable: platform actions, the owner's own actions, `role.manage`, `api.manage` (`NEVER_GRANTABLE_ACTIONS`).
 * - The role cannot hold more than the person making, editing or assigning it holds (their own effective set).
 * - An edit applies on each holder's next request: the set is read fresh per request, nothing is cached in a session.
 * - Every change writes an audit row with the action lists before and after.
 */
import { TRPCError } from "@trpc/server";
import { abortBatchUnless, atomicBatch, isBatchAbort } from "@orrn/db/atomic";
import { customRole, membership, membershipCustomRole, user } from "@orrn/db/schema";
import { companyRoles, type CompanyRole } from "@orrn/db/schema/tenant";
import { and, asc, count, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { actionProcedure, anyActionProcedure, router } from "../index";
import { auditInsert } from "../lib/audit";
import { buddyRevokeStatements } from "@orrn/auth/buddy-revoke";
import { createId } from "../lib/id";
import { now } from "../lib/clock";
import {
  actionList,
  canBeCustomBase,
  ctxActions,
  effectiveActions,
  fixedRoleActions,
  ROLE_TOGGLE_ACTIONS,
  type Action,
  type CustomRoleGrant,
} from "../lib/permissions";

export const ROLE_NAME_MAX = 40;
export const ROLE_REFUSALS = {
  notFound: "Not found",
  ownerBase: "A custom role can't copy the owner",
  moreThanYou: "You can't give a role an action you don't hold yourself",
  nameTaken: "A role with this name already exists",
  inUse: "People still hold this role. Give them another role first",
  ownerMember: "The owner keeps the owner role",
  yourself: "Cannot change your own role",
} as const;

const toggle = z.enum(ROLE_TOGGLE_ACTIONS as unknown as [Action, ...Action[]]);
const actionsInput = z.array(toggle).max(ROLE_TOGGLE_ACTIONS.length);
const nameInput = z.string().trim().min(1).max(ROLE_NAME_MAX);

const notFound = (): never => {
  throw new TRPCError({ code: "NOT_FOUND", message: ROLE_REFUSALS.notFound });
};

/**
 * The stored change lists, normalised against the base: `added` only names actions the base lacks, `removed` only
 * actions it holds. So a role equal to its base stores two empty lists.
 */
export function normaliseChanges(baseRole: CompanyRole, on: readonly Action[], off: readonly Action[]): CustomRoleGrant {
  const base = fixedRoleActions(baseRole);
  const added = [...new Set(on)].filter((a) => !base.has(a) && !off.includes(a)).sort();
  const removed = [...new Set(off)].filter((a) => base.has(a)).sort();
  return { baseRole, added, removed };
}

/**
 * Refuses a role that switches ON an action the actor lacks (the actor's own effective set). The base role's own
 * actions are not checked: whoever may change roles may already give anyone that fixed role (`member.updateRole`),
 * and a plant admin lacks most floor actions (`order.manage`, `press.run`), so checking the whole set would stop them
 * copying any floor role. What a custom role adds is what this rule guards.
 */
function assertWithinActor(actor: ReadonlySet<Action>, grant: CustomRoleGrant): void {
  for (const a of grant.added) {
    if (!actor.has(a as Action)) throw new TRPCError({ code: "FORBIDDEN", message: ROLE_REFUSALS.moreThanYou });
  }
}

function isUniqueViolation(e: unknown): boolean {
  for (let cur: unknown = e, depth = 0; cur && depth < 6; depth += 1) {
    if (/UNIQUE constraint failed/.test(cur instanceof Error ? cur.message : String(cur))) return true;
    cur = (cur as { cause?: unknown }).cause;
  }
  return false;
}

async function loadRole(db: Parameters<typeof atomicBatch>[0], companyId: string, id: string) {
  return db
    .select()
    .from(customRole)
    .where(and(eq(customRole.id, id), eq(customRole.companyId, companyId)))
    .get();
}

export const rolesRouter = router({
  /**
   * The plant's custom roles, with each one's effective actions and how many people hold it, and the catalogue the
   * screen needs: the actions a role may switch, and each fixed role's own set. Read by whoever manages roles or people.
   */
  list: anyActionProcedure("role.manage", "users.manage").query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({
        id: customRole.id,
        name: customRole.name,
        baseRole: customRole.baseRole,
        added: customRole.added,
        removed: customRole.removed,
        updatedAt: customRole.updatedAt,
      })
      .from(customRole)
      .where(eq(customRole.companyId, ctx.companyId))
      .orderBy(asc(customRole.nameKey))
      .limit(200);
    const held = await ctx.db
      .select({ id: membershipCustomRole.customRoleId, n: count() })
      .from(membershipCustomRole)
      .where(eq(membershipCustomRole.companyId, ctx.companyId))
      .groupBy(membershipCustomRole.customRoleId);
    const heldBy = new Map(held.map((h) => [h.id, Number(h.n)]));
    const fixed = Object.fromEntries(
      companyRoles.filter(canBeCustomBase).map((r) => [r, actionList(fixedRoleActions(r)).filter((a) => ROLE_TOGGLE_ACTIONS.includes(a))]),
    ) as Record<Exclude<CompanyRole, "owner">, Action[]>;
    return {
      roles: rows.map((r) => {
        const grant = { baseRole: r.baseRole, added: r.added ?? [], removed: r.removed ?? [] };
        return {
          id: r.id,
          name: r.name,
          baseRole: r.baseRole,
          added: grant.added,
          removed: grant.removed,
          actions: actionList(effectiveActions(r.baseRole, grant)).filter((a) => ROLE_TOGGLE_ACTIONS.includes(a)),
          members: heldBy.get(r.id) ?? 0,
          updatedAt: r.updatedAt,
        };
      }),
      toggleActions: [...ROLE_TOGGLE_ACTIONS],
      fixed,
      /** The caller's own set: the screen greys out what they can't give. */
      mine: actionList(ctxActions(ctx)).filter((a) => ROLE_TOGGLE_ACTIONS.includes(a)),
    };
  }),

  /** Copy a fixed role and switch actions on (`on`) or off (`off`). */
  create: actionProcedure("role.manage")
    .input(z.object({ name: nameInput, baseRole: z.enum(companyRoles), on: actionsInput.default([]), off: actionsInput.default([]) }))
    .mutation(async ({ ctx, input }) => {
      if (!canBeCustomBase(input.baseRole)) throw new TRPCError({ code: "BAD_REQUEST", message: ROLE_REFUSALS.ownerBase });
      const grant = normaliseChanges(input.baseRole, input.on, input.off);
      assertWithinActor(ctxActions(ctx), grant);
      const id = createId();
      const after = actionList(effectiveActions(grant.baseRole, grant));
      try {
        await atomicBatch(ctx.db, [
          ctx.db.insert(customRole).values({
            id,
            companyId: ctx.companyId,
            name: input.name,
            nameKey: input.name.toLowerCase(),
            baseRole: grant.baseRole,
            added: [...grant.added],
            removed: [...grant.removed],
            createdBy: ctx.session.user.id,
          }),
          auditInsert(ctx, {
            action: "role.create",
            subjectType: "custom_role",
            subjectId: id,
            meta: { name: input.name, baseRole: grant.baseRole, before: actionList(fixedRoleActions(grant.baseRole)), after },
          }),
        ]);
      } catch (e) {
        if (isUniqueViolation(e)) throw new TRPCError({ code: "CONFLICT", message: ROLE_REFUSALS.nameTaken });
        throw e;
      }
      return { id };
    }),

  /** Rename a role or change its switches. The base never changes. Holders get the new set on their next request. */
  update: actionProcedure("role.manage")
    .input(z.object({ id: z.string().min(1).max(64), name: nameInput.optional(), on: actionsInput, off: actionsInput }))
    .mutation(async ({ ctx, input }) => {
      const row = (await loadRole(ctx.db, ctx.companyId, input.id)) ?? notFound();
      // Nobody edits the role they hold: an admin narrowed by the owner would otherwise switch their own removals
      // back (removals are not checked against the actor). The owner never holds a custom role.
      if (ctx.customRole?.id === row.id) throw new TRPCError({ code: "FORBIDDEN", message: ROLE_REFUSALS.yourself });
      const grant = normaliseChanges(row.baseRole, input.on, input.off);
      assertWithinActor(ctxActions(ctx), grant);
      const before = actionList(effectiveActions(row.baseRole, { baseRole: row.baseRole, added: row.added ?? [], removed: row.removed ?? [] }));
      const after = actionList(effectiveActions(grant.baseRole, grant));
      const name = input.name ?? row.name;
      try {
        await atomicBatch(ctx.db, [
          ctx.db
            .update(customRole)
            .set({ name, nameKey: name.toLowerCase(), added: [...grant.added], removed: [...grant.removed], updatedAt: now() })
            .where(and(eq(customRole.id, row.id), eq(customRole.companyId, ctx.companyId))),
          abortBatchUnless(ctx.db, sql`changes() > 0`),
          auditInsert(ctx, {
            action: "role.update",
            subjectType: "custom_role",
            subjectId: row.id,
            meta: { name, ...(name !== row.name ? { from: row.name } : {}), baseRole: row.baseRole, before, after },
          }),
        ]);
      } catch (e) {
        if (isUniqueViolation(e)) throw new TRPCError({ code: "CONFLICT", message: ROLE_REFUSALS.nameTaken });
        if (isBatchAbort(e)) notFound();
        throw e;
      }
      return { id: row.id };
    }),

  /** Delete a role nobody holds. */
  delete: actionProcedure("role.manage")
    .input(z.object({ id: z.string().min(1).max(64) }))
    .mutation(async ({ ctx, input }) => {
      const row = (await loadRole(ctx.db, ctx.companyId, input.id)) ?? notFound();
      const before = actionList(effectiveActions(row.baseRole, { baseRole: row.baseRole, added: row.added ?? [], removed: row.removed ?? [] }));
      try {
        await atomicBatch(ctx.db, [
          // The guard lives in the statement: an assignment that lands between the read and this batch keeps the role.
          ctx.db
            .delete(customRole)
            .where(
              and(
                eq(customRole.id, row.id),
                eq(customRole.companyId, ctx.companyId),
                sql`not exists (select 1 from ${membershipCustomRole} where ${membershipCustomRole.customRoleId} = ${row.id})`,
              ),
            ),
          abortBatchUnless(ctx.db, sql`changes() > 0`),
          auditInsert(ctx, {
            action: "role.delete",
            subjectType: "custom_role",
            subjectId: row.id,
            meta: { name: row.name, baseRole: row.baseRole, before, after: [] },
          }),
        ]);
      } catch (e) {
        if (isBatchAbort(e) || /FOREIGN KEY constraint failed/.test(String((e as Error)?.message ?? e))) {
          const still = await loadRole(ctx.db, ctx.companyId, input.id);
          if (!still) notFound();
          throw new TRPCError({ code: "CONFLICT", message: ROLE_REFUSALS.inUse });
        }
        throw e;
      }
      return { id: row.id };
    }),

  /**
   * Give a member a custom role in place of their fixed one (`customRoleId`), or take it away (null: they keep the
   * fixed role, which is the base). The member's `membership.role` becomes the base in the same batch.
   */
  assign: actionProcedure("member.updateRole")
    .input(z.object({ membershipId: z.string().min(1).max(64), customRoleId: z.string().min(1).max(64).nullable() }))
    .mutation(async ({ ctx, input }) => {
      const target = await ctx.db
        .select({ id: membership.id, userId: membership.userId, role: membership.role, userName: user.name })
        .from(membership)
        .innerJoin(user, eq(user.id, membership.userId))
        .where(and(eq(membership.id, input.membershipId), eq(membership.companyId, ctx.companyId)))
        .get();
      if (!target) notFound();
      const member = target!;
      if (member.userId === ctx.session.user.id) throw new TRPCError({ code: "BAD_REQUEST", message: ROLE_REFUSALS.yourself });
      if (member.role === "owner") throw new TRPCError({ code: "FORBIDDEN", message: ROLE_REFUSALS.ownerMember });

      const current = await ctx.db
        .select({ id: customRole.id, name: customRole.name, baseRole: customRole.baseRole, added: customRole.added, removed: customRole.removed })
        .from(membershipCustomRole)
        .innerJoin(customRole, eq(customRole.id, membershipCustomRole.customRoleId))
        .where(and(eq(membershipCustomRole.membershipId, member.id), eq(membershipCustomRole.companyId, ctx.companyId)))
        .get();
      const beforeGrant = current ? { baseRole: current.baseRole, added: current.added ?? [], removed: current.removed ?? [] } : null;
      const before = actionList(effectiveActions(member.role, beforeGrant));

      const at = now();
      if (input.customRoleId === null) {
        if (!current) return { membershipId: member.id, customRoleId: null };
        await atomicBatch(ctx.db, [
          ctx.db
            .delete(membershipCustomRole)
            .where(and(eq(membershipCustomRole.membershipId, member.id), eq(membershipCustomRole.companyId, ctx.companyId))),
          auditInsert(ctx, {
            action: "member.customRole",
            subjectType: "membership",
            subjectId: member.id,
            meta: { userId: member.userId, from: current.name, to: null, role: member.role, before, after: actionList(effectiveActions(member.role)) },
          }),
        ]);
        return { membershipId: member.id, customRoleId: null };
      }

      const role = (await loadRole(ctx.db, ctx.companyId, input.customRoleId)) ?? notFound();
      const grant = { baseRole: role.baseRole, added: role.added ?? [], removed: role.removed ?? [] };
      assertWithinActor(ctxActions(ctx), grant);
      if (!canBeCustomBase(role.baseRole)) throw new TRPCError({ code: "BAD_REQUEST", message: ROLE_REFUSALS.ownerBase });
      const after = actionList(effectiveActions(role.baseRole, grant));
      try {
        await atomicBatch(ctx.db, [
          // The role must still exist with the same base; the membership must still be this plant's and not an owner's.
          ctx.db
            .update(membership)
            .set({ role: role.baseRole })
            .where(
              and(
                eq(membership.id, member.id),
                eq(membership.companyId, ctx.companyId),
                sql`${membership.role} <> 'owner'`,
                sql`exists (select 1 from ${customRole} where ${customRole.id} = ${role.id} and ${customRole.companyId} = ${ctx.companyId} and ${customRole.baseRole} = ${role.baseRole})`,
              ),
            ),
          abortBatchUnless(ctx.db, sql`changes() > 0`),
          // orrn buddy (security M4): any role change ends the person's buddy grants in this plant.
          ...(member.role === role.baseRole
            ? []
            : buddyRevokeStatements(ctx.db, { userId: member.userId, companyId: ctx.companyId }, "role_changed", at)),
          ctx.db
            .insert(membershipCustomRole)
            .values({ membershipId: member.id, companyId: ctx.companyId, customRoleId: role.id, assignedBy: ctx.session.user.id, assignedAt: at })
            .onConflictDoUpdate({
              target: membershipCustomRole.membershipId,
              set: { customRoleId: role.id, assignedBy: ctx.session.user.id, assignedAt: at },
            }),
          auditInsert(ctx, {
            action: "member.customRole",
            subjectType: "membership",
            subjectId: member.id,
            meta: {
              userId: member.userId,
              from: current?.name ?? null,
              to: role.name,
              role: role.baseRole,
              ...(member.role !== role.baseRole ? { fromRole: member.role } : {}),
              before,
              after,
            },
          }),
        ]);
      } catch (e) {
        if (isBatchAbort(e)) notFound();
        throw e;
      }
      return { membershipId: member.id, customRoleId: role.id };
    }),
});

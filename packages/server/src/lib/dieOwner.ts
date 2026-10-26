/**
 * The die ownership gate (FP-DR-13, C2): one helper for plan, press, pack and dispatch. A section
 * (`die.owner_customer_id`) or a copy (`die_instance.owner_customer_id`, which wins) may belong to
 * a customer; their dies only make their material unless an approved `die_owner_override` for
 * this copy and this customer is live (`meta.closedAt` unset). The rules are pure in
 * `@orrn/domain` (`decideDieOwner`); this file reads the rows, always scoped by company.
 *
 * - `checkDieAllowed` returns the decision (screens show the chip and the request button).
 * - `assertDieAllowed` throws the TRPCError the procedures surface:
 *   BAD_REQUEST "Pick the die copy" / "This section has no copies", FORBIDDEN "This die belongs to {name}".
 */
import { decideDieOwner, type DieOwnerDecision, type DieOwnerOverridePurpose } from "@orrn/domain";
import { approval } from "@orrn/db/schema/approval";
import { die } from "@orrn/db/schema/catalog";
import { customer } from "@orrn/db/schema/customers";
import { dieInstance } from "@orrn/db/schema/dies";
import { TRPCError } from "@trpc/server";
import { and, eq, ne, sql } from "drizzle-orm";

import type { OrrnDb } from "./atomic";
import { TRPCMetaError } from "./errorMeta";

async function copyCode(db: OrrnDb, companyId: string, id: string | null): Promise<string | null> {
  if (!id) return null;
  const [row] = await db
    .select({ code: dieInstance.code })
    .from(dieInstance)
    .where(and(eq(dieInstance.id, id), eq(dieInstance.companyId, companyId)))
    .limit(1);
  return row?.code ?? null;
}

export type DieOwnerInput = {
  /** The section (catalogue die). Optional when `dieInstanceId` is given; must match it when both are. */
  dieId?: string | null;
  /** The copy in use; required whenever the section or any copy is owned. */
  dieInstanceId?: string | null;
  /** The customer the material is for; null = plant stock (never passes an owned die). */
  customerId: string | null;
  /** Where the check runs; recorded on an override request and in the audit. */
  purpose: DieOwnerOverridePurpose;
  /** Restrict the live grant to this approval (e.g. the one the screen just got approved). */
  approvalId?: string | null;
};

export type DieOwnerCheck = DieOwnerDecision & {
  sectionId: string;
  dieInstanceId: string | null;
  ownerName: string | null;
  /** The approval that let it through, when `viaGrant`. */
  grantId: string | null;
};

/** Read the rows and decide. Throws NOT_FOUND for a die or copy outside the company. */
export async function checkDieAllowed(db: OrrnDb, companyId: string, input: DieOwnerInput): Promise<DieOwnerCheck> {
  let sectionId = input.dieId ?? null;
  let copy: { id: string; sectionId: string; ownerCustomerId: string | null } | null = null;

  if (input.dieInstanceId) {
    const [row] = await db
      .select({ id: dieInstance.id, sectionId: dieInstance.sectionId, ownerCustomerId: dieInstance.ownerCustomerId })
      .from(dieInstance)
      .where(and(eq(dieInstance.id, input.dieInstanceId), eq(dieInstance.companyId, companyId)))
      .limit(1);
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Die copy not found" });
    if (sectionId && sectionId !== row.sectionId) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "This copy is not of that die" });
    }
    copy = row;
    sectionId = row.sectionId;
  }
  if (!sectionId) throw new TRPCError({ code: "BAD_REQUEST", message: "Pick the die" });

  const [section] = await db
    .select({ ownerCustomerId: die.ownerCustomerId })
    .from(die)
    .where(and(eq(die.id, sectionId), eq(die.companyId, companyId)))
    .limit(1);
  if (!section) throw new TRPCError({ code: "NOT_FOUND", message: "Die not found" });

  let sectionCopyCount = 0;
  let anyCopyOwned = false;
  if (!copy) {
    const [counts] = await db
      .select({
        copies: sql<number>`count(*)`,
        owned: sql<number>`coalesce(sum(case when ${dieInstance.ownerCustomerId} is not null then 1 else 0 end), 0)`,
      })
      .from(dieInstance)
      .where(and(eq(dieInstance.companyId, companyId), eq(dieInstance.sectionId, sectionId), ne(dieInstance.status, "retired")));
    sectionCopyCount = Number(counts?.copies ?? 0);
    anyCopyOwned = Number(counts?.owned ?? 0) > 0;
  }

  let grantId: string | null = null;
  const owner = copy ? (copy.ownerCustomerId ?? section.ownerCustomerId) : null;
  if (copy && owner !== null && owner !== input.customerId && input.customerId !== null) {
    const conditions = [
      eq(approval.companyId, companyId),
      eq(approval.kind, "die_owner_override"),
      eq(approval.subjectId, copy.id),
      eq(approval.status, "approved"),
      sql`json_extract(${approval.meta}, '$.attemptedCustomerId') = ${input.customerId}`,
      sql`json_extract(${approval.meta}, '$.closedAt') is null`,
    ];
    if (input.approvalId) conditions.push(eq(approval.id, input.approvalId));
    const [grant] = await db.select({ id: approval.id }).from(approval).where(and(...conditions)).limit(1);
    grantId = grant?.id ?? null;
  }

  const decision = decideDieOwner({
    sectionOwnerId: section.ownerCustomerId,
    sectionCopyCount,
    anyCopyOwned,
    copy: copy ? { ownerCustomerId: copy.ownerCustomerId } : null,
    customerId: input.customerId,
    hasLiveGrant: grantId !== null,
  });

  let ownerName: string | null = null;
  if (decision.ownerCustomerId) {
    // A soft-deleted customer still owns its dies (C2), so no deleted_at filter here.
    const [c] = await db
      .select({ name: customer.name })
      .from(customer)
      .where(and(eq(customer.id, decision.ownerCustomerId), eq(customer.companyId, companyId)))
      .limit(1);
    ownerName = c?.name ?? null;
  }

  return {
    ...decision,
    sectionId,
    dieInstanceId: copy?.id ?? null,
    ownerName,
    grantId: decision.ok && decision.viaGrant ? grantId : null,
  };
}

/** `checkDieAllowed`, throwing when the die may not be used. Returns the check when it may. */
export async function assertDieAllowed(db: OrrnDb, companyId: string, input: DieOwnerInput): Promise<DieOwnerCheck> {
  const check = await checkDieAllowed(db, companyId, input);
  if (check.ok) return check;
  switch (check.block) {
    case "pick_copy":
      throw new TRPCError({ code: "BAD_REQUEST", message: "Pick the die copy" });
    case "no_copies":
      throw new TRPCError({ code: "BAD_REQUEST", message: "This section has no copies" });
    case "owned":
      // `meta` lets the screen offer "Ask for an exception" on the right copy (FP-DR-12).
      throw new TRPCMetaError({
        code: "FORBIDDEN",
        message: check.ownerName ? `This die belongs to ${check.ownerName}` : "This die belongs to another customer",
        meta: {
          ownerCustomerId: check.ownerCustomerId,
          ownerName: check.ownerName,
          dieInstanceId: check.dieInstanceId,
          code: await copyCode(db, companyId, check.dieInstanceId),
        },
      });
  }
}

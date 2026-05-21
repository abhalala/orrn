import { die } from "@orrn/db/schema/catalog";
import { customer } from "@orrn/db/schema/customers";
import { dispatch, dispatchItem } from "@orrn/db/schema/dispatch";
import { bundle, bundleGroup, bundleStatusEvent } from "@orrn/db/schema/inventory";
import { companySequence } from "@orrn/db/schema/sync";
import { company, membership } from "@orrn/db/schema/tenant";

import type { createDb } from "@orrn/db";

type Db = ReturnType<typeof createDb>;

const ids = {
  company: "dev-company-orrn",
  customer: "dev-customer-apex",
  dieRound: "dev-die-round-10",
  dieChannel: "dev-die-channel-22",
  group: "dev-bundle-group-001",
  dispatchDraft: "dev-dispatch-draft",
  dispatchReserved: "dev-dispatch-reserved",
  dispatchCompleted: "dev-dispatch-completed",
};

const bundleRows = [
  {
    id: "dev-bundle-available-001",
    serial: "BG-000001-B001",
    status: "available" as const,
    currentDispatchId: null,
    quantity: 24,
    weightG: 18400,
    lengthMm: 6100,
  },
  {
    id: "dev-bundle-available-002",
    serial: "BG-000001-B002",
    status: "available" as const,
    currentDispatchId: null,
    quantity: 18,
    weightG: 14200,
    lengthMm: 6100,
  },
  {
    id: "dev-bundle-reserved-001",
    serial: "BG-000001-B003",
    status: "reserved" as const,
    currentDispatchId: ids.dispatchReserved,
    quantity: 16,
    weightG: 13100,
    lengthMm: 5800,
  },
  {
    id: "dev-bundle-dispatched-001",
    serial: "BG-000001-B004",
    status: "dispatched" as const,
    currentDispatchId: ids.dispatchCompleted,
    quantity: 20,
    weightG: 16100,
    lengthMm: 6000,
  },
];

export async function seedDevData(db: Db, email: string) {
  const normalizedEmail = email.trim().toLowerCase();
  const existingUser = await db.query.user.findFirst({
    where: (fields, { eq }) => eq(fields.email, normalizedEmail),
  });

  if (!existingUser) {
    return {
      ok: false,
      status: 404,
      message:
        "Create a local account first, then seed with the same email. Default: owner@orrn.local / password of your choice.",
    };
  }

  const now = new Date();
  const futureShipDate = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);

  await db.transaction(async (tx) => {
    await tx
      .insert(company)
      .values({
        id: ids.company,
        name: "ORRN Demo Manufacturing",
        slug: "orrn-demo",
        status: "active",
        plan: "dev",
      })
      .onConflictDoNothing();

    await tx
      .insert(membership)
      .values({
        id: `dev-membership-${existingUser.id}`,
        userId: existingUser.id,
        companyId: ids.company,
        role: "owner",
      })
      .onConflictDoNothing();

    await tx
      .insert(companySequence)
      .values({
        companyId: ids.company,
        value: 20,
      })
      .onConflictDoNothing();

    await tx
      .insert(customer)
      .values({
        id: ids.customer,
        companyId: ids.company,
        serverSeq: 1,
        name: "Apex Fabricators",
        phone: "+1 555 0100",
        email: "procurement@apex.example",
        notes: "Demo customer for local UI review.",
      })
      .onConflictDoNothing();

    await tx
      .insert(die)
      .values([
        {
          id: ids.dieRound,
          companyId: ids.company,
          serverSeq: 2,
          series: "AL",
          sectionCode: "ROUND-10",
          name: "10mm Round Bar",
          dimensions: { diameterMm: 10 },
          weightMinG: 100,
          weightMaxG: 25000,
          status: "active",
          notes: "Seeded active die.",
        },
        {
          id: ids.dieChannel,
          companyId: ids.company,
          serverSeq: 3,
          series: "AL",
          sectionCode: "CHAN-22",
          name: "22mm Channel",
          dimensions: { widthMm: 22, heightMm: 12 },
          weightMinG: 100,
          weightMaxG: 30000,
          status: "active",
          notes: "Seeded active die.",
        },
      ])
      .onConflictDoNothing();

    await tx
      .insert(bundleGroup)
      .values({
        id: ids.group,
        companyId: ids.company,
        serverSeq: 4,
        code: "BG-000001",
        dieId: ids.dieRound,
        unit: "pcs",
        purchaseOrderRef: "PO-DEMO-001",
        notes: "Seeded receipt group.",
        createdBy: existingUser.id,
      })
      .onConflictDoNothing();

    await tx
      .insert(bundle)
      .values(
        bundleRows.map((row, index) => ({
          id: row.id,
          companyId: ids.company,
          serverSeq: 5 + index,
          groupId: ids.group,
          dieId: ids.dieRound,
          serial: row.serial,
          quantity: row.quantity,
          weightG: row.weightG,
          lengthMm: row.lengthMm,
          status: row.status,
          currentDispatchId: row.currentDispatchId,
          createdBy: existingUser.id,
        })),
      )
      .onConflictDoNothing();

    await tx
      .insert(dispatch)
      .values([
        {
          id: ids.dispatchDraft,
          companyId: ids.company,
          serverSeq: 10,
          code: "DSP-000010",
          customerId: ids.customer,
          status: "draft",
          shipDate: futureShipDate,
          notes: "Draft dispatch seeded for add/remove testing.",
          createdBy: existingUser.id,
        },
        {
          id: ids.dispatchReserved,
          companyId: ids.company,
          serverSeq: 11,
          code: "DSP-000011",
          customerId: ids.customer,
          status: "reserved",
          shipDate: futureShipDate,
          notes: "Reserved dispatch seeded for state-machine review.",
          createdBy: existingUser.id,
        },
        {
          id: ids.dispatchCompleted,
          companyId: ids.company,
          serverSeq: 12,
          code: "DSP-000012",
          customerId: ids.customer,
          status: "completed",
          shipDate: now,
          notes: "Completed dispatch seeded for M6 packing-list planning.",
          createdBy: existingUser.id,
          completedBy: existingUser.id,
          completedAt: now,
        },
      ])
      .onConflictDoNothing();

    await tx
      .insert(dispatchItem)
      .values([
        {
          id: "dev-dispatch-item-reserved-001",
          companyId: ids.company,
          dispatchId: ids.dispatchReserved,
          bundleId: "dev-bundle-reserved-001",
        },
        {
          id: "dev-dispatch-item-completed-001",
          companyId: ids.company,
          dispatchId: ids.dispatchCompleted,
          bundleId: "dev-bundle-dispatched-001",
        },
      ])
      .onConflictDoNothing();

    await tx
      .insert(bundleStatusEvent)
      .values(
        bundleRows.map((row) => ({
          id: `dev-status-${row.id}`,
          companyId: ids.company,
          bundleId: row.id,
          fromStatus: null,
          toStatus: row.status,
          reason: "dev-seed",
          actorId: existingUser.id,
          dispatchId: row.currentDispatchId,
        })),
      )
      .onConflictDoNothing();
  });

  return {
    ok: true,
    status: 200,
    message: `Seeded demo company for ${normalizedEmail}`,
    email: normalizedEmail,
    companyId: ids.company,
  };
}

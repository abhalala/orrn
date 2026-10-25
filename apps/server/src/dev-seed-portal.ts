import { hashPassword } from "@orrn/auth/password";
import { atomicBatch, type createDb } from "@orrn/db";
import { account, user } from "@orrn/db/schema/auth";
import { auditLog } from "@orrn/db/schema/audit";
import { die } from "@orrn/db/schema/catalog";
import { dispatch } from "@orrn/db/schema/dispatch";
import { customerPortalSection, customerPortalUser, testCertificate } from "@orrn/db/schema/portal";
import { salesOrder, salesOrderLine } from "@orrn/db/schema/sales";
import { docSeries } from "@orrn/db/schema/series";
import { orderGrams } from "@orrn/domain";
import { docPeriod, nextDocNumber } from "@orrn/server/lib/docNumber";
import { buildCertificateSnapshot } from "@orrn/server/lib/testCertificate";
import { and, eq } from "drizzle-orm";

type Db = ReturnType<typeof createDb>;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Fixed ids so e2e can reach them (W3-PORTAL-W). */
export const DEV_PORTAL = {
  portalUserId: "dev-portal-user-kd",
  customerId: "dev-customer-kd",
  /** Sections granted to KD (Patti 14701, Tee 13090); Channel 12230 shows through KD's ownership. */
  grants: [
    { id: "dev-portal-section-14701", dieId: "dev-die-14701" },
    { id: "dev-portal-section-13090", dieId: "dev-die-13090" },
  ],
  bookingId: "dev-so-4",
  bookingLineId: "dev-sol-4-1",
  certificateId: "dev-cert-done-1",
  certifiedDispatchId: "dev-dispatch-done-1",
} as const;

/**
 * Customer portal demo (Wave 3, FP-PF-01..04). Runs after the main seed (which deleted these rows in
 * its reset and re-created customers, dies, dispatches and packing lists): KD Extrusion's party login
 * (party@orrn.local, active), two granted sections plus the owned 12230, one portal booking (SO-4,
 * source portal, band-start kg) and a test certificate for KD's completed dispatch (chemistry
 * pending: no spectro on the demo casts). Idempotent: fixed ids, and the reset clears them first.
 */
export async function seedPortalRows(
  db: Db,
  opts: { companyId: string; party: { email: string; name: string }; password: string; officeId: string; now: number },
) {
  const { companyId, officeId, now } = opts;
  const partyUserId = await ensurePartyUser(db, opts.party, opts.password);
  const at = (daysAgo: number) => new Date(now - daysAgo * DAY_MS);

  // SO-4 continues the order book the main seed wrote (SO-1..3).
  const period = docPeriod("so", new Date(now));
  const [series] = await db
    .select({ value: docSeries.value })
    .from(docSeries)
    .where(and(eq(docSeries.companyId, companyId), eq(docSeries.docType, "so"), eq(docSeries.period, period), eq(docSeries.scope, "")))
    .limit(1);
  const soSeq = (series?.value ?? 0) + 1;
  const number = `SO-${soSeq}`;

  const [patti] = await db
    .select({ weightMinG: die.weightMinG, alloy: die.alloy, temper: die.temper })
    .from(die)
    .where(and(eq(die.id, DEV_PORTAL.grants[0].dieId), eq(die.companyId, companyId)))
    .limit(1);
  if (!patti) throw new Error("dev-seed: portal needs section 14701");
  const cutLengthMm = 3658;
  const pcs = 200;
  const kgG = orderGrams(pcs, cutLengthMm, patti.weightMinG, "inch");

  await atomicBatch(db, [
    db.insert(customerPortalUser).values({
      id: DEV_PORTAL.portalUserId,
      companyId,
      customerId: DEV_PORTAL.customerId,
      email: opts.party.email,
      userId: partyUserId,
      status: "active",
      inviteId: null,
      invitedAt: at(6),
      invitedBy: officeId,
      acceptedAt: at(5),
      createdAt: at(6),
      updatedAt: at(5),
    }),
    ...DEV_PORTAL.grants.map((g) =>
      db.insert(customerPortalSection).values({
        id: g.id,
        companyId,
        customerId: DEV_PORTAL.customerId,
        dieId: g.dieId,
        grantedBy: officeId,
        grantedAt: at(6),
      }),
    ),
    db.insert(salesOrder).values({
      id: DEV_PORTAL.bookingId,
      companyId,
      period,
      number,
      customerId: DEV_PORTAL.customerId,
      poNumber: null,
      orderDate: new Date(now + 5.5 * 3_600_000 - DAY_MS).toISOString().slice(0, 10),
      status: "booking",
      note: "Placed from the party portal",
      source: "portal",
      lineSeq: 1,
      statusChangedAt: at(1),
      statusChangedBy: partyUserId,
      createdBy: partyUserId,
      createdAt: at(1),
    }),
    db.insert(salesOrderLine).values({
      id: DEV_PORTAL.bookingLineId,
      companyId,
      salesOrderId: DEV_PORTAL.bookingId,
      lineNo: 1,
      dieId: DEV_PORTAL.grants[0].dieId,
      kgPer12ftMilli: patti.weightMinG,
      cutLengthMm,
      pcs,
      kgG,
      qtyBasis: "pcs",
      impliedG: kgG,
      weightBasis: "band_start",
      bandStartMilli: patti.weightMinG,
      alloy: patti.alloy,
      temper: patti.temper,
      createdBy: partyUserId,
      createdAt: at(1),
    }),
    db
      .update(docSeries)
      .set({ value: soSeq })
      .where(and(eq(docSeries.companyId, companyId), eq(docSeries.docType, "so"), eq(docSeries.period, period), eq(docSeries.scope, ""))),
    db.insert(auditLog).values({
      id: "dev-audit-portal-order-4",
      companyId,
      actorId: partyUserId,
      action: "portal.order.create",
      subjectType: "sales_order",
      subjectId: DEV_PORTAL.bookingId,
      meta: { salesOrderId: DEV_PORTAL.bookingId, customerId: DEV_PORTAL.customerId, number, period },
      at: at(1),
    }),
  ]);

  // The certificate of KD's completed dispatch, through the same builder the office uses.
  const [d] = await db
    .select()
    .from(dispatch)
    .where(and(eq(dispatch.id, DEV_PORTAL.certifiedDispatchId), eq(dispatch.companyId, companyId)))
    .limit(1);
  if (d && d.status === "completed") {
    const issuedAt = new Date(now - 4 * DAY_MS + 3_600_000);
    const cert = await nextDocNumber(db, companyId, "cert", issuedAt, officeId);
    const snapshot = await buildCertificateSnapshot(db, companyId, d, { number: cert.number, revision: 1, at: issuedAt });
    await db.insert(testCertificate).values({
      id: DEV_PORTAL.certificateId,
      companyId,
      dispatchId: d.id,
      customerId: d.customerId,
      packingListId: null,
      period: cert.period,
      number: cert.number,
      revision: 1,
      chemistry: snapshot.chemistry.status,
      snapshot: snapshot as unknown as Record<string, unknown>,
      createdBy: officeId,
      createdAt: issuedAt,
    });
  }
}

/**
 * The party's password account (email + password sign-in, no TOTP: PF §9-2). Written directly with
 * the same hash Better Auth uses (auth.setPassword does the same), so the seed never needs the Better
 * Auth API for it. Never a membership. Kept when it exists.
 */
async function ensurePartyUser(db: Db, party: { email: string; name: string }, password: string): Promise<string> {
  const [existing] = await db.select({ id: user.id }).from(user).where(eq(user.email, party.email)).limit(1);
  const id = existing?.id ?? "dev-user-party";
  if (!existing) {
    await db.insert(user).values({ id, name: party.name, email: party.email, emailVerified: true, onboardingCompleted: true });
  }
  const [credential] = await db
    .select({ id: account.id })
    .from(account)
    .where(and(eq(account.userId, id), eq(account.providerId, "credential")))
    .limit(1);
  if (!credential) {
    await db.insert(account).values({ id: `dev-account-${id}`, accountId: id, providerId: "credential", userId: id, password: await hashPassword(password) });
  }
  return id;
}

/**
 * Plant masters and plant rules (XE parity lane ADM). Mounted as `masters`; one Masters area for the
 * shared lists, which is how this lane reads XE's "common services" (#85).
 *
 * - `lists.*` (#57, #75, #76): departments, designations, modes of packing, die categories. Reading is
 *   open to every member (pickers); writing is `masters.publish`. Never deleted, only retired.
 * - `bank.*` (#20): several accounts per plant, one live default. Read by the people who see money.
 * - `insurance.*` (#21): the transit insurance policy, a plant setting, printed on the PL when set.
 * - `numberFormats.*` (#77): prefix, year part and padding per doc type (`refFormat.manage`).
 * - `approvalRules.*` (#78): who may approve each approval kind, and thresholds (`approvalRule.manage`).
 * - `people.assign` (#75): a member's department and designation (`users.manage`).
 * - `packing.*` (#76): the mode of packing on an order line and on a dispatch (its PL).
 *
 * The router is ungated by module (masters are read across modules). Writes that touch a module's
 * rows check that module themselves (`assertModule`).
 */
import { TRPCError } from "@trpc/server";
import { and, asc, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";

import { approvalKinds } from "@orrn/db/schema/approval";
import { plantBankAccount, plantMaster, plantMasterKinds } from "@orrn/db/schema/admin";
import { dispatch } from "@orrn/db/schema/dispatch";
import { salesOrderLine } from "@orrn/db/schema/sales";
import { docSeries } from "@orrn/db/schema/series";
import { company, companyRoles, membership } from "@orrn/db/schema/tenant";
import {
  APPROVAL_MEASURES,
  checkApprovalRule,
  checkDocFormat,
  DEFAULT_DOC_FORMATS,
  DOC_FORMAT_FY_STYLES,
  DOC_TYPES_NEEDING_FY,
  FORMATTABLE_DOC_TYPES,
  formatDocNumberWith,
  isBankAccountNo,
  isIfsc,
  isYmd,
  MAX_APPROVAL_THRESHOLD,
  MAX_DOC_PAD,
  MAX_DOC_PREFIX,
  PLANT_MASTER_STARTERS,
  readApprovalRules,
  readDocFormats,
  readTransitInsurance,
  type DocFormat,
  type FormattableDocType,
} from "@orrn/domain";

import { actionProcedure, anyActionProcedure, companyProcedure, router } from "../index";
import { atomicBatch, type OrrnDb } from "../lib/atomic";
import { auditInsert } from "../lib/audit";
import { settingsPatchSql } from "../lib/companySettings";
import { docPeriod } from "../lib/docNumber";
import { DEFAULT_TIMEZONE, isValidTimezone } from "../lib/dayWindow";
import { assertModule } from "../lib/moduleGate";
import { APPROVER_ROLES, canAny, type Action, type CompanyRole } from "../lib/permissions";
import { now as clockNow } from "../lib/clock";
import { nextCompanySeq } from "../lib/sequence";

const id = z.string().min(1).max(64);
const kind = z.enum(plantMasterKinds);
const name = z.string().trim().min(1, "Give the name").max(60);
const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));

const bad = (message: string): never => {
  throw new TRPCError({ code: "BAD_REQUEST", message });
};
const notFound = (): never => {
  throw new TRPCError({ code: "NOT_FOUND", message: "Not found" });
};

/** Who may read the plant's bank accounts: the people who handle prices, papers and accounts. */
const BANK_READERS: readonly Action[] = ["masters.publish", "order.price", "export.accounts", "invoice.link"];
const meOf = (role: CompanyRole) => ({ company: { role }, isPlatformAdmin: false, platformRole: null });

const sameWords = (a: string, b: string) => a.trim().replace(/\s+/g, " ").toLowerCase() === b.trim().replace(/\s+/g, " ").toLowerCase();

async function settingsOf(db: OrrnDb, companyId: string): Promise<Record<string, unknown>> {
  const [row] = await db.select({ settings: company.settings }).from(company).where(eq(company.id, companyId)).limit(1);
  return row?.settings ?? {};
}

/** Live entry of one kind with these words (the partial unique index is the race guard). */
async function assertNameFree(db: OrrnDb, companyId: string, k: (typeof plantMasterKinds)[number], label: string, exceptId?: string) {
  const rows = await db
    .select({ id: plantMaster.id, name: plantMaster.name })
    .from(plantMaster)
    .where(and(eq(plantMaster.companyId, companyId), eq(plantMaster.kind, k), eq(plantMaster.active, true)));
  if (rows.some((r) => r.id !== exceptId && sameWords(r.name, label))) bad(`"${label.trim()}" is already on this list`);
}

function nameClash(e: unknown, label: string): void {
  const text = `${(e as Error)?.message ?? e} ${(e as { cause?: { message?: string } })?.cause?.message ?? ""}`;
  if (/plant_master_live_name_unique|plant_master\.company_id, plant_master\.kind/i.test(text)) bad(`"${label.trim()}" is already on this list`);
}

/** A die category write needs the die room module; the other lists are plant-wide. */
async function assertKindModule(ctx: { db: OrrnDb; companyId: string }, k: string) {
  if (k === "die_category") await assertModule(ctx, "dies");
}

/** Check that an id names a live entry of this kind in this plant (or null = clear). */
export async function assertMasterOfKind(db: OrrnDb, companyId: string, k: (typeof plantMasterKinds)[number], masterId: string | null): Promise<void> {
  if (masterId === null) return;
  const [row] = await db
    .select({ id: plantMaster.id })
    .from(plantMaster)
    .where(and(eq(plantMaster.id, masterId), eq(plantMaster.companyId, companyId), eq(plantMaster.kind, k), eq(plantMaster.active, true)))
    .limit(1);
  if (!row) notFound();
}

const bankInput = z.object({
  bankName: z.string().trim().min(1, "Give the bank name").max(80),
  branch: optText(80),
  accountName: z.string().trim().min(1, "Give the account name").max(120),
  accountNo: z.string().trim().min(1).max(30),
  ifsc: z.string().trim().min(1).max(20),
  note: optText(120),
});

function checkBank(input: { accountNo: string; ifsc: string }): { accountNo: string; ifsc: string } {
  const accountNo = input.accountNo.replace(/\s+/g, "");
  const ifsc = input.ifsc.trim().toUpperCase();
  if (!isBankAccountNo(accountNo)) bad("The account number must be 6 to 20 digits");
  if (!isIfsc(ifsc)) bad("The IFSC must be 11 characters, like SBIN0001234");
  return { accountNo, ifsc };
}

const docFormatInput = z.object({
  prefix: z.string().max(MAX_DOC_PREFIX),
  fy: z.enum(DOC_FORMAT_FY_STYLES),
  pad: z.number().int().min(0).max(MAX_DOC_PAD),
});

const FORMAT_REFUSALS: Record<string, string> = {
  prefix_chars: "The prefix may hold letters and / - _ . only, no digits",
  prefix_length: `The prefix may be at most ${MAX_DOC_PREFIX} characters`,
  pad_range: `Padding is 0 to ${MAX_DOC_PAD} digits`,
  fy_style: "Choose how the year shows",
  fy_required: "This number must show the year, or it would repeat next year",
  unknown_type: "This number's format cannot be changed",
};

const roleList = z.array(z.enum(companyRoles)).min(1).max(companyRoles.length);
const ruleInput = z.object({
  roles: roleList,
  above: z.object({ value: z.number().int().min(0).max(MAX_APPROVAL_THRESHOLD), roles: roleList }).nullish(),
});

const RULE_REFUSALS: Record<string, string> = {
  roles_empty: "Choose at least one role",
  role_unknown: "Choose roles from the list",
  threshold_not_offered: "This kind of request has no figure to set a limit on",
  threshold_range: "The limit must be a whole number",
  above_roles_empty: "Choose who approves above the limit",
};

export const plantMastersRouter = router({
  lists: router({
    /** Every entry (retired included) of one kind or all kinds, in list order. */
    list: companyProcedure.input(z.object({ kind: kind.optional() }).optional()).query(async ({ ctx, input }) => {
      return ctx.db
        .select({
          id: plantMaster.id,
          kind: plantMaster.kind,
          name: plantMaster.name,
          expectedLifeG: plantMaster.expectedLifeG,
          active: plantMaster.active,
          sortOrder: plantMaster.sortOrder,
        })
        .from(plantMaster)
        .where(and(eq(plantMaster.companyId, ctx.companyId), input?.kind ? eq(plantMaster.kind, input.kind) : undefined))
        .orderBy(asc(plantMaster.kind), asc(plantMaster.sortOrder), asc(plantMaster.name));
    }),

    create: actionProcedure("masters.publish")
      .input(z.object({ kind, name, expectedLifeG: z.number().int().positive().max(1_000_000_000_000).nullish() }))
      .mutation(async ({ ctx, input }) => {
        await assertKindModule(ctx, input.kind);
        if (input.expectedLifeG != null && input.kind !== "die_category") bad("Only a die category has an expected life");
        await assertNameFree(ctx.db, ctx.companyId, input.kind, input.name);
        const [last] = await ctx.db
          .select({ n: sql<number>`coalesce(max(${plantMaster.sortOrder}), 0)` })
          .from(plantMaster)
          .where(and(eq(plantMaster.companyId, ctx.companyId), eq(plantMaster.kind, input.kind)));
        const rowId = crypto.randomUUID();
        const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
        try {
          await atomicBatch(ctx.db, [
            ctx.db.insert(plantMaster).values({
              id: rowId,
              companyId: ctx.companyId,
              serverSeq: seq,
              kind: input.kind,
              name: input.name,
              expectedLifeG: input.expectedLifeG ?? null,
              active: true,
              sortOrder: Number(last?.n ?? 0) + 1,
              createdBy: ctx.session.user.id,
            }),
            auditInsert(ctx, { action: "plant_master.create", subjectType: "plant_master", subjectId: rowId, meta: { kind: input.kind, name: input.name } }),
          ]);
        } catch (e) {
          nameClash(e, input.name);
          throw e;
        }
        return { id: rowId };
      }),

    /** Add the starter entries of a kind that are not on the list yet (one tap for a new plant). */
    addStarters: actionProcedure("masters.publish")
      .input(z.object({ kind }))
      .mutation(async ({ ctx, input }) => {
        await assertKindModule(ctx, input.kind);
        const rows = await ctx.db
          .select({ name: plantMaster.name, active: plantMaster.active, sortOrder: plantMaster.sortOrder })
          .from(plantMaster)
          .where(and(eq(plantMaster.companyId, ctx.companyId), eq(plantMaster.kind, input.kind)));
        const missing = PLANT_MASTER_STARTERS[input.kind].filter((n) => !rows.some((r) => r.active && sameWords(r.name, n)));
        if (missing.length === 0) return { added: 0 };
        let order = rows.reduce((m, r) => Math.max(m, r.sortOrder), 0);
        const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
        await atomicBatch(ctx.db, [
          ...missing.map((n) =>
            ctx.db.insert(plantMaster).values({
              id: crypto.randomUUID(),
              companyId: ctx.companyId,
              serverSeq: seq,
              kind: input.kind,
              name: n,
              expectedLifeG: null,
              active: true,
              sortOrder: (order += 1),
              createdBy: ctx.session.user.id,
            }),
          ),
          auditInsert(ctx, { action: "plant_master.starters", subjectType: "plant_master", subjectId: null, meta: { kind: input.kind, names: missing } }),
        ]);
        return { added: missing.length };
      }),

    /** Rename, set a category's expected life, or retire / bring back an entry. */
    update: actionProcedure("masters.publish")
      .input(
        z.object({
          id,
          name: name.optional(),
          expectedLifeG: z.number().int().positive().max(1_000_000_000_000).nullish(),
          active: z.boolean().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const [row] = await ctx.db
          .select()
          .from(plantMaster)
          .where(and(eq(plantMaster.id, input.id), eq(plantMaster.companyId, ctx.companyId)))
          .limit(1);
        if (!row) return notFound();
        await assertKindModule(ctx, row.kind);
        if (input.expectedLifeG !== undefined && row.kind !== "die_category") bad("Only a die category has an expected life");
        const nextName = input.name ?? row.name;
        const nextActive = input.active ?? row.active;
        if (nextActive && (input.name !== undefined || (input.active === true && !row.active))) {
          await assertNameFree(ctx.db, ctx.companyId, row.kind, nextName, row.id);
        }
        const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
        const set: Partial<typeof plantMaster.$inferInsert> = { serverSeq: seq, name: nextName, active: nextActive };
        if (input.expectedLifeG !== undefined) set.expectedLifeG = input.expectedLifeG ?? null;
        try {
          await atomicBatch(ctx.db, [
            ctx.db.update(plantMaster).set(set).where(and(eq(plantMaster.id, row.id), eq(plantMaster.companyId, ctx.companyId))),
            auditInsert(ctx, {
              action: "plant_master.update",
              subjectType: "plant_master",
              subjectId: row.id,
              meta: { kind: row.kind, from: { name: row.name, active: row.active, expectedLifeG: row.expectedLifeG }, to: { name: nextName, active: nextActive, expectedLifeG: set.expectedLifeG ?? row.expectedLifeG } },
            }),
          ]);
        } catch (e) {
          nameClash(e, nextName);
          throw e;
        }
        return { id: row.id };
      }),
  }),

  bank: router({
    /** The plant's accounts, default first. Only for the people who see prices, papers or accounts. */
    list: companyProcedure.input(z.object({ includeRetired: z.boolean().default(false) }).optional()).query(async ({ ctx, input }) => {
      if (!canAny(meOf(ctx.role), BANK_READERS)) throw new TRPCError({ code: "FORBIDDEN", message: "You don't have permission to do that" });
      return ctx.db
        .select({
          id: plantBankAccount.id,
          bankName: plantBankAccount.bankName,
          branch: plantBankAccount.branch,
          accountName: plantBankAccount.accountName,
          accountNo: plantBankAccount.accountNo,
          ifsc: plantBankAccount.ifsc,
          note: plantBankAccount.note,
          isDefault: plantBankAccount.isDefault,
          active: plantBankAccount.active,
        })
        .from(plantBankAccount)
        .where(and(eq(plantBankAccount.companyId, ctx.companyId), input?.includeRetired ? undefined : eq(plantBankAccount.active, true)))
        .orderBy(sql`${plantBankAccount.isDefault} desc`, asc(plantBankAccount.bankName));
    }),

    /** Add an account. The plant's first live account becomes the default. */
    create: actionProcedure("masters.publish")
      .input(bankInput.extend({ makeDefault: z.boolean().default(false) }))
      .mutation(async ({ ctx, input }) => {
        const { accountNo, ifsc } = checkBank(input);
        const [live] = await ctx.db
          .select({ n: sql<number>`count(*)` })
          .from(plantBankAccount)
          .where(and(eq(plantBankAccount.companyId, ctx.companyId), eq(plantBankAccount.active, true)));
        const makeDefault = input.makeDefault || Number(live?.n ?? 0) === 0;
        const rowId = crypto.randomUUID();
        const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
        await atomicBatch(ctx.db, [
          ...(makeDefault
            ? [ctx.db.update(plantBankAccount).set({ isDefault: false, serverSeq: seq }).where(and(eq(plantBankAccount.companyId, ctx.companyId), eq(plantBankAccount.isDefault, true)))]
            : []),
          ctx.db.insert(plantBankAccount).values({
            id: rowId,
            companyId: ctx.companyId,
            serverSeq: seq,
            bankName: input.bankName,
            branch: input.branch,
            accountName: input.accountName,
            accountNo,
            ifsc,
            note: input.note,
            isDefault: makeDefault,
            active: true,
            createdBy: ctx.session.user.id,
          }),
          auditInsert(ctx, { action: "bank_account.create", subjectType: "bank_account", subjectId: rowId, meta: { bankName: input.bankName, ifsc, last4: accountNo.slice(-4), isDefault: makeDefault } }),
        ]);
        return { id: rowId, isDefault: makeDefault };
      }),

    update: actionProcedure("masters.publish")
      .input(bankInput.extend({ id }))
      .mutation(async ({ ctx, input }) => {
        const { accountNo, ifsc } = checkBank(input);
        const [row] = await ctx.db
          .select({ id: plantBankAccount.id })
          .from(plantBankAccount)
          .where(and(eq(plantBankAccount.id, input.id), eq(plantBankAccount.companyId, ctx.companyId)))
          .limit(1);
        if (!row) return notFound();
        const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
        await atomicBatch(ctx.db, [
          ctx.db
            .update(plantBankAccount)
            .set({ bankName: input.bankName, branch: input.branch, accountName: input.accountName, accountNo, ifsc, note: input.note, serverSeq: seq })
            .where(and(eq(plantBankAccount.id, row.id), eq(plantBankAccount.companyId, ctx.companyId))),
          auditInsert(ctx, { action: "bank_account.update", subjectType: "bank_account", subjectId: row.id, meta: { bankName: input.bankName, ifsc, last4: accountNo.slice(-4) } }),
        ]);
        return { id: row.id };
      }),

    /** Make one live account the default (the one papers print). The old default stops being it in the same batch. */
    setDefault: actionProcedure("masters.publish")
      .input(z.object({ id }))
      .mutation(async ({ ctx, input }) => {
        const [row] = await ctx.db
          .select({ id: plantBankAccount.id, active: plantBankAccount.active })
          .from(plantBankAccount)
          .where(and(eq(plantBankAccount.id, input.id), eq(plantBankAccount.companyId, ctx.companyId)))
          .limit(1);
        if (!row) return notFound();
        if (!row.active) bad("Bring the account back before making it the default");
        const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
        await atomicBatch(ctx.db, [
          ctx.db
            .update(plantBankAccount)
            .set({ isDefault: false, serverSeq: seq })
            .where(and(eq(plantBankAccount.companyId, ctx.companyId), eq(plantBankAccount.isDefault, true), ne(plantBankAccount.id, row.id))),
          ctx.db
            .update(plantBankAccount)
            .set({ isDefault: true, serverSeq: seq })
            .where(and(eq(plantBankAccount.id, row.id), eq(plantBankAccount.companyId, ctx.companyId), eq(plantBankAccount.active, true))),
          auditInsert(ctx, { action: "bank_account.default", subjectType: "bank_account", subjectId: row.id }),
        ]);
        return { id: row.id };
      }),

    /** Retire or bring back an account. Retiring the default leaves the plant with none until another is chosen. */
    setActive: actionProcedure("masters.publish")
      .input(z.object({ id, active: z.boolean() }))
      .mutation(async ({ ctx, input }) => {
        const [row] = await ctx.db
          .select({ id: plantBankAccount.id, isDefault: plantBankAccount.isDefault })
          .from(plantBankAccount)
          .where(and(eq(plantBankAccount.id, input.id), eq(plantBankAccount.companyId, ctx.companyId)))
          .limit(1);
        if (!row) return notFound();
        const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
        await atomicBatch(ctx.db, [
          ctx.db
            .update(plantBankAccount)
            .set({ active: input.active, isDefault: input.active ? row.isDefault : false, serverSeq: seq })
            .where(and(eq(plantBankAccount.id, row.id), eq(plantBankAccount.companyId, ctx.companyId))),
          auditInsert(ctx, { action: input.active ? "bank_account.restore" : "bank_account.retire", subjectType: "bank_account", subjectId: row.id }),
        ]);
        return { id: row.id };
      }),
  }),

  insurance: router({
    /** The plant's transit insurance policy (any member: it prints on the PL). */
    get: companyProcedure.query(async ({ ctx }) => readTransitInsurance((await settingsOf(ctx.db, ctx.companyId)).transitInsurance)),

    /** Set or clear (null) the policy. */
    set: actionProcedure("masters.publish")
      .input(
        z
          .object({
            policyNo: z.string().trim().min(1, "Give the policy number").max(60),
            insurer: z.string().trim().min(1, "Give the insurer").max(80),
            validFrom: z.string().nullish(),
            validTo: z.string().nullish(),
            printOnPl: z.boolean().default(true),
          })
          .nullable(),
      )
      .mutation(async ({ ctx, input }) => {
        let value: Record<string, unknown> | null = null;
        if (input) {
          const validFrom = input.validFrom || null;
          const validTo = input.validTo || null;
          if (validFrom !== null && !isYmd(validFrom)) bad("Give the start date as a day");
          if (validTo !== null && !isYmd(validTo)) bad("Give the end date as a day");
          if (validFrom && validTo && validTo < validFrom) bad("The policy ends before it starts");
          value = { policyNo: input.policyNo, insurer: input.insurer, validFrom, validTo, printOnPl: input.printOnPl };
        }
        const before = (await settingsOf(ctx.db, ctx.companyId)).transitInsurance ?? null;
        await atomicBatch(ctx.db, [
          ctx.db.update(company).set({ settings: settingsPatchSql({ transitInsurance: value }) }).where(eq(company.id, ctx.companyId)),
          auditInsert(ctx, { action: "company.insurance.update", subjectType: "company", subjectId: ctx.companyId, meta: { previous: before, changed: value } }),
        ]);
        return readTransitInsurance(value);
      }),
  }),

  numberFormats: router({
    /**
     * Each doc type whose text the plant may set: today's text, the plant's own (if any), and what the
     * next number will read, from the live counter of the current period.
     */
    get: companyProcedure.query(async ({ ctx }) => {
      const settings = await settingsOf(ctx.db, ctx.companyId);
      const own = readDocFormats(settings.docFormats);
      const tz = typeof settings.timezone === "string" && isValidTimezone(settings.timezone) ? settings.timezone : DEFAULT_TIMEZONE;
      const at = clockNow();
      const counters = await ctx.db
        .select({ docType: docSeries.docType, period: docSeries.period, value: docSeries.value })
        .from(docSeries)
        .where(and(eq(docSeries.companyId, ctx.companyId), eq(docSeries.scope, "")));
      const pl = settings.plSeries as { prefix?: unknown } | undefined;
      const plPrefix = typeof pl?.prefix === "string" ? pl.prefix : "PL/";
      return FORMATTABLE_DOC_TYPES.map((docType) => {
        const period = docPeriod(docType as never, at, tz);
        const builtIn: DocFormat = docType === "pl" ? { prefix: plPrefix, fy: "long", pad: 0 } : DEFAULT_DOC_FORMATS[docType];
        const format = own[docType] ?? builtIn;
        const value = counters.find((c) => c.docType === docType && c.period === period)?.value ?? 0;
        return {
          docType,
          period,
          builtIn,
          custom: own[docType] ?? null,
          needsYear: DOC_TYPES_NEEDING_FY.includes(docType),
          next: formatDocNumberWith(format, period, value + 1),
        };
      });
    }),

    /** Set a doc type's format, or clear it (null) to go back to today's text. Only later numbers change. */
    set: actionProcedure("refFormat.manage")
      .input(z.object({ docType: z.enum(FORMATTABLE_DOC_TYPES), format: docFormatInput.nullable() }))
      .mutation(async ({ ctx, input }) => {
        if (input.format) {
          const err = checkDocFormat(input.docType, input.format);
          if (err) bad(FORMAT_REFUSALS[err]!);
        }
        const before = readDocFormats((await settingsOf(ctx.db, ctx.companyId)).docFormats)[input.docType] ?? null;
        const key = `docFormats.${input.docType}` as const;
        await atomicBatch(ctx.db, [
          ctx.db
            .update(company)
            .set({ settings: input.format ? settingsPatchSql({ [key]: input.format }) : sql`json_remove(coalesce(${company.settings}, '{}'), ${`$.docFormats.${input.docType}`})` })
            .where(eq(company.id, ctx.companyId)),
          auditInsert(ctx, { action: "company.number_format.update", subjectType: "company", subjectId: ctx.companyId, meta: { docType: input.docType, previous: before, changed: input.format } }),
        ]);
        return { docType: input.docType as FormattableDocType, format: input.format };
      }),
  }),

  approvalRules: router({
    /** Every approval kind with its built-in approvers, the plant's rule (if any) and the figure a limit reads. */
    get: companyProcedure.query(async ({ ctx }) => {
      const rules = readApprovalRules((await settingsOf(ctx.db, ctx.companyId)).approvalRules, companyRoles);
      return approvalKinds.map((k) => ({
        kind: k,
        builtIn: [...APPROVER_ROLES[k]],
        rule: rules[k] ?? null,
        measure: APPROVAL_MEASURES[k]?.unit ?? null,
      }));
    }),

    /** Set or clear (null) the rule of one kind. Requests already decided stay as they are. */
    set: actionProcedure("approvalRule.manage")
      .input(z.object({ kind: z.enum(approvalKinds), rule: ruleInput.nullable() }))
      .mutation(async ({ ctx, input }) => {
        if (input.rule) {
          const err = checkApprovalRule(input.kind, { roles: input.rule.roles, above: input.rule.above ?? null }, companyRoles);
          if (err) bad(RULE_REFUSALS[err]!);
        }
        const before = readApprovalRules((await settingsOf(ctx.db, ctx.companyId)).approvalRules, companyRoles)[input.kind] ?? null;
        const value = input.rule ? { roles: input.rule.roles, above: input.rule.above ?? null } : null;
        await atomicBatch(ctx.db, [
          ctx.db
            .update(company)
            .set({ settings: value ? settingsPatchSql({ [`approvalRules.${input.kind}`]: value }) : sql`json_remove(coalesce(${company.settings}, '{}'), ${`$.approvalRules.${input.kind}`})` })
            .where(eq(company.id, ctx.companyId)),
          auditInsert(ctx, { action: "company.approval_rule.update", subjectType: "company", subjectId: ctx.companyId, meta: { kind: input.kind, previous: before, changed: value } }),
        ]);
        return { kind: input.kind, rule: value };
      }),
  }),

  people: router({
    /** A member's department and designation (null clears). HR reads these in wave 3. */
    assign: actionProcedure("users.manage")
      .input(z.object({ membershipId: id, departmentId: id.nullable(), designationId: id.nullable() }))
      .mutation(async ({ ctx, input }) => {
        const [row] = await ctx.db
          .select({ id: membership.id, departmentId: membership.departmentId, designationId: membership.designationId })
          .from(membership)
          .where(and(eq(membership.id, input.membershipId), eq(membership.companyId, ctx.companyId)))
          .limit(1);
        if (!row) return notFound();
        await assertMasterOfKind(ctx.db, ctx.companyId, "department", input.departmentId);
        await assertMasterOfKind(ctx.db, ctx.companyId, "designation", input.designationId);
        await atomicBatch(ctx.db, [
          ctx.db
            .update(membership)
            .set({ departmentId: input.departmentId, designationId: input.designationId })
            .where(and(eq(membership.id, row.id), eq(membership.companyId, ctx.companyId))),
          auditInsert(ctx, {
            action: "membership.assign",
            subjectType: "membership",
            subjectId: row.id,
            meta: { from: { departmentId: row.departmentId, designationId: row.designationId }, to: { departmentId: input.departmentId, designationId: input.designationId } },
          }),
        ]);
        return { id: row.id };
      }),
  }),

  packing: router({
    /** Mode of packing on an order line (null clears). Order desk. */
    setForLine: actionProcedure("order.manage")
      .input(z.object({ lineId: id, packingModeId: id.nullable() }))
      .mutation(async ({ ctx, input }) => {
        await assertModule(ctx, "orders");
        const [line] = await ctx.db
          .select({ id: salesOrderLine.id, packingModeId: salesOrderLine.packingModeId })
          .from(salesOrderLine)
          .where(and(eq(salesOrderLine.id, input.lineId), eq(salesOrderLine.companyId, ctx.companyId)))
          .limit(1);
        if (!line) return notFound();
        await assertMasterOfKind(ctx.db, ctx.companyId, "packing_mode", input.packingModeId);
        await atomicBatch(ctx.db, [
          ctx.db
            .update(salesOrderLine)
            .set({ packingModeId: input.packingModeId })
            .where(and(eq(salesOrderLine.id, line.id), eq(salesOrderLine.companyId, ctx.companyId))),
          auditInsert(ctx, { action: "order_line.packing_mode", subjectType: "sales_order_line", subjectId: line.id, meta: { from: line.packingModeId, to: input.packingModeId } }),
        ]);
        return { id: line.id };
      }),

    /**
     * Mode of packing for a whole dispatch (its PL). A PL already issued shows it after
     * `packingList.regenerate`; a cancelled dispatch is refused.
     */
    setForDispatch: anyActionProcedure("dispatch.scan", "dispatch.complete")
      .input(z.object({ dispatchId: id, packingModeId: id.nullable() }))
      .mutation(async ({ ctx, input }) => {
        await assertModule(ctx, "dispatches");
        const [row] = await ctx.db
          .select({ id: dispatch.id, status: dispatch.status, packingModeId: dispatch.packingModeId })
          .from(dispatch)
          .where(and(eq(dispatch.id, input.dispatchId), eq(dispatch.companyId, ctx.companyId)))
          .limit(1);
        if (!row) return notFound();
        if (row.status === "cancelled") bad("This dispatch is cancelled");
        await assertMasterOfKind(ctx.db, ctx.companyId, "packing_mode", input.packingModeId);
        await atomicBatch(ctx.db, [
          ctx.db
            .update(dispatch)
            .set({ packingModeId: input.packingModeId })
            .where(and(eq(dispatch.id, row.id), eq(dispatch.companyId, ctx.companyId), ne(dispatch.status, "cancelled"))),
          auditInsert(ctx, { action: "dispatch.packing_mode", subjectType: "dispatch", subjectId: row.id, meta: { from: row.packingModeId, to: input.packingModeId } }),
        ]);
        return { id: row.id };
      }),
  }),
});

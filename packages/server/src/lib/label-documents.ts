import { TRPCError } from "@trpc/server";
import { and, desc, eq, isNull } from "drizzle-orm";

import type { OrrnDb } from "@orrn/db";
import { labelTemplate } from "@orrn/db/schema/printing";
import { te200Profile, validateLabelDocument, type LabelDocument } from "@orrn/domain";
import { atomicBatchLast } from "./atomic";

function assertValidDocument(document: LabelDocument): void {
  const issues = validateLabelDocument(document, te200Profile);
  if (issues.length > 0) {
    throw new TRPCError({ code: "BAD_REQUEST", message: issues[0]!.message });
  }
}

async function readTemplate(db: OrrnDb, companyId: string, templateId: string): Promise<typeof labelTemplate.$inferSelect> {
  const row = await db
    .select()
    .from(labelTemplate)
    .where(and(eq(labelTemplate.id, templateId), eq(labelTemplate.companyId, companyId), isNull(labelTemplate.deletedAt)))
    .get();
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Label template not found" });
  return row;
}

export async function listLabelDocuments(db: OrrnDb, companyId: string) {
  return db
    .select({
      id: labelTemplate.id,
      name: labelTemplate.name,
      kind: labelTemplate.kind,
      version: labelTemplate.version,
      schema: labelTemplate.schema,
      draftSchema: labelTemplate.draftSchema,
      draftUpdatedAt: labelTemplate.draftUpdatedAt,
      createdAt: labelTemplate.createdAt,
    })
    .from(labelTemplate)
    .where(and(eq(labelTemplate.companyId, companyId), isNull(labelTemplate.deletedAt)))
    .orderBy(desc(labelTemplate.createdAt));
}

export async function getLabelDocument(db: OrrnDb, companyId: string, templateId: string): Promise<typeof labelTemplate.$inferSelect> {
  return readTemplate(db, companyId, templateId);
}

export async function createLabelDraft(db: OrrnDb, companyId: string, name: string, document: LabelDocument) {
  assertValidDocument(document);
  const id = crypto.randomUUID();
  const now = new Date();
  const row = {
    id,
    companyId,
    name: name.trim(),
    kind: "bundle" as const,
    schema: document as unknown as Record<string, unknown>,
    draftSchema: document as unknown as Record<string, unknown>,
    draftUpdatedAt: now,
    variables: {},
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
  await db.insert(labelTemplate).values(row).returning().get();
  return row;
}

export async function updateLabelDraft(db: OrrnDb, companyId: string, templateId: string, document: LabelDocument) {
  assertValidDocument(document);
  await readTemplate(db, companyId, templateId);
  const now = new Date();
  const updated = await db
    .update(labelTemplate)
    .set({ draftSchema: document as unknown as Record<string, unknown>, draftUpdatedAt: now, updatedAt: now })
    .where(and(eq(labelTemplate.id, templateId), eq(labelTemplate.companyId, companyId)))
    .returning()
    .get();
  if (!updated) throw new TRPCError({ code: "NOT_FOUND", message: "Label template not found" });
  return updated;
}

export async function cloneLabelDraft(db: OrrnDb, companyId: string, templateId: string, name: string) {
  const source = await readTemplate(db, companyId, templateId);
  const now = new Date();
  const row = {
    id: crypto.randomUUID(),
    companyId,
    name: name.trim(),
    kind: source.kind,
    schema: source.schema,
    draftSchema: source.draftSchema,
    draftUpdatedAt: now,
    variables: source.variables,
    spoolTemplateId: null,
    spoolPushedAt: null,
    version: source.version,
    createdAt: now,
    updatedAt: now,
  };
  await db.insert(labelTemplate).values(row).returning().get();
  return row;
}

export async function publishLabelDraft(db: OrrnDb, companyId: string, templateId: string) {
  const source = await readTemplate(db, companyId, templateId);
  assertValidDocument(source.draftSchema as unknown as LabelDocument);
  const now = new Date();
  const version = source.version + 1;
  const [updated] = await atomicBatchLast(db, [
    db
      .update(labelTemplate)
      .set({ schema: source.draftSchema!, draftUpdatedAt: now, updatedAt: now, version })
      .where(and(eq(labelTemplate.id, templateId), eq(labelTemplate.companyId, companyId)))
      .returning(),
  ]);
  if (!updated) throw new TRPCError({ code: "NOT_FOUND", message: "Label template not found" });
  return updated as typeof labelTemplate.$inferSelect;
}

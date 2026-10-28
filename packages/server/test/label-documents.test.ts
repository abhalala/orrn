import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { compactLabel, operationsDense } from "@orrn/domain";
import { labelTemplate, printerProfile, printLog } from "@orrn/db/schema/printing";

import { createTestEnv, type TestEnv } from "./harness";

let env: TestEnv;

function serialized<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

beforeAll(async () => {
  env = await createTestEnv();
});

afterAll(async () => {
  await env.dispose();
});

describe("tenant label drafts and publishing", () => {
  test("creates, edits, clones, and publishes without changing frozen print payloads", async () => {
    const { companyId } = await env.seedCompany();
    const admin = env.caller({ role: "admin", companyId });
    const draft = await admin.spool.labelDocuments.createDraft({ name: "Operations dense", document: operationsDense });
    expect(draft.draftSchema).toMatchObject(serialized(operationsDense));
    expect(draft.version).toBe(1);

    const edited = await admin.spool.labelDocuments.updateDraft({ templateId: draft.id, document: compactLabel });
    expect(edited.draftSchema).toMatchObject(serialized(compactLabel));
    expect(edited.schema).toMatchObject(serialized(operationsDense));

    const clone = await admin.spool.labelDocuments.clone({ templateId: draft.id, name: "Compact alternate" });
    expect(clone.id).not.toBe(draft.id);
    expect(clone.draftSchema).toMatchObject(serialized(compactLabel));

    await env.db.insert(printerProfile).values({ id: crypto.randomUUID(), companyId, name: "Bay", spoolPrinterId: "tsc-1", templateId: draft.id });
    const profile = await env.db.select().from(printerProfile).where(eq(printerProfile.templateId, draft.id)).get();
    const frozenLogId = crypto.randomUUID();
    await env.db.insert(printLog).values({
      id: frozenLogId,
      companyId,
      templateId: draft.id,
      profileId: profile!.id,
      status: "queued",
      variables: { serialNumber: "FROZEN-1" },
      payloadHash: "f".repeat(64),
      attempt: 1,
      labelVersion: 1,
      jobKey: "bundle:FROZEN-1:label:v1:attempt:1",
    });

    const published = await admin.spool.labelDocuments.publish({ templateId: clone.id });
    expect(published.version).toBe(2);
    expect(published.schema).toMatchObject(serialized(compactLabel));
    expect(published.draftSchema).toMatchObject(serialized(compactLabel));

    const original = (await admin.spool.labelDocuments.get({ templateId: draft.id })) as typeof labelTemplate.$inferSelect;
    expect(original.version).toBe(1);
    expect(original.schema).toMatchObject(serialized(operationsDense));
    const frozen = await env.db.select().from(printLog).where(eq(printLog.id, frozenLogId)).get();
    expect(frozen?.payloadHash).toBe("f".repeat(64));
    expect(frozen?.variables).toEqual({ serialNumber: "FROZEN-1" });
    expect(frozen?.labelVersion).toBe(1);
  });

  test("rejects cross-tenant reads and unauthorized draft writes", async () => {
    const { companyId } = await env.seedCompany();
    const other = await env.seedCompany();
    const admin = env.caller({ role: "admin", companyId });
    const draft = await admin.spool.labelDocuments.createDraft({ name: "Private draft", document: operationsDense });

    const otherAdmin = env.caller({ role: "admin", companyId: other.companyId });
    await expect(otherAdmin.spool.labelDocuments.get({ templateId: draft.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    const viewer = env.caller({ role: "viewer", companyId });
    await expect(viewer.spool.labelDocuments.createDraft({ name: "Forbidden", document: operationsDense })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  test("rejects forbidden identifiers before persistence", async () => {
    const { companyId } = await env.seedCompany();
    const admin = env.caller({ role: "admin", companyId });
    const invalid = structuredClone(operationsDense);
    // @ts-expect-error intentional invalid variable fixture
    invalid.elements[0]!.variable = "uuid";
    await expect(admin.spool.labelDocuments.createDraft({ name: "Bad", document: invalid })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await env.db.select().from(labelTemplate).where(eq(labelTemplate.companyId, companyId)).all()).toHaveLength(0);
  });

  test("preview values are a real bundle's print variables and never cross tenants", async () => {
    const { companyId } = await env.seedCompany();
    const other = await env.seedCompany();
    const viewer = env.caller({ role: "viewer", companyId });
    expect(await viewer.spool.labelDocuments.sample({})).toBeNull();

    const [bundle] = await env.seedBundles(companyId, await env.seedDie(companyId), 1);
    const [foreign] = await env.seedBundles(other.companyId, await env.seedDie(other.companyId), 1);
    const sample = await viewer.spool.labelDocuments.sample({ serial: bundle!.serial });
    expect(sample?.serial).toBe(bundle!.serial);
    expect(sample?.variables).toMatchObject({ serialNumber: bundle!.serial, quantity: "10", weight: "25 kg" });
    expect(sample?.variables.qr).toContain(`/b/${bundle!.serial}`);
    expect((await viewer.spool.labelDocuments.sample({}))?.serial).toBe(bundle!.serial);
    await expect(viewer.spool.labelDocuments.sample({ serial: foreign!.serial })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

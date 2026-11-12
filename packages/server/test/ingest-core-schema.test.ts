/**
 * Infinity Portal A0: the ingest migration applies on a fresh D1, the one-active-run index holds, the two
 * new actions are owner and admin only, and backups leave out the rebuildable ingest tables.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { createTestEnv, type CompanyRole, type TestEnv } from "./harness";

let env: TestEnv;

beforeAll(async () => {
  env = await createTestEnv();
});

afterAll(async () => {
  await env.dispose();
});

const INGEST_TABLES = [
  "customer_alias",
  "ingest_answer",
  "ingest_artifact",
  "ingest_block",
  "ingest_bot_run",
  "ingest_candidate",
  "ingest_hole",
  "ingest_hole_version",
  "ingest_merge_chunk",
  "ingest_merge_run",
  "ingest_order_key",
  "ingest_staged_row",
];

// The ingest migration is found by its name, not its number: the number moves at integration.
describe("migration NNNN_ingest", () => {
  test("creates every ingest table on a fresh D1", async () => {
    const rows = await env.d1
      .prepare("select name from sqlite_master where type = 'table' and (name like 'ingest_%' or name = 'customer_alias') order by name")
      .all<{ name: string }>();
    expect(rows.results.map((r) => r.name)).toEqual(INGEST_TABLES);
  });

  test("is the last migration in the journal, chained after the one before it", async () => {
    const journal = (await import("../../db/src/migrations/meta/_journal.json")).default as {
      entries: { idx: number; tag: string; when: number }[];
    };
    const last = journal.entries.at(-1)!;
    const prev = journal.entries.at(-2)!;
    expect(last.tag).toMatch(/^\d{4}_ingest$/);
    expect(last.idx).toBe(journal.entries.length - 1);
    expect(last.tag).toBe(`${String(last.idx).padStart(4, "0")}_ingest`);
    expect(prev.idx).toBe(last.idx - 1);
    expect(prev.tag).not.toMatch(/_ingest$/);
    expect(last.when).toBeGreaterThan(prev.when);
    expect(await Bun.file(new URL(`../../db/src/migrations/${last.tag}.sql`, import.meta.url)).exists()).toBe(true);
  });

  test("one active merge run per plant; a finished run frees the slot", async () => {
    const { companyId } = await env.seedCompany();
    const { ingestMergeRun } = await import("@orrn/db/schema/ingest");
    const { eq } = await import("drizzle-orm");
    await env.db.insert(ingestMergeRun).values({ id: "run-a", companyId, state: "planning" });
    await expect(Promise.resolve(env.db.insert(ingestMergeRun).values({ id: "run-b", companyId, state: "running" }))).rejects.toThrow();
    await env.db.update(ingestMergeRun).set({ state: "done" }).where(eq(ingestMergeRun.id, "run-a"));
    await env.db.insert(ingestMergeRun).values({ id: "run-b", companyId, state: "running" });
    const other = await env.seedCompany();
    await env.db.insert(ingestMergeRun).values({ id: "run-c", companyId: other.companyId, state: "planning" });
  });

  test("one artifact per plant per digest", async () => {
    const { companyId } = await env.seedCompany();
    const { ingestArtifact } = await import("@orrn/db/schema/ingest");
    const row = {
      companyId,
      sha256: "a".repeat(64),
      fileName: "a.csv",
      kind: "csv" as const,
      sizeBytes: 10,
      vaultState: "not_stored" as const,
      readState: "reading" as const,
    };
    await env.db.insert(ingestArtifact).values({ id: "art-1", ...row });
    await expect(Promise.resolve(env.db.insert(ingestArtifact).values({ id: "art-2", ...row }))).rejects.toThrow();
  });
});

describe("permissions", () => {
  const ROLES: CompanyRole[] = [
    "owner",
    "admin",
    "manager",
    "office",
    "accountant",
    "supervisor",
    "packer",
    "foundry",
    "press",
    "storekeeper",
    "die_room",
    "operator",
    "viewer",
  ];

  test("ingest.upload and ingest.merge belong to owner and admin only", async () => {
    const { can } = await import("../src/lib/permissions");
    for (const action of ["ingest.upload", "ingest.merge"] as const) {
      const holders = ROLES.filter((role) => can({ company: { role }, isPlatformAdmin: false, platformRole: null }, action));
      expect({ action, holders }).toEqual({ action, holders: ["owner", "admin"] });
    }
  });
});

describe("backups", () => {
  test("staged rows and merge chunks are excluded; the other ingest tables are exported", async () => {
    const { EXCLUDED_TABLES } = await import("../src/lib/backup");
    expect(EXCLUDED_TABLES.has("ingest_staged_row")).toBe(true);
    expect(EXCLUDED_TABLES.has("ingest_merge_chunk")).toBe(true);
    for (const t of INGEST_TABLES.filter((n) => n !== "ingest_staged_row" && n !== "ingest_merge_chunk")) {
      expect({ t, excluded: EXCLUDED_TABLES.has(t) }).toEqual({ t, excluded: false });
    }
  });
});

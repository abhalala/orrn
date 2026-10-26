import { afterAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { assertPreserved, decryptBackup, encryptBackup, pendingMigrations } from "./production-safety";

const temporary = await mkdtemp(join(tmpdir(), "orrn-production-safety-test-"));
const root = resolve(import.meta.dir, "../../..");
afterAll(async () => { await rm(temporary, { recursive: true, force: true }); });

describe("production release guards", () => {
  test("rejects unknown migration branches and gaps instead of replaying guessed history", () => {
    const files = ["0000_a.sql", "0001_b.sql", "0002_c.sql"];
    expect(pendingMigrations(files, ["0000_a.sql"])).toEqual(["0001_b.sql", "0002_c.sql"]);
    expect(() => pendingMigrations(files, ["unknown.sql"])).toThrow("absent from this checkout");
    expect(() => pendingMigrations(files, ["0000_a.sql", "0002_c.sql"])).toThrow("gap");
  });

  test("detects lost rows or tables; only live verification permits growth", () => {
    expect(() => assertPreserved({ bundle: 2 }, { bundle: 1 })).toThrow();
    expect(() => assertPreserved({ bundle: 2 }, {})).toThrow();
    expect(() => assertPreserved({ bundle: 2 }, { bundle: 3 })).toThrow();
    expect(() => assertPreserved({ bundle: 2 }, { bundle: 3 }, true)).not.toThrow();
  });

  test("encrypted backup restores exactly and rejects tampering and the wrong historical key", async () => {
    const input = join(temporary, "source");
    const encrypted = join(temporary, "backup.enc");
    const restored = join(temporary, "restored");
    const content = Buffer.from("Private fixture data\n".repeat(100_000));
    await writeFile(input, content);
    await encryptBackup(input, encrypted, "test-only-production-key");
    expect((await readFile(encrypted)).includes(Buffer.from("Private fixture data"))).toBe(false);
    await decryptBackup(encrypted, restored, "test-only-production-key");
    expect(await readFile(restored)).toEqual(content);
    await expect(decryptBackup(encrypted, restored, "wrong-key")).rejects.toThrow();
    expect(await Bun.file(restored).exists()).toBe(false);
    const corrupted = await readFile(encrypted);
    corrupted[100] = corrupted[100]! ^ 1;
    await writeFile(encrypted, corrupted);
    await expect(decryptBackup(encrypted, restored, "test-only-production-key")).rejects.toThrow();
    expect(await Bun.file(restored).exists()).toBe(false);
  });

  test("rehearses the full 0009-to-current migration path with legacy operational rows on local D1", async () => {
    const directory = join(temporary, "orrn-production-safety");
    await mkdir(directory);
    const migrationsDir = join(root, "packages/db/src/migrations");
    const files = (await readdir(migrationsDir)).filter((name) => name.endsWith(".sql")).sort();
    const baseline = files.filter((name) => Number(name.slice(0, 4)) <= 9);
    const db = new Database(":memory:");
    let sql = "";
    for (const file of baseline) { const part = await readFile(join(migrationsDir, file), "utf8"); db.exec(part); sql += `${part}\n`; }
    const fixture = `
INSERT INTO company (id, name, slug, status, modules) VALUES ('release-company', 'Release fixture', 'release-fixture', 'active', '["customers","dies","bundles","dispatches"]');
INSERT INTO customer (id, company_id, name) VALUES ('release-customer', 'release-company', 'Fixture customer');
INSERT INTO die (id, company_id, series, section_code, weight_min_g, weight_max_g, oblique_mm, notes) VALUES ('release-die', 'release-company', 'PATTI', 'RELEASE-1', 2400, 2600, 7, 'Retain this note');
INSERT INTO bundle_group (id, company_id, die_id, unit, code) VALUES ('release-group', 'release-company', 'release-die', 'mm', 'BG-000001');
INSERT INTO bundle (id, company_id, group_id, die_id, serial, quantity, weight_g, length_mm) VALUES ('release-bundle', 'release-company', 'release-group', 'release-die', 'BG-000001-B001', 20, 50000, 3658);
INSERT INTO dispatch (id, company_id, code, customer_id) VALUES ('release-dispatch', 'release-company', 'DSP-1', 'release-customer');
CREATE TABLE d1_migrations (id TEXT PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL);
${baseline.map((name, i) => `INSERT INTO d1_migrations VALUES ('${String(i + 1).padStart(5, "0")}', '${name}', '2026-10-01');`).join("\n")}
`;
    db.exec(fixture); sql += fixture;
    const names = db.query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name <> 'd1_migrations'").all();
    const counts = Object.fromEntries(names.map(({ name }) => [name, db.query<{ n: number }, []>(`SELECT count(*) AS n FROM "${name}"`).get()!.n]));
    db.close();
    await writeFile(join(directory, "production.sql"), sql);
    await writeFile(join(directory, "before.json"), JSON.stringify({ counts, foreignKeyViolations: 0, migrations: baseline.map((name, i) => ({ id: String(i + 1), name })) }));
    await writeFile(join(directory, "wrangler.json"), JSON.stringify({ name: "orrn-release-test", compatibility_date: "2026-10-01", d1_databases: [{ binding: "DB", database_name: "release-test", database_id: "00000000-0000-0000-0000-000000000001" }] }));
    const fixtureEnv: NodeJS.ProcessEnv = { ...process.env, RUNNER_TEMP: temporary };
    delete fixtureEnv.CLOUDFLARE_API_TOKEN;
    delete fixtureEnv.CLOUDFLARE_ACCOUNT_ID;
    delete fixtureEnv.ORRN_MASTER_KEY;
    const result = Bun.spawnSync([process.execPath, join(import.meta.dir, "production-safety.ts"), "rehearse"], { cwd: root, env: fixtureEnv, stdout: "pipe", stderr: "pipe", timeout: 180_000 });
    if (result.exitCode !== 0 && await Bun.file(join(directory, "private-command-error.log")).exists()) console.error(await readFile(join(directory, "private-command-error.log"), "utf8"));
    expect(new TextDecoder().decode(result.stderr)).toBe("");
    expect(result.exitCode).toBe(0);
    expect(new TextDecoder().decode(result.stdout)).toContain("Every existing table's row count and foreign-key integrity were preserved");
    const checked = Bun.spawnSync([join(root, "apps/server/node_modules/.bin/wrangler"), "d1", "execute", "DB", "--local", "--persist-to", join(directory, "state"), "--config", join(directory, "wrangler.json"), "--command", "SELECT (SELECT notes FROM die WHERE id='release-die') AS notes, (SELECT modules FROM company WHERE id='release-company') AS modules, (SELECT weight_g FROM bundle WHERE id='release-bundle') AS grams", "--json"], { cwd: root, env: fixtureEnv, stdout: "pipe", stderr: "pipe" });
    expect(checked.exitCode).toBe(0);
    const row = JSON.parse(new TextDecoder().decode(checked.stdout))[0].results[0];
    expect(row.notes).toBe("Retain this note\nOblique (legacy): 7 mm");
    expect(JSON.parse(row.modules)).toEqual([]);
    expect(row.grams).toBe(50_000);
  }, 180_000);
});

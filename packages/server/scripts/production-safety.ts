import assert from "node:assert/strict";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { createReadStream, createWriteStream, writeFileSync } from "node:fs";
import { mkdir, open, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";

const root = resolve(import.meta.dir, "../../..");
const migrationsDir = join(root, "packages/db/src/migrations");
const header = Buffer.from("ORRN-D1-BACKUP-v1\n");
const protectedNames = new Set(["bundle", "bundle_group", "dispatch", "dispatch_item", "packing_list", "customer", "die", "audit_log", "print_log"]);
type Row = Record<string, unknown>;
type Snapshot = {
  databaseId: string;
  databaseName: string;
  revision: string;
  capturedAt: string;
  bookmark: unknown;
  migrations: { id: string; name: string }[];
  counts: Record<string, number>;
  foreignKeyViolations: number;
};

function required(name: string): string {
  const value = process.env[name];
  assert(value, `${name} is required`);
  return value;
}

function safetyDir(): string {
  return join(required("RUNNER_TEMP"), "orrn-production-safety");
}

/** Never print CLI output: failed SQL imports can echo private production rows. */
function run(label: string, args: string[]): string {
  const result = Bun.spawnSync(args, { cwd: root, stdout: "pipe", stderr: "pipe", timeout: 600_000 });
  if (result.exitCode !== 0) writeFileSync(join(safetyDir(), "private-command-error.log"), Buffer.concat([result.stdout, result.stderr]), { mode: 0o600 });
  assert.equal(result.exitCode, 0, `${label} failed (exit ${result.exitCode}); private command output suppressed`);
  return new TextDecoder().decode(result.stdout);
}

function wrangler(label: string, args: string[]): string {
  return run(label, [join(root, "apps/server/node_modules/.bin/wrangler"), ...args, "--config", join(safetyDir(), "wrangler.json")]);
}

async function cf(path: string, sql?: string): Promise<unknown> {
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${required("CLOUDFLARE_ACCOUNT_ID")}/${path}`, {
    method: sql === undefined ? "GET" : "POST",
    headers: { Authorization: `Bearer ${required("CLOUDFLARE_API_TOKEN")}`, "Content-Type": "application/json" },
    ...(sql === undefined ? {} : { body: JSON.stringify({ sql }) }),
  });
  const body = await response.json() as { success?: boolean; result?: unknown; errors?: { code?: number }[] };
  assert(response.ok && body.success, `Cloudflare request failed (HTTP ${response.status}; codes ${body.errors?.map((e) => e.code).join(",") ?? "unknown"})`);
  return body.result;
}

async function query(databaseId: string, sql: string): Promise<Row[]> {
  // Every production query in this script is read-only. Local rehearsal uses a separate CLI path.
  assert(/^(SELECT\b|PRAGMA (?:table_info|foreign_key_check))/i.test(sql.trim()), "Production safety queries must be read-only");
  const result = await cf(`d1/database/${databaseId}/query`, sql) as { success: boolean; results: Row[] }[];
  assert(result.every((r) => r.success), "Production read failed");
  return result.flatMap((r) => r.results);
}

const identifier = (name: string) => `"${name.replaceAll('"', '""')}"`;
const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;
const tablesSql = "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name <> 'd1_migrations' ORDER BY name";
async function tableCounts(read: (sql: string) => Promise<Row[]>, names: string[]): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  // Bounded scalar columns avoid D1's strict compound-SELECT limit without an N+1 request per table.
  for (let offset = 0; offset < names.length; offset += 20) {
    const batch = names.slice(offset, offset + 20);
    const rows = await read(`SELECT ${batch.map((name) => `(SELECT count(*) FROM ${identifier(name)}) AS ${identifier(name)}`).join(", ")}`);
    assert(rows[0], "Table-count read returned no result");
    for (const name of batch) counts[name] = Number(rows[0][name]);
  }
  return counts;
}

/** Only names present in the reviewed checkout may be considered already applied. */
export function pendingMigrations(files: string[], applied: string[]): string[] {
  const known = new Set(files);
  assert(applied.every((name) => known.has(name)), "Production contains migration names absent from this checkout");
  const appliedSet = new Set(applied);
  const pending = files.filter((name) => !appliedSet.has(name));
  if (pending.length) assert(!files.slice(files.indexOf(pending[0]!)).some((name) => appliedSet.has(name)), "Production migration history has a gap");
  return pending;
}

export function assertPreserved(before: Record<string, number>, after: Record<string, number>, minimum = false): void {
  for (const [table, count] of Object.entries(before)) {
    assert(Object.hasOwn(after, table), `A pre-existing table disappeared: ${table}`);
    assert(minimum ? after[table]! >= count : after[table] === count, `Pre-existing rows were not preserved in ${table}`);
  }
}

function backupKey(secret: string): Buffer {
  assert(secret.trim(), "ORRN_MASTER_KEY is required to encrypt the production backup");
  return createHash("sha256").update("orrn-production-backup:v1\0").update(secret).digest();
}

/** Authenticated, streaming encryption; a public repository must never upload plaintext SQL. */
export async function encryptBackup(input: string, output: string, secret: string): Promise<void> {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", backupKey(secret), iv);
  await writeFile(output, Buffer.concat([header, iv]), { mode: 0o600 });
  await pipeline(createReadStream(input), cipher, createWriteStream(output, { flags: "a", mode: 0o600 }));
  await writeFile(output, cipher.getAuthTag(), { flag: "a" });
}

export async function decryptBackup(input: string, output: string, secret: string): Promise<void> {
  const file = await open(input, "r");
  const size = (await file.stat()).size;
  const prefix = Buffer.alloc(header.length + 12);
  const tag = Buffer.alloc(16);
  try {
    assert(size > prefix.length + tag.length, "Truncated production backup");
    await file.read(prefix, 0, prefix.length, 0);
    await file.read(tag, 0, tag.length, size - tag.length);
  } finally {
    await file.close();
  }
  assert(prefix.subarray(0, header.length).equals(header), "Unsupported production backup format");
  const decipher = createDecipheriv("aes-256-gcm", backupKey(secret), prefix.subarray(header.length));
  decipher.setAuthTag(tag);
  try {
    await pipeline(createReadStream(input, { start: prefix.length, end: size - tag.length - 1 }), decipher, createWriteStream(output, { mode: 0o600 }));
  } catch (error) {
    await rm(output, { force: true });
    throw error;
  }
}

async function digest(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function local(sql: string): Promise<Row[]> {
  const file = join(safetyDir(), "query.sql");
  await writeFile(file, sql, { mode: 0o600 });
  const result = JSON.parse(wrangler("Local D1 query", ["d1", "execute", "DB", "--local", "--persist-to", join(safetyDir(), "state"), "--file", file, "--json"])) as { success: boolean; results: Row[] }[];
  assert(result.every((r) => r.success), "Local D1 rehearsal query failed");
  return result.flatMap((r) => r.results);
}

async function backup(): Promise<void> {
  required("ORRN_MASTER_KEY");
  await mkdir(safetyDir(), { recursive: true, mode: 0o700 });
  // Resolve the actual deployed production binding. Never guess a database by a name prefix.
  const domains = await cf("workers/domains") as { hostname: string; service: string }[];
  const matches = domains.filter((domain) => domain.hostname === "api.orrn.in");
  assert.equal(matches.length, 1, "Expected exactly one deployed api.orrn.in Worker domain");
  const settings = await cf(`workers/scripts/${encodeURIComponent(matches[0]!.service)}/settings`) as { bindings: { type: string; name: string; id: string }[] };
  const bindings = settings.bindings.filter((binding) => binding.type === "d1" && binding.name === "DB");
  assert.equal(bindings.length, 1, "Expected one production D1 DB binding");
  const databaseId = bindings[0]!.id;
  const database = await cf(`d1/database/${databaseId}`) as { uuid: string; name: string };
  assert.equal(database.uuid, databaseId, "Production database identity mismatch");
  await writeFile(join(safetyDir(), "wrangler.json"), JSON.stringify({
    name: "orrn-production-safety", compatibility_date: "2026-10-01",
    d1_databases: [{ binding: "DB", database_name: database.name, database_id: databaseId }],
  }), { mode: 0o600 });
  const columns = await query(databaseId, "PRAGMA table_info(d1_migrations)");
  assert(["id", "name", "applied_at"].every((column) => columns.some((r) => r.name === column)), "Unexpected production migration-table format; inspect before deploying");
  const migrations = await query(databaseId, "SELECT id, name FROM d1_migrations ORDER BY name") as Snapshot["migrations"];
  const names = (await query(databaseId, tablesSql)).map((row) => String(row.name));
  const before: Snapshot = {
    databaseId, databaseName: database.name, revision: required("GITHUB_SHA"), capturedAt: new Date().toISOString(),
    bookmark: JSON.parse(wrangler("Time Travel bookmark", ["d1", "time-travel", "info", "DB", "--json"])),
    migrations, counts: await tableCounts((sql) => query(databaseId, sql), names),
    foreignKeyViolations: (await query(databaseId, "PRAGMA foreign_key_check")).length,
  };
  assert(typeof (before.bookmark as { bookmark?: unknown }).bookmark === "string", "Time Travel returned no recovery bookmark");
  await writeFile(join(safetyDir(), "before.json"), JSON.stringify(before), { mode: 0o600 });
  wrangler("Production database export", ["d1", "export", "DB", "--remote", "--skip-confirmation", "--output", join(safetyDir(), "production.sql")]);
  assert((await stat(join(safetyDir(), "production.sql"))).size > 0, "Production export is empty");
  run("Backup archive", ["tar", "-czf", join(safetyDir(), "backup.tar.gz"), "-C", safetyDir(), "before.json", "wrangler.json", "production.sql"]);
  await encryptBackup(join(safetyDir(), "backup.tar.gz"), join(safetyDir(), "backup.enc"), required("ORRN_MASTER_KEY"));
  await decryptBackup(join(safetyDir(), "backup.enc"), join(safetyDir(), "verified.tar.gz"), required("ORRN_MASTER_KEY"));
  assert.equal(await digest(join(safetyDir(), "backup.tar.gz")), await digest(join(safetyDir(), "verified.tar.gz")), "Encrypted backup round-trip failed");
  console.log("Production binding verified; Time Travel bookmark and encrypted export captured and round-trip verified.");
}

async function rehearse(): Promise<void> {
  const before = JSON.parse(await readFile(join(safetyDir(), "before.json"), "utf8")) as Snapshot;
  assert.equal(before.foreignKeyViolations, 0, "Production has pre-existing foreign-key violations; inspect before cutover");
  const files = (await readdir(migrationsDir)).filter((name) => name.endsWith(".sql")).sort();
  const pending = pendingMigrations(files, before.migrations.map((migration) => migration.name));
  assert(!pending.includes("0028_fp_wave2.sql") || !before.counts.melt, "The melt rebuild is unsafe on an existing melt; cutover stopped");
  wrangler("Restore production export to local D1", ["d1", "execute", "DB", "--local", "--persist-to", join(safetyDir(), "state"), "--file", join(safetyDir(), "production.sql"), "--yes"]);
  const copiedTables = (await local(tablesSql)).map((row) => String(row.name));
  const copied = await tableCounts(local, copiedTables);
  // The export may include writes made after the earlier remote read. Sessions can also expire.
  // Check document lower bounds here, then compare every frozen copy's table exactly after rehearsal.
  assert(Object.keys(before.counts).every((name) => Object.hasOwn(copied, name)), "A production table is missing from the export");
  assertPreserved(Object.fromEntries(Object.entries(before.counts).filter(([name]) => protectedNames.has(name))), copied, true);
  let sequence = Math.max(0, ...before.migrations.map((migration) => Number(migration.id)).filter(Number.isFinite));
  for (const name of pending) {
    const sql = await readFile(join(migrationsDir, name), "utf8");
    // Match Alchemy: each file and its history row execute together, including all D1 rebuild guards.
    await local(`${sql}\nINSERT INTO d1_migrations (id, name, applied_at) VALUES (${literal(String(++sequence).padStart(5, "0"))}, ${literal(name)}, datetime('now'));`);
  }
  const afterNames = (await local(tablesSql)).map((row) => String(row.name));
  assertPreserved(copied, await tableCounts(local, afterNames));
  assert.equal((await local("PRAGMA foreign_key_check")).length, 0, "Rehearsed migrations introduced foreign-key violations");
  assert.equal((await local("SELECT name FROM d1_migrations")).length, files.length, "Rehearsal migration history is incomplete");
  console.log(`Rehearsed ${pending.length} pending migrations on the production export. Every existing table's row count and foreign-key integrity were preserved.`);
}

async function verify(): Promise<void> {
  const before = JSON.parse(await readFile(join(safetyDir(), "before.json"), "utf8")) as Snapshot;
  const afterNames = (await query(before.databaseId, tablesSql)).map((row) => String(row.name));
  const after = await tableCounts((sql) => query(before.databaseId, sql), afterNames);
  const protectedCounts = Object.fromEntries(Object.entries(before.counts).filter(([name]) => protectedNames.has(name)));
  // Live traffic may add documents while deploying, so production counts may increase.
  assertPreserved(protectedCounts, after, true);
  assert.equal((await query(before.databaseId, "PRAGMA foreign_key_check")).length, 0, "Production foreign-key verification failed");
  const files = (await readdir(migrationsDir)).filter((name) => name.endsWith(".sql")).sort();
  const applied = (await query(before.databaseId, "SELECT name FROM d1_migrations")).map((row) => String(row.name));
  assert.equal(pendingMigrations(files, applied).length, 0, "Production has unapplied migrations");
  console.log("Production migration history is complete, protected document counts are preserved and foreign-key verification passed.");
}

if (import.meta.main) {
  const mode = process.argv[2];
  if (mode === "decrypt") {
    assert(process.argv[3] && process.argv[4], "Usage: production-safety.ts decrypt <backup.enc> <backup.tar.gz>");
    await decryptBackup(process.argv[3], process.argv[4], required("ORRN_MASTER_KEY"));
  } else if (mode === "backup") await backup();
  else if (mode === "rehearse") await rehearse();
  else if (mode === "verify") await verify();
  else throw new Error("Expected backup, rehearse, verify or decrypt");
}

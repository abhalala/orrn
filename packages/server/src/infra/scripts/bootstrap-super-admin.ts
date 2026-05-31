/**
 * Grant platform super_admin to an existing Better Auth user by email.
 * Usage (from packages/server):
 *   bun --env-file=.env src/infra/scripts/bootstrap-super-admin.ts --stage production user@example.com
 *   bun --env-file=.env src/infra/scripts/bootstrap-super-admin.ts --stage dev user@example.com
 */
import { config } from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const infraDir = dirname(fileURLToPath(import.meta.url));
config({ path: join(infraDir, "../../../.env") });

const STAGE_DB: Record<string, string> = {
  production: "c633f951-f2a1-4c4e-bdb0-12cb8efe8e22",
  dev: "0da1b8cd-02e2-4c06-9cb7-fcc61e317aa6",
};

const args = process.argv.slice(2);
const stageFlag = args.find((a) => a.startsWith("--stage="))?.split("=")[1]
  ?? (args.includes("--stage") ? args[args.indexOf("--stage") + 1] : "production");
const emailArg = args.find((a) => !a.startsWith("--") && a !== stageFlag);

if (!emailArg) {
  console.error("Usage: bootstrap-super-admin.ts --stage <production|dev> <email>");
  process.exit(1);
}

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const token = process.env.CLOUDFLARE_API_TOKEN;
const dbId = STAGE_DB[stageFlag as keyof typeof STAGE_DB];

if (!accountId || !token) {
  console.error("Missing CLOUDFLARE_ACCOUNT_ID or CLOUDFLARE_API_TOKEN in packages/server/.env");
  process.exit(1);
}
if (!dbId) {
  console.error(`Unknown stage "${stageFlag}". Use production or dev.`);
  process.exit(1);
}

const email = emailArg.trim().toLowerCase();

async function query(sql: string, params: unknown[] = []) {
  const r = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${dbId}/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ sql, params }),
    },
  );
  const j = (await r.json()) as {
    success: boolean;
    errors?: unknown;
    result?: { results: unknown[] }[];
  };
  if (!j.success) {
    throw new Error(JSON.stringify(j.errors));
  }
  return j.result?.[0]?.results ?? [];
}

const users = (await query("SELECT id, email, name FROM user WHERE email = ? LIMIT 1", [
  email,
])) as { id: string; email: string; name: string }[];

const userRow = users[0];
if (!userRow) {
  console.error(
    `No user with email ${email} in ${stageFlag} D1. Sign up on ${stageFlag === "production" ? "https://orrn.in" : "https://dev.orrn.app"} first, then re-run.`,
  );
  process.exit(1);
}

const now = Date.now();
await query(
  `INSERT INTO platform_admin (user_id, role, created_at, created_by)
   VALUES (?, 'super_admin', ?, NULL)
   ON CONFLICT (user_id) DO UPDATE SET role = 'super_admin'`,
  [userRow.id, now],
);

console.log(`OK: ${userRow.email} (${userRow.id}) is super_admin on ${stageFlag}.`);

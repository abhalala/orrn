/**
 * Set email/password credentials for an existing user (or create staff user on D1).
 *
 * Usage (from packages/server):
 *   STAFF_PASSWORD='…' bun --env-file=.env src/infra/scripts/set-staff-password.ts --stage production ansh@bhalala.org
 */
import { randomBytes } from "node:crypto";
import { config } from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { hashPassword } from "@orrn/auth/password";

const infraDir = dirname(fileURLToPath(import.meta.url));
config({ path: join(infraDir, "../../../.env") });

const STAGE_DB: Record<string, string> = {
  production: "c633f951-f2a1-4c4e-bdb0-12cb8efe8e22",
  dev: "0da1b8cd-02e2-4c06-9cb7-fcc61e317aa6",
};

const args = process.argv.slice(2);
const stageFlag =
  args.find((a) => a.startsWith("--stage="))?.split("=")[1] ??
  (args.includes("--stage") ? args[args.indexOf("--stage") + 1] : "production");
const forceChange = !args.includes("--no-force-change");
const emailArg = args.find(
  (a) => !a.startsWith("--") && a !== stageFlag && a !== "--no-force-change",
);
const password = process.env.STAFF_PASSWORD;

if (!emailArg || !password || password.length < 8) {
  console.error(
    "Usage: STAFF_PASSWORD='…' bun --env-file=.env scripts/set-staff-password.ts --stage <production|dev> <email>",
  );
  process.exit(1);
}

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const token = process.env.CLOUDFLARE_API_TOKEN;
const dbId = STAGE_DB[stageFlag as keyof typeof STAGE_DB];
const email = emailArg.trim().toLowerCase();

if (!accountId || !token || !dbId) {
  console.error("Missing CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, or unknown stage.");
  process.exit(1);
}

function nanoidLike(size = 21): string {
  const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  const bytes = randomBytes(size);
  let id = "";
  for (let i = 0; i < size; i++) id += alphabet[bytes[i]! % alphabet.length];
  return id;
}

async function query<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
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
    result?: { results: T[] }[];
  };
  if (!j.success) throw new Error(JSON.stringify(j.errors));
  return j.result?.[0]?.results ?? [];
}

const hashed = await hashPassword(password);
const now = Date.now();

let users = await query<{ id: string; email: string; name: string }>(
  "SELECT id, email, name FROM user WHERE email = ? LIMIT 1",
  [email],
);

let userId = users[0]?.id;

if (!userId) {
  userId = nanoidLike(24);
  const name = email.split("@")[0] ?? "Staff";
  await query(
    `INSERT INTO user (id, name, email, email_verified, image, created_at, updated_at, two_factor_enabled, onboarding_completed, must_change_password)
     VALUES (?, ?, ?, 1, NULL, ?, ?, 0, 1, ?)`,
    [userId, name, email, now, now, forceChange ? 1 : 0],
  );
  console.log(`Created user ${email} (${userId}) on ${stageFlag}`);
}

const accounts = await query<{ id: string; provider_id: string }>(
  "SELECT id, provider_id FROM account WHERE user_id = ?",
  [userId],
);

const credential = accounts.find((a) => a.provider_id === "credential");

if (credential) {
  await query("UPDATE account SET password = ?, updated_at = ? WHERE id = ?", [
    hashed,
    now,
    credential.id,
  ]);
} else {
  const accountRowId = nanoidLike(24);
  await query(
    `INSERT INTO account (id, account_id, provider_id, user_id, password, created_at, updated_at)
     VALUES (?, ?, 'credential', ?, ?, ?, ?)`,
    [accountRowId, userId, userId, hashed, now, now],
  );
}

await query(
  "UPDATE user SET email_verified = 1, onboarding_completed = 1, must_change_password = ?, updated_at = ? WHERE id = ?",
  [forceChange ? 1 : 0, now, userId],
);

await query(
  `INSERT INTO platform_admin (user_id, role, created_at, created_by)
   VALUES (?, 'super_admin', ?, NULL)
   ON CONFLICT (user_id) DO UPDATE SET role = 'super_admin'`,
  [userId, now],
);

console.log(
  `OK: password updated for ${email} on ${stageFlag} (staff super_admin)` +
    (forceChange ? " — user must change password on next login." : "") +
    ".",
);

/** Opt Fourcubes into die-based packing groups. Missing company is a safe no-op. */
import { config } from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const infraDir = dirname(fileURLToPath(import.meta.url));
config({ path: join(infraDir, "../../../.env") });

const FOURCUBES_COMPANY_ID = "f869924a-b5d0-4125-a3b1-9b4c9a8e26c3";
const STAGE_DB: Record<string, string> = {
  production: "c633f951-f2a1-4c4e-bdb0-12cb8efe8e22",
  dev: "0da1b8cd-02e2-4c06-9cb7-fcc61e317aa6",
};
const args = process.argv.slice(2);
const stageArg = args.find((arg) => arg.startsWith("--stage="))?.split("=")[1]
  ?? (args.includes("--stage") ? args[args.indexOf("--stage") + 1] : "production");
if (stageArg !== "production" && stageArg !== "dev") {
  console.error("Invalid --stage (production|dev)");
  process.exit(1);
}
const stage: keyof typeof STAGE_DB = stageArg;
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const token = process.env.CLOUDFLARE_API_TOKEN;
const dbId = STAGE_DB[stage];
if (!accountId || !token || !dbId) {
  console.error("Missing Cloudflare credentials or invalid --stage (production|dev)");
  process.exit(1);
}

async function query(sql: string, params: unknown[] = []) {
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${dbId}/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ sql, params }),
  });
  const body = await response.json() as { success: boolean; errors?: unknown; result?: Array<{ results: unknown[] }> };
  if (!body.success) throw new Error(JSON.stringify(body.errors));
  return body.result?.[0]?.results ?? [];
}

const rows = await query("SELECT id FROM company WHERE id = ? LIMIT 1", [FOURCUBES_COMPANY_ID]);
if (rows.length === 0) {
  console.log(`SKIP: Fourcubes company is absent from ${stage}.`);
} else {
  await query(
    "UPDATE company SET settings = json_patch(COALESCE(settings, '{}'), '{\"packingGroupKey\":\"die\"}') WHERE id = ?",
    [FOURCUBES_COMPANY_ID],
  );
  console.log(`OK: Fourcubes packingGroupKey=die on ${stage}.`);
}

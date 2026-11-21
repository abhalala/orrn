/**
 * Shared set-up for the buddy tests (design 2026-11-18): a plant listed in `BUDDY_COMPANIES`, a grant made
 * through `buddy.grant.create`, and helpers that speak to `/mcp` in-process. Synthetic data only.
 */
import { company } from "@orrn/db/schema";
import type { CompanyRole } from "@orrn/db/schema/tenant";
import { eq } from "drizzle-orm";

import { workersEnv } from "./env-mock";
import type { TestEnv } from "./harness";

export const FAKE_HERMES_ENV = {
  HERMES_BASE_URL: "https://hermes.test",
  HERMES_ACCESS_CLIENT_ID: "fake-access-id",
  HERMES_ACCESS_CLIENT_SECRET: "fake-access-secret",
  HERMES_API_KEY: "fake-hermes-key",
} as const;

export function setHermesEnv(on: boolean): void {
  for (const [k, v] of Object.entries(FAKE_HERMES_ENV)) {
    if (on) workersEnv[k] = v;
    else delete workersEnv[k];
  }
}

/** Add a company's slug to `BUDDY_COMPANIES` (the env object is read at call time). */
export async function listPlant(env: TestEnv, companyId: string): Promise<string> {
  const row = await env.db.select({ slug: company.slug }).from(company).where(eq(company.id, companyId)).get();
  const slugs = new Set(String(workersEnv.BUDDY_COMPANIES ?? "").split(",").filter(Boolean));
  slugs.add(row!.slug);
  workersEnv.BUDDY_COMPANIES = [...slugs].join(",");
  return row!.slug;
}

export async function unlistPlant(env: TestEnv, companyId: string): Promise<void> {
  const row = await env.db.select({ slug: company.slug }).from(company).where(eq(company.id, companyId)).get();
  const slugs = String(workersEnv.BUDDY_COMPANIES ?? "").split(",").filter((s) => s && s !== row!.slug);
  workersEnv.BUDDY_COMPANIES = slugs.join(",");
}

export type BuddyPlant = Awaited<ReturnType<TestEnv["seedCompany"]>> & {
  owner: ReturnType<TestEnv["caller"]>;
  as: (role: CompanyRole) => ReturnType<TestEnv["caller"]>;
  slug: string;
};

export async function buddyPlant(env: TestEnv, opts: { modules?: string[]; settings?: Record<string, unknown> } = {}): Promise<BuddyPlant> {
  const seeded = await env.seedCompany(opts);
  const slug = await listPlant(env, seeded.companyId);
  const as = (role: CompanyRole) => env.caller({ role, companyId: seeded.companyId });
  return { ...seeded, owner: as("owner"), as, slug };
}

/** "Connect Hermes" as the plant's owner: a grant token (shown once). */
export async function connect(p: BuddyPlant): Promise<{ token: string; grantId: string }> {
  return p.owner.buddy.grant.create();
}

let rpcId = 0;

export async function mcpRequest(
  env: TestEnv,
  token: string | null,
  body: unknown,
  opts: { method?: string; headers?: Record<string, string>; roles?: readonly CompanyRole[] } = {},
): Promise<Response> {
  const { handleMcpRequest } = await import("../src/lib/buddy/mcp");
  const headers: Record<string, string> = { "content-type": "application/json", ...(opts.headers ?? {}) };
  if (token) headers.authorization = `Bearer ${token}`;
  const method = opts.method ?? "POST";
  const request = new Request("https://api.test/mcp", {
    method,
    headers,
    ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
  });
  return handleMcpRequest(request, { db: env.db, ...(opts.roles ? { roles: opts.roles } : {}) });
}

export type ToolEnvelope = {
  status: string;
  asOf: string;
  data?: any;
  message?: string;
  issues?: unknown[];
  truncated?: true;
  hint?: string;
};

/** One `tools/call`; returns the envelope (or throws on an HTTP or JSON-RPC error). */
export async function tool(
  env: TestEnv,
  token: string,
  name: string,
  args: Record<string, unknown>,
  opts: { roles?: readonly CompanyRole[] } = {},
): Promise<ToolEnvelope> {
  rpcId += 1;
  const res = await mcpRequest(env, token, { jsonrpc: "2.0", id: rpcId, method: "tools/call", params: { name, arguments: args } }, opts);
  if (res.status !== 200) throw new Error(`mcp answered HTTP ${res.status}`);
  const body = (await res.json()) as { result?: { content: { text: string }[]; structuredContent: ToolEnvelope }; error?: unknown };
  if (!body.result) throw new Error(`mcp error ${JSON.stringify(body.error)}`);
  const parsed = JSON.parse(body.result.content[0]!.text) as ToolEnvelope;
  return parsed;
}

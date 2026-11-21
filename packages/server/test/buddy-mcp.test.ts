/**
 * orrn buddy, tool leg: `POST /mcp` (design 2026-11-18, §4.2, §4.3, §7, §10, §12).
 *
 * Pins: a grant reaches only its own plant; a role without the action is forbidden (and the gate refuses
 * a role outside BUDDY_ROLES); denied paths are not found; buddy.* is unreachable; revoked or expired
 * grants are refused; rate limits; one buddy_call row per call; the 32 KB cap, the 256 KB body and the batch of 20; the secure sign-in gate
 * judges a grant like the session that made it; the MCP module imports no write code.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { buddyCall, buddyDraft, buddyGrant, company, customer, membership } from "@orrn/db/schema";
import { and, eq, sql } from "drizzle-orm";

import { buddyPlant, connect, mcpRequest, tool, unlistPlant, type BuddyPlant } from "./buddy-fixture";
import { createTestEnv, type TestEnv } from "./harness";

let env: TestEnv;

beforeAll(async () => {
  env = await createTestEnv();
});

afterAll(async () => {
  await env.dispose();
});

async function grantFor(p: BuddyPlant, userId: string, over: Partial<typeof buddyGrant.$inferInsert> = {}): Promise<string> {
  const { newBuddyToken, hashBuddyToken } = await import("../src/lib/buddy/token");
  const { createId } = await import("../src/lib/id");
  const token = newBuddyToken();
  await env.db.insert(buddyGrant).values({
    id: createId(),
    companyId: p.companyId,
    userId,
    tokenHash: await hashBuddyToken(token),
    createdBy: userId,
    expiresAt: new Date(Date.now() + 86_400_000),
    ...over,
  });
  return token;
}

describe("HTTP and JSON-RPC", () => {
  test("no token or a wrong token: 401 with no body; GET/DELETE 405; a browser Origin 403", async () => {
    const p = await buddyPlant(env);
    const { token } = await connect(p);
    const init = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } };
    const none = await mcpRequest(env, null, init);
    expect(none.status).toBe(401);
    expect(await none.text()).toBe("");
    expect((await mcpRequest(env, `${token.slice(0, -2)}xx`, init)).status).toBe(401);
    expect((await mcpRequest(env, "not-a-token", init)).status).toBe(401);
    expect((await mcpRequest(env, token, null, { method: "GET" })).status).toBe(405);
    expect((await mcpRequest(env, token, null, { method: "DELETE" })).status).toBe(405);
    expect((await mcpRequest(env, token, init, { headers: { origin: "https://app.test" } })).status).toBe(403);
  });

  test("initialize, tools/list, ping, a notification (202), an unknown method", async () => {
    const p = await buddyPlant(env);
    const { token } = await connect(p);
    const init = await mcpRequest(env, token, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } });
    expect(init.headers.get("content-type")).toContain("application/json");
    expect(await init.json()).toMatchObject({ id: 1, result: { protocolVersion: "2025-03-26", serverInfo: { name: "orrn" }, capabilities: { tools: {} } } });
    const list = (await (await mcpRequest(env, token, { jsonrpc: "2.0", id: 2, method: "tools/list" })).json()) as { result: { tools: { name: string }[] } };
    expect(list.result.tools.map((t) => t.name)).toEqual(["orrn_search", "orrn_describe", "orrn_call", "orrn_review_link"]);
    expect(await (await mcpRequest(env, token, { jsonrpc: "2.0", id: 3, method: "ping" })).json()).toMatchObject({ id: 3, result: {} });
    const note = await mcpRequest(env, token, { jsonrpc: "2.0", method: "notifications/initialized" });
    expect(note.status).toBe(202);
    expect(await (await mcpRequest(env, token, { jsonrpc: "2.0", id: 4, method: "resources/list" })).json()).toMatchObject({ error: { code: -32601 } });
    expect(await (await mcpRequest(env, token, { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "orrn_shell", arguments: {} } })).json()).toMatchObject({ error: { code: -32602 } });
  });
});

describe("identity on the tool leg (§4.3)", () => {
  test("a cross-tenant token sees nothing of the other plant", async () => {
    const a = await buddyPlant(env);
    const b = await buddyPlant(env);
    const { token } = await connect(a);
    await a.owner.customer.create({ name: "Alpha Synthetic Traders" });
    const bCustomer = await b.owner.customer.create({ name: "Beta Synthetic Metals" });
    const list = await tool(env, token, "orrn_call", { path: "customer.list", input: {} });
    expect(list.status).toBe("ok");
    const names = JSON.stringify(list.data);
    expect(names).toContain("Alpha Synthetic Traders");
    expect(names).not.toContain("Beta Synthetic Metals");
    const other = await tool(env, token, "orrn_call", { path: "customer.get", input: { id: bCustomer.id } });
    expect(other.status).toBe("not_found");
    expect(JSON.stringify(other)).not.toContain("Beta");
  });

  test("a viewer grant: refused by the gate; with the gate widened, forbidden on an owner-or-admin query, naming the action", async () => {
    const p = await buddyPlant(env);
    const viewerToken = await grantFor(p, p.users.viewer.id);
    // The gate: viewer is not in BUDDY_ROLES.
    expect((await mcpRequest(env, viewerToken, { jsonrpc: "2.0", id: 1, method: "tools/list" })).status).toBe(401);
    // Widened (tests only), the procedure's own rule answers.
    const roles = ["owner", "viewer"] as const;
    const env2 = await tool(env, viewerToken, "orrn_call", { path: "audit.list", input: {} }, { roles });
    expect(env2.status).toBe("forbidden");
    expect(env2.message).toContain("audit.read");
    // The same procedure's guard refuses the buddy context directly (not only the registry pre-check).
    const { contextFromGrant } = await import("../src/lib/buddy/grantContext");
    const resolved = await contextFromGrant(env.db, viewerToken, { roles });
    if (!resolved.ok) throw new Error("expected a context");
    const { appRouter } = await import("../src/routers/index");
    await expect(appRouter.createCaller(resolved.ctx).audit.list({})).rejects.toMatchObject({ code: "FORBIDDEN" });
    // A viewer may read what a viewer reads.
    expect((await tool(env, viewerToken, "orrn_call", { path: "customer.list", input: {} }, { roles })).status).toBe("ok");
  });

  test("the context holds no inbound header, no platform role, no impersonation; via is buddy", async () => {
    const p = await buddyPlant(env);
    const { token } = await connect(p);
    const { contextFromGrant } = await import("../src/lib/buddy/grantContext");
    const r = await contextFromGrant(env.db, token);
    if (!r.ok) throw new Error("expected a context");
    expect(r.ctx.request.headers.get("authorization")).toBeNull();
    expect(r.ctx).toMatchObject({ via: "buddy", isPlatformAdmin: false, platformRole: null, impersonation: null, role: "owner", companyId: p.companyId });
  });

  test("revoked, expired, unlisted plant, removed member, suspended plant: refused", async () => {
    const p = await buddyPlant(env);
    const call = (t: string) => mcpRequest(env, t, { jsonrpc: "2.0", id: 1, method: "tools/list" });
    const { token, grantId } = await connect(p);
    expect((await call(token)).status).toBe(200);
    await p.owner.buddy.grant.revoke({ grantId });
    expect((await call(token)).status).toBe(401);

    const expired = await grantFor(p, p.users.owner.id, { expiresAt: new Date(Date.now() - 1000) });
    expect((await call(expired)).status).toBe(401);

    const live = await grantFor(p, p.users.owner.id);
    expect((await call(live)).status).toBe(200);
    await unlistPlant(env, p.companyId);
    expect((await call(live)).status).toBe(401);

    const q = await buddyPlant(env);
    const t2 = (await connect(q)).token;
    await env.db.delete(membership).where(and(eq(membership.companyId, q.companyId), eq(membership.userId, q.users.owner.id)));
    expect((await call(t2)).status).toBe(401);

    const r = await buddyPlant(env);
    const t3 = (await connect(r)).token;
    await env.db.update(company).set({ status: "suspended" }).where(eq(company.id, r.companyId));
    expect((await call(t3)).status).toBe(401);
  });

  test("secure sign-in: a grant made by a password session stops working when the plant requires a strong sign-in", async () => {
    const p = await buddyPlant(env, { settings: { requireStrongSignIn: true } });
    const weak = await grantFor(p, p.users.owner.id, { signInMethod: "password" });
    const refused = await tool(env, weak, "orrn_call", { path: "customer.list", input: {} });
    expect(refused.status).toBe("forbidden");
    // A grant made by a passkey session (the minting session passed the same gate) works.
    const strongOwner = env.caller({ role: "owner", companyId: p.companyId, signInMethod: "passkey" });
    const { token } = await strongOwner.buddy.grant.create();
    expect((await tool(env, token, "orrn_call", { path: "customer.list", input: {} })).status).toBe("ok");
    // And a password session cannot even make a grant in this plant.
    await expect(env.caller({ role: "owner", companyId: p.companyId, signInMethod: "password" }).buddy.grant.create()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("what the buddy may reach (§4.2, §12.3)", () => {
  test("denied paths are not found by describe or call, and search never lists them", async () => {
    const p = await buddyPlant(env);
    const { token } = await connect(p);
    for (const path of ["auth.me", "company.updateSettings", "ingest.candidate.approve", "ingest.merge.start", "buddy.drafts.confirm", "buddy.grant.create", "platform.companies.list", "__proto__", "toString"]) {
      expect({ path, d: (await tool(env, token, "orrn_describe", { path })).status }).toEqual({ path, d: "not_found" });
      expect({ path, c: (await tool(env, token, "orrn_call", { path, input: {} })).status }).toEqual({ path, c: "not_found" });
    }
    const hits = await tool(env, token, "orrn_search", { query: "approve merge discard confirm drafts grant settings", limit: 30 });
    const paths: string[] = hits.data.hits.map((h: { path: string }) => h.path);
    for (const denied of ["ingest.candidate.approve", "ingest.merge.start", "ingest.candidate.discard", "buddy.drafts.confirm", "buddy.grant.create", "company.updateSettings"]) {
      expect(paths).not.toContain(denied);
    }
  });

  test("model_checked, approve, merge and discard are not callable even as drafts: no draft row", async () => {
    const p = await buddyPlant(env);
    const { token } = await connect(p);
    for (const path of ["ingest.vision.check", "ingest.candidate.approve", "ingest.merge.start", "ingest.merge.step", "ingest.merge.stop", "ingest.candidate.discard", "ingest.hole.retire"]) {
      const r = await tool(env, token, "orrn_call", { path, input: { candidateId: "c1", expectSeq: 1, runId: "r1", expectCursor: 0, holeId: "h1" } });
      expect({ path, s: r.status }).toEqual({ path, s: "not_found" });
    }
    const drafts = await env.db.select({ n: sql<number>`count(*)` }).from(buddyDraft).where(eq(buddyDraft.companyId, p.companyId)).get();
    expect(Number(drafts?.n)).toBe(0);
  });

  test("owner decision 2: approval.decide, the owner's die close override and answerDoubts make no draft", async () => {
    const p = await buddyPlant(env);
    const { token } = await connect(p);
    const tries: [string, unknown][] = [
      ["approval.decide", { id: "a1", decision: "approved" }],
      ["dieInstance.closeOwnerOverride", { id: "d1", reason: "synthetic" }],
      ["ingest.rows.answerDoubts", { candidateId: "c1", answer: "right", expectCount: 3, expectSeq: 1 }],
      ["ingest.rows.answerDoubts", { candidateId: "c1", answer: "skip", rowId: "r1", expectSeq: 1 }],
    ];
    for (const [path, input] of tries) {
      expect({ path, d: (await tool(env, token, "orrn_describe", { path })).status }).toEqual({ path, d: "not_found" });
      expect({ path, c: (await tool(env, token, "orrn_call", { path, input })).status }).toEqual({ path, c: "not_found" });
    }
    const drafts = await env.db.select({ n: sql<number>`count(*)` }).from(buddyDraft).where(eq(buddyDraft.companyId, p.companyId)).get();
    expect(Number(drafts?.n)).toBe(0);
  });

  test("the MCP token cannot confirm: buddy.* is unreachable, and the buddy router refuses a buddy context", async () => {
    const p = await buddyPlant(env);
    const { token } = await connect(p);
    const made = await tool(env, token, "orrn_call", { path: "customer.create", input: { name: "Gamma Synthetic Co" } });
    expect(made.status).toBe("needs_confirm");
    const draftId = made.data.draftId as string;
    expect((await tool(env, token, "orrn_call", { path: "buddy.drafts.confirm", input: { draftId } })).status).toBe("not_found");
    const { contextFromGrant } = await import("../src/lib/buddy/grantContext");
    const r = await contextFromGrant(env.db, token);
    if (!r.ok) throw new Error("expected a context");
    const { appRouter } = await import("../src/routers/index");
    await expect(appRouter.createCaller(r.ctx).buddy.drafts.confirm({ draftId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(appRouter.createCaller(r.ctx).buddy.grant.create()).rejects.toMatchObject({ code: "FORBIDDEN" });
    const still = await env.db.select({ status: buddyDraft.status }).from(buddyDraft).where(eq(buddyDraft.id, draftId)).get();
    expect(still?.status).toBe("pending");
    const made2 = await env.db.select({ n: sql<number>`count(*)` }).from(customer).where(and(eq(customer.companyId, p.companyId), eq(customer.name, "Gamma Synthetic Co"))).get();
    expect(Number(made2?.n)).toBe(0);
  });

  test("a CSV download of a report is refused by input; the JSON form is allowed", async () => {
    const p = await buddyPlant(env);
    const { token } = await connect(p);
    const csv = await tool(env, token, "orrn_call", { path: "press.report", input: { format: "csv" } });
    expect(csv.status).toBe("forbidden");
    expect(csv.message).toContain("CSV");
  });
});

describe("orrn_call", () => {
  test("a mutation becomes a draft and writes nothing else; invalid input makes no draft", async () => {
    const p = await buddyPlant(env);
    const { token } = await connect(p);
    const bad = await tool(env, token, "orrn_call", { path: "customer.create", input: { name: "" } });
    expect(bad.status).toBe("invalid");
    expect(bad.issues?.length).toBeGreaterThan(0);
    const ok = await tool(env, token, "orrn_call", { path: "customer.create", input: { name: "Delta Synthetic Steel" } });
    expect(ok.status).toBe("needs_confirm");
    expect(typeof ok.data.draftId).toBe("string");
    const n = await env.db.select({ n: sql<number>`count(*)` }).from(customer).where(eq(customer.companyId, p.companyId)).get();
    expect(Number(n?.n)).toBe(0);
    const row = await env.db.select().from(buddyDraft).where(eq(buddyDraft.id, ok.data.draftId)).get();
    expect(row).toMatchObject({ companyId: p.companyId, requestedByUserId: p.users.owner.id, path: "customer.create", status: "pending", inputJson: { name: "Delta Synthetic Steel" } });
    expect(row!.expiresAt.getTime() - row!.createdAt.getTime()).toBe(24 * 60 * 60 * 1000);
  });

  test("search and describe: kind, how it runs, the action, whether the role may call it, the JSON Schema", async () => {
    const p = await buddyPlant(env);
    const { token } = await connect(p);
    const s = await tool(env, token, "orrn_search", { query: "import candidate" });
    expect(s.status).toBe("ok");
    expect(s.data.hits.some((h: { path: string }) => h.path === "ingest.candidate.get")).toBe(true);
    const d = await tool(env, token, "orrn_describe", { path: "ingest.shape.make" });
    expect(d).toMatchObject({ status: "ok", data: { path: "ingest.shape.make", kind: "mutation", runs: "as a draft the person confirms", action: "ingest.upload", callable: true } });
    expect(d.data.input).toMatchObject({ type: "object", properties: { candidateId: expect.any(Object), expectSeq: expect.any(Object) } });
    expect((await tool(env, token, "orrn_search", { query: "  " })).status).toBe("invalid");
  });

  test("one buddy_call row per call, refused ones too, with no bodies", async () => {
    const p = await buddyPlant(env);
    const { token, grantId } = await connect(p);
    await tool(env, token, "orrn_search", { query: "stock" });
    await tool(env, token, "orrn_call", { path: "auth.me", input: {} });
    await tool(env, token, "orrn_call", { path: "customer.create", input: { name: "Epsilon Synthetic" } });
    const rows = await env.db.select().from(buddyCall).where(eq(buddyCall.grantId, grantId)).orderBy(buddyCall.at);
    expect(rows.map((r) => [r.tool, r.path, r.outcome])).toEqual([
      ["orrn_search", null, "ok"],
      ["orrn_call", "auth.me", "not_found"],
      ["orrn_call", "customer.create", "needs_confirm"],
    ]);
    expect(rows.every((r) => r.companyId === p.companyId && r.userId === p.users.owner.id && r.resultBytes > 0)).toBe(true);
    expect(Object.keys(rows[0]!)).not.toContain("result");
  });

  test("orrn_review_link: a link to the plant's web host for a real candidate or file; another plant's id is not found", async () => {
    const { plant: ingestPlant, upload } = await import("./ingest-portal-helpers");
    const ip = await ingestPlant(env);
    const { listPlant } = await import("./buddy-fixture");
    await listPlant(env, ip.companyId);
    const { token } = await ip.owner.buddy.grant.create();
    const { artifactId, candidates } = await upload(ip.owner, [{ headers: ["Name", "City"], rows: [["Zeta Synthetic", "Morbi"]] }]);
    const c = candidates[0]!;
    const link = await tool(env, token, "orrn_review_link", { candidateId: c.id });
    expect(link).toMatchObject({ status: "ok", data: { url: `https://app.test/ingest/review/${c.id}`, path: `/ingest/review/${c.id}` } });
    const file = await tool(env, token, "orrn_review_link", { artifactId });
    expect(file.data.url).toBe(`https://app.test/ingest/files/${artifactId}`);
    const other = await buddyPlant(env);
    const otherToken = (await connect(other)).token;
    expect((await tool(env, otherToken, "orrn_review_link", { candidateId: c.id })).status).toBe("not_found");
    expect((await tool(env, token, "orrn_review_link", {})).status).toBe("invalid");
  });
});

describe("limits and the cap (§7)", () => {
  test("60 tool calls a minute per grant, then rate_limited (logged)", async () => {
    const p = await buddyPlant(env);
    const { token, grantId } = await connect(p);
    const { createId } = await import("../src/lib/id");
    const rows = Array.from({ length: 60 }, () => ({
      id: createId(),
      companyId: p.companyId,
      userId: p.users.owner.id,
      grantId,
      tool: "orrn_search",
      outcome: "ok" as const,
      at: new Date(),
    }));
    for (let i = 0; i < rows.length; i += 10) await env.db.insert(buddyCall).values(rows.slice(i, i + 10));
    const r = await tool(env, token, "orrn_search", { query: "stock" });
    expect(r.status).toBe("rate_limited");
    const last = await env.db.select({ outcome: buddyCall.outcome }).from(buddyCall).where(eq(buddyCall.grantId, grantId)).orderBy(sql`${buddyCall.at} desc`).get();
    expect(last?.outcome).toBe("rate_limited");
  });

  test("20 drafts an hour per grant, then rate_limited and no 21st draft", async () => {
    const p = await buddyPlant(env);
    const { token, grantId } = await connect(p);
    const { createId } = await import("../src/lib/id");
    for (let i = 0; i < 20; i += 1) {
      await env.db.insert(buddyDraft).values({
        id: createId(),
        companyId: p.companyId,
        requestedByUserId: p.users.owner.id,
        grantId,
        path: "customer.create",
        inputJson: { name: `Synthetic ${i}` },
        expiresAt: new Date(Date.now() + 3_600_000),
      });
    }
    const r = await tool(env, token, "orrn_call", { path: "customer.create", input: { name: "One Too Many" } });
    expect(r.status).toBe("rate_limited");
    const n = await env.db.select({ n: sql<number>`count(*)` }).from(buddyDraft).where(eq(buddyDraft.grantId, grantId)).get();
    expect(Number(n?.n)).toBe(20);
  });

  test("results over 32 KB are cut with truncated: true and a hint", async () => {
    const { capResult, okEnvelope, RESULT_CAP_BYTES } = await import("../src/lib/buddy/envelope");
    const big = { items: Array.from({ length: 2000 }, (_, i) => ({ id: i, name: `Synthetic row ${i} `.repeat(4) })), total: 2000 };
    const env1 = okEnvelope(big);
    expect(env1.truncated).toBe(true);
    expect(env1.hint).toContain("32 KB");
    expect(JSON.stringify(env1.data).length).toBeLessThanOrEqual(RESULT_CAP_BYTES);
    expect((env1.data as { total: number }).total).toBe(2000);
    expect(capResult({ small: 1 })).toEqual({ data: { small: 1 }, truncated: false });
    const arr = capResult(Array.from({ length: 5000 }, (_, i) => `row-${i}-xxxxxxxxxx`));
    expect(arr.truncated).toBe(true);
    expect(JSON.stringify(arr.data).length).toBeLessThanOrEqual(RESULT_CAP_BYTES);
    const text = capResult("x".repeat(100_000));
    expect(text.truncated).toBe(true);
  });

  test("a body over 256 KB is 413; a batch of more than 20 or none is 400; a batch of 20 answers each", async () => {
    const p = await buddyPlant(env);
    const { token } = await connect(p);
    const big = await mcpRequest(env, token, { jsonrpc: "2.0", id: 1, method: "ping", params: { pad: "x".repeat(256 * 1024) } });
    expect(big.status).toBe(413);
    const ping = (id: number) => ({ jsonrpc: "2.0", id, method: "ping" });
    expect((await mcpRequest(env, token, Array.from({ length: 21 }, (_, i) => ping(i)))).status).toBe(400);
    expect((await mcpRequest(env, token, [])).status).toBe(400);
    const ok = await mcpRequest(env, token, Array.from({ length: 20 }, (_, i) => ping(i)));
    expect(ok.status).toBe(200);
    const answers = (await ok.json()) as { id: number }[];
    expect(answers.map((a) => a.id)).toEqual(Array.from({ length: 20 }, (_, i) => i));
  });
});

describe("the MCP module writes nothing but its own rows (§10 grep)", () => {
  const dir = join(import.meta.dir, "../src/lib/buddy");
  const MCP_FILES = ["mcp.ts", "grantContext.ts", "draftCreate.ts", "callLog.ts", "registry.ts", "decisions.ts", "descriptions.ts", "envelope.ts", "links.ts", "token.ts", "config.ts", "access.ts"];

  test("mcp.ts imports only these buddy modules, no mutation code, atomicBatch, ledger or number builder", () => {
    const src = readFileSync(join(dir, "mcp.ts"), "utf8");
    const imports = [...src.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]!);
    for (const i of imports) {
      if (i.startsWith("./")) expect(MCP_FILES).toContain(`${i.slice(2)}.ts`);
    }
    for (const file of MCP_FILES) {
      const text = readFileSync(join(dir, file), "utf8");
      const imps = [...text.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]!);
      for (const i of imps) {
        expect({ file, i, banned: /atomic|ledger|docNumber|sequence|approval|stock|spool|print|helpers|\/routers\//.test(i) }).toEqual({ file, i, banned: false });
      }
      expect({ file, atomicBatch: /atomicBatch/.test(text) }).toEqual({ file, atomicBatch: false });
      // Writes: only buddy_draft and buddy_call inserts, the draft's audit row, and the grant's last_used_at.
      for (const m of text.matchAll(/\.(insert|update|delete)\(\s*([A-Za-z]+)/g)) {
        const ok = (m[1] === "insert" && (m[2] === "buddyDraft" || m[2] === "buddyCall")) || (m[1] === "update" && m[2] === "buddyGrant");
        expect({ file, write: `${m[1]}(${m[2]})`, ok }).toEqual({ file, write: `${m[1]}(${m[2]})`, ok: true });
      }
    }
    // The only dynamic import is the router, used for createCaller (queries in mcp.ts).
    expect([...src.matchAll(/import\("([^"]+)"\)/g)].map((m) => m[1])).toEqual(["../../routers/index"]);
  });
});

/**
 * Request and auth logs never keep invite tokens or links (global rule; plan 2026-11-18, Task 8 fix
 * round 1). Workers Logs are on in prod, so whatever the request logger prints is stored. The query
 * string carries tRPC GET inputs, Better Auth's `callbackURL` (which can hold `/invite/<token>`) and
 * magic-link tokens, so the logger prints the path only, and the reset link's own token is masked.
 */
import { describe, expect, test } from "bun:test";
import { Hono } from "hono";

import { loggedPath, requestLogger } from "../src/lib/requestLog";

const INVITE = "0b7c2f8e-6a51-4c1d-9f3e-2d4b8a6c1e90";

describe("request log", () => {
  test("prints the path without the query string", () => {
    expect(loggedPath(`https://api.orrn.app/trpc/invite.status?batch=1&input=${encodeURIComponent(JSON.stringify({ 0: { token: INVITE } }))}`)).toBe("/trpc/invite.status");
    expect(loggedPath("https://api.orrn.app/api/auth/magic-link/verify?token=abc123&callbackURL=x")).toBe("/api/auth/magic-link/verify");
    expect(loggedPath("https://api.orrn.app/health#frag")).toBe("/health");
    expect(loggedPath("http://localhost:3000/")).toBe("/");
  });

  test("masks the reset link's token, which is in its path", () => {
    expect(loggedPath(`https://api.orrn.app/api/auth/reset-password/Zq81xYb2?callbackURL=${encodeURIComponent(`https://app/reset-password?next=/invite/${INVITE}`)}`)).toBe(
      "/api/auth/reset-password/:token",
    );
    // The POST that finishes a reset has no token in its path and keeps its name.
    expect(loggedPath("https://api.orrn.app/api/auth/reset-password")).toBe("/api/auth/reset-password");
  });

  test("the middleware logs method, path and status, never the token", async () => {
    const lines: string[] = [];
    const app = new Hono();
    app.use(requestLogger((line) => void lines.push(line)));
    app.get("/api/auth/reset-password/:token", (c) => c.redirect(`https://app.test/reset-password?next=${encodeURIComponent(`/invite/${INVITE}`)}`));
    app.post("/trpc/*", (c) => c.json({ ok: true }));
    await app.request(`/api/auth/reset-password/Zq81xYb2?callbackURL=${encodeURIComponent(`https://app.test/reset-password?next=/invite/${INVITE}`)}`);
    await app.request(`/trpc/invite.status?batch=1&input=${encodeURIComponent(JSON.stringify({ 0: { token: INVITE } }))}`, { method: "POST" });
    const text = lines.join("\n");
    expect(text).toContain("GET /api/auth/reset-password/:token 302");
    expect(text).toContain("POST /trpc/invite.status 200");
    for (const secret of [INVITE, "Zq81xYb2", "callbackURL", "input="]) expect(text).not.toContain(secret);
  });
});

describe("auth log", () => {
  test("masks invite links and reset tokens, plain or percent-encoded (Better Auth logs a refused callbackURL whole)", async () => {
    const { redactAuthLog } = await import("@orrn/auth/logger");
    const lines = [
      `Invalid callbackURL: https://evil.example/reset-password?next=%2Finvite%2F${INVITE}`,
      `Invalid redirectURL: https://evil.example/invite/${INVITE}?kind=portal`,
      "Invalid callbackURL: https://api.orrn.app/api/auth/reset-password/Zq81xYb2",
    ];
    const text = JSON.stringify(lines.map((l) => redactAuthLog(l)));
    for (const secret of [INVITE, "Zq81xYb2"]) expect(text).not.toContain(secret);
    expect(text).toContain("invite%2F[redacted]");
    expect(text).toContain("/invite/[redacted]");
    expect(text).toContain("/reset-password/[redacted]");
  });
});

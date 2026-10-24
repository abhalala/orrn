/**
 * T17 I-1 / T27 I-2: with no Resend key, packages/auth must not print the
 * magic-link email (a live sign-in link) anywhere but a development stack.
 */
import { afterEach, describe, expect, spyOn, test } from "bun:test";

import { sendAuthEmail } from "@orrn/auth";
import { unsentEmailLog } from "@orrn/auth/unsent-email";

import { workersEnv } from "./env-mock";

const LINK = "https://api.test/api/auth/magic-link/verify?token=live-secret-token-123";
const EMAIL = { to: "owner@ravi-aluminium.in", subject: "Your ORRN Magic Sign-In Link", html: `<a href="${LINK}">Sign in</a>` };

const saved: Record<string, unknown> = {};
function useEnv(values: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(values)) {
    if (!(k in saved)) saved[k] = workersEnv[k];
    if (v === undefined) delete workersEnv[k];
    else workersEnv[k] = v;
  }
}
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete workersEnv[k];
    else workersEnv[k] = v;
    delete saved[k];
  }
});

async function logged(run: () => Promise<unknown>) {
  const spy = spyOn(console, "log").mockImplementation(() => {});
  try {
    await run();
    return spy.mock.calls.map((args) => args.map(String).join(" ")).join("\n");
  } finally {
    spy.mockRestore();
  }
}

describe("packages/auth sendAuthEmail without an email provider", () => {
  test("production prints only the recipient's domain and the subject, never the link or the address", async () => {
    useEnv({ NODE_ENV: "production", RESEND_API_KEY: undefined });
    const out = await logged(() => sendAuthEmail(EMAIL));
    expect(out).not.toContain("live-secret-token-123");
    expect(out).not.toContain("magic-link/verify");
    expect(out).not.toContain("owner@");
    expect(out).toContain("@ravi-aluminium.in");
    expect(out).toContain("Your ORRN Magic Sign-In Link");
    expect(out).toContain("not sent: no provider");
  });

  test("any stack that is not development (test, unset) is treated like production", async () => {
    for (const nodeEnv of ["test", undefined]) {
      useEnv({ NODE_ENV: nodeEnv, RESEND_API_KEY: undefined });
      const out = await logged(() => sendAuthEmail(EMAIL));
      expect(out).not.toContain("live-secret-token-123");
    }
  });

  test("development prints the whole email, link included, so local sign-in works", async () => {
    useEnv({ NODE_ENV: "development" });
    const out = await logged(() => sendAuthEmail(EMAIL));
    expect(out).toContain(LINK);
    expect(out).toContain("owner@ravi-aluminium.in");
  });

  test("unsentEmailLog copes with an address without @", () => {
    expect(unsentEmailLog("production", { ...EMAIL, to: "nobody" })).toContain("@unknown");
  });
});

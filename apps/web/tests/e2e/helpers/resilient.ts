import { expect, request, type APIResponse, type Locator, type Page } from "@playwright/test";

import { backoffMs, retryDecision } from "./resilient-policy";

/**
 * Makes every Playwright API call in this process (`ctx.get/post`, `page.context().request.*`, `request.newContext()`)
 * ride out transport hiccups of the shared local worker: see `resilient-policy.ts` for exactly what is repeated.
 * Installed once per worker process by importing this file (helpers/test.ts, accounts.ts, owner-api.ts do).
 *
 * It patches `fetch` on the APIRequestContext prototype because `get`, `post`, `put`, ... all funnel through it, so a
 * spec's own sign-in or tRPC helper is covered without each one growing its own loop. A refusal the app gives (4xx,
 * or a 500 on a write) comes back unchanged on the first attempt.
 */
const INSTALLED = Symbol.for("orrn.e2e.resilientFetch");

type Fetch = (this: unknown, urlOrRequest: unknown, options?: { method?: string } & Record<string, unknown>) => Promise<APIResponse>;

async function install() {
  const probe = await request.newContext();
  const proto = Object.getPrototypeOf(probe) as Record<string | symbol, unknown>;
  await probe.dispose();
  if (proto[INSTALLED] || typeof proto.fetch !== "function") return;
  const original = proto.fetch as Fetch;
  const resilientFetch: Fetch = async function (this: unknown, urlOrRequest, options) {
    const url = typeof urlOrRequest === "string" ? urlOrRequest : String((urlOrRequest as { url?: () => string }).url?.() ?? urlOrRequest);
    const method = (options?.method ?? (typeof urlOrRequest === "object" && urlOrRequest ? (urlOrRequest as { method?: () => string }).method?.() : undefined) ?? "GET").toString();
    for (let attempt = 1; ; attempt += 1) {
      let response: APIResponse | undefined;
      let error: unknown;
      try {
        response = await original.call(this, urlOrRequest, options);
      } catch (e) {
        error = e;
      }
      const decision = retryDecision({ method, url, attempt, error, status: response?.status() });
      if (!decision.retry) {
        if (error !== undefined) throw error;
        return response!;
      }
      if (process.env.E2E_RETRY_LOG) console.warn(`[e2e retry ${attempt}] ${method} ${url.replace(/\?.*/, "")}: ${decision.why}`);
      await new Promise((done) => setTimeout(done, backoffMs(attempt)));
    }
  };
  proto.fetch = resilientFetch;
  proto[INSTALLED] = true;
}

await install();

/**
 * Wait for a number (a count read from the API or a list) to settle, then assert it. For "how many rows now" reads
 * that an earlier write needs a moment to reach (a queue, a derived list). Locator counts should keep using
 * `expect(locator).toHaveCount(n)`, which already retries.
 *
 *   await expectEventually(async () => (await api.q<{ items: unknown[] }>("orders.list", {})).items.length).toBe(3);
 *
 * It re-reads on a 250 ms to 2 s ladder up to `timeout` (default 15 s) and reports the last value it saw.
 */
export function expectEventually<T>(read: () => T | Promise<T>, options: { timeout?: number; message?: string } = {}) {
  return expect.poll(async () => read(), {
    timeout: options.timeout ?? 15_000,
    intervals: [250, 500, 1_000, 2_000],
    message: options.message,
  });
}

/**
 * `page.goto` plus "the page has painted": waits for `ready` (usually the main heading). A first paint can stall on a
 * saturated machine (Vite still transforming modules, the worker answering late, the page stuck on its loading
 * skeleton), so a stall gets ONE reload half way through the budget instead of burning the whole wait on a page that
 * will not recover by itself. A page that is really broken fails the second wait with the usual message.
 */
export async function gotoReady(page: Page, path: string, ready: Locator, timeout = 25_000) {
  await page.goto(path);
  try {
    await expect(ready).toBeVisible({ timeout: Math.ceil(timeout / 2) });
  } catch {
    await page.reload();
    await expect(ready).toBeVisible({ timeout });
  }
}

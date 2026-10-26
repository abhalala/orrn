import { test as base } from "@playwright/test";

import "./resilient";
import { WEB_ORIGIN } from "./ports";

/**
 * `test` for every e2e spec: Playwright's own, plus one automatic worker fixture that pays for the cold start once.
 *
 * The first page a fresh worker loads is slow (a new Chromium, a Vite module graph not warm yet, the worker waking
 * up), and with the shared machine busy it can take longer than an `expect`'s 5 s: the first assertion of whatever
 * test lands on that worker then fails for nothing. The fixture loads `/login` once per worker with a long budget
 * and waits for the form, so every later load (and every 5 s expectation) runs against a warm stack. It never fails
 * a test: a stack that is truly down fails the test that needs it, with its own message.
 */
export const test = base.extend<object, { warmFirstLoad: void }>({
  warmFirstLoad: [
    async ({ browser }, use) => {
      const context = await browser.newContext();
      try {
        const page = await context.newPage();
        await page.goto(`${WEB_ORIGIN}/login`, { timeout: 90_000, waitUntil: "load" });
        await page.getByLabel("Email", { exact: true }).waitFor({ timeout: 60_000 });
      } catch {
        // The test that needs the stack reports it.
      } finally {
        await context.close();
      }
      await use();
    },
    { scope: "worker", auto: true, timeout: 150_000 },
  ],
});

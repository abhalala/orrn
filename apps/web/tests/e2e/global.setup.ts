import { expect, test as setup } from "@playwright/test";

const apiURL = process.env.E2E_API_URL ?? "http://localhost:3000";

/**
 * Seeds the local demo company (owner/operator/viewer/staff accounts, dies,
 * bundles, dispatches). The endpoint is idempotent and only exists on the
 * local worker (loopback + ORRN_LOCAL_PASSWORD binding).
 */
setup("seed the local demo company", async ({ request }) => {
  const res = await request.post(`${apiURL}/dev/seed`);
  expect(res.ok(), `POST ${apiURL}/dev/seed returned ${res.status()}`).toBe(true);
});

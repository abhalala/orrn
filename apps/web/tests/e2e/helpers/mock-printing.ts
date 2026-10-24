import type { Page } from "@playwright/test";

/**
 * The local seed has no label printing connected. This answers the two print
 * procedures (`spool.deploymentStatus` as active, `spool.printBundleLabel`)
 * in the browser and passes every other tRPC call through to the real API
 * (the real response's CORS headers are kept). `fail(attempt)` decides which
 * print attempts (1-based) come back as "printer offline" (BAD_GATEWAY).
 */
export async function mockLabelPrinting(
  page: Page,
  apiURL: string,
  opts: { fail?: (attempt: number) => boolean } = {},
): Promise<{ printed: string[]; attempts(): number }> {
  const printed: string[] = [];
  let attempts = 0;
  await page.route(`${apiURL}/trpc/**`, async (route) => {
    const req = route.request();
    const procs = decodeURIComponent(new URL(req.url()).pathname.split("/trpc/")[1] ?? "").split(",");
    if (req.method() === "OPTIONS" || !procs.some((p) => p.startsWith("spool."))) return route.continue();
    const response = await route.fetch();
    let real: unknown[];
    try {
      real = (await response.json()) as unknown[];
    } catch {
      // Not JSON (wrangler's "worker restarted mid-request" 503): hand it on unchanged.
      return route.fulfill({ response });
    }
    const inputs = (req.method() === "POST" ? req.postDataJSON() : {}) as Record<string, { bundleId?: string }>;
    const out = procs.map((p, i) => {
      if (p === "spool.deploymentStatus") {
        return { result: { data: { id: "dep-e2e", status: "active", subdomain: null, spoolDomain: null } } };
      }
      if (p === "spool.printBundleLabel") {
        attempts += 1;
        if (opts.fail?.(attempts)) {
          return {
            error: {
              message: "Spool node unreachable",
              code: -32603,
              data: { code: "BAD_GATEWAY", httpStatus: 502, path: p },
            },
          };
        }
        printed.push(inputs[String(i)]?.bundleId ?? "");
        return { result: { data: { jobId: `job-${attempts}` } } };
      }
      return real[i];
    });
    await route.fulfill({ response, status: 200, json: out });
  });
  return { printed, attempts: () => attempts };
}

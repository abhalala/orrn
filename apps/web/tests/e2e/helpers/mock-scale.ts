import type { Page } from "@playwright/test";

export type MockReading = {
  stable: boolean;
  grams?: number;
  ageMs?: number;
  reason?: string;
  configured: boolean;
  simulated: boolean;
  nodeId: string | null;
};

/** A scale that is set up and sending a steady weight (grams). */
export const steady = (grams: number): MockReading => ({ stable: true, grams, ageMs: 80, configured: true, simulated: false, nodeId: "node-e2e" });
/** A scale that is set up but sends nothing (indicator off). */
export const silent: MockReading = { stable: false, reason: "stale", configured: true, simulated: false, nodeId: "node-e2e" };

/**
 * The seed has no scale node, and a node's heartbeat is signed by the node, so a browser test cannot
 * make one. This answers `scale.reading` in the browser with `reading()` (called on every poll) and
 * lets every other tRPC call through to the real API (batched calls are merged, the real CORS headers
 * kept). The server still decides what it accepts: a scale weight is refused while no node reports a
 * scale, a typed weight with a reason is fine.
 */
export async function mockScale(page: Page, apiURL: string, reading: () => MockReading): Promise<{ polls(): number }> {
  let polls = 0;
  await page.route(`${apiURL}/trpc/**`, async (route) => {
    const req = route.request();
    const procs = decodeURIComponent(new URL(req.url()).pathname.split("/trpc/")[1] ?? "").split(",");
    if (req.method() === "OPTIONS" || !procs.includes("scale.reading")) return route.continue();
    const only = procs.every((p) => p === "scale.reading");
    if (only) {
      polls += procs.length;
      const body = procs.map(() => ({ result: { data: reading() } }));
      return route.fulfill({
        status: 200,
        headers: { "access-control-allow-origin": req.headers().origin ?? "*", "access-control-allow-credentials": "true", "content-type": "application/json" },
        json: body,
      });
    }
    const response = await route.fetch();
    const real = (await response.json()) as unknown[];
    const out = procs.map((p, i) => (p === "scale.reading" ? { result: { data: reading() } } : real[i]));
    polls += procs.filter((p) => p === "scale.reading").length;
    await route.fulfill({ response, status: 200, json: out });
  });
  return { polls: () => polls };
}

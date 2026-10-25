import { expect, type Page } from "@playwright/test";

import { signInViaApi } from "./accounts";
import { API_URL, WEB_ORIGIN } from "./ports";

/**
 * BACKLOG 36: two copies cannot sit on one press line, and the seed's P1 already holds 14701-1 for
 * PR-1. Tests run in parallel, so a test that issues a copy gets a press of its own: the owner
 * adds a press line and releases a one-die plan on it (a sample or die trial plan needs no order
 * line), and the release's queued run is the run the copy goes to. The seed reset deletes these
 * lines at the start of the next run.
 *
 * Signs this page in as the owner; the caller signs in as the die room afterwards.
 */
export async function ownPressRun(
  page: Page,
  opts: { sectionId: string; purpose: "sample" | "die_trial"; tag: string },
): Promise<{ lineId: string; lineCode: string; runId: string; runNumber: string }> {
  await signInViaApi(page, "owner");
  const call = async <T>(path: string, input: unknown): Promise<T> => {
    const res = await page.context().request.post(`${API_URL}/trpc/${path}`, { headers: { origin: WEB_ORIGIN }, data: input });
    expect(res.ok(), `${path} returned ${res.status()}: ${await res.text()}`).toBe(true);
    return (await res.json()).result.data as T;
  };
  // Codes are at most 12 letters, digits or dashes and unique per plant.
  const lineCode = `T${opts.tag}${Date.now().toString(36).slice(-5)}`.toUpperCase().slice(0, 12);
  const line = await call<{ id: string }>("press.lines.create", { code: lineCode, name: `Test press ${lineCode}`, sortOrder: 900 });
  const start = Date.now();
  const plan = await call<{ id: string }>("plans.create", {
    pressLineId: line.id,
    windowStart: start,
    windowEnd: start + 3_600_000,
    purpose: opts.purpose,
    dies: [{ sectionId: opts.sectionId, lines: [] }],
  });
  const released = await call<{ runs: { id: string; number: string }[] }>("plans.release", { id: plan.id });
  const run = released.runs[0]!;
  return { lineId: line.id, lineCode, runId: run.id, runNumber: run.number };
}

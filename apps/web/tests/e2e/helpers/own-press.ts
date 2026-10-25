import { ownerApi, type OwnerApi } from "./owner-api";

/**
 * A press line of the test's own, with queued runs on it (D29: a line holds at most two issued
 * copies, the running run's and one preheating, and the seed's P1 already holds 14701-1 for PR-1).
 * Tests run in parallel, so a test that issues a copy gets a press of its own: the owner adds a
 * press line and releases one-die plans on it (a sample or die trial plan needs no order line).
 * `issued` copies are made through the API (status available) and issued to the last runs, so the
 * line starts that full. Everything goes through the owner's own request context; the page's
 * session is never touched.
 *
 * Call `cleanup()` from an `afterEach`/`afterAll`: every run still queued or die_issued is voided
 * (which also cancels its issue), the line is retired and the copies made here are retired, so the
 * die room's "to issue" count and the run pickers of parallel specs never see them. It throws when
 * something could not be undone.
 */
export type OwnPress = {
  lineId: string;
  lineCode: string;
  runs: { runId: string; runNumber: string }[];
  /** Copies made here and issued to the last `issued` runs, in run order. */
  issued: { id: string; code: string; runNumber: string; issueId: string }[];
  api: OwnerApi;
  cleanup(): Promise<void>;
};

export async function ownPress(opts: {
  sectionId: string;
  purpose: "sample" | "die_trial";
  tag: string;
  runs?: number;
  issued?: number;
}): Promise<OwnPress> {
  const api = await ownerApi();
  const copies: string[] = [];
  // Codes are at most 12 letters, digits or dashes and unique per plant.
  const lineCode = `T${opts.tag}${Date.now().toString(36).slice(-5)}`.toUpperCase().slice(0, 12);
  const line = await api.mutate<{ id: string }>("press.lines.create", { code: lineCode, name: `Test press ${lineCode}`, sortOrder: 900 });
  const runs: OwnPress["runs"] = [];
  for (let i = 0; i < (opts.runs ?? 1); i += 1) {
    const start = Date.now();
    const plan = await api.mutate<{ id: string }>("plans.create", {
      pressLineId: line.id,
      windowStart: start,
      windowEnd: start + 3_600_000,
      purpose: opts.purpose,
      dies: [{ sectionId: opts.sectionId, lines: [] }],
    });
    const released = await api.mutate<{ runs: { id: string; number: string }[] }>("plans.release", { id: plan.id });
    runs.push({ runId: released.runs[0]!.id, runNumber: released.runs[0]!.number });
  }
  const issued: OwnPress["issued"] = [];
  for (const run of runs.slice(runs.length - (opts.issued ?? 0))) {
    const copy = await api.mutate<{ id: string; code: string }>("dieInstance.create", { sectionId: opts.sectionId, status: "available" });
    copies.push(copy.id);
    const out = await api.mutate<{ id: string }>("dieInstance.issues.issue", { dieInstanceId: copy.id, pressLineId: line.id, pressRunId: run.runId });
    issued.push({ id: copy.id, code: copy.code, runNumber: run.runNumber, issueId: out.id });
  }

  async function cleanup() {
    const problems: string[] = [];
    const attempt = async (what: string, fn: () => Promise<unknown>) => {
      try {
        await fn();
      } catch (e) {
        problems.push(`${what}: ${e instanceof Error ? e.message : String(e)}`);
      }
    };
    try {
      const reasons = await api.query<{ id: string; code: string }[]>("press.reasons", { kind: "void" });
      const reasonCodeId = (reasons.find((r) => r.code === "other") ?? reasons[0]!).id;
      const list = await api.query<{ items: { id: string; number: string; status: string }[] }>("press.runs.list", { pressLineId: line.id, limit: 100 });
      for (const r of list.items.filter((x) => x.status === "queued" || x.status === "die_issued")) {
        await attempt(`void ${r.number}`, () => api.mutate("press.runs.void", { id: r.id, reasonCodeId, note: "e2e cleanup" }));
      }
      await attempt(`retire line ${lineCode}`, () => api.mutate("press.lines.retire", { id: line.id }));
      for (const id of copies) await attempt(`retire copy ${id}`, () => api.mutate("dieInstance.update", { id, status: "retired" }));
    } finally {
      await api.dispose();
    }
    if (problems.length > 0) throw new Error(`e2e cleanup left things behind:\n${problems.join("\n")}`);
  }

  return { lineId: line.id, lineCode, runs, issued, api, cleanup };
}

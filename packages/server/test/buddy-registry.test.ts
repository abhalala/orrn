/**
 * orrn buddy registry and the one allow/deny constant (design 2026-11-18, §4.2, §10, §12.3).
 *
 * - every top-level router of `appRouter` has a decision;
 * - every `ingest.*` procedure has its own decision (a new ingest procedure cannot become a tool by accident);
 * - a path decision names a real procedure, except from the named pending list (release 2 of the import);
 * - the §12.3 paths and the §10 scan hits are denied; every allowed path describes as JSON Schema.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { createTestEnv, type TestEnv } from "./harness";

let env: TestEnv;

beforeAll(async () => {
  env = await createTestEnv();
});

afterAll(async () => {
  await env.dispose();
});

async function load() {
  const { appRouter } = await import("../src/routers/index");
  const { BUDDY_DECISIONS, decideBuddyPath } = await import("../src/lib/buddy/decisions");
  const { buddyRegistry, inputJsonSchema } = await import("../src/lib/buddy/registry");
  const { buddyDescriptions } = await import("../src/lib/buddy/descriptions");
  const reg = await buddyRegistry();
  return { appRouter, BUDDY_DECISIONS, decideBuddyPath, reg, inputJsonSchema, buddyDescriptions };
}

/** §12.3, word for word: never callable by the buddy, not even as a draft. */
const NEVER = [
  "ingest.vision.check",
  "ingest.candidate.approve",
  "ingest.merge.start",
  "ingest.merge.step",
  "ingest.merge.stop",
  "ingest.hole.retire",
  "ingest.candidate.discard",
  "ingest.artifact.begin",
  "ingest.artifact.commitRaw",
  "ingest.artifact.putBlocks",
  "ingest.artifact.putRows",
  "ingest.artifact.complete",
  "ingest.rows.decide",
  "ingest.rows.skipNoDate",
  "ingest.candidate.repickHeader",
  "ingest.shape.save",
  "ingest.vision.start",
  "ingest.vision.bandTickets",
  "ingest.vision.skipPage",
  "ingest.vision.typePage",
  "ingest.vision.fixCell",
  "ingest.vision.readUrl",
];

/** §12.1: what the buddy can do in an import. */
const IMPORT_TOOLS = [
  "ingest.status",
  "ingest.artifact.list",
  "ingest.artifact.get",
  "ingest.candidate.list",
  "ingest.shape.make",
  "ingest.vision.readPage",
  "ingest.answer.set",
  "ingest.rows.answerDoubts",
  "ingest.period.confirm",
  "ingest.candidate.confirmNear",
  "ingest.candidate.setTarget",
  "ingest.candidate.hold",
  "ingest.candidate.release",
  "ingest.candidate.get",
  "ingest.rows.list",
  "ingest.rows.doubts",
  "ingest.hole.list",
  "ingest.merge.get",
  "ingest.provenance.forRecord",
  "ingest.dryRun.step",
];

/** The §10 scan (2026-11-20): queries that write rows, call out, mint links or export in bulk. */
const SCAN_DENIED = [
  "reasonCodes.list",
  "press.reasons",
  "dieInstance.work.kinds",
  "press.collector.runSummary",
  "dieInstance.files.url",
  "dieInstance.drawing",
  "press.runs.drawing",
  "scale.reading",
  "reports.salesRegisterCsv",
  "foundry.spectro.file",
];

describe("every router and every ingest procedure has a decision", () => {
  test("each top-level key of appRouter is in BUDDY_DECISIONS.routers, and nothing stale is there", async () => {
    const { appRouter, BUDDY_DECISIONS } = await load();
    const tops = new Set(Object.keys(appRouter._def.procedures).map((p) => p.split(".")[0]!));
    const decided = new Set(Object.keys(BUDDY_DECISIONS.routers));
    expect([...tops].filter((t) => !decided.has(t)).sort()).toEqual([]);
    expect([...decided].filter((t) => !tops.has(t)).sort()).toEqual([]);
  });

  test("each ingest procedure has its own entry (router is per-procedure)", async () => {
    const { reg, BUDDY_DECISIONS } = await load();
    expect(BUDDY_DECISIONS.routers.ingest).toBe("per-procedure");
    const own = { ...BUDDY_DECISIONS.paths, ...BUDDY_DECISIONS.pending } as Record<string, unknown>;
    const ingest = [...reg.keys()].filter((p) => p.startsWith("ingest."));
    expect(ingest.length).toBeGreaterThan(30);
    expect(ingest.filter((p) => !Object.prototype.hasOwnProperty.call(own, p)).sort()).toEqual([]);
  });

  test("a path decision names a real procedure; only the named pending list may name one that does not exist yet", async () => {
    const { reg, BUDDY_DECISIONS } = await load();
    const stale = Object.keys(BUDDY_DECISIONS.paths).filter((p) => !reg.has(p));
    expect(stale).toEqual([]);
    // Pending paths are release 2 of the import; once it merges they exist and must move to `paths`.
    for (const p of Object.keys(BUDDY_DECISIONS.pending)) {
      expect(p.startsWith("ingest.vision.")).toBe(true);
      expect({ p, existsNow: reg.has(p) }).toEqual({ p, existsNow: false });
    }
  });

  test("an unknown router or an undecided ingest path is denied (fail closed)", async () => {
    const { decideBuddyPath } = await load();
    expect(decideBuddyPath("newRouter.list").kind).toBe("deny");
    expect(decideBuddyPath("ingest.somethingNew").kind).toBe("deny");
    expect(decideBuddyPath("__proto__").kind).toBe("deny");
    expect(decideBuddyPath("constructor.x").kind).toBe("deny");
  });
});

describe("the decisions themselves", () => {
  test("§12.3: never callable, not even as a draft", async () => {
    const { decideBuddyPath } = await load();
    for (const p of NEVER) expect({ p, kind: decideBuddyPath(p).kind }).toEqual({ p, kind: "deny" });
  });

  test("§12.1: the import tools are allowed", async () => {
    const { decideBuddyPath } = await load();
    for (const p of IMPORT_TOOLS) expect({ p, kind: decideBuddyPath(p).kind }).toEqual({ p, kind: "allow" });
  });

  test("§10 scan hits are denied; the CSV form of two reports is refused by input", async () => {
    const { decideBuddyPath, reg } = await load();
    const { refusedInput } = await import("../src/lib/buddy/decisions");
    for (const p of SCAN_DENIED) {
      expect({ p, exists: reg.has(p), kind: decideBuddyPath(p).kind }).toEqual({ p, exists: true, kind: "deny" });
    }
    for (const p of ["reports.ageing", "press.report"]) {
      const d = decideBuddyPath(p);
      expect(d.kind).toBe("allow");
      expect(refusedInput(d, { format: "csv" })).toBeTruthy();
      expect(refusedInput(d, { format: "json" })).toBeNull();
      expect(refusedInput(d, {})).toBeNull();
    }
  });

  test("§4.2: members, roles, company settings, the buddy router and the denied routers", async () => {
    const { decideBuddyPath, reg } = await load();
    for (const p of ["company.updateSettings", "company.membersUpdateRole", "company.membersRemove", "company.switch", "foundry.casts.setSeriesStart"]) {
      expect({ p, exists: reg.has(p), kind: decideBuddyPath(p).kind }).toEqual({ p, exists: true, kind: "deny" });
    }
    const deniedRouters = ["auth", "invite", "platform", "portal", "waitlist", "spool", "edge", "device", "release", "backup", "support", "buddy"];
    for (const entry of reg.values()) {
      const top = entry.path.split(".")[0]!;
      if (deniedRouters.includes(top) || entry.path === "healthCheck" || entry.path === "privateData") {
        expect({ p: entry.path, kind: entry.decision.kind }).toEqual({ p: entry.path, kind: "deny" });
      }
    }
    expect(reg.get("buddy.drafts.confirm")?.decision.kind).toBe("deny");
  });

  test("every denied decision carries a reason", async () => {
    const { BUDDY_DECISIONS } = await load();
    const all = [...Object.values(BUDDY_DECISIONS.routers), ...Object.values(BUDDY_DECISIONS.paths), ...Object.values(BUDDY_DECISIONS.pending)];
    for (const d of all) {
      if (typeof d === "object" && d.kind === "deny") expect(d.reason.length).toBeGreaterThan(10);
    }
  });
});

describe("the catalogue", () => {
  test("is built from appRouter._def.procedures with kind and the guard action", async () => {
    const { reg } = await load();
    expect(reg.get("ingest.status")).toMatchObject({ kind: "query", guard: { mode: "any", actions: ["ingest.upload", "ingest.merge"] } });
    expect(reg.get("ingest.shape.make")).toMatchObject({ kind: "mutation", guard: { mode: "all", actions: ["ingest.upload"] } });
    expect(reg.get("audit.list")).toMatchObject({ kind: "query", guard: { mode: "all", actions: ["audit.read"] } });
    expect(reg.get("ingest.shape.make")?.fields).toEqual(expect.arrayContaining(["candidateId", "expectSeq"]));
  });

  test("every allowed path describes its input as JSON Schema", async () => {
    const { reg, inputJsonSchema } = await load();
    const failures: string[] = [];
    let allowed = 0;
    for (const entry of reg.values()) {
      if (entry.decision.kind !== "allow") continue;
      allowed += 1;
      try {
        JSON.stringify(inputJsonSchema(entry));
      } catch (e) {
        failures.push(`${entry.path}: ${String(e)}`);
      }
    }
    expect(allowed).toBeGreaterThan(200);
    expect(failures).toEqual([]);
  });

  test("descriptions: the import tools are described by hand (others fall back to words from the path)", async () => {
    const { buddyDescriptions, reg } = await load();
    for (const p of IMPORT_TOOLS) expect({ p, described: p in buddyDescriptions }).toEqual({ p, described: true });
    // A lint-style list, not a failure (§4.2): how many allowed paths still use the fallback.
    const missing = [...reg.values()].filter((e) => e.decision.kind === "allow" && !(e.path in buddyDescriptions)).length;
    expect(missing).toBeGreaterThanOrEqual(0);
  });
});

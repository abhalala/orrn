/**
 * orrn buddy registry and the one allow/deny constant (design 2026-11-18, §4.2, §10, §12.3).
 *
 * - every top-level router of `appRouter` has a decision;
 * - every `ingest.*` procedure has its own decision (a new ingest procedure cannot become a tool by accident);
 * - a path decision names a real procedure, except from the named pending list (release 2 of the import);
 * - the §12.3 paths and the §10 scan hits are denied; every allowed path describes as JSON Schema.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

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
  // Owner decision 2 (2026-11-20): attestation acts, even as drafts.
  "approval.decide",
  "dieInstance.closeOwnerOverride",
  "ingest.rows.answerDoubts",
  // Review S8: release 2 procedures, denied ahead of the merge.
  "ingest.artifact.uploadStart",
  "ingest.artifact.uploadTickets",
  "ingest.artifact.uploadComplete",
  "ingest.artifact.uploadAbort",
  "ingest.vision.nextBatch",
  "ingest.vision.finishRest",
];

/** Release 2 of the import (PR #12, merged 2026-11-21): decided ahead in `pending`, moved to `paths` at the rebase. */
const RELEASE_2 = [
  "ingest.vision.readPage",
  "ingest.vision.pages",
  "ingest.vision.check",
  "ingest.vision.start",
  "ingest.vision.bandTickets",
  "ingest.vision.skipPage",
  "ingest.vision.typePage",
  "ingest.vision.fixCell",
  "ingest.vision.readUrl",
  "ingest.artifact.uploadStart",
  "ingest.artifact.uploadTickets",
  "ingest.artifact.uploadComplete",
  "ingest.artifact.uploadAbort",
  "ingest.vision.nextBatch",
  "ingest.vision.finishRest",
  "ingest.vision.waiting",
];

/** Paths of a branch that has not merged yet, the only ones `pending` may name. None today. */
const PENDING: string[] = [];

/** §12.1: what the buddy can do in an import. */
const IMPORT_TOOLS = [
  "ingest.status",
  "ingest.artifact.list",
  "ingest.artifact.get",
  "ingest.candidate.list",
  "ingest.shape.make",
  "ingest.vision.readPage",
  "ingest.answer.set",
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
  // Delta round decision 1 (B1, D-M1): a share link would leave orrn through the chat, like the drawing link.
  "die.share.create",
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
    // Pending paths belong to an unmerged branch; once it merges they exist and must move to `paths`.
    expect(Object.keys(BUDDY_DECISIONS.pending).sort()).toEqual([...PENDING].sort());
    for (const p of Object.keys(BUDDY_DECISIONS.pending)) {
      expect({ p, existsNow: reg.has(p) }).toEqual({ p, existsNow: false });
    }
  });

  test("review N2: a change in an allowed router needs its own reviewed entry; a new one is denied and named here", async () => {
    const { reg, BUDDY_DECISIONS } = await load();
    const { undecidedChanges, buildRegistry } = await import("../src/lib/buddy/registry");
    // Today every change of an allowed router is decided by name.
    expect(undecidedChanges(reg)).toEqual([]);
    // A new mutation in an allowed router, as tRPC keeps it: denied, and listed until it gets an entry.
    const fake = buildRegistry({
      "customer.zzSyntheticNew": { _def: { type: "mutation", inputs: [] } },
      "customer.zzSyntheticRead": { _def: { type: "query", inputs: [] } },
    });
    expect(fake.get("customer.zzSyntheticNew")?.decision.kind).toBe("deny");
    expect(fake.get("customer.zzSyntheticRead")?.decision.kind).toBe("allow");
    expect(undecidedChanges(fake)).toEqual(["customer.zzSyntheticNew"]);
    // Every named change exists and sits in an allowed router (no stale names).
    const changes = BUDDY_DECISIONS.changes as readonly string[];
    expect(changes.filter((p) => reg.get(p)?.kind !== "mutation")).toEqual([]);
    expect([...changes].sort()).toEqual([...changes]);
  });

  test("an unknown router or an undecided ingest path is denied (fail closed)", async () => {
    const { decideBuddyPath } = await load();
    expect(decideBuddyPath("newRouter.list").kind).toBe("deny");
    expect(decideBuddyPath("ingest.somethingNew").kind).toBe("deny");
    expect(decideBuddyPath("__proto__").kind).toBe("deny");
    expect(decideBuddyPath("constructor.x").kind).toBe("deny");
  });

  test("the pending release 2 decisions apply at run time, so the page tick is denied the day it merges", async () => {
    const { decideBuddyPath } = await load();
    // decideBuddyPath is what the registry stores per procedure; a pending entry wins over the router once the path exists.
    expect(decideBuddyPath("ingest.vision.check").kind).toBe("deny");
    expect(decideBuddyPath("ingest.vision.start").kind).toBe("deny");
    expect(decideBuddyPath("ingest.vision.readPage").kind).toBe("allow");
  });

  test("release 2 has merged: each of its procedures exists, has its own entry in paths, and the registry carries it", async () => {
    const { reg, BUDDY_DECISIONS } = await load();
    const paths = BUDDY_DECISIONS.paths as Record<string, { kind: "allow" | "deny" }>;
    for (const p of RELEASE_2) {
      expect({ p, exists: reg.has(p), inPaths: Object.prototype.hasOwnProperty.call(paths, p) }).toEqual({ p, exists: true, inPaths: true });
      expect(reg.get(p)?.decision.kind).toBe(paths[p]!.kind);
    }
    // The tick, the uploads and the page-image steps stay denied; the reads and readPage stay allowed.
    for (const p of ["ingest.vision.check", "ingest.vision.readUrl", "ingest.artifact.uploadStart", "ingest.vision.nextBatch", "ingest.vision.finishRest"]) {
      expect({ p, kind: reg.get(p)?.decision.kind }).toEqual({ p, kind: "deny" });
    }
    for (const p of ["ingest.vision.pages", "ingest.vision.waiting", "ingest.vision.readPage"]) {
      expect({ p, kind: reg.get(p)?.decision.kind }).toEqual({ p, kind: "allow" });
    }
  });
});

/**
 * Security M2 / decision 10: every procedure is pinned with its kind and decision. A new procedure, or a changed
 * decision, fails here until its line is added to the snapshot in the same change (a reviewed, one-line decision).
 * Regenerate after deciding: `BUDDY_SNAPSHOT_WRITE=1 bun test test/buddy-registry.test.ts`, then read the diff.
 */
describe("every procedure is pinned (security M2)", () => {
  const SNAPSHOT = join(import.meta.dir, "buddy-procedures.snapshot.tsv");

  test("the registry matches the checked-in snapshot of path, kind, decision and irreversible", async () => {
    const { reg } = await load();
    const { irreversiblePath } = await import("../src/lib/buddy/draftRefs");
    const lines = [...reg.values()]
      .map((e) => {
        const d = e.decision;
        const decision = d.kind === "deny" ? "deny" : d.unless ? `allow unless ${d.unless.field}=${d.unless.values.join("|")}` : "allow";
        // Delta decision 5: whether the change can be undone, which gates Confirm on unnamed ids and bidi controls.
        return `${e.path}\t${e.kind}\t${decision}\t${irreversiblePath(e.path) ? "irreversible" : "reversible"}`;
      })
      .sort();
    if (process.env.BUDDY_SNAPSHOT_WRITE === "1") writeFileSync(SNAPSHOT, `${lines.join("\n")}\n`);
    const pinned = existsSync(SNAPSHOT) ? readFileSync(SNAPSHOT, "utf8").split("\n").filter(Boolean) : [];
    const pinnedSet = new Set(pinned);
    const now = new Set(lines);
    expect({ notPinned: lines.filter((l) => !pinnedSet.has(l)), stale: pinned.filter((l) => !now.has(l)) }).toEqual({ notPinned: [], stale: [] });
    expect(lines.length).toBeGreaterThan(400);
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

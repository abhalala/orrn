import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { replayKey, sendOnce, type ReplayAttempt } from "../lib/replay-key";
import { RequestTimeoutError } from "../lib/request-timeout";
import { writeFailureKind } from "../lib/request-timeout";

/**
 * W4-NATIVE-C: every write the phone can send twice (a reply lost on plant Wi-Fi, a second tap, an app kill)
 * is either sent with a replay key that the SERVER honours, or is guarded some other way and says so here.
 * Reads the native source for every `trpc.<proc>.mutationOptions` and the server source for what each
 * procedure accepts, so a new write, or a server that learns a key, fails this test until someone decides.
 */

const NATIVE = join(import.meta.dir, "..");
const SERVER = join(import.meta.dir, "..", "..", "..", "packages", "server", "src", "routers");

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "__tests__" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) sourceFiles(p, out);
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

const NATIVE_FILES = ["app", "features", "components", "lib"].flatMap((d) => sourceFiles(join(NATIVE, d)));
const read = (p: string) => readFileSync(p, "utf8");

/** proc path -> the native files that send it. */
function nativeWrites(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const f of NATIVE_FILES) {
    for (const m of read(f).matchAll(/trpc\.([A-Za-z.]+?)\.mutationOptions\(/g)) {
      out.set(m[1]!, [...(out.get(m[1]!) ?? []), f.slice(NATIVE.length + 1)]);
    }
  }
  return out;
}

type Keyed = { how: "replay-key"; field: "clientRequestId" | "clientMutationId"; server: string; leaf: string; sendsIn: string; model: string };
type Guarded = { how: "guarded"; server: string; leaf: string; guard: string };

const KEYED: Record<string, Keyed> = {
  "bundle.createReceipt": { how: "replay-key", field: "clientRequestId", server: "bundle.ts", leaf: "createReceipt", sendsIn: "app/(tabs)/pack/new.tsx", model: "withRequestKey (session nonce + payload hash; pack-submit.test.ts)" },
  "dispatch.scan": { how: "replay-key", field: "clientRequestId", server: "dispatch.ts", leaf: "scan", sendsIn: "app/(tabs)/dispatch/[id].tsx", model: "replayKey + sendOnce" },
  "dispatch.addBundlesBySerial": { how: "replay-key", field: "clientRequestId", server: "dispatch.ts", leaf: "addBundlesBySerial", sendsIn: "features/bundle/add-to-dispatch-sheet.tsx", model: "replayKey (also features/scan/scan-view.tsx: replayKey + sendOnce)" },
  "dispatch.create": { how: "replay-key", field: "clientRequestId", server: "dispatch.ts", leaf: "create", sendsIn: "app/(tabs)/dispatch/new.tsx", model: "replayKey + sendOnce (BACKLOG 47)" },
  "dieInstance.addReading": { how: "replay-key", field: "clientRequestId", server: "dieInstance.ts", leaf: "addReading", sendsIn: "features/dies/reading-panel.tsx", model: "replayKey + sendOnce (BACKLOG 47)" },
  "die.share.create": { how: "replay-key", field: "clientMutationId", server: "dieShare.ts", leaf: "create", sendsIn: "features/dies/share-panel.tsx", model: "replayKey + sendOnce (final fixes 5, M4: the server derives the link from the key, so a repeat answers the first link)" },
  "foundry.casts.open": { how: "replay-key", field: "clientRequestId", server: "foundry.ts", leaf: "open", sendsIn: "features/foundry/new-cast-view.tsx", model: "replayKey + sendOnce (W2-FD-N)" },
  "foundry.casts.close": { how: "replay-key", field: "clientMutationId", server: "foundry.ts", leaf: "close", sendsIn: "features/foundry/close-sheet.tsx", model: "replayKey + sendOnce; the key is the clientMutationId (W2-FD-N)" },
  "foundry.melts.save": { how: "replay-key", field: "clientRequestId", server: "foundryMelt.ts", leaf: "save", sendsIn: "features/foundry/melt-editor.tsx", model: "replayKey + sendOnce on the FIRST save (it makes the draft); later saves send expectedServerSeq, so a repeat of one that landed is refused as stale (W2-FD-N)" },
  "foundry.melts.lock": { how: "replay-key", field: "clientMutationId", server: "foundryMelt.ts", leaf: "lock", sendsIn: "features/foundry/melt-editor.tsx", model: "replayKey + sendOnce; the key is the clientMutationId (W2-FD-N)" },
  "foundry.melts.correct": { how: "replay-key", field: "clientMutationId", server: "foundryMelt.ts", leaf: "correct", sendsIn: "features/foundry/melt-sheet-view.tsx", model: "replayKey + sendOnce; the key is the clientMutationId (W2-FD-N)" },
  "foundry.spectro.enter": { how: "replay-key", field: "clientRequestId", server: "foundry.ts", leaf: "enter", sendsIn: "features/foundry/spectro-panel.tsx", model: "replayKey + sendOnce (W2-FD-N)" },
  "orders.create": { how: "replay-key", field: "clientRequestId", server: "salesOrder.ts", leaf: "create", sendsIn: "features/orders/booking-screen.tsx", model: "bookingSubmit -> replayKey" },
  // W3-AG-N (FP-AG-16): the ageing station. Each write goes through `useKeyedWrite` (features/ageing/use-ageing.ts: replayKey + sendOnce), the key is the server's `clientMutationId`.
  "ageing.batches.load": { how: "replay-key", field: "clientMutationId", server: "ageing.ts", leaf: "load", sendsIn: "features/ageing/load-view.tsx", model: "useKeyedWrite (replayKey + sendOnce)" },
  "ageing.batches.start": { how: "replay-key", field: "clientMutationId", server: "ageing.ts", leaf: "start", sendsIn: "features/ageing/sheets.tsx", model: "useKeyedWrite (replayKey + sendOnce)" },
  "ageing.batches.temp": { how: "replay-key", field: "clientMutationId", server: "ageing.ts", leaf: "temp", sendsIn: "features/ageing/sheets.tsx", model: "useKeyedWrite (replayKey + sendOnce)" },
  "ageing.batches.out": { how: "replay-key", field: "clientMutationId", server: "ageing.ts", leaf: "out", sendsIn: "features/ageing/sheets.tsx", model: "useKeyedWrite (replayKey + sendOnce)" },
  "ageing.batches.hardness": { how: "replay-key", field: "clientMutationId", server: "ageing.ts", leaf: "hardness", sendsIn: "features/ageing/sheets.tsx", model: "useKeyedWrite (replayKey + sendOnce)" },
  "ageing.batches.release": { how: "replay-key", field: "clientMutationId", server: "ageing.ts", leaf: "release", sendsIn: "features/ageing/batch-view.tsx", model: "useKeyedWrite (replayKey + sendOnce)" },
};

/** Writes the server gives no replay key. Each says what stops a second send doing harm; the screens re-read after an unsure answer instead of resending. */
const GUARDED: Record<string, Guarded> = {
  "dispatch.reserve": { how: "guarded", server: "dispatch.ts", leaf: "reserve", guard: "state move draft to reserved: a second call is refused by the status guard" },
  "dispatch.unreserve": { how: "guarded", server: "dispatch.ts", leaf: "unreserve", guard: "state move: a second call is refused by the status guard" },
  "dispatch.complete": { how: "guarded", server: "dispatch.ts", leaf: "complete", guard: "state move to completed: a second call is refused by the status guard; stock postings are written once with the move" },
  "dispatch.cancel": { how: "guarded", server: "dispatch.ts", leaf: "cancel", guard: "state move: a second call is refused by the status guard" },
  "dispatch.softDelete": { how: "guarded", server: "dispatch.ts", leaf: "softDelete", guard: "deleted_at set once; a second call finds it gone" },
  "dispatch.removeBundle": { how: "guarded", server: "dispatch.ts", leaf: "removeBundle", guard: "removes a row; a second call finds nothing to remove" },
  "dispatch.update": { how: "guarded", server: "dispatch.ts", leaf: "update", guard: "BACKLOG 62: sets the vehicle number to an absolute value before Dispatch; the same value twice is the same state" },
  "dispatch.setItemGroupLabel": { how: "guarded", server: "dispatch.ts", leaf: "setItemGroupLabel", guard: "sets an absolute label; the same value twice is the same state" },
  "packingList.regenerate": { how: "guarded", server: "packingList.ts", leaf: "regenerate", guard: "builds a new revision from the dispatch; a repeat makes the next revision of the same content (a revision trail, no stock effect)" },
  "bundle.transitionStatus": { how: "guarded", server: "bundle.ts", leaf: "transitionStatus", guard: "available <-> void move: a second call is refused by the status guard" },
  "spool.printBundleLabel": { how: "guarded", server: "spool.ts", leaf: "printBundleLabel", guard: "BACKLOG 44: the spool job key (bundle:<serial>:label:v<version>:attempt:<n>) is built on the server; this button is an explicit reprint (reprint: true = attempt + 1) and is disabled while a send is pending, so a double tap prints once" },
  "dieInstance.nitridingOut": { how: "guarded", server: "dieInstance.ts", leaf: "nitridingOut", guard: "state move: a second call is refused 'is out at nitriding' (die_instance status guard)" },
  "dieInstance.nitridingBack": { how: "guarded", server: "dieInstance.ts", leaf: "nitridingBack", guard: "state move: a second call is refused 'is not out at nitriding'" },
  "dieInstance.issues.issue": { how: "guarded", server: "dieIssue.ts", leaf: "issue", guard: "one open issue per copy (partial unique index): a second call is refused 'is already issued to'" },
  "dieInstance.issues.return": { how: "guarded", server: "dieIssue.ts", leaf: "return", guard: "state move issued to returned: a second call is refused 'This issue is already closed'" },
  "dieInstance.issues.cancel": { how: "guarded", server: "dieIssue.ts", leaf: "cancel", guard: "state move issued to cancelled: a second call is refused 'This issue is already closed'" },
  "dieInstance.maker.jobs.send": { how: "guarded", server: "dieMaker.ts", leaf: "send", guard: "one open maker job per copy (partial unique index): a second call is refused" },
  "dieInstance.maker.jobs.receive": { how: "guarded", server: "dieMaker.ts", leaf: "receive", guard: "state move sent to received: a second call is refused 'already closed'" },
  "dieInstance.maker.jobs.cancel": { how: "guarded", server: "dieMaker.ts", leaf: "cancel", guard: "state move sent to cancelled: a second call is refused 'already closed'" },
  "press.downtime.start": { how: "guarded", server: "press.ts", leaf: "start", guard: "one open downtime per press line: a second call is refused 'already has downtime running'" },
  "press.downtime.stop": { how: "guarded", server: "press.ts", leaf: "stop", guard: "stops an open row once; a second call finds it stopped" },
  "press.runs.handover": { how: "guarded", server: "pressRun.ts", leaf: "handover", guard: "sets the people on a run to absolute values; the same values twice change nothing" },
  "foundry.melts.discard": { how: "guarded", server: "foundryMelt.ts", leaf: "discard", guard: "state move draft to cancelled: a second call is refused 'Only a draft can be discarded'; a draft posts nothing, so there is nothing to reverse" },
  "foundry.melts.requestCorrection": { how: "guarded", server: "foundryMelt.ts", leaf: "requestCorrection", guard: "one open request per melt: a second call is refused 'A correction for this melt is already waiting for approval'; an approval is not a stock effect" },
  "foundry.spectro.attach": { how: "guarded", server: "foundry.ts", leaf: "attach", guard: "adds one more result of the same photo to a draft melt; the latest live result is the one judged, nothing posts to stock, and the button waits for the answer (an unsure answer re-reads the results before a second photo is sent)" },
  "orders.confirm": { how: "guarded", server: "orderFlow.ts", leaf: "confirm", guard: "sends serverSeq (optimistic lock) and the booking-only status guard: a second call is refused 'Only a booking can be confirmed' or 'changed meanwhile'" },
  "invite.acceptByToken": { how: "guarded", server: "invite.ts", leaf: "acceptByToken", guard: "the token is single use; a second call finds the invite accepted" },
  // W3-AG-N: the supervisor's hold, clear and approval request. The server keys none of them; `useGuardedWrite` never resends on its own and, after an unsure answer, re-reads the batch before the button is free again.
  "ageing.batches.hold": { how: "guarded", server: "ageing.ts", leaf: "hold", guard: "already_held: a second hold of a held LINE is refused 'already held' (status guard). A second hold of the whole trolley is not refused: it holds the same lines again and writes a second audit row (the state is idempotent), so the sheet closes after an unsure answer that landed instead of inviting a second tap" },
  "ageing.batches.unhold": { how: "guarded", server: "ageing.ts", leaf: "unhold", guard: "not_held: a second clear is refused 'not held' (status guard); a batch that moved on answers wrong_status" },
  "ageing.batches.requestOverride": { how: "guarded", server: "ageing.ts", leaf: "requestOverride", guard: "one pending ageing_override approval per batch: a second request is refused override_pending" },
  "device.register": { how: "guarded", server: "release.ts", leaf: "register", guard: "upsert by install id, once per launch per plant" },
};

/** The procedure's definition, from its name to its `.mutation(`, plus the body of a shared `.input(name)` constant when it uses one. */
function procedureHead(file: string, leaf: string): string {
  const src = read(join(SERVER, file));
  const m = new RegExp(`^\\s+${leaf}: [A-Za-z]*Procedure`, "m").exec(src);
  expect({ file, leaf, found: m !== null }).toEqual({ file, leaf, found: true });
  let from = m!.index;
  // A router that names its procedures once and lists them (`load: loadProcedure,`, routers/ageing.ts): read the definition.
  const alias = new RegExp(`^\\s+${leaf}: (\\w+Procedure),`, "m").exec(src)?.[1];
  if (alias) {
    from = src.search(new RegExp(`^const ${alias}\\b`, "m"));
    expect({ alias, found: from > -1 }).toEqual({ alias, found: true });
  }
  const to = src.indexOf(".mutation(", from);
  let head = src.slice(from, to);
  const shared = /\.input\(\s*([A-Za-z_]\w*)\s*\)/.exec(head)?.[1];
  if (shared) {
    // The shared input is in the router file, or (ageing) in lib/ageingContracts.ts.
    const contracts = read(join(SERVER, "..", "lib", "ageingContracts.ts"));
    const where = src.search(new RegExp(`const ${shared}\\b`)) > -1 ? src : contracts;
    const at = where.search(new RegExp(`const ${shared}\\b`));
    expect({ shared, found: at > -1 }).toEqual({ shared, found: true });
    head += where.slice(at, at + 1500);
  }
  return head;
}

const KEY_FIELD = /client(?:Request|Mutation)Id/;

describe("replay keys: every native write is accounted for", () => {
  const writes = nativeWrites();

  test("the native writes are exactly the audited ones", () => {
    expect([...writes.keys()].sort()).toEqual([...Object.keys(KEYED), ...Object.keys(GUARDED)].sort());
  });

  test("a keyed write: the server takes the key, and the screen sends one from a pure model", () => {
    for (const [proc, k] of Object.entries(KEYED)) {
      const head = procedureHead(k.server, k.leaf);
      const file = read(join(SERVER, k.server));
      expect({ proc, serverTakesKey: head.includes(k.field) || file.includes(k.field) }).toEqual({ proc, serverTakesKey: true });
      const sender = read(join(NATIVE, k.sendsIn));
      expect({ proc, sends: sender.includes(k.field) || /withRequestKey|bookingSubmit|replayKey/.test(sender) }).toEqual({ proc, sends: true });
      expect(writes.get(proc)!.some((f) => f === k.sendsIn)).toBe(true);
    }
  });

  test("the guarded writes have no server key; the day the server adds one, this test says to use it", () => {
    for (const [proc, g] of Object.entries(GUARDED)) {
      expect(g.guard.length).toBeGreaterThan(20);
      const head = procedureHead(g.server, g.leaf);
      expect({ proc, serverHasKey: KEY_FIELD.test(head) }).toEqual({ proc, serverHasKey: false });
    }
  });

  test("the app resends on its own (sendOnce) only with the key in the call", () => {
    for (const f of NATIVE_FILES) {
      const src = read(f);
      if (!/\bsendOnce\(/.test(src) || f.endsWith("replay-key.ts")) continue;
      for (const call of src.matchAll(/sendOnce\(([\s\S]{0,200}?)\)\.then|sendOnce\(\s*\(clientRequestId\)([\s\S]{0,200}?),\s*\w/g)) {
        expect({ file: f, carriesKey: (call[0] ?? "").includes("clientRequestId") }).toEqual({ file: f, carriesKey: true });
      }
    }
  });

  test("a keyless write is never retried by a wrapper that resends on a lost reply", () => {
    for (const f of NATIVE_FILES) {
      const src = read(f);
      if (f.endsWith("replay-key.ts")) continue;
      expect({ file: f, loop: /retry:\s*(?:[1-9]|true)/.test(src) && /mutationOptions/.test(src) }).toEqual({ file: f, loop: false });
    }
  });
});

describe("the replay models", () => {
  let n = 0;
  const fresh = () => `id-${++n}`;

  test("the same content after an unsure answer reuses the id; new content gets a new one", () => {
    n = 0;
    const first = replayKey(null, { id: "d1", serial: "S1" }, fresh);
    expect(replayKey(first.attempt, { id: "d1", serial: "S1" }, fresh).id).toBe("id-1");
    expect(replayKey(first.attempt, { id: "d1", serial: "S2" }, fresh).id).toBe("id-2");
  });

  test("editing and going back to an earlier unsaved send reuses that send's id (it may have landed)", () => {
    n = 0;
    const a = replayKey(null, { q: 1 }, fresh);
    const b = replayKey(a.attempt, { q: 2 }, fresh);
    const c = replayKey(b.attempt, { q: 1 }, fresh);
    expect([a.id, b.id, c.id]).toEqual(["id-1", "id-2", "id-1"]);
    expect(replayKey(c.attempt, { q: 2 }, fresh).id).toBe("id-2");
    expect(replayKey(c.attempt, { q: 3 }, fresh).id).toBe("id-3");
  });

  test("a saved write ends the attempt: the next one is new even with the same content", () => {
    n = 0;
    const a = replayKey(null, { q: 1 }, fresh);
    let attempt: ReplayAttempt = a.attempt;
    attempt = null; // what every screen does on success
    expect(replayKey(attempt, { q: 1 }, fresh).id).toBe("id-2");
  });

  test("only a bounded number of earlier sends are remembered", () => {
    n = 0;
    let attempt: ReplayAttempt = null;
    for (let i = 0; i < 40; i++) attempt = replayKey(attempt, { q: i }, fresh).attempt;
    expect(Object.keys(attempt!.earlier ?? {}).length).toBeLessThanOrEqual(8);
  });

  test("sendOnce resends with the SAME key only when no reply came, never after a refusal", async () => {
    const seen: string[] = [];
    const lost = async (key: string) => {
      seen.push(key);
      if (seen.length === 1) throw new RequestTimeoutError(60_000);
      return "ok";
    };
    // a timeout carries no tRPC data, so it counts as no reply
    expect(await sendOnce(lost, "k1")).toBe("ok");
    expect(seen).toEqual(["k1", "k1"]);

    const refused = async (key: string) => {
      seen.push(key);
      throw { data: { code: "BAD_REQUEST", httpStatus: 400 }, message: "x" };
    };
    seen.length = 0;
    await expect(sendOnce(refused, "k2")).rejects.toBeDefined();
    expect(seen).toEqual(["k2"]);
  });

  test("a timed-out or 5xx write is 'unsure': the screen re-reads before offering a resend", () => {
    expect(writeFailureKind(new RequestTimeoutError(60_000))).toBe("unsure");
    expect(writeFailureKind({ data: { code: "INTERNAL_SERVER_ERROR", httpStatus: 503 } })).toBe("unsure");
    expect(writeFailureKind({ data: { code: "CONFLICT", httpStatus: 409 } })).toBe("failed");
  });
});

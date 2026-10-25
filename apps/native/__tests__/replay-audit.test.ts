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
  "orders.create": { how: "replay-key", field: "clientRequestId", server: "salesOrder.ts", leaf: "create", sendsIn: "features/orders/booking-screen.tsx", model: "bookingSubmit -> replayKey" },
};

/** Writes the server gives no replay key. Each says what stops a second send doing harm; the screens re-read after an unsure answer instead of resending. */
const GUARDED: Record<string, Guarded> = {
  "dispatch.create": { how: "guarded", server: "dispatch.ts", leaf: "create", guard: "NO KEY on the server (BACKLOG: add one). A lost reply may leave an empty draft dispatch; the screen says 'not sure it saved' and sends the person to the Dispatch list, never auto-resends." },
  "dispatch.reserve": { how: "guarded", server: "dispatch.ts", leaf: "reserve", guard: "state move draft to reserved: a second call is refused by the status guard" },
  "dispatch.unreserve": { how: "guarded", server: "dispatch.ts", leaf: "unreserve", guard: "state move: a second call is refused by the status guard" },
  "dispatch.complete": { how: "guarded", server: "dispatch.ts", leaf: "complete", guard: "state move to completed: a second call is refused by the status guard; stock postings are written once with the move" },
  "dispatch.cancel": { how: "guarded", server: "dispatch.ts", leaf: "cancel", guard: "state move: a second call is refused by the status guard" },
  "dispatch.softDelete": { how: "guarded", server: "dispatch.ts", leaf: "softDelete", guard: "deleted_at set once; a second call finds it gone" },
  "dispatch.removeBundle": { how: "guarded", server: "dispatch.ts", leaf: "removeBundle", guard: "removes a row; a second call finds nothing to remove" },
  "dispatch.setItemGroupLabel": { how: "guarded", server: "dispatch.ts", leaf: "setItemGroupLabel", guard: "sets an absolute label; the same value twice is the same state" },
  "packingList.regenerate": { how: "guarded", server: "packingList.ts", leaf: "regenerate", guard: "builds a new revision from the dispatch; a repeat makes the next revision of the same content (a revision trail, no stock effect)" },
  "bundle.transitionStatus": { how: "guarded", server: "bundle.ts", leaf: "transitionStatus", guard: "available <-> void move: a second call is refused by the status guard" },
  "spool.printBundleLabel": { how: "guarded", server: "spool.ts", leaf: "printBundleLabel", guard: "a reprint is a new label by design; the button is disabled while a send is pending (bundle-screen.tsx isPending), so a double tap prints once" },
  "dieInstance.addReading": { how: "guarded", server: "dieInstance.ts", leaf: "addReading", guard: "NO KEY on the server. An unsure answer says 'check the card first' (dieErrorText), the reading list on the card is the check; the keypad clears only after the server answers" },
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
  "orders.confirm": { how: "guarded", server: "orderFlow.ts", leaf: "confirm", guard: "sends serverSeq (optimistic lock) and the booking-only status guard: a second call is refused 'Only a booking can be confirmed' or 'changed meanwhile'" },
  "invite.acceptByToken": { how: "guarded", server: "invite.ts", leaf: "acceptByToken", guard: "the token is single use; a second call finds the invite accepted" },
  "device.register": { how: "guarded", server: "release.ts", leaf: "register", guard: "upsert by install id, once per launch per plant" },
};

/** The procedure's definition, from its name to its `.mutation(`, plus the body of a shared `.input(name)` constant when it uses one. */
function procedureHead(file: string, leaf: string): string {
  const src = read(join(SERVER, file));
  const m = new RegExp(`^\\s+${leaf}: [A-Za-z]*Procedure`, "m").exec(src);
  expect({ file, leaf, found: m !== null }).toEqual({ file, leaf, found: true });
  const from = m!.index;
  const to = src.indexOf(".mutation(", from);
  let head = src.slice(from, to);
  const shared = /\.input\(\s*([A-Za-z_]\w*)\s*\)/.exec(head)?.[1];
  if (shared) {
    const at = src.search(new RegExp(`const ${shared}\\b`));
    expect({ shared, found: at > -1 }).toEqual({ shared, found: true });
    head += src.slice(at, at + 1500);
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

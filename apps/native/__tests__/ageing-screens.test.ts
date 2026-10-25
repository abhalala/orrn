import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { en } from "@orrn/i18n/en";
import { gu } from "@orrn/i18n/gu";
import { hi } from "@orrn/i18n/hi";
import { mapSentence } from "@orrn/i18n/refusal";
import { createI18n } from "@orrn/i18n";

import { RequestTimeoutError } from "../lib/request-timeout";

import { ageingError, ageingRefusalText } from "../features/ageing/errors";

/**
 * FP-AG-16 (W3-AG-N): the ageing station's screens, read as source (no device here). Routes under More and not a
 * tab, every write through the keyed or guarded hook, no outbox, refusals through one mapper, no raw
 * `error.message`, every dictionary key in en, hi and gu, and the web-only actions said as such.
 */

const NATIVE = join(import.meta.dir, "..");
const read = (rel: string) => readFileSync(join(NATIVE, rel), "utf8");
const FEATURE = join(NATIVE, "features", "ageing");
const FILES = readdirSync(FEATURE).filter((f) => /\.tsx?$/.test(f));

type Tree = { readonly [key: string]: string | Tree };
function flatten(tree: Tree, prefix = "", out = new Set<string>()): Set<string> {
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") out.add(path);
    else flatten(value, path, out);
  }
  return out;
}
const enKeys = flatten(en as unknown as Tree);
const hiKeys = flatten(hi as unknown as Tree);
const guKeys = flatten(gu as unknown as Tree);

describe("routes", () => {
  test("the board, the batch and the load screen live under More; the tab bar is untouched", () => {
    for (const f of ["app/more/ageing/index.tsx", "app/more/ageing/[id].tsx", "app/more/ageing/load.tsx"]) expect(existsSync(join(NATIVE, f))).toBe(true);
    const layout = read("app/more/_layout.tsx");
    for (const name of ["ageing/index", "ageing/[id]", "ageing/load"]) expect(layout).toContain(`name="${name}"`);
    expect(existsSync(join(NATIVE, "app/(tabs)/ageing"))).toBe(false);
    expect(read("lib/nav.ts")).not.toMatch(/ageing/);
  });

  test("Today shows the tile from the server's own dashboard figures (no extra read)", () => {
    const today = read("app/(tabs)/today/index.tsx");
    expect(today).toContain("<AgeingToday ageing={data.ageing} me={me.data} />");
    expect(read("features/ageing/today-card.tsx")).not.toMatch(/useQuery|trpc\./);
  });

  test("the bundle page shows its ageing line and the void sheet says where the pieces go", () => {
    expect(read("features/bundle/bundle-screen.tsx")).toContain("<BundleAgeing bundleId={bundle.id} />");
    expect(read("features/bundle/transition-sheet.tsx")).toMatch(/<BundleVoidNote bundleId=\{bundleId\} enabled=\{visible\} \/>/);
    const note = read("features/ageing/bundle-ageing.tsx");
    expect(note).toContain("ageing.trace.voidWritesOff");
    expect(note).toContain("ageing.trace.voidReturns");
  });
});

describe("writes", () => {
  test("the phone's ageing writes are exactly: load, start, temp, out, hardness, release (keyed) and hold, unhold, requestOverride (guarded)", () => {
    const found = new Set<string>();
    for (const f of FILES) for (const m of read(`features/ageing/${f}`).matchAll(/trpc\.(ageing\.[A-Za-z.]+?)\.mutationOptions\(/g)) found.add(m[1]!);
    expect([...found].sort()).toEqual(
      ["ageing.batches.hardness", "ageing.batches.hold", "ageing.batches.load", "ageing.batches.out", "ageing.batches.release", "ageing.batches.requestOverride", "ageing.batches.start", "ageing.batches.temp", "ageing.batches.unhold"].sort(),
    );
  });

  test("rework, discard, split and void are web-only: the phone never calls them", () => {
    for (const f of FILES) expect(read(`features/ageing/${f}`)).not.toMatch(/batches\.(rework|discardRemaining|split|void|simulate)\b/);
  });

  test("a keyed write sends through useKeyedWrite with the key in the call; the hook is replayKey + sendOnce", () => {
    const hook = read("features/ageing/use-ageing.ts");
    expect(hook).toMatch(/attempt\.key\(body\)/);
    expect(hook).toMatch(/useRef\(createAttempt\(randomId\)\)\.current/);
    expect(read("features/ageing/attempt.ts")).toMatch(/replayKey\(current, body, fresh\)/);
    expect(hook).toMatch(/sendOnce\(\(clientRequestId\) => call\(clientRequestId\), id\)/);
    let keyed = 0;
    for (const f of ["sheets.tsx", "load-view.tsx", "batch-view.tsx"]) {
      const src = read(`features/ageing/${f}`);
      expect(src).not.toMatch(/\.mutate\(/);
      for (const m of src.matchAll(/write\.run\(([^,)]*)[,)]/g)) {
        // Keyed: run(body, (clientMutationId) => x.mutateAsync({ ...body, clientMutationId })). Guarded: run(() => x.mutateAsync(...)), in the guarded sheets only.
        if (m[1] === "body") keyed += 1;
      }
      expect((src.match(/write\.run\(body, \(clientMutationId\) => \w+\.mutateAsync\(\{ \.\.\.body, clientMutationId \}\)\)/g) ?? []).length).toBe((src.match(/write\.run\(body,/g) ?? []).length);
    }
    expect(keyed).toBe(6);
  });

  test("an unsure answer re-reads the board and batch before anything else is sent; nothing is queued", () => {
    const hook = read("features/ageing/use-ageing.ts");
    expect(hook).toMatch(/writeFailureKind\(error\) === "unsure"/);
    expect(hook.match(/await onUnsure\(\)/g)?.length).toBe(2);
    // Both hooks keep the button busy through the re-read (m-1): pending stays on while the board and batch are read again.
    expect(hook.match(/set\(\{ pending: unsure, error, unsure \}\)/g)?.length).toBe(2);
    expect(hook.match(/set\(\{ pending: false, error, unsure \}\)/g)?.length).toBe(2);
    expect(hook).not.toMatch(/set\(\{ pending: false, error, unsure \}\);\s*\/\/ An unsure answer may have landed/);
    for (const f of FILES) {
      const src = read(`features/ageing/${f}`);
      expect(src).not.toMatch(/outbox|AsyncStorage|SecureStore|retry:\s*(?:[1-9]|true)/i);
    }
  });

  test("each guarded sheet uses useGuardedWrite and sends no key", () => {
    const sheets = read("features/ageing/sheets.tsx");
    expect((sheets.match(/useGuardedWrite\(refresh\)/g) ?? []).length).toBe(3);
    expect(sheets).toMatch(/hold\.mutateAsync\(\{ \.\.\.\(row \? \{ rowId: row\.id \} : \{ batchId: batch\.id \}\)/);
    expect(sheets).not.toMatch(/hold\.mutateAsync\([^)]*clientMutationId/);
  });

  test("every write sits behind <Can> or can(): the sheets are opened only from permitted buttons", () => {
    const view = read("features/ageing/batch-view.tsx");
    expect(view).toContain('<Can do="ageing.record">');
    expect(view).toContain('<Can do="ageing.release">');
    expect(view).toMatch(/mayAct = perm !== null && can\(me, perm\)/);
    expect(read("features/ageing/load-view.tsx")).toMatch(/can\(me, "ageing\.load"\)/);
  });
});

describe("refusals", () => {
  test("every ageing screen reaches the refusals through errors.ts; no screen shows error.message", () => {
    expect(read("features/ageing/errors.ts")).toMatch(/^import "@orrn\/i18n\/refusal-ageing";/m);
    for (const f of FILES) {
      const src = read(`features/ageing/${f}`);
      // errors.ts is the one mapper: it reads the sentence to match it, and shows nothing of it.
      expect({ f, raw: f !== "errors.ts" && /\.message\b/.test(src) }).toEqual({ f, raw: false });
      expect({ f, own: /serverRefusal\(/.test(src) }).toEqual({ f, own: f === "errors.ts" });
    }
    expect(read("features/ageing/ui.tsx")).toMatch(/ageingError\(t, error\)/);
  });

  test("an ageing sentence is said in the person's language, an answer that never came says not sure", () => {
    const sentence = "Oven OV-1 already has a batch in it";
    const hit = mapSentence(sentence, createI18n("en").t);
    expect(hit?.key).toBe("ageing.refusal.ovenBusy");
    const err = { message: sentence, data: { code: "BAD_REQUEST", httpStatus: 400 } };
    expect(ageingError(createI18n("en").t, err)).toContain("OV-1");
    expect(ageingError(createI18n("hi").t, err)).not.toBe(ageingError(createI18n("en").t, err));
    expect(ageingRefusalText(createI18n("en").t, err)).toContain("OV-1");
    expect(ageingRefusalText(createI18n("en").t, { message: "Something else entirely", data: { httpStatus: 400 } })).toBeNull();
    expect(ageingError(createI18n("en").t, new RequestTimeoutError(60_000))).toBe(createI18n("en").t("native.saveUnsureBody"));
  });
});

describe("words", () => {
  const used = new Set<string>();
  for (const f of [...FILES.map((x) => `features/ageing/${x}`), "app/more/ageing/index.tsx"]) {
    const src = read(f);
    for (const m of src.matchAll(/["'`]((?:ageing|today\.oven|native\.web)\.[A-Za-z0-9_.${}]+)["'`]/g)) {
      const text = m[1]!;
      if (text.includes("${")) {
        const prefix = text.slice(0, text.indexOf("${"));
        for (const k of enKeys) if (k.startsWith(prefix)) used.add(k);
      } else if (enKeys.has(text) || [...enKeys].some((e) => e.startsWith(`${text}.`))) used.add(text);
    }
  }

  test("the scanner found the screens' keys", () => {
    expect(used.size).toBeGreaterThan(120);
    expect(used.has("ageing.action.release")).toBe(true);
    expect(used.has("today.oven.held")).toBe(true);
  });

  test("every key the ageing screens read exists in en, hi and gu (no new key was needed)", () => {
    const noHi = [...used].filter((k) => enKeys.has(k) && !hiKeys.has(k));
    expect(noHi).toEqual([]);
    const noGu = [...used].filter((k) => enKeys.has(k) && !guKeys.has(k));
    expect(noGu).toEqual([]);
  });

  test("web-only actions are named on the batch screen and linked to the web page of the batch", () => {
    const view = read("features/ageing/batch-view.tsx");
    expect(view).toContain("ageing.action.rework");
    expect(view).toContain("ageing.action.discard");
    expect(view).toContain("ageing.action.void");
    expect(view).toMatch(/Linking\.openURL\(webUrl\(batchWebPath\(id\)\)\)/);
    expect(view).toContain('t("native.web.title")');
  });

  test("a sample of the other method (pass null) never shows a failing chip", () => {
    const view = read("features/ageing/batch-view.tsx");
    expect(view).toMatch(/r\.hardnessPass === null \? null : <Chip tone=\{hardnessTone\(r\.hardnessPass\)\}/);
  });

  test("the hardness note after a save is neutral when the sample did not decide", () => {
    expect(read("features/ageing/sheets.tsx")).toContain("<Note tone={hardnessNoteTone(last.pass)}>");
  });

  test("Hold and Clear hold close when the re-read after an unsure answer shows the new state (the person never sees a red already held)", () => {
    const sheets = read("features/ageing/sheets.tsx");
    expect(sheets).toMatch(/write\.unsure && !write\.pending && holdLanded\(batch, row \? row\.id : null\)/);
    expect(sheets).toMatch(/write\.unsure && !write\.pending && unholdLanded\(batch, row\.id\)/);
    expect(read("features/ageing/batch-view.tsx")).toMatch(/<UnholdSheet batch=\{batch\} row=\{unholdRow\}/);
  });

  test("the load screen keeps the picked bundles in state, and points to the batch an unsure load may have made", () => {
    const load = read("features/ageing/load-view.tsx");
    expect(load).toMatch(/useState<Record<string, AvailableBundle>>\(\{\}\)/);
    expect(load).not.toMatch(/\(bundles\.data\?\.items \?\? \[\]\)\.filter\(\(b\) => bundle/);
    expect(load).toContain('t("ageing.load.openBatch"');
    for (const dict of [en, hi, gu] as unknown as Tree[]) expect(flatten(dict).has("ageing.load.openBatch")).toBe(true);
  });

  test("the native reason kinds hold every kind the web's do (ageing_abort included)", () => {
    const kinds = (src: string) => [...(/export type ReasonCodeKind =([^;]+);/.exec(src)?.[1] ?? "").matchAll(/"([a-z_]+)"/g)].map((m) => m[1]!).sort();
    const web = readFileSync(join(NATIVE, "..", "web", "src", "features", "press", "reason-label.ts"), "utf8");
    expect(kinds(read("features/press/reason-label.ts"))).toEqual(kinds(web));
    expect(kinds(read("features/press/reason-label.ts"))).toContain("ageing_abort");
  });

  test("telemetry readings are shown read-only with their source", () => {
    const view = read("features/ageing/batch-view.tsx");
    expect(view).toContain("ageing.readings.feedNote");
    expect(view).toMatch(/r\.source !== "typed"/);
  });
});

describe("the files stay in their lane", () => {
  test("no new dependency and no source file outside the ageing feature, the routes and the three append-only edits", () => {
    const pkg = JSON.parse(read("package.json")) as { dependencies: Record<string, string> };
    expect(pkg.dependencies["react-native-svg"]).toBeDefined();
    for (const f of FILES) {
      const src = read(`features/ageing/${f}`);
      for (const m of src.matchAll(/from "([^".@][^"]*|@[^"/]+\/[^"]+)"/g)) {
        const mod = m[1]!;
        expect({ f, mod, known: Object.keys(pkg.dependencies).some((d) => mod === d || mod.startsWith(`${d}/`)) || /^(@orrn\/|expo-router|react-native-svg)/.test(mod) || mod === "react" || mod === "react-native" }).toEqual({ f, mod, known: true });
      }
    }
    expect(statSync(FEATURE).isDirectory()).toBe(true);
  });
});

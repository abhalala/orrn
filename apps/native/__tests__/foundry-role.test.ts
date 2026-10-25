import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { en } from "@orrn/i18n/en";
import { hi } from "@orrn/i18n/hi";
import { can, type Action, type Me } from "@orrn/server/lib/permissions";

import { moreRows } from "../features/more/more-rows";
import { extraTabs, placeScan, reachableTabs, tabSetFor, visibleTabs } from "../lib/nav";

/**
 * W2-FD-N: the foundry phone, end to end without a device: the tab bar the foundry role gets, the routes
 * behind it, what each role may do, which files send a write and how (replay key, permission, refusal in
 * the person's language), and that nothing is stored for later (no foundry outbox in this phase).
 */

const NATIVE = join(import.meta.dir, "..");
const read = (rel: string) => readFileSync(join(NATIVE, rel), "utf8");

function me(role: NonNullable<Me["company"]>["role"], modules: string[] = []): Me {
  return {
    user: { id: "u", name: "A", email: "a@b.in" },
    company: { id: "c", name: "P", slug: "p", status: "active", plan: null, role, modules },
    isPlatformAdmin: false,
  };
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((e) => {
    const p = join(dir, e);
    return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(e) ? [p] : [];
  });
}

const FOUNDRY = "features/foundry";
const files = walk(join(NATIVE, FOUNDRY)).map((f) => f.slice(NATIVE.length + 1));

describe("the foundry role's tab bar", () => {
  test("Today, Cast, Scan (centred), Stock, More", () => {
    expect(tabSetFor(me("foundry"))).toBe("foundry");
    expect(visibleTabs(me("foundry"))).toEqual(["today", "cast", "scan", "stock", "menu"]);
    expect(placeScan(visibleTabs(me("foundry")))).toEqual(["today", "cast", "scan", "stock", "menu"]);
  });

  test("the packer and dispatch tabs are not reachable by the foundry role, by link either", () => {
    const reach = new Set(reachableTabs(me("foundry")));
    for (const hidden of ["pack", "dispatch", "orders", "press", "dies"] as const) expect(reach.has(hidden)).toBe(false);
    expect(extraTabs(me("foundry"))).toEqual([]);
  });

  test("a plant without the foundry module has no Cast tab", () => {
    expect(visibleTabs(me("foundry", ["bundles", "dies"]))).toEqual(["today", "scan", "stock", "menu"]);
    expect(visibleTabs(me("foundry", ["foundry", "bundles"]))).toEqual(["today", "cast", "scan", "stock", "menu"]);
  });

  test("a supervisor keeps the packer bar and gains Cast under More; a packer or viewer does not", () => {
    expect(visibleTabs(me("supervisor"))).not.toContain("cast");
    expect(extraTabs(me("supervisor"))).toContain("cast");
    expect(moreRows(me("supervisor")).map((r) => r.key)).toContain("cast");
    expect(moreRows(me("supervisor")).find((r) => r.key === "cast")?.href).toBe("/cast");
    for (const role of ["packer", "viewer", "press", "die_room", "office"] as const) expect({ role, cast: reachableTabs(me(role)).includes("cast") }).toEqual({ role, cast: false });
  });

  test("a supervisor of a plant without the foundry module sees no Cast row", () => {
    expect(extraTabs(me("supervisor", ["bundles", "press"]))).not.toContain("cast");
  });

  test("every tab on the bar has a screen, and the Cast tab has its stack and four routes", () => {
    for (const rel of [
      "app/(tabs)/cast/_layout.tsx",
      "app/(tabs)/cast/index.tsx",
      "app/(tabs)/cast/new.tsx",
      "app/(tabs)/cast/[id].tsx",
      "app/(tabs)/cast/melt/[meltId].tsx",
    ]) {
      expect({ rel, exists: existsSync(join(NATIVE, rel)) }).toEqual({ rel, exists: true });
    }
  });
});

describe("what each role may do on the foundry phone", () => {
  const holds = (role: Parameters<typeof me>[0], a: Action) => can(me(role), a);

  test("foundry opens casts, enters, locks and asks to correct melts; it cannot close or cancel a cast", () => {
    for (const a of ["cast.enter", "melt.enter", "melt.correct"] as const) expect({ a, ok: holds("foundry", a) }).toEqual({ a, ok: true });
    expect(holds("foundry", "cast.close")).toBe(false);
  });

  test("a supervisor holds all four, so Close cast is on its cast screen", () => {
    for (const a of ["cast.enter", "melt.enter", "melt.correct", "cast.close"] as const) expect({ a, ok: holds("supervisor", a) }).toEqual({ a, ok: true });
  });

  test("a packer, viewer and press operator hold none of them", () => {
    for (const role of ["packer", "viewer", "press"] as const) {
      for (const a of ["cast.enter", "melt.enter", "cast.close"] as const) expect({ role, a, ok: holds(role, a) }).toEqual({ role, a, ok: false });
    }
  });
});

/** proc path -> the foundry files that send it. */
function writes(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const f of files) {
    for (const m of read(f).matchAll(/trpc\.([A-Za-z.]+?)\.mutationOptions\(/g)) out.set(m[1]!, [...(out.get(m[1]!) ?? []), f]);
  }
  return out;
}

describe("the foundry writes from the phone", () => {
  const w = writes();

  test("exactly these procedures are sent, each from one file", () => {
    expect(Object.fromEntries([...w].sort())).toEqual({
      "foundry.casts.close": [`${FOUNDRY}/close-sheet.tsx`],
      "foundry.casts.open": [`${FOUNDRY}/new-cast-view.tsx`],
      "foundry.melts.correct": [`${FOUNDRY}/melt-sheet-view.tsx`],
      "foundry.melts.discard": [`${FOUNDRY}/melt-editor.tsx`],
      "foundry.melts.lock": [`${FOUNDRY}/melt-editor.tsx`],
      "foundry.melts.requestCorrection": [`${FOUNDRY}/melt-sheet-view.tsx`],
      "foundry.melts.save": [`${FOUNDRY}/melt-editor.tsx`],
      "foundry.spectro.attach": [`${FOUNDRY}/spectro-panel.tsx`],
      "foundry.spectro.enter": [`${FOUNDRY}/spectro-panel.tsx`],
    });
  });

  test("Close cast is only for cast.close holders: the sheet and its button sit inside <Can do=\"cast.close\">", () => {
    const detail = read(`${FOUNDRY}/cast-detail.tsx`);
    expect(detail).toMatch(/<Can do="cast\.close">[\s\S]*<CloseSheet/);
    expect(read(`${FOUNDRY}/close-sheet.tsx`)).toMatch(/trpc\.foundry\.casts\.close\.mutationOptions/);
    // Nothing else may send a close.
    expect(files.filter((f) => /casts\.close\.mutationOptions/.test(read(f)))).toEqual([`${FOUNDRY}/close-sheet.tsx`]);
  });

  test("each write sits behind the permission the server asks for", () => {
    expect(read(`${FOUNDRY}/cast-tab-view.tsx`)).toMatch(/<Can do="cast\.enter">/);
    expect(read(`${FOUNDRY}/new-cast-view.tsx`)).toMatch(/can\(me, "cast\.enter"\)/);
    expect(read(`${FOUNDRY}/melt-view.tsx`)).toMatch(/can\(me, "melt\.enter"\)/);
    expect(read(`${FOUNDRY}/melt-sheet-view.tsx`)).toMatch(/<Can do="melt\.correct">/);
    expect(read(`${FOUNDRY}/spectro-panel.tsx`)).toMatch(/<Can do="cast\.enter">/);
  });

  test("a write that can be sent twice carries a replay key: first save, lock, open cast, close, typed spectro, correct", () => {
    for (const f of [`${FOUNDRY}/melt-editor.tsx`, `${FOUNDRY}/new-cast-view.tsx`, `${FOUNDRY}/close-sheet.tsx`, `${FOUNDRY}/spectro-panel.tsx`, `${FOUNDRY}/melt-sheet-view.tsx`]) {
      const src = read(f);
      expect({ f, key: /replayKey\(/.test(src) && /sendOnce\(/.test(src) }).toEqual({ f, key: true });
    }
    const editor = read(`${FOUNDRY}/melt-editor.tsx`);
    expect(editor).toMatch(/clientRequestId/);
    expect(editor).toMatch(/clientMutationId/);
    expect(read(`${FOUNDRY}/close-sheet.tsx`)).toMatch(/clientMutationId/);
    expect(read(`${FOUNDRY}/new-cast-view.tsx`)).toMatch(/clientRequestId/);
    expect(read(`${FOUNDRY}/spectro-panel.tsx`)).toMatch(/clientRequestId/);
  });

  test("a refused write is said through the foundry refusal tables, never as the server's English", () => {
    for (const f of new Set([...w.values()].flat())) {
      const src = read(f);
      expect({ f, usesFoundryError: /foundryError\(/.test(src) }).toEqual({ f, usesFoundryError: true });
      expect({ f, showsMessage: /error\.message|\.message\}|e\.message/.test(src) }).toEqual({ f, showsMessage: false });
    }
    expect(read(`${FOUNDRY}/errors.ts`)).toMatch(/import "@orrn\/i18n\/refusal-foundry"/);
  });

  test("review m-1/m-8: a stale or unsure save offers 'Load the saved melt'; a failed reason list says so", () => {
    const editor = read(`${FOUNDRY}/melt-editor.tsx`);
    expect(editor).toMatch(/foundry\.melt\.reload\.button/);
    expect(editor).toMatch(/isStaleMelt\(problem\)/);
    expect(editor).toMatch(/adoptEarlierDraft\(\)/);
    expect(read(`${FOUNDRY}/close-sheet.tsx`)).toMatch(/<ErrorLine error=\{reasons\.error\} \/>/);
    expect(read(`${FOUNDRY}/melt-sheet-view.tsx`)).toMatch(/<ErrorLine error=\{reasons\.error\} \/>/);
  });

  test("review m-2: the first save names the melt in the route, so a landed lock turns the screen into the locked sheet", () => {
    expect(read(`${FOUNDRY}/melt-editor.tsx`)).toMatch(/router\.setParams\(\{ meltId: v\.id \}\)/);
    expect(read(`${FOUNDRY}/melt-view.tsx`)).toMatch(/meltForScreen\(/);
  });

  test("an unsure answer is re-read, not blindly sent again by the screen", () => {
    for (const f of new Set([...w.values()].flat())) expect({ f, retryLoop: /retry:\s*(?:[1-9]|true)/.test(read(f)) }).toEqual({ f, retryLoop: false });
  });
});

describe("no foundry outbox in this phase", () => {
  test("nothing under features/foundry or the Cast routes keeps a write for later", () => {
    const all = [...files, ...walk(join(NATIVE, "app/(tabs)/cast")).map((f) => f.slice(NATIVE.length + 1))];
    for (const f of all) {
      expect({ f, stores: /expo-file-system|expo-secure-store|AsyncStorage|draft-store|outbox/i.test(read(f)) }).toEqual({ f, stores: false });
    }
  });
});

describe("the build needs no new native module", () => {
  const deps = JSON.parse(read("package.json")).dependencies as Record<string, string>;

  test("the photo of a spectro printout is taken with expo-camera, which the scanner already needs", () => {
    expect(deps["expo-camera"]).toBeDefined();
    expect(deps["expo-image-picker"]).toBeUndefined();
    expect(read(`${FOUNDRY}/camera-sheet.tsx`)).toMatch(/takePictureAsync/);
  });

  test("review I-4: the camera is set to about 2 MP and ONE picture is re-encoded at each quality, not a new photo per step", () => {
    const src = read(`${FOUNDRY}/camera-sheet.tsx`);
    expect(src).toMatch(/getAvailablePictureSizesAsync\(\)/);
    expect(src).toMatch(/pictureSize=\{pictureSize\}/);
    expect(src.match(/takePictureAsync\(/g)?.length).toBe(1);
    expect(src).toMatch(/pictureRef: true/);
    expect(src).toMatch(/savePictureAsync\(\{ quality, base64: true \}\)/);
    // the capture sits before the quality loop, never inside it
    expect(src.indexOf("takePictureAsync(")).toBeLessThan(src.indexOf("for (const quality of PHOTO_QUALITIES)"));
  });

  test("the declared native modules are all in package.json", () => {
    const imports = files.flatMap((f) => [...read(f).matchAll(/from "(expo-[a-z-]+|react-native-[a-z-]+)"/g)].map((m) => m[1]!));
    for (const mod of new Set(imports)) expect({ mod, declared: mod in deps || mod === "react-native" }).toEqual({ mod, declared: true });
  });
});

describe("the surfaces are wired", () => {
  test("the Stock tab shows the billets from stock.billets for the people on the foundry floor", () => {
    expect(read("app/(tabs)/stock/index.tsx")).toMatch(/BilletStock/);
    expect(read(`${FOUNDRY}/billet-stock.tsx`)).toMatch(/trpc\.foundry\.stock\.billets\.queryOptions\(BILLET_QUERY\)/);
    expect(read(`${FOUNDRY}/billet-stock.tsx`)).toMatch(/casts: g\.count/);
  });

  test("Today shows the Foundry tile to cast.enter holders", () => {
    expect(read("app/(tabs)/today/index.tsx")).toMatch(/FoundryToday/);
    expect(read(`${FOUNDRY}/today-card.tsx`)).toMatch(/<Can do="cast\.enter">/);
  });

  test("the lock gates on the sheet come from the server's preview of the saved draft", () => {
    const editor = read(`${FOUNDRY}/melt-editor.tsx`);
    expect(editor).toMatch(/trpc\.foundry\.melts\.preview\.queryOptions/);
    expect(editor).toMatch(/gateSentences\(/);
  });

  test("the cast chip and the close sheet read the server's figures (closeout, closePreview), not their own", () => {
    expect(read(`${FOUNDRY}/cast-detail.tsx`)).toMatch(/closeout/);
    expect(read(`${FOUNDRY}/close-sheet.tsx`)).toMatch(/trpc\.foundry\.casts\.closePreview\.queryOptions/);
  });
});

describe("every key the foundry screens read has English and Hindi", () => {
  type Tree = { readonly [key: string]: string | Tree };
  const get = (tree: Tree, key: string) => key.split(".").reduce<string | Tree | undefined>((at, p) => (typeof at === "object" ? at[p] : undefined), tree);
  const literal = /["'`]((?:foundry|common|scan|units|nav|native|refusal|errors|status)\.[A-Za-z0-9_.]+)["'`]/g;

  test("a dictionary key written in the foundry source exists in en and hi", () => {
    const missing: string[] = [];
    for (const f of [...files, "app/(tabs)/stock/index.tsx", "app/(tabs)/today/index.tsx"]) {
      const code = read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      for (const m of code.matchAll(literal)) {
        const key = m[1]!;
        if (key.includes("${")) continue;
        const inEn = get(en as Tree, key);
        if (inEn === undefined) {
          // A prefix like "foundry.melt.status" is built into a full key at runtime: it must be a group.
          missing.push(`${f}: ${key} (en)`);
          continue;
        }
        if (get(hi as unknown as Tree, key) === undefined) missing.push(`${f}: ${key} (hi)`);
      }
    }
    expect(missing).toEqual([]);
  });
});

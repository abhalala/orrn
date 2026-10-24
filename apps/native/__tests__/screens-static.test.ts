import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { ROOT_ROUTES } from "../lib/gate";

const ROOT = join(import.meta.dir, "..");
const read = (f: string) => readFileSync(join(ROOT, f), "utf8");

function sourceFiles(dir: string, pattern = /\.tsx?$/): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full, pattern));
    else if (pattern.test(entry)) out.push(full);
  }
  return out;
}

const UI_FILES = ["app", "components", "features"].flatMap((d) => sourceFiles(join(ROOT, d), /\.tsx$/)).map((f) => relative(ROOT, f));

/** The opening tag starting at `start` (`<Name ... >`), braces and strings respected. */
function openingTag(src: string, start: number): string {
  let depth = 0;
  let quote: string | null = null;
  for (let i = start + 1; i < src.length; i++) {
    const c = src[i]!;
    if (quote) {
      if (c === quote && src[i - 1] !== "\\") quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") quote = c;
    else if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === ">" && depth === 0) return src.slice(start, i + 1);
  }
  return src.slice(start);
}

/** Every `<Tag ...>` opening tag of the given component names in a file. */
function tagsOf(src: string, names: string[]): string[] {
  const out: string[] = [];
  const re = new RegExp(`<(${names.join("|")})\\b`, "g");
  for (const m of src.matchAll(re)) out.push(openingTag(src, m.index!));
  return out;
}

describe("T29 screens exist (plan Task 29 file list)", () => {
  const screens = [
    "app/(tabs)/today/index.tsx",
    "app/(tabs)/pack/index.tsx",
    "app/(tabs)/pack/new.tsx",
    "app/(tabs)/pack/[id].tsx",
    "app/(tabs)/scan.tsx",
    "app/(tabs)/stock/index.tsx",
    "app/(tabs)/stock/[dieId].tsx",
    "app/(tabs)/stock/bundles.tsx",
    "app/b/[serial].tsx",
    "app/(tabs)/dispatch/index.tsx",
    "app/(tabs)/dispatch/new.tsx",
    "app/(tabs)/dispatch/[id].tsx",
    "app/more/index.tsx",
    "app/more/dies.tsx",
    "app/more/dies/[id].tsx",
    "app/more/customers.tsx",
    "app/more/customers/[id].tsx",
    "app/more/guides.tsx",
    "app/more/guides/[slug].tsx",
    "app/more/settings.tsx",
    "app/invite/[token].tsx",
  ];
  for (const s of screens) {
    test(s, () => {
      expect(existsSync(join(ROOT, s))).toBe(true);
    });
  }

  test("no screen is a placeholder any more", () => {
    expect(UI_FILES.filter((f) => /\bRouteStub\b|ui\.stubTitle/.test(read(f)))).toEqual([]);
  });

  test("the bundle page is a signed-in root screen (T28 interface)", () => {
    expect(ROOT_ROUTES.app as readonly string[]).toContain("b/[serial]");
  });

  test("the pre-C2 invite kit is gone", () => {
    expect(existsSync(join(ROOT, "components/erp.tsx"))).toBe(false);
  });
});

describe("C2 components (plan Task 29)", () => {
  const components = [
    "status-block",
    "big-number",
    "button",
    "chip",
    "field",
    "number-input",
    "segmented-control",
    "sheet",
    "empty-state",
    "page-header",
    "list-row",
    "how-to-button",
  ];
  for (const c of components) {
    test(`components/ui/${c}.tsx`, () => {
      expect(existsSync(join(ROOT, "components/ui", `${c}.tsx`))).toBe(true);
    });
  }
});

describe("accessibility (brief a11y 9)", () => {
  test("every PressableScale carries a role and a label (or passes its props through)", () => {
    const offenders: string[] = [];
    for (const f of UI_FILES) {
      if (f === "components/ui/pressable-scale.tsx") continue;
      for (const tag of tagsOf(read(f), ["PressableScale"])) {
        const spreads = /\{\.\.\.(rest|props)\}/.test(tag);
        if (spreads) continue;
        if (!/accessibilityRole=/.test(tag) || !/accessibilityLabel=/.test(tag)) offenders.push(`${f}: ${tag.slice(0, 80)}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test("TextInputs outside Field/NumberInput have an accessible label", () => {
    const offenders: string[] = [];
    for (const f of UI_FILES) {
      for (const tag of tagsOf(read(f), ["TextInput"])) {
        if (/\{\.\.\.(rest|props)\}/.test(tag)) continue;
        if (!/accessibilityLabel=/.test(tag)) offenders.push(`${f}: ${tag.slice(0, 80)}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test("no visible English is hard-coded in JSX (every string goes through t())", () => {
    const offenders: string[] = [];
    for (const f of UI_FILES) {
      for (const m of read(f).matchAll(/>\s*([A-Za-z][^<>{}()=;]*?)\s*<\//g)) offenders.push(`${f}: ${m[1]}`);
    }
    expect(offenders).toEqual([]);
  });

  test("no English literal in Alert.alert or accessibility props", () => {
    const offenders: string[] = [];
    for (const f of UI_FILES) {
      const src = read(f);
      for (const m of src.matchAll(/Alert\.alert\(\s*"[A-Za-z]/g)) offenders.push(`${f}: ${m[0]}`);
      for (const m of src.matchAll(/accessibility(Label|Hint)="[A-Za-z][^"]*"/g)) offenders.push(`${f}: ${m[0]}`);
    }
    expect(offenders).toEqual([]);
  });
});

describe("tokens only (brief: no raw hex, no Tailwind palette colours)", () => {
  test("no hex colour literals in screens and components", () => {
    const offenders: string[] = [];
    for (const f of UI_FILES) {
      for (const m of read(f).matchAll(/["'`]#[0-9a-fA-F]{3,8}["'`]/g)) offenders.push(`${f}: ${m[0]}`);
    }
    expect(offenders).toEqual([]);
  });

  test("no Tailwind palette colour classes (bg-blue-500, text-gray-400)", () => {
    const palette = /\b(?:bg|text|border)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/g;
    const offenders = UI_FILES.flatMap((f) => [...read(f).matchAll(palette)].map((m) => `${f}: ${m[0]}`));
    expect(offenders).toEqual([]);
  });

  test("radius rule: only rounded-input, -card, -block, -hero and -full", () => {
    const offenders: string[] = [];
    for (const f of UI_FILES) {
      for (const m of read(f).matchAll(/\brounded(?:-[a-z]+)?(?:-\[[^\]]+\]|-(?:sm|md|lg|xl|2xl|3xl|none))?\b/g)) {
        const cls = m[0];
        if (!/^rounded-(input|card|block|hero|full)$/.test(cls)) offenders.push(`${f}: ${cls}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("feedback and motion", () => {
  test("haptics go through lib/feedback (success and error only, never the only signal)", () => {
    const direct = UI_FILES.filter((f) => /Haptics\.notificationAsync/.test(read(f)));
    expect(direct).toEqual([]);
    const fb = read("lib/feedback.ts");
    expect(fb).toMatch(/NotificationFeedbackType\.Success/);
    expect(fb).toMatch(/NotificationFeedbackType\.Error/);
  });

  test("pop and rise come from lib/motion, which drops them under reduced motion", () => {
    const src = read("lib/motion.ts");
    expect(src).toMatch(/reduceMotion/);
    expect(read("components/ui/status-block.tsx")).toMatch(/riseEntering\(/);
  });
});

describe("writes follow the T28 rule (unsure vs failed)", () => {
  const writers = ["app/(tabs)/pack/new.tsx", "app/(tabs)/dispatch/new.tsx", "app/(tabs)/dispatch/[id].tsx", "app/b/[serial].tsx"];
  for (const f of writers) {
    test(`${f} tells "not sure it saved" from "failed"`, () => {
      expect(read(f)).toMatch(/writeFailureKind\(|saveErrorText\(/);
    });
  }
});

describe("packing list share", () => {
  test("uses the mapped UTI, never the MIME type as UTI", () => {
    const src = read("lib/packing-list-export.ts");
    expect(src).toMatch(/PL_SHARE_TARGETS/);
    expect(src).not.toMatch(/UTI:\s*mimeType/);
  });
});

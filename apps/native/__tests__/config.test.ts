import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const REPO = join(ROOT, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const json = (p: string) => JSON.parse(read(p));

type Plugin = string | [string, Record<string, unknown>];
const appJson = json("app.json").expo as {
  ios: { bundleIdentifier: string; supportsTablet: boolean };
  android: { package: string; adaptiveIcon: Record<string, string> };
  icon: string;
  splash: { image: string; backgroundColor: string; dark?: { image: string; backgroundColor: string } };
  plugins: Plugin[];
  locales: Record<string, string>;
};
const plugin = (name: string) => appJson.plugins.find((p) => (Array.isArray(p) ? p[0] : p) === name);

describe("app.json (N13)", () => {
  test("bundle ids", () => {
    expect(appJson.ios.bundleIdentifier).toBe("in.orrn.app");
    expect(appJson.android.package).toBe("in.orrn.app");
    expect(appJson.ios.supportsTablet).toBe(true);
  });

  test("icon, adaptive icon and splash point at files that exist", () => {
    const files = [
      appJson.icon,
      appJson.splash.image,
      appJson.splash.dark?.image,
      ...Object.values(appJson.android.adaptiveIcon).filter((v) => v.startsWith("./")),
    ];
    for (const f of files) {
      expect(f).toBeString();
      expect(existsSync(join(ROOT, f as string))).toBe(true);
    }
  });

  test("camera plugin with a plain-language permission and no microphone", () => {
    const camera = plugin("expo-camera");
    expect(Array.isArray(camera)).toBe(true);
    const opts = (camera as [string, Record<string, unknown>])[1];
    expect(String(opts.cameraPermission)).toMatch(/bundle/i);
    expect(opts.microphonePermission).toBe(false);
    expect(opts.recordAudioAndroid).toBe(false);
  });

  test("font, localization and router plugins", () => {
    expect(plugin("expo-font")).toBeDefined();
    expect(plugin("expo-router")).toBeDefined();
    const loc = plugin("expo-localization") as [string, { supportedLocales: string[] }];
    expect(loc[1].supportedLocales).toEqual(["en", "hi"]);
  });

  test("OS strings exist in English and Hindi with the same keys", () => {
    expect(Object.keys(appJson.locales).sort()).toEqual(["en", "hi"]);
    const en = json(appJson.locales.en);
    const hi = json(appJson.locales.hi);
    expect(Object.keys(hi.ios).sort()).toEqual(Object.keys(en.ios).sort());
    const camera = plugin("expo-camera") as [string, Record<string, unknown>];
    expect(en.ios.NSCameraUsageDescription).toBe(camera[1].cameraPermission);
    expect(hi.ios.NSCameraUsageDescription).toMatch(/[ऀ-ॿ]/);
  });
});

describe("babel (N13)", () => {
  test("the worklets plugin runs exactly once", () => {
    const req = createRequire(join(ROOT, "package.json"));
    const presetDir = dirname(req.resolve("babel-preset-expo/package.json"));
    const babel = createRequire(join(presetDir, "package.json"))("@babel/core");
    const opts = babel.loadOptions({
      cwd: ROOT,
      root: ROOT,
      filename: join(ROOT, "app", "_layout.tsx"),
      babelrc: false,
      configFile: join(ROOT, "babel.config.js"),
      caller: { name: "metro", bundler: "metro", platform: "ios" },
    });
    const keys = (opts.plugins as { key: string }[]).map((p) => p.key).filter((k) => /worklet|reanimated/.test(k));
    expect(keys).toEqual(["worklets"]);
  });
});

describe("tailwind", () => {
  test("content covers lib/ and features/ so classes there are generated", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const content = require("../tailwind.config.js").content as string[];
    expect(content.some((g) => g.startsWith("./lib/"))).toBe(true);
    expect(content.some((g) => g.startsWith("./features/"))).toBe(true);
  });
});

describe("auth client", () => {
  test("registers twoFactorClient (N5)", () => {
    expect(read("lib/auth-client.ts")).toMatch(/twoFactorClient\(/);
  });

  test("native never sends the impersonation header", () => {
    for (const f of ["utils/trpc.ts", "lib/auth-client.ts"]) {
      expect(read(f)).not.toMatch(/x-orrn-impersonate-company/);
    }
  });
});

describe("removed (N14, N15)", () => {
  const gone = [
    "components/sign-up.tsx",
    "components/theme-toggle.tsx",
    "components/impersonation-banner.tsx",
    "components/container.tsx",
    "contexts",
    "lib/edge-node-store.ts",
    "utils/navigation.ts",
    "assets/images/react-logo.png",
    "assets/images/react-logo@2x.png",
    "assets/images/react-logo@3x.png",
    "assets/images/partial-react-logo.png",
  ];
  for (const f of gone) {
    test(f, () => expect(existsSync(join(ROOT, f))).toBe(false));
  }

  test("shared native-only UI leftovers are gone and no longer exported", () => {
    for (const f of ["impersonation-banner.native.tsx", "not-found.native.tsx", "toaster-native.tsx"]) {
      expect(existsSync(join(REPO, "packages/ui/src/components", f))).toBe(false);
    }
    const exportsMap = JSON.stringify(JSON.parse(readFileSync(join(REPO, "packages/ui/package.json"), "utf8")).exports);
    expect(exportsMap).not.toContain("impersonation-banner.native");
    expect(exportsMap).not.toContain("not-found.native");
  });

  test("unused dependencies are dropped", () => {
    const deps = Object.keys(json("package.json").dependencies);
    for (const d of ["@react-navigation/drawer", "@react-navigation/elements", "@react-native-picker/picker", "@orrn/edge-runtime"]) {
      expect(deps).not.toContain(d);
    }
  });
});

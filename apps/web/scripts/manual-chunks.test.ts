import { describe, expect, test } from "bun:test";

import { manualChunk, packageOf } from "./manual-chunks";

/** A module id the way Bun's isolated install lays it out under `root`. */
const bunId = (root: string, pkg: string, file: string) =>
  `${root}/node_modules/.bun/${pkg.replace("/", "+")}@1.0.0+abc/node_modules/${pkg}/${file}`;

describe("packageOf", () => {
  test("names the package of the last node_modules segment", () => {
    expect(packageOf(bunId("/repo", "@tanstack/react-router", "dist/esm/index.js"))).toBe("@tanstack/react-router");
    expect(packageOf("/repo/node_modules/papaparse/papaparse.min.js")).toBe("papaparse");
    expect(packageOf("C:\\repo\\node_modules\\@tanstack\\query-core\\build\\index.js")).toBe("@tanstack/query-core");
  });

  test("is undefined for app source and virtual modules", () => {
    expect(packageOf("/repo/apps/web/src/main.tsx")).toBeUndefined();
    expect(packageOf("\0vite/preload-helper.js")).toBeUndefined();
  });
});

describe("manualChunk", () => {
  test("router, query and store packages share the tanstack chunk", () => {
    for (const pkg of [
      "@tanstack/react-router",
      "@tanstack/router-core",
      "@tanstack/history",
      "@tanstack/react-query",
      "@tanstack/query-core",
      "@tanstack/store",
      "@tanstack/react-store",
    ]) {
      expect(manualChunk(bunId("/repo", pkg, "dist/esm/index.js")), pkg).toBe("tanstack");
    }
  });

  test("router files whose names contain 'form' stay in the tanstack chunk", () => {
    expect(manualChunk(bunId("/repo", "@tanstack/router-core", "dist/esm/ssr/transformStreamWithRouter.js"))).toBe(
      "tanstack",
    );
    expect(manualChunk(bunId("/repo", "@tanstack/router-core", "dist/esm/serializer/transformer.js"))).toBe("tanstack");
  });

  test("a checkout under a directory named like 'platform' keeps the tanstack chunk", () => {
    expect(manualChunk(bunId("/srv/platform/orrn", "@tanstack/react-router", "dist/esm/link.js"))).toBe("tanstack");
    expect(manualChunk(bunId("/home/me/formwork", "@tanstack/query-core", "build/modern/index.js"))).toBe("tanstack");
  });

  test("form-only and devtools packages ride with the screens that load them", () => {
    for (const pkg of [
      "@tanstack/react-form",
      "@tanstack/form-core",
      "@tanstack/devtools-event-client",
      "@tanstack/pacer-lite",
      "@tanstack/react-query-devtools",
      "@tanstack/react-router-devtools",
      "@tanstack/router-devtools-core",
    ]) {
      expect(manualChunk(bunId("/repo", pkg, "dist/esm/index.js")), pkg).toBeUndefined();
    }
  });

  test("other packages and app code are left to Rollup, papaparse gets its own chunk", () => {
    expect(manualChunk(bunId("/repo", "@trpc/tanstack-react-query", "dist/index.mjs"))).toBeUndefined();
    expect(manualChunk("/repo/apps/web/src/features/marketing/hero.tsx")).toBeUndefined();
    expect(manualChunk(bunId("/repo", "papaparse", "papaparse.min.js"))).toBe("csv-parser");
  });
});

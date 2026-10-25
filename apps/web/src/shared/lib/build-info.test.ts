import { expect, test } from "bun:test";

import pkg from "../../../package.json";

// Settings > About prints this version (vite.config.ts reads it from package.json).
test("the web app has a real version, not the 0.0.0 placeholder", () => {
  expect(pkg.version).toMatch(/^\d+\.\d+\.\d+$/);
  expect(pkg.version).not.toBe("0.0.0");
});

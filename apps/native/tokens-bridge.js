/**
 * Loads the shared design tokens (`packages/ui/src/tokens.ts`) from plain
 * CommonJS, so `tailwind.config.js` (loaded by Node inside Metro) and the bun
 * tests read the very same values the web theme uses.
 *
 * Node cannot `require` a `.ts` file on every version we may run (EAS images,
 * CI), so the file is transpiled with the TypeScript compiler that the app
 * already depends on. `tokens.ts` must therefore stay self-contained (no
 * imports): it is a plain data module by design.
 */
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const file = path.resolve(__dirname, "../../packages/ui/src/tokens.ts");
const { outputText } = ts.transpileModule(fs.readFileSync(file, "utf8"), {
  fileName: file,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
});

const mod = { exports: {} };
new Function("module", "exports", outputText)(mod, mod.exports);

/** @type {typeof import("../../packages/ui/src/tokens")} */
module.exports = mod.exports;

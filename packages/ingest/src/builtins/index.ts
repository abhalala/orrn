import { builtinBundles } from "./bundles";
import { builtinCustomers } from "./customers";
import { builtinDies } from "./dies";
import type { BuiltinHole } from "./types";

export * from "./types";
export * from "./aliases";
export { analyzeBuiltin, instantiate, unitFromHeaderText, type BuiltinAnalysis, type BuiltinMapping } from "./instantiate";
export { builtinBundles, builtinCustomers, builtinDies };

export const BUILTIN_HOLES: readonly BuiltinHole[] = [builtinCustomers, builtinDies, builtinBundles];

/** `builtin:<id>@<version>`, the `hole_ref` of a candidate fitted to a built-in hole. */
export function builtinRef(hole: BuiltinHole): string {
  return `builtin:${hole.id}@${hole.version}`;
}

export function findBuiltin(ref: string): BuiltinHole | null {
  const m = /^builtin:([a-z_]+)@(\d+)$/.exec(ref);
  if (!m) return null;
  return BUILTIN_HOLES.find((h) => h.id === m[1] && h.version === Number(m[2])) ?? null;
}

/**
 * The buddy's catalogue of orrn procedures (design 2026-11-18, §4.2), built once per isolate by walking
 * `appRouter._def.procedures`: path, kind, input parser(s), guard action(s), the decision of
 * `decisions.ts`, and a one-line description from `descriptions.ts`.
 *
 * `routers/index.ts` is imported lazily: the buddy router is mounted there, so a static import would be a
 * cycle. Every lookup is by own key of the catalogue map, never by walking a caller proxy with a
 * model-supplied string.
 */
import { z } from "zod";

import { GUARD_ACTIONS, type GuardActions } from "../../index";
import type { Action } from "../permissions";
import { can } from "../permissions";
import type { CompanyRole } from "@orrn/db/schema/tenant";
import { decideBuddyPath, type BuddyDecision } from "./decisions";
import { describePath } from "./descriptions";

/** A parser as tRPC keeps it; orrn inputs are zod schemas. */
type Parser = unknown;

export type BuddyProcedure = {
  path: string;
  kind: "query" | "mutation";
  decision: BuddyDecision;
  description: string;
  inputs: Parser[];
  guard: GuardActions | null;
  /** Top-level input field names, for search. */
  fields: string[];
};

type AnyProcedure = {
  _def: { type?: string; inputs?: unknown[]; middlewares?: unknown[] };
};

let cache: Map<string, BuddyProcedure> | null = null;

/** Top-level field names of an object input, and of each object option of a union input (e.g. rows or { rows, clientRequestId }). */
function fieldNames(inputs: Parser[]): string[] {
  const names = new Set<string>();
  const visit = (p: unknown) => {
    const shape = (p as { shape?: Record<string, unknown> } | null)?.shape;
    if (shape && typeof shape === "object") for (const k of Object.keys(shape)) names.add(k);
    const options = (p as { options?: unknown } | null)?.options;
    if (Array.isArray(options)) for (const o of options) visit(o);
  };
  for (const p of inputs) visit(p);
  return [...names];
}

function guardOf(proc: AnyProcedure): GuardActions | null {
  for (const m of proc._def.middlewares ?? []) {
    if (typeof m !== "function") continue;
    const g = GUARD_ACTIONS.get(m);
    if (g) return g;
  }
  return null;
}

export function buildRegistry(procedures: Record<string, AnyProcedure>): Map<string, BuddyProcedure> {
  const map = new Map<string, BuddyProcedure>();
  for (const [path, proc] of Object.entries(procedures)) {
    const type = proc._def.type;
    if (type !== "query" && type !== "mutation") continue;
    const inputs = [...(proc._def.inputs ?? [])];
    map.set(path, {
      path,
      kind: type,
      decision: decideBuddyPath(path),
      description: describePath(path),
      inputs,
      guard: guardOf(proc),
      fields: fieldNames(inputs),
    });
  }
  return map;
}

/** Every query and mutation of `appRouter`, decided. */
export async function buddyRegistry(): Promise<Map<string, BuddyProcedure>> {
  if (cache) return cache;
  const { appRouter } = await import("../../routers/index");
  cache = buildRegistry(appRouter._def.procedures as unknown as Record<string, AnyProcedure>);
  return cache;
}

/** The procedure when the buddy may reach it (decision allow), else null. Own-key lookup only. */
export async function allowedProcedure(path: unknown): Promise<BuddyProcedure | null> {
  if (typeof path !== "string" || path.length === 0 || path.length > 200) return null;
  const reg = await buddyRegistry();
  const entry = reg.get(path);
  return entry && entry.decision.kind === "allow" ? entry : null;
}

/** Whether the role holds the guard's action(s); null when the procedure has no action guard. */
export function roleHoldsGuard(guard: GuardActions | null, role: CompanyRole | null): boolean | null {
  if (!guard) return null;
  if (!role) return false;
  const me = { company: { role }, isPlatformAdmin: false, platformRole: null };
  return guard.mode === "all"
    ? guard.actions.every((a: Action) => can(me, a))
    : guard.actions.some((a: Action) => can(me, a));
}

/**
 * Validate an input against the procedure's parser(s). Returns the zod issues on failure. The caller keeps
 * the raw input (not the parsed output), so a later confirm parses exactly what the model sent.
 */
export function validateInput(entry: BuddyProcedure, input: unknown): { ok: true } | { ok: false; issues: unknown[] } {
  for (const p of entry.inputs) {
    if (p instanceof z.ZodType) {
      const r = p.safeParse(input);
      if (!r.success) return { ok: false, issues: r.error.issues.slice(0, 20) };
    }
  }
  return { ok: true };
}

/** The input JSON Schema (zod v4 `z.toJSONSchema`, input side). Unrepresentable parts show as "any". */
export function inputJsonSchema(entry: BuddyProcedure): unknown {
  const schemas = entry.inputs
    .filter((p): p is z.ZodType => p instanceof z.ZodType)
    .map((p) => z.toJSONSchema(p, { io: "input", unrepresentable: "any" }));
  if (schemas.length === 0) return null;
  if (schemas.length === 1) return schemas[0];
  return { allOf: schemas };
}

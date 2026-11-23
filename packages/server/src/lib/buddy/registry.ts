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
import { ctxCan, type PermissionCtx } from "../permissions";
import { BUDDY_DECISIONS, decideBuddyPath, type BuddyDecision } from "./decisions";
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
      decision: decideBuddyPath(path, type),
      description: describePath(path),
      inputs,
      guard: guardOf(proc),
      fields: fieldNames(inputs),
    });
  }
  return map;
}

/**
 * Review N2: mutations of an allowed router that have no entry in `paths` or `changes` (they are denied until
 * decided). The registry test fails while this is not empty.
 */
export function undecidedChanges(reg: Map<string, BuddyProcedure>): string[] {
  const paths = BUDDY_DECISIONS.paths as Record<string, unknown>;
  const routers = BUDDY_DECISIONS.routers as Record<string, unknown>;
  const changes = new Set<string>(BUDDY_DECISIONS.changes);
  const out: string[] = [];
  for (const e of reg.values()) {
    if (e.kind !== "mutation") continue;
    const top = routers[e.path.split(".")[0] ?? ""];
    if (!top || typeof top !== "object" || (top as BuddyDecision).kind !== "allow") continue;
    if (Object.prototype.hasOwnProperty.call(paths, e.path) || changes.has(e.path)) continue;
    out.push(e.path);
  }
  return out.sort();
}

/** Every query and mutation of `appRouter`, decided. */
export async function buddyRegistry(): Promise<Map<string, BuddyProcedure>> {
  if (cache) return cache;
  const { appRouter, loadAllRouters } = await import("../../routers/index");
  // Top-level routers load lazily: load them all first, or the registry would freeze a partial list.
  await loadAllRouters();
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

/**
 * Whether the person holds the guard's action(s); null when the procedure has no action guard. Reads the
 * context's effective set (custom roles, XE PLATFORM row 79), never the role alone.
 */
export function ctxHoldsGuard(guard: GuardActions | null, ctx: PermissionCtx): boolean | null {
  if (!guard) return null;
  if (!ctx.role) return false;
  return guard.mode === "all"
    ? guard.actions.every((a: Action) => ctxCan(ctx, a))
    : guard.actions.some((a: Action) => ctxCan(ctx, a));
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

/** zod's object and union classes, unwrapped from optional/nullable/default. */
function objectShapes(p: unknown): { keys: string[]; loose: boolean }[] | null {
  let cur = p;
  for (let i = 0; i < 5; i += 1) {
    if (cur instanceof z.ZodOptional || cur instanceof z.ZodNullable || cur instanceof z.ZodDefault) cur = (cur as { unwrap(): unknown }).unwrap();
    else break;
  }
  if (cur instanceof z.ZodObject) {
    const catchall = (cur as unknown as { _zod?: { def?: { catchall?: unknown } } })._zod?.def?.catchall;
    const loose = !!catchall && !(catchall instanceof z.ZodNever);
    return [{ keys: Object.keys(cur.shape), loose }];
  }
  if (cur instanceof z.ZodArray) return [];
  if (cur instanceof z.ZodUnion) {
    const out: { keys: string[]; loose: boolean }[] = [];
    for (const o of cur.options as unknown[]) {
      const sub = objectShapes(o);
      if (sub === null) return null;
      out.push(...sub);
    }
    return out;
  }
  return null;
}

/**
 * Top-level keys of an object input that no object option of the procedure takes (review N4): zod strips them, so the
 * card would show a key that never runs. Empty when the input is not a plain object or the parser is not made of
 * plain objects (records, `any`, loose objects).
 */
export function unknownKeys(entry: BuddyProcedure, input: unknown): string[] {
  if (!input || typeof input !== "object" || Array.isArray(input)) return [];
  const allowed = new Set<string>();
  for (const p of entry.inputs) {
    const shapes = objectShapes(p);
    if (shapes === null || shapes.some((s) => s.loose)) return [];
    for (const s of shapes) for (const k of s.keys) allowed.add(k);
  }
  if (entry.inputs.length === 0) return Object.keys(input);
  return Object.keys(input).filter((k) => !allowed.has(k));
}

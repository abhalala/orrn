/**
 * The tool result envelope (October spec §2.1, design 2026-11-18 §4.2): `{ status, asOf, data?, message?,
 * issues?, truncated?, hint? }`. Results are capped at 32 KB; a longer one is cut with `truncated: true`
 * and a hint to narrow the query.
 */
import { TRPCError } from "@trpc/server";
import { ZodError } from "zod";

import { now } from "../clock";

export const RESULT_CAP_BYTES = 32 * 1024;

export type EnvelopeStatus =
  | "ok"
  | "needs_confirm"
  | "forbidden"
  | "not_found"
  | "invalid"
  | "rate_limited"
  | "error";

export type Envelope = {
  status: EnvelopeStatus;
  asOf: string;
  data?: unknown;
  message?: string;
  issues?: unknown[];
  truncated?: true;
  hint?: string;
};

const encoder = new TextEncoder();
export const byteLength = (text: string): number => encoder.encode(text).length;

const HINT = "The answer was longer than 32 KB and was cut. Ask for less: add filters, a smaller limit or a narrower date range.";

function fits(value: unknown, cap: number): boolean {
  return byteLength(JSON.stringify(value) ?? "null") <= cap;
}

/** The longest prefix of `items` that fits once placed by `wrap`. */
function longestFit(items: unknown[], wrap: (part: unknown[]) => unknown, cap: number): unknown[] {
  let lo = 0;
  let hi = items.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (fits(wrap(items.slice(0, mid)), cap)) lo = mid;
    else hi = mid - 1;
  }
  return items.slice(0, lo);
}

/**
 * Cap a result at `cap` bytes of JSON. An array keeps its first items; an object keeps its keys and cuts
 * its largest array; anything else becomes a text preview.
 */
export function capResult(data: unknown, cap: number = RESULT_CAP_BYTES): { data: unknown; truncated: boolean } {
  if (data === undefined) return { data: null, truncated: false };
  if (fits(data, cap)) return { data, truncated: false };
  const room = cap - 512;
  if (Array.isArray(data)) return { data: longestFit(data, (p) => p, room), truncated: true };
  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    const arrays = Object.entries(obj).filter(([, v]) => Array.isArray(v)) as [string, unknown[]][];
    if (arrays.length > 0) {
      const [key, items] = arrays.reduce((a, b) => (JSON.stringify(b[1]).length > JSON.stringify(a[1]).length ? b : a));
      const cut = { ...obj, [key]: longestFit(items, (p) => ({ ...obj, [key]: p }), room) };
      if (fits(cut, cap)) return { data: cut, truncated: true };
    }
  }
  const text = JSON.stringify(data) ?? "";
  let preview = text.slice(0, room);
  while (byteLength(preview) > room) preview = preview.slice(0, Math.floor(preview.length * 0.9));
  return { data: { preview }, truncated: true };
}

export function okEnvelope(data: unknown): Envelope {
  const capped = capResult(data);
  return {
    status: "ok",
    asOf: now().toISOString(),
    data: capped.data,
    ...(capped.truncated ? { truncated: true as const, hint: HINT } : {}),
  };
}

export function statusEnvelope(status: EnvelopeStatus, message?: string, extra: Partial<Envelope> = {}): Envelope {
  return { status, asOf: now().toISOString(), ...(message ? { message } : {}), ...extra };
}

/** A tRPC error as the envelope: forbidden (names the action when known), not_found, invalid, rate_limited, error. */
export function errorEnvelope(error: unknown, opts: { action?: string | null } = {}): Envelope {
  if (error instanceof TRPCError) {
    if (error.code === "FORBIDDEN" || error.code === "UNAUTHORIZED") {
      const needs = opts.action ? ` It needs the action "${opts.action}".` : "";
      return statusEnvelope("forbidden", `${error.message}.${needs}`.replace("..", "."));
    }
    if (error.code === "NOT_FOUND") return statusEnvelope("not_found", "Not found.");
    if (error.code === "TOO_MANY_REQUESTS") return statusEnvelope("rate_limited", error.message);
    if (error.code === "BAD_REQUEST" || error.code === "PARSE_ERROR") {
      const cause = error.cause;
      if (cause instanceof ZodError) return statusEnvelope("invalid", "The input does not fit.", { issues: cause.issues.slice(0, 20) });
      return statusEnvelope("invalid", error.message);
    }
    if (error.code === "CONFLICT" || error.code === "PRECONDITION_FAILED") return statusEnvelope("error", error.message);
    return statusEnvelope("error", "orrn could not answer that.");
  }
  return statusEnvelope("error", "orrn could not answer that.");
}

/** What a stripped secret becomes (delta round decision 1). */
export const HIDDEN = "[hidden]";
const SECRET_KEYS = new Set(["token", "secret", "password", "url", "signedUrl", "shareUrl"]);
const SHARE_PATH = /\/share\//;
const SIGNED_QUERY = /(?:^|[?&;\s])(?:x-amz-signature|sig|token)=/i;

const secretText = (s: string): boolean => SHARE_PATH.test(s) || SIGNED_QUERY.test(s);

/**
 * A result with every secret hidden (delta round decision 1, D-M1): recursively, any key named `token`, `secret`,
 * `password`, `url`, `signedUrl` or `shareUrl`, a `path` that holds `/share/`, and any string that holds a share path
 * or a signed-link query (`X-Amz-Signature=`, `sig=`, `token=`) becomes `"[hidden]"`. Used for every stored
 * `buddy_draft.result_json` and every read result Hermes is told on the MCP leg.
 */
export function stripSecrets(value: unknown): unknown {
  if (typeof value === "string") return secretText(value) ? HIDDEN : value;
  if (Array.isArray(value)) return value.map(stripSecrets);
  if (!value || typeof value !== "object" || value instanceof Date) return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_KEYS.has(k) && v !== null && v !== undefined) out[k] = HIDDEN;
    else out[k] = stripSecrets(v);
  }
  return out;
}

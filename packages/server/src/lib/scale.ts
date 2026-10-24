/**
 * Weighing-scale readings for the pack screen (FP-PK-02).
 *
 * The scale hangs off the plant's orrn-spool node (Go, `internal/scale`), which reads the
 * indicator receive-only and applies the stability rule. ORRN asks the node through SpoolClient
 * and re-checks the rule's hard edges here, so a wrong or old answer can never fill a weight:
 *   - stable = five frames within 20 g, no change for 1 s (decided on the node);
 *   - newest frame older than 3 s => { stable: false } with no grams;
 *   - a steady 0 (or less) is not a weight => stable false;
 *   - timeout, network error or a bad answer => { stable: false }.
 * Typed weights stay possible; when a node has a scale configured the pack flow asks for a reason.
 */
import { z } from "zod";

import type { SpoolScaleReading } from "./spool-client";

export const SCALE_STALE_MS = 3000;

export type ScaleReason =
  | "not_configured"
  | "no_frames"
  | "stale"
  | "settling"
  | "zero"
  | "unreachable"
  | "no_node"
  | "node_inactive"
  | "bad_answer";

export type ScaleReading = {
  stable: boolean;
  /** Present when the node had a fresh frame; integer grams. */
  grams?: number;
  ageMs?: number;
  frames?: number;
  reason?: ScaleReason | (string & {});
  /** The node reports a scale (real or simulated). Typed weight then needs a reason. */
  configured: boolean;
  simulated: boolean;
  /** The edge node asked, null when none. */
  nodeId: string | null;
};

const spoolReadingSchema = z.object({
  grams: z.number().int().optional(),
  stable: z.boolean(),
  ageMs: z.number().int().min(0).optional(),
  frames: z.number().int().min(0).optional(),
  reason: z.string().max(40).optional(),
  configured: z.boolean().optional(),
  simulated: z.boolean().optional(),
});

/** Re-applies the spec's hard edges to whatever the node answered. */
export function normalizeScaleReading(raw: unknown, nodeId: string | null): ScaleReading {
  const parsed = spoolReadingSchema.safeParse(raw);
  if (!parsed.success) {
    return { stable: false, reason: "bad_answer", configured: true, simulated: false, nodeId };
  }
  const r: SpoolScaleReading = parsed.data;
  const configured = r.configured ?? true;
  const simulated = r.simulated ?? false;
  const base = { configured, simulated, nodeId };
  if (!configured) return { stable: false, reason: r.reason ?? "not_configured", ...base };
  if (r.ageMs === undefined || r.ageMs > SCALE_STALE_MS || r.grams === undefined) {
    return {
      stable: false,
      reason: r.ageMs !== undefined && r.ageMs > SCALE_STALE_MS ? "stale" : (r.reason ?? "no_frames"),
      ...(r.ageMs !== undefined ? { ageMs: r.ageMs } : {}),
      ...base,
    };
  }
  const out: ScaleReading = { grams: r.grams, stable: r.stable, ageMs: r.ageMs, frames: r.frames ?? 0, ...base };
  if (r.grams <= 0) {
    out.stable = false;
    out.reason = "zero";
  } else if (!r.stable) {
    out.reason = r.reason ?? "settling";
  }
  return out;
}

export function scaleUnavailable(reason: ScaleReason, nodeId: string | null, configured: boolean): ScaleReading {
  return { stable: false, reason, configured, simulated: false, nodeId };
}

// ─── Dev simulator (SCALE_SIMULATOR=1, never in production) ─────────────────────────────────
// Turn on locally with `SCALE_SIMULATOR=1` in apps/server/.dev.vars (git-ignored; wrangler reads it
// next to wrangler.local.jsonc), then restart `bun run dev:local`.

/** True when the local dev simulator should answer instead of a node. */
export function scaleSimulatorEnabled(env: { SCALE_SIMULATOR?: string; NODE_ENV?: string }): boolean {
  return env.SCALE_SIMULATOR === "1" && env.NODE_ENV !== "production";
}

const CYCLE_MS = 14_000;

function mix(n: number): number {
  let x = (n + 0x9e3779b9) | 0;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return (x ^ (x >>> 16)) >>> 0;
}

/**
 * A reading as the node would report it, at wall time `nowMs`: a 14 s cycle of empty platform
 * (zero), a bundle landing and settling, a steady hold, a 45 g nudge, a second hold, lift-off.
 * Mirrors orrn-spool's `--scale-sim` closely enough to wire `/pack/new` without hardware.
 */
export function simulatedScaleReading(nowMs: number): ScaleReading {
  const cycle = Math.floor(nowMs / CYCLE_MS);
  const t = nowMs - cycle * CYCLE_MS;
  const target = 25_000 + (mix(cycle) % 95_000);
  const grams = target - (target % 5);
  const base = { configured: true, simulated: true, nodeId: null, ageMs: 80 };
  const steady = (g: number, since: number) => {
    const held = t - since;
    const frames = Math.floor(held / 100) + 1;
    return held >= 1000
      ? { grams: g, stable: true, frames, ...base }
      : { grams: g, stable: false, frames, reason: "settling", ...base };
  };
  if (t < 3000) return { grams: 0, stable: false, frames: 30, reason: "zero", ...base };
  if (t < 5400) {
    const f = (t - 3000) / 2400;
    const swing = Math.round((0.08 * grams * Math.exp(-4.5 * f) * Math.cos(2 * Math.PI * 3 * f)) / 5) * 5;
    return { grams: grams + swing, stable: false, frames: 1, reason: "settling", ...base };
  }
  if (t < 9400) return steady(grams, 5400);
  if (t < 10_200) {
    const g = grams + Math.round((45 * (t - 9400)) / 800 / 5) * 5;
    return { grams: g, stable: false, frames: 1, reason: "settling", ...base };
  }
  if (t < 13_200) return steady(grams + 45, 10_200);
  const g = Math.max(0, Math.round(((grams + 45) * (1 - (t - 13_200) / 800)) / 5) * 5);
  return { grams: g, stable: false, frames: 1, reason: g === 0 ? "zero" : "settling", ...base };
}

import { classifyCode, parseScan } from "@orrn/domain";
import { useCallback } from "react";

import { trpcClient } from "@/shared/utils/trpc";

export type ScanCandidate = { bundleId: string; number: string; year: number };

export type ResolveScanResult =
  | { ok: true; bundle: { bundleId: string; number: string } }
  | { ok: false; reason: "unrecognised"; raw: string }
  | { ok: false; reason: "not_found"; code: string }
  | { ok: false; reason: "ambiguous"; code: string; candidates: ScanCandidate[] };

/**
 * What a scan or typed entry points at in this company. `parseScan` takes a
 * bare code or a label link (`…/b/26I4086?c=fourcubes`) and normalises case;
 * the server resolver then finds the bundle for any printed format: plant
 * number `26I4086`, old month-only `J540` (which may match several years:
 * `ambiguous`, the person picks), legacy FCMS id or `BG-` serial. Network and
 * server failures throw (the plain client: the sheet says what happened in
 * place, not as an extra error toast).
 */
export async function resolveScan(raw: string): Promise<ResolveScanResult> {
  const parsed = parseScan(raw);
  if (parsed.kind !== "serial") return { ok: false, reason: "unrecognised", raw };
  const hit = await trpcClient.resolve.byCode.query({ code: parsed.serial });
  if (hit.kind === "bundle") return { ok: true, bundle: { bundleId: hit.bundleId, number: hit.number } };
  if (hit.kind === "ambiguous") return { ok: false, reason: "ambiguous", code: parsed.serial, candidates: hit.candidates };
  return { ok: false, reason: "not_found", code: parsed.serial };
}

/**
 * True when the code is the bundle's number as stored (plant number, `BG-`
 * serial), so it can go straight to `dispatch.addBundlesBySerial` without a
 * resolve round trip. Old month-only numbers and legacy ids are resolved first.
 */
export function isStoredNumber(serial: string): boolean {
  const kind = classifyCode(serial).kind;
  return kind === "plant" || kind === "serial";
}

/** `resolve(raw)` for components. */
export function useResolveScan() {
  return useCallback((raw: string) => resolveScan(raw), []);
}

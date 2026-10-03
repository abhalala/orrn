import { classifyCode, monthLetter } from "@orrn/domain";
import { bundle, legacyBundleMap } from "@orrn/db/schema";
import { and, desc, eq, inArray } from "drizzle-orm";

import type { OrrnDb } from "./atomic";

export type ResolveResult =
  | { kind: "bundle"; bundleId: string; number: string }
  | { kind: "ambiguous"; candidates: { bundleId: string; number: string; year: number }[] }
  | { kind: "not_found" };

/**
 * Old month-only numbers (`J540`) carry no year. Candidates are the plant numbers `YYJ540` for the
 * years the plant could have printed them (2020-2049), looked up through the unique
 * (company, serial) index. 30 serials + company id stay well under D1's 100 bound parameters.
 */
const FIRST_YY = 20;
const LAST_YY = 49;

/**
 * Resolve whatever a scanner, a typed entry or a pasted QR URL holds to a bundle of `companyId`:
 * plant number `26I4086`, old month-only `J540`, legacy FCMS cuid (via `legacy_bundle_map`) or a
 * current serial such as `BG-000001-B001`. Every query is scoped by company.
 */
export async function resolveCode(db: OrrnDb, companyId: string, code: string): Promise<ResolveResult> {
  const parsed = classifyCode(code);
  if (parsed.kind === "unknown") return { kind: "not_found" };

  if (parsed.kind === "cuid") {
    const [hit] = await db
      .select({ bundleId: bundle.id, number: bundle.serial })
      .from(legacyBundleMap)
      .innerJoin(bundle, and(eq(bundle.id, legacyBundleMap.bundleId), eq(bundle.companyId, legacyBundleMap.companyId)))
      .where(and(eq(legacyBundleMap.companyId, companyId), eq(legacyBundleMap.legacyId, parsed.id)))
      .limit(1);
    return hit ? { kind: "bundle", ...hit } : { kind: "not_found" };
  }

  // Exact serial first: covers plant numbers, BG serials and companies whose own serials look like J540.
  const [exact] = await db
    .select({ bundleId: bundle.id, number: bundle.serial })
    .from(bundle)
    .where(and(eq(bundle.companyId, companyId), eq(bundle.serial, parsed.serial)))
    .limit(1);
  if (exact) return { kind: "bundle", ...exact };

  if (parsed.kind !== "monthOnly") return { kind: "not_found" };

  const letter = monthLetter(parsed.month);
  const serials = Array.from(
    { length: LAST_YY - FIRST_YY + 1 },
    (_, i) => `${FIRST_YY + i}${letter}${parsed.seq}`,
  );
  const rows = await db
    .select({ bundleId: bundle.id, number: bundle.serial })
    .from(bundle)
    .where(and(eq(bundle.companyId, companyId), inArray(bundle.serial, serials)))
    .orderBy(desc(bundle.serial));
  const candidates = rows
    .map((r) => ({ ...r, year: 2000 + Number(r.number.slice(0, 2)) }))
    .sort((a, b) => b.year - a.year);
  if (candidates.length === 0) return { kind: "not_found" };
  if (candidates.length === 1) return { kind: "bundle", bundleId: candidates[0]!.bundleId, number: candidates[0]!.number };
  return { kind: "ambiguous", candidates };
}

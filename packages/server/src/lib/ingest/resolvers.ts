/**
 * Server resolvers of the dry run (plan B4): turn a name or code from a file into a live record of
 * this plant. Matching rules are `matchName` in `@orrn/ingest` (lane C); `nameKey` there equals
 * `nameKey` in lib/purchase.ts (pinned by a parity test). A near match is never taken on its own: it
 * makes the row ambiguous with options for a person to pick.
 */
import { matchName, nameKey as engineNameKey, type NameEntry } from "@orrn/ingest";
import { and, eq, inArray, isNull, ne, sql, type SQL } from "drizzle-orm";

import { customer, customerAlias, die, dieInstance, legacyBundleMap, vendor, vendorAlias } from "@orrn/db/schema";

import { mapInChunks, type OrrnDb } from "../atomic";
import { nameKey } from "../purchase";

type Db = { db: OrrnDb; companyId: string };

export type Resolution =
  | { kind: "match"; id: string; label: string }
  | { kind: "ambiguous"; options: { id: string; label: string }[] }
  | { kind: "none" };

/** Same rule on both sides of the wire; the parity test pins this. */
export const serverNameKey = nameKey;
export const sharedNameKey = engineNameKey;

export type NameIndex = { entries: NameEntry[]; labels: Map<string, string> };

/** Every live customer of the plant by its name and its aliases, in memory (plan B4). */
export async function loadCustomerIndex(ctx: Db): Promise<NameIndex> {
  const rows = await ctx.db
    .select({ id: customer.id, name: customer.name })
    .from(customer)
    .where(and(eq(customer.companyId, ctx.companyId), isNull(customer.deletedAt)));
  const aliases = await ctx.db
    .select({ id: customerAlias.customerId, alias: customerAlias.alias, key: customerAlias.aliasKey })
    .from(customerAlias)
    .where(eq(customerAlias.companyId, ctx.companyId));
  const labels = new Map(rows.map((r) => [r.id, r.name]));
  const entries: NameEntry[] = rows.map((r) => ({ id: r.id, key: nameKey(r.name), label: r.name }));
  for (const a of aliases) if (labels.has(a.id)) entries.push({ id: a.id, key: a.key, label: labels.get(a.id)! });
  return { entries, labels };
}

/** Every vendor of the plant that is not merged, by name and alias. */
export async function loadVendorIndex(ctx: Db): Promise<NameIndex> {
  const rows = await ctx.db
    .select({ id: vendor.id, name: vendor.name, key: vendor.nameKey })
    .from(vendor)
    .where(and(eq(vendor.companyId, ctx.companyId), ne(vendor.status, "merged")));
  const aliases = await ctx.db
    .select({ id: vendorAlias.vendorId, key: vendorAlias.aliasKey })
    .from(vendorAlias)
    .where(eq(vendorAlias.companyId, ctx.companyId));
  const labels = new Map(rows.map((r) => [r.id, r.name]));
  const entries: NameEntry[] = rows.map((r) => ({ id: r.id, key: r.key, label: r.name }));
  for (const a of aliases) if (labels.has(a.id)) entries.push({ id: a.id, key: a.key, label: labels.get(a.id)! });
  return { entries, labels };
}

/** `customer_by_name` and `vendor_by_name`: exact key matches, a near key is ambiguous, never merged. */
export function resolveName(index: NameIndex, text: string): Resolution {
  const m = matchName(text, index.entries);
  if (m.kind === "exact") {
    if (m.ids.length === 1) return { kind: "match", id: m.ids[0]!, label: index.labels.get(m.ids[0]!) ?? text };
    return { kind: "ambiguous", options: m.ids.map((id) => ({ id, label: index.labels.get(id) ?? id })) };
  }
  if (m.kind === "near") return { kind: "ambiguous", options: m.options.map((o) => ({ id: o.id, label: o.label })) };
  return { kind: "none" };
}

export type SectionRow = { id: string; series: string; sectionCode: string; name: string | null };

/** Live sections whose code is one of `codes` (chunked IN lists). */
export async function loadSections(ctx: Db, codes: readonly string[]): Promise<SectionRow[]> {
  return mapInChunks(sectionKeys(codes), (part) =>
    ctx.db
      .select({ id: die.id, series: die.series, sectionCode: die.sectionCode, name: die.name })
      .from(die)
      .where(and(eq(die.companyId, ctx.companyId), isNull(die.deletedAt), sectionCodeIn(part))),
  );
}

/** Section codes as the resolvers compare them: trimmed, upper case, unique, no blanks. */
export function sectionKeys(codes: readonly string[]): string[] {
  return [...new Set(codes.map((c) => c.trim().toUpperCase()).filter(Boolean))];
}

/** The SQL filter that compares section codes the way `resolveSection` does (A16). */
export function sectionCodeIn(keys: readonly string[]): SQL {
  return inArray(sql`upper(trim(${die.sectionCode}))`, [...keys]);
}

const norm = (s: string) => s.trim().toUpperCase();

/**
 * `section_by_code`: series + code exact; else the code alone when it is unique in the plant; else
 * ambiguous with the options; none means the `create_legacy_die` question.
 */
export function resolveSection(sections: readonly SectionRow[], series: string | null, code: string): Resolution {
  const byCode = sections.filter((s) => norm(s.sectionCode) === norm(code));
  if (series) {
    const exact = byCode.filter((s) => norm(s.series) === norm(series));
    if (exact.length === 1) return { kind: "match", id: exact[0]!.id, label: `${exact[0]!.series} ${exact[0]!.sectionCode}` };
  }
  if (byCode.length === 1) return { kind: "match", id: byCode[0]!.id, label: `${byCode[0]!.series} ${byCode[0]!.sectionCode}` };
  if (byCode.length > 1) return { kind: "ambiguous", options: byCode.map((s) => ({ id: s.id, label: `${s.series} ${s.sectionCode}` })) };
  return { kind: "none" };
}

export type CopyRow = { id: string; code: string; makerDieNo: string | null; sectionId: string };

/** `die_copy_by_code`: the maker's die number, or the plant copy code. */
export async function loadCopies(ctx: Db, codes: readonly string[]): Promise<CopyRow[]> {
  const unique = [...new Set(codes.filter(Boolean))];
  const byMaker = await mapInChunks(unique, (part) =>
    ctx.db
      .select({ id: dieInstance.id, code: dieInstance.code, makerDieNo: dieInstance.makerDieNo, sectionId: dieInstance.sectionId })
      .from(dieInstance)
      .where(and(eq(dieInstance.companyId, ctx.companyId), inArray(dieInstance.makerDieNo, part))),
  );
  const byCode = await mapInChunks(unique, (part) =>
    ctx.db
      .select({ id: dieInstance.id, code: dieInstance.code, makerDieNo: dieInstance.makerDieNo, sectionId: dieInstance.sectionId })
      .from(dieInstance)
      .where(and(eq(dieInstance.companyId, ctx.companyId), inArray(dieInstance.code, part))),
  );
  const seen = new Map<string, CopyRow>();
  for (const r of [...byMaker, ...byCode]) seen.set(r.id, r);
  return [...seen.values()];
}

export function resolveCopy(copies: readonly CopyRow[], code: string): Resolution {
  const hits = copies.filter((c) => c.makerDieNo === code || c.code === code);
  if (hits.length === 1) return { kind: "match", id: hits[0]!.id, label: hits[0]!.code };
  if (hits.length > 1) return { kind: "ambiguous", options: hits.map((h) => ({ id: h.id, label: h.code })) };
  return { kind: "none" };
}

/** `bundle_by_legacy_id`: a hit in `legacy_bundle_map` means the bundle is already in orrn. */
export async function loadLegacyBundles(ctx: Db, legacyIds: readonly string[]): Promise<Map<string, string>> {
  const unique = [...new Set(legacyIds.filter(Boolean))];
  const rows = await mapInChunks(unique, (part) =>
    ctx.db
      .select({ legacyId: legacyBundleMap.legacyId, bundleId: legacyBundleMap.bundleId })
      .from(legacyBundleMap)
      .where(and(eq(legacyBundleMap.companyId, ctx.companyId), inArray(legacyBundleMap.legacyId, part))),
  );
  return new Map(rows.map((r) => [r.legacyId, r.bundleId]));
}

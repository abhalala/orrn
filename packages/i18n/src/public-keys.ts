/**
 * The English the public marketing page (`/`) renders, by key or subtree.
 *
 * `/` has a JS budget (apps/web/scripts/check-route-budget.ts), so the web
 * entry carries only these strings (src/en-public.gen.ts); the full English
 * dictionary is a lazy chunk like every other locale (src/loader.ts) that the
 * root route loads before any other page renders.
 *
 * Adding a `t("…")` to the marketing page? Add its key here, then run
 * `bun run --cwd packages/i18n gen:public`. Tests fail until both are done
 * (packages/i18n public.test.ts, apps/web marketing public-keys.test.ts).
 * Keep app namespaces out unless `/` shows them: whatever is listed here
 * ships to every first visitor.
 */
export const PUBLIC_KEYS = [
  "common.appName",
  "common.demoData",
  "common.language",
  "marketing",
  "nav.dispatch",
  "nav.pack",
  "nav.skipToContent",
  "nav.stock",
  "pack.new.bundleNumber",
  "pack.new.pieces",
  "pack.new.saveBundle",
  "pack.new.weight",
  "packingList.columns.bundleNo",
  "packingList.columns.kgPer12ft",
  "packingList.columns.pcs",
  "packingList.columns.sr",
  "packingList.columns.weightKg",
  "packingList.customer",
  "packingList.date",
  "packingList.plNo",
  "packingList.title",
  "packingList.totals",
  "scan.title",
  "status.bundle.available",
  "status.bundle.reserved",
  "status.printJob.success",
  "status.range.inRange",
  "units.kg",
  "units.kgPer12ft",
] as const;

export type MessageTree = { readonly [key: string]: string | MessageTree };

/** The subset of `tree` named by `paths` (each a leaf key or a subtree), in the tree's own key order. */
export function pickMessages(tree: MessageTree, paths: readonly string[]): MessageTree {
  const out: Record<string, string | MessageTree> = {};
  for (const [key, value] of Object.entries(tree)) {
    if (paths.includes(key)) {
      out[key] = value;
      continue;
    }
    const prefix = `${key}.`;
    const inner = paths.filter((p) => p.startsWith(prefix)).map((p) => p.slice(prefix.length));
    if (inner.length === 0 || typeof value === "string") continue;
    const picked = pickMessages(value, inner);
    if (Object.keys(picked).length > 0) out[key] = picked;
  }
  return out;
}

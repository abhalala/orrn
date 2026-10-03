/**
 * TEMPORARY (delete in Task 15, route map): the shell is keyed to the C2
 * paths, but some of those routes don't exist yet. `navTarget` maps a C2 path
 * onto today's route so no nav item 404s. When the route map lands, delete this
 * file and replace `navTarget(x)` with `x` (and `legacyPrefixes` with nothing).
 */
const C2_TO_CURRENT: readonly (readonly [c2: string, current: string])[] = [
  ["/today", "/dashboard"],
  ["/pack", "/receipts"],
  ["/stock/bundles", "/bundles"],
  ["/dispatch", "/dispatches"],
  ["/printing", "/spool"],
  ["/settings", "/settings/members"],
  ["/admin/requests", "/admin/waitlist"],
];

function under(path: string, prefix: string) {
  return path === prefix || path.startsWith(`${prefix}/`);
}

/** Today's route for a C2 path (`/dispatch/abc` → `/dispatches/abc`). Unknown paths pass through. */
export function navTarget(path: string): string {
  for (const [c2, current] of C2_TO_CURRENT) {
    if (under(path, c2)) return current + path.slice(c2.length);
  }
  return path;
}

/** Old URLs that still belong to a C2 nav item, so it lights up on them. */
export const legacyPrefixes: Partial<Record<string, readonly string[]>> = {
  stock: ["/bundles"],
  dispatch: ["/packing-lists"],
};

/**
 * Bundle detail. Today it is `/bundles/$id`; the route map moves it to
 * `/b/$serial` and this becomes `/b/${serial}`.
 */
export function bundleDetailPath(bundle: { id: string; serial: string }): string {
  return `/bundles/${encodeURIComponent(bundle.id)}`;
}

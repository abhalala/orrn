/**
 * Old URL to new URL (spec §3.2). Every path the pre-C2 app served still
 * resolves, so no bookmark, email link or printed QR breaks. The query string
 * always carries over.
 *
 * Two rows need the server and are not here: `/bundles/$id` (id to serial, via
 * `bundle.getBundle`) and `/packing-lists/$id` (to its dispatch, via
 * `packingList.get`). Their route loaders do that lookup.
 */
export const STATIC_REDIRECTS: Record<string, string> = {
  "/dashboard": "/today",
  "/receipts": "/pack",
  "/receipts/new": "/pack/new",
  "/bundles": "/stock/bundles",
  "/dispatches": "/dispatch",
  "/dispatches/new": "/dispatch/new",
  "/spool": "/printing",
  "/settings/members": "/settings?tab=team",
  // The emailed magic link (waitlist approval). Plain /welcome again: the steps
  // come from auth.me, so the old ?magic=1 flag (ruling R6) is gone.
  "/setup-credentials": "/welcome",
  "/onboarding": "/welcome",
  "/change-password": "/welcome",
  "/waitlist": "/request-access",
  "/admin/waitlist": "/admin/requests",
  "/admin/spool": "/admin/companies",
};

/** Old parent path to its new parent: `/receipts/abc` becomes `/pack/abc`. */
const PARAM_REDIRECTS: Record<string, string> = {
  "/receipts": "/pack",
  "/dispatches": "/dispatch",
};

function trimTrailingSlash(pathname: string): string {
  return pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
}

function paramName(pair: string): string {
  const raw = pair.split("=", 1)[0] ?? "";
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/**
 * Append the incoming query to `target`, untouched (no re-encoding). A name the
 * target already sets keeps the target's value: `/settings/members?tab=x` is
 * still the Team tab.
 */
function withSearch(target: string, search: string): string {
  const incoming = search.replace(/^\?/, "");
  if (!incoming) return target;
  const [path = "", own = ""] = target.split("?", 2) as [string, string?];
  const ownNames = new Set(own ? own.split("&").map(paramName) : []);
  const extra = incoming.split("&").filter((pair) => pair && !ownNames.has(paramName(pair)));
  const query = [own, ...extra].filter(Boolean).join("&");
  return query ? `${path}?${query}` : path;
}

/**
 * Where an old URL now lives, or null when `pathname` is not an old URL (or
 * needs a server lookup, see above). `search` is `location.searchStr`, with or
 * without the leading `?`. Ids keep their original encoding.
 */
export function resolveRedirect(pathname: string, search: string): string | null {
  const path = trimTrailingSlash(pathname);

  const direct = Object.hasOwn(STATIC_REDIRECTS, path) ? STATIC_REDIRECTS[path] : undefined;
  if (direct) return withSearch(direct, search);

  const [, parent, id, ...rest] = path.split("/") as [string, string?, string?, ...string[]];
  const next = parent ? PARAM_REDIRECTS[`/${parent}`] : undefined;
  if (next && id && rest.length === 0) return withSearch(`${next}/${id}`, search);

  return null;
}

/**
 * A `/welcome?token=...` link sent before the front door was rebuilt (the
 * owner's sign-in link used to open a public /welcome). /welcome is the
 * signed-in stepper now, so such a link goes to `/continue`, which spends the
 * token on a tap. Null for any other /welcome visit.
 */
export function legacyWelcomeLink(pathname: string, search: string): string | null {
  if (trimTrailingSlash(pathname) !== "/welcome") return null;
  const params = new URLSearchParams(search);
  const token = params.get("token");
  if (!token) return null;
  const out = new URLSearchParams({ token });
  const error = params.get("error");
  if (error) out.set("error", error);
  return `/continue?${out.toString()}`;
}

import { Link, useLocation } from "@tanstack/react-router";

export type BreadcrumbsProps = {
  /** Path the "home" crumb links to, e.g. `/dashboard` or `/admin`. */
  homePath: string;
  /** Display label for the home crumb. */
  homeLabel?: string;
  /**
   * Path segments to skip when rendering the trail. Useful when the home
   * crumb already covers part of the URL (e.g. the staff console lives under
   * `/admin/*` so the `admin` segment shouldn't appear twice).
   */
  skipSegments?: readonly string[];
};

/**
 * Generic breadcrumb trail derived from the current pathname. Both the ERP
 * (`/dashboard`) and Staff (`/admin`) shells render this above their main
 * content area.
 */
export function Breadcrumbs({
  homePath,
  homeLabel = "Home",
  skipSegments,
}: BreadcrumbsProps) {
  const location = useLocation();
  const skipSet = new Set(skipSegments ?? []);
  const segments = location.pathname
    .split("/")
    .filter(Boolean)
    .filter((seg) => !skipSet.has(seg));

  if (segments.length === 0) return null;

  // Rebuild the full path for each segment, ignoring skipped segments.
  let cumulative = "";
  const crumbs = location.pathname
    .split("/")
    .filter(Boolean)
    .map((seg) => {
      cumulative += "/" + seg;
      return { seg, path: cumulative };
    })
    .filter(({ seg }) => !skipSet.has(seg));

  return (
    <nav
      aria-label="Breadcrumb"
      className="flex items-center gap-1 px-6 h-9 text-xs text-muted-foreground border-b border-border bg-background"
    >
      <Link to={homePath as "/"} className="hover:text-foreground hover:underline">
        {homeLabel}
      </Link>
      {crumbs.map(({ seg, path }, i) => {
        const isLast = i === crumbs.length - 1;
        return (
          <span key={path} className="flex items-center gap-1">
            <span aria-hidden>/</span>
            {isLast ? (
              <span className="text-foreground">{prettifySegment(seg)}</span>
            ) : (
              <Link to={path as "/"} className="hover:text-foreground hover:underline">
                {prettifySegment(seg)}
              </Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}

function prettifySegment(seg: string): string {
  if (seg === "$id" || seg.startsWith("$")) return "Detail";
  if (seg === "new") return "New";
  return seg.charAt(0).toUpperCase() + seg.slice(1);
}

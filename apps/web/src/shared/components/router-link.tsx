import type { LinkComponent, UiLinkProps } from "@orrn/ui/components/link";
import { Link } from "@tanstack/react-router";
import { forwardRef } from "react";

/**
 * Adapts TanStack Router's `Link` to `@orrn/ui`'s `UiLink` contract, so
 * library components (ActionTile, StatusBlock, ResponsiveList rows, PageHeader
 * back) navigate client-side. External and mailto/tel links stay plain anchors.
 */
export const RouterLink: LinkComponent = forwardRef<HTMLAnchorElement, UiLinkProps>(function RouterLink(
  { to, ...rest },
  ref,
) {
  if (/^([a-z][a-z0-9+.-]*:|\/\/)/i.test(to)) {
    return <a ref={ref} href={to} {...rest} />;
  }
  // `to` is a runtime string from the component library; the route tree types
  // can't check it here. Callers pass paths built from the route map.
  return <Link ref={ref} to={to as never} {...(rest as object)} />;
});

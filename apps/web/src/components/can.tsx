import type { ReactNode } from "react";

import { can, useMe, type Action } from "@/lib/me";

type Props = {
  do: Action;
  fallback?: ReactNode;
  children: ReactNode;
};

/**
 * Hide its children unless the current user can perform `action`.
 *
 * Convenience wrapper; the server is still authoritative. We render `fallback`
 * (default: nothing) when denied so callers can show a tooltip / "ask admin"
 * placeholder if they want to.
 */
export function Can({ do: action, fallback = null, children }: Props) {
  const { data: me } = useMe();
  if (!can(me, action)) return <>{fallback}</>;
  return <>{children}</>;
}

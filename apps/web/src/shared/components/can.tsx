import type { ReactNode } from "react";

import { can, canAny, useMe, type Action } from "../lib/me";

type Props = {
  /** One action, or a list meaning "any of these" (e.g. store items: store.txn or masters.publish). */
  do: Action | readonly Action[];
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
  const allowed = typeof action === "string" ? can(me, action) : canAny(me, action);
  if (!allowed) return <>{fallback}</>;
  return <>{children}</>;
}

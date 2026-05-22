import type { ReactNode } from "react";

import { can, useMe, type Action } from "@/utils/me";

type Props = {
  do: Action;
  fallback?: ReactNode;
  children: ReactNode;
};

/**
 * Native parity with apps/web's <Can>. Hides children unless the current user
 * can perform `action`. Server is still authoritative.
 */
export function Can({ do: action, fallback = null, children }: Props) {
  const { data: me } = useMe();
  if (!can(me, action)) return <>{fallback}</>;
  return <>{children}</>;
}

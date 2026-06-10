import type { ReactNode } from "react";

import { WorkspaceShell } from "./app-shell";
import { STAFF_NAV } from "../lib/navigation";

export function StaffShell({ children }: { children: ReactNode }) {
  return (
    <WorkspaceShell
      homePath="/admin"
      homeLabel="Godseye"
      skipSegments={["admin"]}
      nav={STAFF_NAV}
      maxWidth={1280}
      staffMode
    >
      {children}
    </WorkspaceShell>
  );
}

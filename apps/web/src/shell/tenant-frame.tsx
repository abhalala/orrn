import type { ReactNode } from "react";

import { ScanProvider } from "@/features/scan/scan-context";

import { AppShell } from "./app-shell";

/**
 * The signed-in company frame: scan sheet plus the app shell. `_tenant` wraps
 * its pages in it, and `/b/$serial` does too when the visitor is a member (it
 * lives outside `_tenant` so a signed-out label scan isn't sent to login).
 */
export function TenantFrame({ children }: { children: ReactNode }) {
  return (
    <ScanProvider>
      <AppShell variant="tenant">{children}</AppShell>
    </ScanProvider>
  );
}

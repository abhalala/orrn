import { useRouterState } from "@tanstack/react-router";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { ScanSheet, type AddBundlesReport, type ScanMode } from "./scan-sheet";

export type { AddBundlesReport, ScanMode } from "./scan-sheet";

/**
 * Global scan entry (ruling R5). `useScan().open()` from the tab bar, rail or
 * sidebar opens the scan sheet in lookup mode (a serial or label link opens
 * that bundle); a dispatch's Build step calls
 * `open({ kind: "dispatch", dispatchId, dispatchCode, onAdded })` for
 * continuous scanning into that dispatch.
 */
type ScanContextValue = { open(mode?: ScanMode): void; available: boolean };

const ScanContext = createContext<ScanContextValue>({ open: () => {}, available: false });

export function useScan() {
  return useContext(ScanContext);
}

type SheetState = { mode: ScanMode; open: boolean; session: number };

type ScanSeamWindow = Window & {
  __orrnScan?: { open(mode?: Partial<ScanMode>): void };
  __orrnScanReports?: AddBundlesReport[];
};

export function ScanProvider({ children }: { children: ReactNode }) {
  const [sheet, setSheet] = useState<SheetState>({ mode: { kind: "lookup" }, open: false, session: 0 });

  // A fresh sheet per open: results, count and camera state never carry over.
  const open = useCallback(
    (mode: ScanMode = { kind: "lookup" }) => setSheet((s) => ({ mode, open: true, session: s.session + 1 })),
    [],
  );
  const onOpenChange = useCallback((next: boolean) => setSheet((s) => ({ ...s, open: next })), []);

  // Leaving the page (back button, a link) closes the sheet and with it the camera.
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  useEffect(() => {
    setSheet((s) => (s.open ? { ...s, open: false } : s));
  }, [pathname]);

  // Test seam (dev server only; dropped from production builds): open any
  // mode before the screens that call it exist. Dispatch reports are kept on
  // `window.__orrnScanReports` when no `onAdded` is given.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const w = window as ScanSeamWindow;
    w.__orrnScan = {
      open(mode) {
        if (mode?.kind === "dispatch" && mode.dispatchId) {
          open({
            kind: "dispatch",
            dispatchId: mode.dispatchId,
            dispatchCode: mode.dispatchCode,
            onAdded: mode.onAdded ?? ((report) => (w.__orrnScanReports ??= []).push(report)),
          });
        } else open({ kind: "lookup" });
      },
    };
    return () => {
      delete w.__orrnScan;
    };
  }, [open]);

  const value = useMemo<ScanContextValue>(() => ({ open, available: true }), [open]);
  return (
    <ScanContext.Provider value={value}>
      {children}
      <ScanSheet key={sheet.session} mode={sheet.mode} open={sheet.open} onOpenChange={onOpenChange} />
    </ScanContext.Provider>
  );
}

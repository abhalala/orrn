import { parseScan } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { Field } from "@orrn/ui/components/field";
import { ScanField } from "@orrn/ui/components/scan-field";
import { Sheet } from "@orrn/ui/components/sheet";
import { useNavigate } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";

import { bundleDetailPath } from "@/shared/lib/paths";
import { trpcClient } from "@/shared/utils/trpc";

/**
 * Global scan entry (ruling R5). `useScan().open()` from the tab bar, rail or
 * sidebar opens a sheet with the manual / wedge-scanner field; a serial or a
 * label link opens that bundle. Task 16 replaces the sheet with the camera
 * scanner and adds `{ kind: "dispatch" }` for continuous scanning into a
 * dispatch, behind the same `open(mode)` call.
 */
export type ScanMode = { kind: "lookup" };

type ScanContextValue = { open(mode?: ScanMode): void; available: boolean };

const ScanContext = createContext<ScanContextValue>({ open: () => {}, available: false });

export function useScan() {
  return useContext(ScanContext);
}

export function ScanProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const value = useMemo<ScanContextValue>(() => ({ open: () => setOpen(true), available: true }), []);
  return (
    <ScanContext.Provider value={value}>
      {children}
      <LookupSheet open={open} onOpenChange={setOpen} />
    </ScanContext.Provider>
  );
}

type Feedback = { kind: "searching"; serial: string } | { kind: "notFound"; serial: string } | { kind: "unrecognised" };

function LookupSheet({ open, onOpenChange }: { open: boolean; onOpenChange(open: boolean): void }) {
  const { t } = useT();
  const navigate = useNavigate();
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  // Only the newest scan may act (a wedge scanner can fire twice quickly).
  const latest = useRef(0);

  const close = useCallback(
    (next: boolean) => {
      if (!next) setFeedback(null);
      onOpenChange(next);
    },
    [onOpenChange],
  );

  const onScan = async (raw: string) => {
    const parsed = parseScan(raw);
    if (parsed.kind !== "serial") {
      setFeedback({ kind: "unrecognised" });
      return;
    }
    const ticket = ++latest.current;
    setFeedback({ kind: "searching", serial: parsed.serial });
    try {
      // The plain client, so a miss is shown here and not also as an error toast.
      const found = await trpcClient.bundle.getBySerial.query({ serial: parsed.serial });
      if (ticket !== latest.current) return;
      close(false);
      void navigate({ to: bundleDetailPath(found.bundle) as never });
    } catch {
      if (ticket !== latest.current) return;
      setFeedback({ kind: "notFound", serial: parsed.serial });
    }
  };

  return (
    <Sheet open={open} onOpenChange={close} title={t("scan.title")}>
      <div className="flex flex-col gap-4 pt-1">
        <Field label={t("scan.manualLabel")} hint={t("scan.manualHint")}>
          <ScanField onScan={onScan} placeholder="BG-000001-B001" autoFocus />
        </Field>
        <p role="status" aria-live="polite" className="m-0 flex min-h-6 min-w-0 items-center gap-2 text-[15px]">
          {feedback?.kind === "searching" ? (
            <>
              <Loader2 aria-hidden="true" className="size-4 shrink-0 animate-spin text-muted-foreground" />
              <span className="text-muted-foreground">{t("ui.searching")}</span>
            </>
          ) : null}
          {feedback?.kind === "notFound" ? (
            <>
              <span className="font-semibold text-destructive">{t("scan.notFound")}</span>
              <span className="min-w-0 truncate font-mono text-muted-foreground" title={feedback.serial}>
                {feedback.serial}
              </span>
            </>
          ) : null}
          {feedback?.kind === "unrecognised" ? (
            <span className="font-semibold text-destructive">{t("scan.unrecognised")}</span>
          ) : null}
        </p>
      </div>
    </Sheet>
  );
}

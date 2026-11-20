import { useT } from "@orrn/i18n";
import { cn } from "@orrn/ui/lib/utils";
import { MessageCircle } from "lucide-react";
import { Component, lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";

import { can, useMe, type Me } from "@/shared/lib/me";

const loadPanel = () => import("./buddy-panel");
const LazyBuddyPanel = lazy(loadPanel);

/** Whether this person gets the bubble: the server says Buddy is on for them here, and the role can `buddy.use`. */
export function showBuddy(me: (Me & { buddy?: boolean }) | undefined): boolean {
  return me?.buddy === true && !me.impersonation && can(me, "buddy.use");
}

class PanelBoundary extends Component<{ children: ReactNode; onFailed: () => void }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override componentDidCatch() {
    this.props.onFailed();
  }

  override render() {
    return this.state.failed ? null : this.props.children;
  }
}

/**
 * The closed bubble (design §4.5): a round button at the bottom right, mounted once in the `_tenant` layout. Only this
 * file is in the layout's chunk; the panel, the chat client and the draft cards load on the first open
 * (`buddy-panel.tsx`, a dynamic import) and then stay mounted, so the conversation and an open panel survive route
 * changes. Portalled to `body`, so the page's view transition never moves it. It sits above the phone tab bar and
 * above a screen's sticky action bar (the same `--orrn-toast-bottom` lift toasts use), below sheets, the command
 * palette and toasts (z-40).
 */
export function BuddyLauncher() {
  const { t } = useT();
  const { data: me } = useMe();
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const show = showBuddy(me);
  const companyId = me?.company?.id ?? null;

  // A plant switch closes the panel; the panel itself is keyed on plant and person, so its chat starts fresh.
  useEffect(() => setOpen(false), [companyId]);

  if (!show || !me || typeof document === "undefined") return null;

  const openPanel = () => {
    setLoaded(true);
    setOpen(true);
  };
  const failed = () => {
    setOpen(false);
    setLoaded(false);
    toast.error(t("buddy.failed"));
  };

  return createPortal(
    <>
      <button
        type="button"
        onClick={openPanel}
        onPointerEnter={() => void loadPanel().catch(() => {})}
        onFocus={() => void loadPanel().catch(() => {})}
        aria-label={t("buddy.open")}
        title={t("buddy.open")}
        aria-haspopup="dialog"
        aria-expanded={open}
        data-testid="buddy-launcher"
        className={cn(
          "fixed right-4 z-40 flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-button transition-[scale] duration-[var(--dur-fast)] active:scale-[0.95] motion-reduce:transition-none md:right-6",
          "bottom-[max(calc(89px+env(safe-area-inset-bottom)),var(--orrn-toast-bottom,0px))] md:bottom-[max(24px,var(--orrn-toast-bottom,0px))]",
        )}
      >
        <MessageCircle aria-hidden="true" className="size-6" strokeWidth={2} />
      </button>
      {loaded ? (
        <PanelBoundary onFailed={failed}>
          <Suspense fallback={null}>
            <LazyBuddyPanel key={`${companyId}:${me.user.id}`} open={open} onOpenChange={setOpen} />
          </Suspense>
        </PanelBoundary>
      ) : null}
    </>,
    document.body,
  );
}

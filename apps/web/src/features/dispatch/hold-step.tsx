import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Dialog } from "@orrn/ui/components/dialog";
import { useMutation } from "@tanstack/react-query";
import { Info } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { trpc } from "@/shared/utils/trpc";

import { dispatchErrorText } from "./errors";

/** Held: the stock is kept for this customer; anything added now is held at once (server rule). */
export function HoldNote({ customerName }: { customerName: string }) {
  const { t } = useT();
  return (
    <div className="flex min-w-0 items-start gap-3 rounded-card bg-tone-blue-tint px-4 py-3 text-tone-blue-ink">
      <Info aria-hidden="true" strokeWidth={2} className="mt-0.5 size-5 shrink-0" />
      <p className="m-0 min-w-0 text-[15px] leading-6">
        {t("dispatch.holdHint", { customer: customerName })} {t("dispatch.heldNote")}
      </p>
    </div>
  );
}

/**
 * A building or held dispatch has no packing list yet: it is issued when the dispatch completes
 * (BACKLOG 85). Says so, and jumps to the bundles that are reserved (held) or on the load (building).
 */
export function PlPendingNote({ held }: { held: boolean }) {
  const { t } = useT();
  const jump = () => {
    const heading = document.getElementById("dispatch-items");
    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    heading?.scrollIntoView({ behavior: still ? "auto" : "smooth", block: "start" });
    heading?.focus({ preventScroll: true });
  };
  return (
    <div
      data-testid="pl-pending"
      className="flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-card border border-border bg-card px-4 py-3"
    >
      <p className="m-0 min-w-0 text-[15px] leading-6">{t("dispatch.detail.plWhenComplete")}</p>
      <Button variant="ghost" onClick={jump} data-testid="pl-pending-link">
        {held ? t("dispatch.detail.plSeeReserved") : t("dispatch.detail.plSeeBundles")}
      </Button>
    </div>
  );
}

/** Release the held stock (back to Building), after a confirmation. */
export function ReleaseButton({ dispatchId, onReleased, disabled }: { dispatchId: string; onReleased(): void; disabled?: boolean }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const release = useMutation(trpc.dispatch.unreserve.mutationOptions());
  return (
    <>
      <Button variant="secondary" size="lg" className="sm:h-11 sm:text-[15px]" disabled={disabled} onClick={() => setOpen(true)} aria-haspopup="dialog">
        {t("dispatch.release")}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => !release.isPending && setOpen(next)}
        title={t("dispatch.releaseTitle")}
        description={t("dispatch.releaseBody")}
        actions={
          <>
            <Button variant="secondary" disabled={release.isPending} onClick={() => setOpen(false)}>
              {t("common.back")}
            </Button>
            <Button
              loading={release.isPending}
              onClick={() =>
                release.mutate(
                  { id: dispatchId },
                  {
                    onSuccess: () => {
                      toast.success(t("dispatch.released"));
                      setOpen(false);
                      onReleased();
                    },
                    onError: (err) => toast.error(dispatchErrorText(t, err)),
                  },
                )
              }
            >
              {t("dispatch.release")}
            </Button>
          </>
        }
      />
    </>
  );
}

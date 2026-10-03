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

import type { BundleStatus } from "@orrn/domain";
import { useT, type GuideSlug } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { GuideSheet } from "@orrn/ui/components/how-to-button";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { BookOpen, PackagePlus, Printer, RotateCcw, Ban } from "lucide-react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";

import { Can } from "@/shared/components/can";
import { trpc } from "@/shared/utils/trpc";

import { AddToDispatchSheet } from "./add-to-dispatch-sheet";
import { reprintErrorKey } from "./format";
import { TransitionDialog } from "./transition-dialog";

/**
 * What a person can do with a bundle (spec §3 `/b/:serial`), each behind the
 * same permission the server checks: Add to dispatch (`dispatch.addBundle`,
 * in stock only), Reprint label (`spool.create_jobs`, not for void bundles),
 * Void or Restore (`bundle.void`). On phones the main action is a 56px bar
 * above the tab bar; the rest sit in a row under the hero. `children` (the
 * facts and history) render between the row and the two guide buttons, then
 * the phone bar, so the bar comes last in both the reading order and on screen.
 */
export function BundleActions({
  bundle,
  description,
  children,
}: {
  bundle: { id: string; serial: string; status: BundleStatus };
  description: string;
  children?: ReactNode;
}) {
  const { t } = useT();
  const queryClient = useQueryClient();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [transitionOpen, setTransitionOpen] = useState(false);

  const canAdd = bundle.status === "available";
  const canReprint = bundle.status !== "void";
  const transitionTo = bundle.status === "available" ? "void" : bundle.status === "void" ? "available" : null;

  const reprint = useMutation(
    trpc.spool.printBundleLabel.mutationOptions({
      onSuccess: () => toast.success(t("stock.reprintSent")),
      onError: (error) => toast.error(t(reprintErrorKey(error))),
    }),
  );

  const refresh = () => {
    // Status changed: the bundle, every stock list and the stock charts move with it.
    for (const key of [
      trpc.bundle.getBySerial.queryKey(),
      trpc.bundle.listBundles.queryKey(),
      trpc.bundle.stockSummary.queryKey(),
      trpc.analytics.stockAgeing.queryKey(),
      trpc.dashboard.today.queryKey(),
    ]) {
      void queryClient.invalidateQueries({ queryKey: key });
    }
  };

  const addButton = (className?: string) => (
    <Button size="lg" className={className} onClick={() => setSheetOpen(true)} aria-haspopup="dialog">
      <PackagePlus aria-hidden="true" strokeWidth={2} />
      {t("bundle.addToDispatch")}
    </Button>
  );

  return (
    <>
      <div role="group" aria-label={t("bundle.actionsLabel")} className="flex flex-wrap items-center gap-2" data-testid="bundle-actions">
        {canAdd ? <Can do="dispatch.addBundle">{addButton("max-md:hidden")}</Can> : null}
        {canReprint ? (
          <Can do="spool.create_jobs">
            <Button
              variant="secondary"
              loading={reprint.isPending}
              onClick={() => reprint.mutate({ bundleId: bundle.id })}
            >
              {reprint.isPending ? null : <Printer aria-hidden="true" strokeWidth={2} />}
              {t("bundle.reprint")}
            </Button>
          </Can>
        ) : null}
        {transitionTo ? (
          <Can do="bundle.void">
            <Button variant="secondary" onClick={() => setTransitionOpen(true)} aria-haspopup="dialog">
              {transitionTo === "void" ? (
                <Ban aria-hidden="true" strokeWidth={2} />
              ) : (
                <RotateCcw aria-hidden="true" strokeWidth={2} />
              )}
              {t(transitionTo === "void" ? "bundle.void" : "bundle.restore")}
            </Button>
          </Can>
        ) : null}
      </div>

      {children}

      {/* Help after the facts: the action row stays actions only, and on phones the guides don't push the facts down. */}
      <div role="group" aria-label={t("nav.guides")} className="-mt-2 flex flex-wrap items-center gap-x-2" data-testid="bundle-guides">
        <GuideButton slug="reprint-label">{t("bundle.howToReprint")}</GuideButton>
        <GuideButton slug="void-bundle">{t("bundle.howToVoid")}</GuideButton>
      </div>

      {canAdd ? (
        <Can do="dispatch.addBundle">
          {/* Phones: the main action stays one thumb away, above the tab bar. */}
          <div className="sticky bottom-[calc(var(--shell-tabbar-offset)+8px)] z-10 rounded-card border border-border bg-card/95 p-2 shadow-md backdrop-blur-md md:hidden">
            {addButton("w-full")}
          </div>
          <AddToDispatchSheet open={sheetOpen} onOpenChange={setSheetOpen} serial={bundle.serial} description={description} />
        </Can>
      ) : null}
      {transitionTo ? (
        <TransitionDialog
          open={transitionOpen}
          onOpenChange={setTransitionOpen}
          bundleId={bundle.id}
          to={transitionTo}
          onDone={refresh}
        />
      ) : null}
    </>
  );
}

/** A quiet "How to ..." button that opens one guide. Named per guide, so two on a page never share a label. */
function GuideButton({ slug, children }: { slug: GuideSlug; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="ghost" className="px-4" aria-haspopup="dialog" onClick={() => setOpen(true)}>
        <BookOpen aria-hidden="true" strokeWidth={2} />
        {children}
      </Button>
      <GuideSheet slug={slug} open={open} onOpenChange={setOpen} />
    </>
  );
}

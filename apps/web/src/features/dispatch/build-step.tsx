import { formatKgTotal } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { useToastLift } from "@orrn/ui/hooks/use-toast-lift";
import { cn } from "@orrn/ui/lib/utils";
import { ClipboardPaste, ScanLine, Search, Sparkles } from "lucide-react";
import { useRef, type ReactNode } from "react";

import { Can } from "@/shared/components/can";

import { BundleGroups, type BundleGroupsProps } from "./bundle-groups";

export type AddActionsProps = {
  onScan(): void;
  onPaste(): void;
  onSearch(): void;
  /** Dispatch opened from a sales order (FP-PK-17): list this order's bundles, then plant stock of its dies. */
  onSuggest?(): void;
  /** Build: scanning is the main job (black pill). Hold: adding is the exception (quiet pills). */
  emphasis: "primary" | "quiet";
};

/** Scan bundles, Paste serials, Search to add. Floor-sized on phones; only for dispatch.addBundle. */
export function AddActions({ onScan, onPaste, onSearch, onSuggest, emphasis }: AddActionsProps) {
  const { t } = useT();
  return (
    <Can do="dispatch.addBundle">
      <div className="grid min-w-0 grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
        <Button
          variant={emphasis === "primary" ? "primary" : "secondary"}
          size={emphasis === "primary" ? "lg" : "md"}
          className={cn("col-span-2 sm:col-auto", emphasis === "quiet" && "max-sm:h-14")}
          onClick={onScan}
          aria-haspopup="dialog"
        >
          <ScanLine aria-hidden="true" strokeWidth={2} />
          {t("dispatch.build.scanBundles")}
        </Button>
        <Button variant="secondary" className="max-sm:h-14 max-sm:px-3" onClick={onPaste} aria-haspopup="dialog">
          <ClipboardPaste aria-hidden="true" strokeWidth={2} />
          {t("dispatch.build.pasteSerials")}
        </Button>
        <Button variant="secondary" className="max-sm:h-14 max-sm:px-3" onClick={onSearch} aria-haspopup="dialog">
          <Search aria-hidden="true" strokeWidth={2} />
          {t("dispatch.build.searchAdd")}
        </Button>
        {onSuggest ? (
          <Button variant="secondary" className="col-span-2 max-sm:h-14 max-sm:px-3 sm:col-auto" onClick={onSuggest} aria-haspopup="dialog" data-suggest-open="">
            <Sparkles aria-hidden="true" strokeWidth={2} />
            {t("dispatch.suggest.button")}
          </Button>
        ) : null}
      </div>
    </Can>
  );
}

export type ItemsSectionProps = BundleGroupsProps;

/**
 * "Bundles in this dispatch": the grouped list, or an empty state that points
 * at the first scan (no button of its own: Scan bundles sits right above it).
 */
export function ItemsSection(props: ItemsSectionProps) {
  const { t } = useT();
  return (
    <section aria-labelledby="dispatch-items" className="flex min-w-0 flex-col gap-3">
      <h2 id="dispatch-items" tabIndex={-1} className="m-0 text-[17px] font-semibold tracking-[-0.01em] focus:outline-none">
        {t("dispatch.build.bundlesIn")}
      </h2>
      {props.items.length === 0 ? (
        <div className="rounded-card border border-border bg-card">
          <EmptyState title={t("dispatch.build.empty")} />
        </div>
      ) : (
        <BundleGroups {...props} />
      )}
    </section>
  );
}

/**
 * The flow's sticky action bar: running totals on the left, the next steps on
 * the right. It sits above the phone tab bar and stays in reach while the
 * list scrolls. `note` explains why the actions are off (an empty dispatch).
 * Toasts are lifted above it while it is on screen.
 */
export function ActionBar({
  bundles,
  weightG,
  note,
  children,
}: {
  bundles: number;
  weightG: number;
  note?: string;
  children: ReactNode;
}) {
  const { t } = useT();
  const ref = useRef<HTMLDivElement>(null);
  // Toasts ("Stock held", "Removed") rise above the bar instead of covering Dispatch.
  useToastLift(ref);
  return (
    <div
      ref={ref}
      data-slot="dispatch-action-bar"
      className="sticky bottom-[calc(var(--shell-tabbar-offset)+12px)] z-20 flex min-w-0 flex-col gap-2 rounded-card border border-border bg-card/95 p-2.5 shadow-md backdrop-blur-md sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:p-3 sm:pl-5"
    >
      <div className="flex min-w-0 flex-col px-1.5 sm:px-0">
        <p data-no-truncate="" className="m-0 text-[15px] font-semibold tabular-nums">
          {t("units.bundlesKg", { bundles, kg: formatKgTotal(weightG / 1000) })}
        </p>
        {note ? (
          <p id="dispatch-action-note" className="m-0 text-[13px] text-muted-foreground">
            {note}
          </p>
        ) : null}
      </div>
      <div className="grid min-w-0 grid-cols-2 gap-2 sm:flex sm:shrink-0">{children}</div>
    </div>
  );
}

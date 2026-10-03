import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { Layers, PackageOpen, Users } from "lucide-react";
import { useId, useState, type ComponentType } from "react";

import { ImportSheet } from "@/features/imports/import-sheet";
import type { ImportKind } from "@/features/imports/parse";
import { Can } from "@/shared/components/can";
import { can, useMe, type Action } from "@/shared/lib/me";

type ImportRow = {
  kind: ImportKind;
  action: Action;
  icon: ComponentType<{ className?: string; strokeWidth?: number; "aria-hidden"?: boolean }>;
  title: "settings.data.importBundles" | "settings.data.importDies" | "settings.data.importCustomers";
  body: "settings.data.bundlesBody" | "settings.data.diesBody" | "settings.data.customersBody";
};

const ROWS: readonly ImportRow[] = [
  { kind: "bundles", action: "bundle.import", icon: PackageOpen, title: "settings.data.importBundles", body: "settings.data.bundlesBody" },
  { kind: "dies", action: "die.import", icon: Layers, title: "settings.data.importDies", body: "settings.data.diesBody" },
  { kind: "customers", action: "customer.import", icon: Users, title: "settings.data.importCustomers", body: "settings.data.customersBody" },
];

/**
 * Settings → Data: one row per import (old bundles, dies, customers), each
 * opening the import sheet. Only rows the person's role can run are shown
 * (`<Can>` per row; the filter only decides the empty state) and the server
 * checks again on every call.
 */
export function DataTab() {
  const { t } = useT();
  const { data: me, isPending } = useMe();
  // The kind stays set after closing so the sheet keeps its title while it slides away.
  const [kind, setKind] = useState<ImportKind>("bundles");
  const [open, setOpen] = useState(false);
  const rows = ROWS.filter((r) => can(me, r.action));

  if (isPending) {
    return (
      <div data-slot="data-tab" aria-busy="true" className="flex flex-col gap-4">
        <Skeleton className="h-6 w-full max-w-[520px]" />
        <Skeleton className="h-[244px] rounded-card" />
      </div>
    );
  }

  return (
    <div data-slot="data-tab" className="flex flex-col gap-4">
      <p className="m-0 max-w-[680px] text-[15px] leading-6 text-muted-foreground">{t("settings.data.hint")}</p>
      {rows.length === 0 ? (
        <p className="m-0 rounded-card border border-border bg-card px-5 py-4 text-[15px] leading-6 text-foreground">
          {t("settings.data.noAccess")}
        </p>
      ) : (
        <ul className="m-0 flex list-none flex-col divide-y divide-border overflow-hidden rounded-card border border-border bg-card p-0">
          {rows.map((row) => (
            <Can key={row.kind} do={row.action}>
              <ImportRowItem
                row={row}
                onOpen={() => {
                  setKind(row.kind);
                  setOpen(true);
                }}
              />
            </Can>
          ))}
        </ul>
      )}
      <ImportSheet kind={kind} open={open} onOpenChange={setOpen} />
    </div>
  );
}

function ImportRowItem({ row, onOpen }: { row: ImportRow; onOpen(): void }) {
  const { t } = useT();
  const titleId = useId();
  const buttonId = useId();
  const Icon = row.icon;
  return (
    <li className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-4 gap-y-3 px-5 py-4 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center">
      <span aria-hidden="true" className="flex size-11 items-center justify-center rounded-full bg-surface-sunken text-foreground">
        <Icon className="size-5" strokeWidth={2} aria-hidden />
      </span>
      <div className="min-w-0">
        <h2 id={titleId} className="m-0 font-display text-[17px] font-bold leading-tight tracking-[-0.02em] break-words text-foreground">
          {t(row.title)}
        </h2>
        <p className="m-0 mt-1 text-[14px] leading-5 break-words text-muted-foreground">{t(row.body)}</p>
      </div>
      <Button
        id={buttonId}
        variant="secondary"
        aria-labelledby={`${buttonId} ${titleId}`}
        onClick={onOpen}
        className="col-start-2 justify-self-start sm:col-start-auto sm:justify-self-end"
      >
        {t("settings.data.chooseFile")}
      </Button>
    </li>
  );
}

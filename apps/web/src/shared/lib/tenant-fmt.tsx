import { createElement, useEffect, type ReactNode } from "react";

import Loader from "@/shared/components/loader";

import { FmtProvider } from "./fmt";
import { useMe } from "./me";
import { clearExpectedPlant, unitsBelongTo, useExpectedPlant } from "./plant-sync";

/**
 * The signed-in plant's set, from `auth.me`. Mounted once in the tenant frame.
 *
 * The provider is keyed on the company id, so a plant switch builds a fresh one, and the frame's content renders only
 * when the units in hand belong to the plant the person switched to (`plant-sync.ts`): until `me` has been read again
 * the existing loading state shows, so no value and no entry box ever carries the previous plant's unit.
 */
export function TenantFmtProvider({ children }: { children: ReactNode }) {
  const { data: me, isError } = useMe();
  const expected = useExpectedPlant();
  const settings = me?.company?.settings as { timezone?: unknown } | undefined;
  const zone = typeof settings?.timezone === "string" && settings.timezone ? settings.timezone : null;
  const companyId = me?.company?.id ?? null;
  const ready = unitsBelongTo(expected, companyId);

  useEffect(() => {
    if (expected !== null && companyId === expected) clearExpectedPlant();
  }, [expected, companyId]);

  useEffect(() => {
    // `me` could not be read after the switch: the old units must not come back, so start the page afresh.
    if (expected !== null && isError) window.location.reload();
  }, [expected, isError]);

  return createElement(FmtProvider, {
    key: companyId ?? "none",
    prefs: me?.company?.units,
    timeZone: zone,
    children: ready ? children : createElement("div", { className: "flex min-h-[100dvh] items-center justify-center" }, createElement(Loader)),
  });
}

import { createElement, useEffect, useRef, type ReactNode } from "react";

import Loader from "@/shared/components/loader";
import { FmtProvider } from "@/shared/lib/fmt";
import { clearExpectedPlant, unitsBelongTo, useExpectedPlant } from "@/shared/lib/plant-sync";

import { usePortalMe } from "./hooks";

/**
 * The party's plant units for the portal frame (units layer). Keyed on the plant id, and after a plant switch
 * (`expectPlant`, `portal-shell.tsx`) the frame shows only its loading state until `portal.me` carries that plant's
 * units: the plant's queries are dropped at the switch, so for a moment the default words would otherwise stand over
 * the new plant's weights. `portal.me` is read again here once; if it still is not the awaited plant, or fails, the
 * page starts afresh.
 */
export function PortalFmtProvider({ children }: { children: ReactNode }) {
  const me = usePortalMe();
  const expected = useExpectedPlant();
  const heldId = me.data?.company.id ?? null;
  const ready = unitsBelongTo(expected, heldId);
  const asked = useRef(false);
  const { isFetching, isError, refetch } = me;

  useEffect(() => {
    if (expected === null) {
      asked.current = false;
      return;
    }
    if (heldId === expected) {
      clearExpectedPlant();
      return;
    }
    if (isFetching) return;
    if (isError || asked.current) {
      window.location.reload();
      return;
    }
    asked.current = true;
    void refetch();
  }, [expected, heldId, isFetching, isError, refetch]);

  return createElement(FmtProvider, {
    key: heldId ?? "none",
    prefs: me.data?.units,
    timeZone: me.data?.timeZone,
    children: ready ? children : createElement("div", { className: "flex min-h-[100dvh] items-center justify-center" }, createElement(Loader)),
  });
}

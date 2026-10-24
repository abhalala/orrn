import { readFloorSettings } from "@orrn/domain";
import { useEffect, useMemo, useState } from "react";

import { can, useMe } from "@/shared/lib/me";

/** The plant's floor settings (rates on orders, weight bands) from the signed-in company. */
export function useFloor() {
  const me = useMe();
  const settings = me.data?.company?.settings;
  return useMemo(() => readFloorSettings(settings), [settings]);
}

/** Whether the order form should ask for a rate: the plant shows rates and this person may price. */
export function useShowRates(): boolean {
  const me = useMe();
  const floor = useFloor();
  return floor.priceOnSalesOrder && can(me.data, "order.price");
}

/** `value`, but only after it stopped changing for `ms` (a quote is asked for once typing pauses). */
export function useDebounced<T>(value: T, ms = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

/** Whether the window is at least `px` wide (re-evaluated when it is resized). */
export function useMinWidth(px: number): boolean {
  const query = `(min-width: ${px}px)`;
  const [wide, setWide] = useState(() => (typeof window === "undefined" ? true : window.matchMedia(query).matches));
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setWide(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return wide;
}

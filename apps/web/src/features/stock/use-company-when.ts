import { useCallback } from "react";

import { useFmt } from "@/shared/lib/fmt";
import { whenText } from "@/shared/lib/fmt-text";

/**
 * "3 Oct, 14:20" in the plant's date order and clock, in the plant's zone (`settings.timezone`) and the UI language.
 * Under the default set it is the text `formatWhen` wrote (`fmt-text.test.ts` runs both).
 */
export function useCompanyWhen(): (at: string | number | Date) => string {
  const fmt = useFmt();
  return useCallback((at) => whenText(fmt, at), [fmt]);
}

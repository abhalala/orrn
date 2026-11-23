import type { Messages } from "../en";
import type { DeepPartial } from "../gu";

/**
 * Gujarati for the XE parity lane MAINT words that sit in a floor namespace: the nav entry. The `maint`
 * screens fall back to English. Needs a native-speaker review, like the other gu-more files.
 */
export const guMaint = {
  nav: {
    maintenance: "જાળવણી",
  },
} satisfies DeepPartial<Messages>;

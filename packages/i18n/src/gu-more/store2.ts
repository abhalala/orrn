import type { Messages } from "../en";
import type { DeepPartial } from "../gu";

/**
 * Gujarati, XE store. `store2` is an office namespace (English in gu on purpose); only the nav entry is a
 * floor word, because `nav` is in GU_FLOOR_NAMESPACES. Needs a native-speaker review like the rest of gu.
 */
export const guStore2 = {
  nav: {
    storeBuying: "સ્ટોર ખરીદ",
  },
} satisfies DeepPartial<Messages>;

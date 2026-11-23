import type { Messages } from "../en";
import type { DeepPartial } from "../gu";

/**
 * Gujarati for the XE parity lane REG words that sit in a floor namespace: the two nav entries. The `reg`
 * screens are office screens and fall back to English. Needs a native-speaker review, like the other gu-more files.
 */
export const guReg = {
  nav: {
    complaints: "ફરિયાદો",
    owner: "માલિક",
  },
} satisfies DeepPartial<Messages>;

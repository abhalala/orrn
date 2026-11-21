import type { MessageKey, Translate } from "@orrn/i18n";

import { CARD_INPUT_KEYS } from "./draft-card.input-keys";
import type { DraftField } from "./types";

/**
 * Words of the first build for keys outside the generated list (other input shapes Hermes may send, and keys the card
 * names in items). Kept so a draft made before a procedure changed still reads in the person's language.
 */
const OLDER_KEYS = ["rowIds", "expectCount", "decision", "matchId", "pageId", "orderId", "serial", "quantity"] as const;

/**
 * Input keys the card names in the person's language (delta round S4, decision 5): every top-level key of every
 * mutation Buddy may draft (`draft-card.input-keys.ts`, generated from the server registry) plus the older words.
 * Each has `buddy.field.<key>` in en, hi and gu (`draft-card.test.tsx` walks them).
 */
export const FIELD_WORD_KEYS: ReadonlySet<string> = new Set<string>([...CARD_INPUT_KEYS, ...OLDER_KEYS]);

/** The name of an input field: the app's word for a known key (a Set, so a prototype name is never a key), else the server's label. */
export function fieldLabel(t: Translate, field: Pick<DraftField, "key" | "label">): string {
  return FIELD_WORD_KEYS.has(field.key) ? t(`buddy.field.${field.key}` as MessageKey) : field.label;
}

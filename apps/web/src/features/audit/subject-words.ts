/**
 * BACKLOG 100: what an audit row's subject is called and where it opens. Its own module: only the audit rows import it,
 * so the route's `validateSearch` (which imports `model.ts`) keeps this out of the app entry.
 */
import type { MessageKey } from "@orrn/i18n";

import { humanKey } from "./model";

/** Subject types with words (`audit.subjectTypes.<type>`) and the screen that shows one of them. */
const SUBJECT_PATHS: Readonly<Record<string, (id: string) => string>> = {
  sales_order: (id) => `/orders/${id}`,
  dispatch: (id) => `/dispatch/${id}`,
  packing_list: (id) => `/packing-lists/${id}`,
  press_run: (id) => `/press/runs/${id}`,
  press_plan: (id) => `/orders/plan/${id}`,
  die_instance: (id) => `/dies/copies/${id}`,
  die: (id) => `/dies/${id}`,
  customer: (id) => `/customers/${id}`,
  vendor: (id) => `/vendors/${id}`,
  bundle: (id) => `/bundles/${id}`,
  cast: (id) => `/casts/${id}`,
  purchase_lot: (id) => `/purchase/${id}`,
  count_session: (id) => `/stock/count/${id}`,
};

export const AUDIT_SUBJECT_TYPES = Object.keys(SUBJECT_PATHS);

/** The screen for a subject, or null when the type has none. */
export function subjectPath(subjectType: string, subjectId: string | null): string | null {
  if (!subjectId) return null;
  const path = SUBJECT_PATHS[subjectType];
  return path ? path(encodeURIComponent(subjectId)) : null;
}

/** The i18n key for a subject type's words, or null when it has none (`humanKey` of the type is shown instead). */
export function subjectTypeKey(subjectType: string): MessageKey | null {
  return SUBJECT_PATHS[subjectType] ? (`audit.subjectTypes.${subjectType}` as MessageKey) : null;
}

/** "Packing list" for `packing_list` when no translation exists. */
export function subjectTypeFallback(subjectType: string): string {
  return humanKey(subjectType);
}

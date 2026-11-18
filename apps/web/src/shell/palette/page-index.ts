import type { MessageKey } from "@orrn/i18n";

/**
 * Keyword alternatives and the main words inside each page (owner decision 2026-11-18). Interface stub: lane SEARCH
 * fills both tables from the route files and dictionaries.
 */

/** Extra words that find a nav page, keyed by nav item `key` (nav-items.ts). */
export const PAGE_ALIASES: Readonly<Record<string, readonly string[]>> = {};

export type PageSection = {
  /** Unique, e.g. "foundry.melt-times". */
  id: string;
  /** Nav item `key` this section belongs to; it inherits that item's permission and module gating. */
  parentKey: string;
  /** Label: a dictionary key when one exists, else plain English. */
  labelKey?: MessageKey;
  label?: string;
  /** Route path the page already supports. */
  to: string;
  /** Search params the page already reads (tab ids), if any. */
  search?: Readonly<Record<string, string>>;
  /** Main words used inside this section, and its aliases. */
  terms: readonly string[];
};

export const PAGE_SECTIONS: readonly PageSection[] = [];

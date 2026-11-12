/** The shapes the die room's route files read from the URL, in a module with no imports (route files run in the app entry). */
export type CopyStatus = "available" | "in_use" | "at_nitriding" | "at_maker" | "retired" | "on_trial";

export const COPY_STATUSES: readonly CopyStatus[] = ["available", "in_use", "at_nitriding", "at_maker", "on_trial", "retired"];

/** Tabs of the die card, in the order the spec lists them. */
export const CARD_TABS = ["readings", "runs", "nitriding", "work", "tier", "maker", "files"] as const;
export type CardTab = (typeof CARD_TABS)[number];

/** `?tab=` from the URL: anything unknown is the first tab. Plain function (no zod in route files). */
export function cardTabParam(value: unknown): CardTab {
  return typeof value === "string" && (CARD_TABS as readonly string[]).includes(value) ? (value as CardTab) : "readings";
}

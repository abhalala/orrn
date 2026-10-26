import type { Locale } from "@orrn/i18n";

/**
 * Refusals are spoken at the gate (FP-PK-15): a clerk watching a truck hears "Not on a sales order" without
 * looking at the phone. Pure parts; lib/speak.ts drives the phone's speech engine.
 */
export const SPEECH_KEY = "orrn.scanSpeak";

const LANG_TAG: Record<Locale, string> = { en: "en-IN", hi: "hi-IN", gu: "gu-IN" };

/** The BCP 47 tag the speech engine is asked for, from the app language (the device language when the app follows it). */
export function speechLang(locale: string): string {
  return (LANG_TAG as Record<string, string>)[locale] ?? "en-IN";
}

/** Whether speech is on: it is, until the person turned it off. */
export function speechOn(stored: string | null | undefined): boolean {
  return stored !== "off";
}

export type ScanResultKind = "added" | "already" | "rejected" | "notFound" | "opened" | "error";

/** Calm results are never spoken: a refusal, a miss or a failure is. */
export function isSpoken(kind: ScanResultKind): boolean {
  return kind === "rejected" || kind === "notFound" || kind === "error";
}

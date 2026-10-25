/**
 * Refusals are spoken at the gate (FP-PK-15): a clerk watching the truck hears "Not on a sales order"
 * without looking at the phone. The browser's speech synthesis does the talking, in the screen's
 * language; nothing is spoken when the browser has none, when the person turned it off, or for the
 * calm outcomes (added, already added). Storage failing (private mode) leaves it on.
 */
const KEY = "orrn.scanSpeak";

const LANG_TAG: Record<string, string> = { en: "en-IN", hi: "hi-IN", gu: "gu-IN" };

/** The BCP 47 tag for a locale code. */
export function speechLang(locale: string): string {
  return LANG_TAG[locale] ?? "en-IN";
}

/** Whether speech is on (default on). */
export function speechOn(storage: Pick<Storage, "getItem"> | null): boolean {
  try {
    return storage?.getItem(KEY) !== "off";
  } catch {
    return true;
  }
}

export function setSpeechOn(storage: Pick<Storage, "setItem"> | null, on: boolean): void {
  try {
    storage?.setItem(KEY, on ? "on" : "off");
  } catch {
    // The choice holds for this visit only.
  }
}

function store(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function isSpeechOn(): boolean {
  return speechOn(store());
}

export function toggleSpeech(on: boolean): void {
  setSpeechOn(store(), on);
}

/** Speak `text` in `locale` (cancels what is still being said). False when nothing was spoken. */
export function speak(text: string, locale: string): boolean {
  if (!isSpeechOn() || !text.trim()) return false;
  try {
    const synth = typeof window === "undefined" ? undefined : window.speechSynthesis;
    if (!synth || typeof SpeechSynthesisUtterance === "undefined") return false;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = speechLang(locale);
    u.rate = 1;
    synth.speak(u);
    return true;
  } catch {
    return false;
  }
}

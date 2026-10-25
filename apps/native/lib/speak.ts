import * as Speech from "expo-speech";
import * as SecureStore from "expo-secure-store";

import { isSpoken, SPEECH_KEY, speechLang, speechOn, type ScanResultKind } from "./speech";

let on: boolean | null = null;

/** Whether refusals are spoken (default on); read once from the phone's keychain, which failing leaves it on. */
export function isSpeechOn(): boolean {
  if (on === null) {
    try {
      on = speechOn(SecureStore.getItem(SPEECH_KEY));
    } catch {
      on = true;
    }
  }
  return on;
}

export function setSpeechOn(next: boolean): void {
  on = next;
  SecureStore.setItemAsync(SPEECH_KEY, next ? "on" : "off").catch(() => {});
  if (!next) void Speech.stop();
}

/** Say `text` in the app language (cancelling what is still being said) when the result is a refusal and speech is on. */
export function speakResult(kind: ScanResultKind, text: string, locale: string): boolean {
  if (!isSpeechOn() || !isSpoken(kind) || !text.trim()) return false;
  try {
    void Speech.stop();
    Speech.speak(text, { language: speechLang(locale), rate: 1 });
    return true;
  } catch {
    return false;
  }
}

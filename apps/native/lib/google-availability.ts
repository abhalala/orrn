import { Platform } from "react-native";

import { googleAvailableOn } from "./google-flow";

/**
 * The one gate for "Continue with Google" on the phone: the stage has Google and this is iOS (ephemeral
 * auth session). Android hides it until an ephemeral Custom Tab path exists (`googleAvailableOn`).
 * Every native screen that offers Google asks this.
 */
export function googleAvailableOnThisPlatform(methods: { google?: boolean } | undefined): boolean {
  return googleAvailableOn(methods, Platform.OS);
}

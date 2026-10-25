import type { Translate } from "@orrn/i18n";

import { serverRefusalLines } from "@/features/shared/server-refusal";

import { blockerText } from "./view";

/**
 * What to tell someone when an orders write was refused: lines, in their language. Every sentence the
 * orders and press plan routers can raise has a `refusal.*` key (shared with the phone, see
 * features/shared/server-refusal.ts); a confirm that is not complete lists what each line still needs;
 * a sentence this build does not know shows the generic line, never the server's English.
 */
export function orderErrorLines(t: Translate, error: unknown): string[] {
  return serverRefusalLines(t, error, (code) => blockerText(code, t));
}

export function orderErrorText(t: Translate, error: unknown): string {
  return orderErrorLines(t, error).join(" ");
}

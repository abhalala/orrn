import { env } from "@orrn/env/native";

import { joinWebUrl } from "./web-link";

// Metro only inlines a literal `process.env.EXPO_PUBLIC_X` (see packages/env/src/native.ts).
const WEB_URL = process.env.EXPO_PUBLIC_WEB_URL;

/** Full address of a web page for this build. */
export function webUrl(path: string): string {
  return joinWebUrl(WEB_URL && WEB_URL.trim() !== "" ? WEB_URL : env.EXPO_PUBLIC_SERVER_URL, path);
}

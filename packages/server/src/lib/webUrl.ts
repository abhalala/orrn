import { env } from "@orrn/env/server";

/** Public base URL of the web app (no trailing slash), for links inside emails. */
export function webBaseUrl(): string {
  return (env.WEB_PUBLIC_URL ?? env.CORS_ORIGIN).replace(/\/+$/, "");
}

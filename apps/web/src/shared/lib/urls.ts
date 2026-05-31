import { env } from "@orrn/env/web";

const fallbackUrl = "http://localhost:3001";

/** App URL from Vite env (set per deploy target). */
export const appUrls = {
  /** Base URL of this unified web app. */
  self: env.VITE_PUBLIC_URL ?? fallbackUrl,
  api: env.VITE_SERVER_URL,
} as const;

/** Login URL with optional return-to path. */
export function marketingLoginUrl(returnTo: string): string {
  const url = new URL("/login", appUrls.self);
  url.searchParams.set("next", returnTo);
  return url.toString();
}
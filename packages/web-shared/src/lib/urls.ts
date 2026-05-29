import { env } from "@orrn/env/web";

const fallbackMarketing = "http://localhost:3001";
const fallbackErp = "http://localhost:3002";
const fallbackStaff = "http://localhost:3003";

/** Cross-app URLs from Vite env (set per deploy target). */
export const appUrls = {
  marketing: env.VITE_MARKETING_URL ?? fallbackMarketing,
  erp: env.VITE_ERP_URL ?? fallbackErp,
  staff: env.VITE_STAFF_URL ?? fallbackStaff,
  api: env.VITE_SERVER_URL,
} as const;

export function marketingLoginUrl(returnTo: string): string {
  const url = new URL("/login", appUrls.marketing);
  url.searchParams.set("next", returnTo);
  return url.toString();
}

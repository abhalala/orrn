/**
 * "Open on the web" (More, sign-in): the pages that stay on the web. The web app's address is
 * `EXPO_PUBLIC_WEB_URL`; when a build does not set it, the server address is used (one host in
 * production). Pure so the join is unit-tested.
 */
export function joinWebUrl(base: string, path: string): string {
  const root = base.trim().replace(/\/+$/, "");
  const rest = path.startsWith("/") ? path : `/${path}`;
  return `${root}${rest}`;
}

/** A settings tab on the web: `/settings?tab=team`. */
export function settingsTabPath(tab: "team" | "shifts" | "standards" | "backup"): string {
  return `/settings?tab=${tab}`;
}

export const FORGOT_PASSWORD_PATH = "/forgot-password";

export type WebLinkKey = "team" | "shifts" | "standards" | "backup";

/**
 * The rows under "Open on the web", by the permission matrix: team, shifts and standards are read by
 * every member; backup needs settings.update (the Backup tab is hidden from everyone else).
 */
export function webLinkRows(canUpdateSettings: boolean): { key: WebLinkKey; path: string }[] {
  const rows: { key: WebLinkKey; path: string }[] = [
    { key: "team", path: settingsTabPath("team") },
    { key: "shifts", path: settingsTabPath("shifts") },
    { key: "standards", path: settingsTabPath("standards") },
  ];
  if (canUpdateSettings) rows.push({ key: "backup", path: settingsTabPath("backup") });
  return rows;
}

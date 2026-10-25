import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, type Page } from "@playwright/test";

import { API_URL, WEB_ORIGIN } from "./ports";

/**
 * Local seed accounts (owner/operator/viewer/office/staff @orrn.local). The shared
 * password comes from ORRN_LOCAL_PASSWORD or, by default, from
 * `apps/server/.dev.local-account.local` (written by
 * `bun apps/server/scripts/write-local-accounts.ts`). Local D1 only.
 */
export function localPassword(): string {
  if (process.env.ORRN_LOCAL_PASSWORD) return process.env.ORRN_LOCAL_PASSWORD;
  const file = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../../../server/.dev.local-account.local");
  const line = readFileSync(file, "utf8")
    .split("\n")
    .find((l) => l.startsWith("ORRN_LOCAL_PASSWORD="));
  if (!line) throw new Error(`ORRN_LOCAL_PASSWORD missing in ${file}`);
  return line.slice("ORRN_LOCAL_PASSWORD=".length).trim();
}

export type LocalRole = "owner" | "operator" | "viewer" | "office" | "supervisor" | "press" | "staff";

/**
 * Fill and submit the real sign-in form on the current /login page. Labels
 * are matched exactly: the password field's "Show password" toggle also
 * contains the word.
 */
export async function signInViaForm(page: Page, role: LocalRole) {
  await page.getByLabel("Email", { exact: true }).fill(`${role}@orrn.local`);
  await page.getByLabel("Password", { exact: true }).fill(localPassword());
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

/** Start a signed-in browser context cookie without the UI (tests that are not about the login screen). */
export async function signInViaApi(page: Page, role: LocalRole) {
  const apiURL = API_URL;
  const origin = WEB_ORIGIN;
  const res = await page.context().request.post(`${apiURL}/api/auth/sign-in/email`, {
    headers: { origin },
    data: { email: `${role}@orrn.local`, password: localPassword() },
  });
  expect(res.ok(), `sign-in as ${role} returned ${res.status()}`).toBe(true);
}

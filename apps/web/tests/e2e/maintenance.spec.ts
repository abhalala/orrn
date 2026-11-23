import { expect, test } from "@playwright/test";

import { signInViaApi } from "./helpers/accounts";
import { ownerApi } from "./helpers/owner-api";

/**
 * XE parity lane MAINT, the main flow: a machine on the register, a breakdown work order raised by hand,
 * started and marked done, then seen in the machine's service history. The spec owns its asset (a unique code).
 */
test("an owner raises a breakdown work order, starts it, marks it done and sees it in the history", async ({ page }) => {
  const api = await ownerApi();
  const code = `E2E-CMP-${Date.now().toString(36).toUpperCase()}`;
  const asset = await api.mutate<{ id: string }>("maint.assets.create", { code, name: "E2E compressor", kind: "compressor", criticality: "B", status: "running" });
  await api.dispose();

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await signInViaApi(page, "owner");

  await page.goto("/maintenance");
  await expect(page.getByRole("heading", { level: 1, name: "Maintenance" })).toBeVisible();
  await page.getByRole("link", { name: "Work orders", exact: true }).click();
  await expect(page).toHaveURL(/\/maintenance\/work-orders$/);

  await page.getByRole("button", { name: "New work order" }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByLabel("Machine").locator("option", { hasText: code })).toHaveCount(1);
  await sheet.getByLabel("Machine").selectOption({ label: `${code} E2E compressor` });
  await sheet.getByLabel("What is wrong").fill("Trips on start");
  await sheet.getByRole("button", { name: "Make work order" }).click();

  await expect(page).toHaveURL(/\/maintenance\/work-orders\/[^/]+$/);
  const moves = page.getByTestId("wo-moves");
  await moves.getByRole("button", { name: "Start work" }).click();
  await expect(moves.getByRole("button", { name: "Wait for spares" })).toBeVisible();
  await moves.getByRole("button", { name: "Mark done" }).click();
  const done = page.getByRole("dialog");
  await done.getByLabel("What was done").fill("Contactor replaced");
  await done.getByRole("button", { name: "Mark done" }).click();
  await expect(page.getByTestId("wo-moves")).toHaveCount(0);
  await expect(page.getByText("Done", { exact: true }).first()).toBeVisible();

  await page.goto(`/maintenance/assets/${asset.id}`);
  await expect(page.getByText("Trips on start")).toBeVisible();
});

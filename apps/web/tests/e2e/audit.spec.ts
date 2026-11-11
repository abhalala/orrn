import { expect, test, type Page } from "@playwright/test";

import { signInViaApi, type LocalRole } from "./helpers/accounts";
import { m, makeParty } from "./helpers/orders-api";

async function open(page: Page, role: LocalRole, path: string) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await signInViaApi(page, role);
  await page.goto(path);
  await expect(page.locator("main#main h1").first()).toBeVisible();
}

test("an owner reads recent audit rows, filters a subject and opens its record", async ({ page }) => {
  await signInViaApi(page, "owner");
  const party = await makeParty(page, "Audit");

  try {
    await open(page, "owner", "/audit");
    await expect(page.getByRole("heading", { level: 1, name: "Audit log" })).toBeVisible();
    const list = page.getByTestId("audit-list");
    await expect(list).toContainText(party.name);
    await expect(list.locator('[data-audit-action="customer.create"]')).toBeVisible();

    await page.getByTestId("audit-subject").fill(party.id);
    await page.getByTestId("audit-subject").press("Enter");
    await expect(page).toHaveURL(new RegExp(`subject=${party.id}`));
    const subject = list.locator('[data-audit-subject="customer"]').filter({ hasText: party.name });
    await expect(subject).toBeVisible();
    await expect(list.locator("[data-audit-subject]")).toHaveCount(1);

    await subject.getByRole("link", { name: party.name, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/customers/${party.id}$`));
    await expect(page.getByRole("heading", { level: 1, name: party.name })).toBeVisible();
  } finally {
    await m(page, "customer.delete", { id: party.id }).catch(() => undefined);
  }
});

test("a role without audit access has no nav entry and is refused on the URL", async ({ page }) => {
  await open(page, "viewer", "/today");
  await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Audit log" })).toHaveCount(0);

  await page.goto("/audit");
  await expect(page.getByText("Your role can't read the audit log.")).toBeVisible();
  await expect(page.getByTestId("audit-filters")).toHaveCount(0);
});

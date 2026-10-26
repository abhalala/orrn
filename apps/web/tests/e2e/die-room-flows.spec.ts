import { expect, type Page } from "@playwright/test";

import { test } from "./helpers/test";
import { signInViaApi } from "./helpers/accounts";
import { ownerApi, type OwnerApi } from "./helpers/owner-api";
import { expectNoHorizontalScroll } from "../helpers/layout-guards";

/**
 * Die room flows (BACKLOG 19): sending a copy to a die maker and receiving it back, and sending a copy
 * to nitriding and back. Each width makes its own copy on a section no other spec reads (Tee 13072 for
 * the maker, Angle 11262 for nitriding), through the owner API, so parallel widths never share one, and
 * retires it afterwards. The maker is made per width too. The nitriding sheet sends open and used only;
 * the server works out what is left (BACKLOG 19), and the card shows it.
 */

const WIDTHS = [375, 820, 1280] as const;
const run = Date.now().toString(36).slice(-5).toUpperCase();

async function open(page: Page, path: string, width: number) {
  await page.setViewportSize({ width, height: 900 });
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await signInViaApi(page, "dieroom");
  await page.goto(path);
  await expect(page.locator("[data-slot='app-shell']")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("main#main h1")).toBeVisible({ timeout: 30_000 });
}

/** A copy on the rack of the section with this code. */
async function newCopy(api: OwnerApi, sectionCode: string) {
  const found = await api.query<{ items: { id: string; sectionCode: string }[] }>("die.list", { search: sectionCode, limit: 10, offset: 0 });
  const section = found.items.find((s) => s.sectionCode === sectionCode);
  expect(section, `section ${sectionCode} in the seed`).toBeDefined();
  const { id } = await api.mutate<{ id: string }>("dieInstance.create", { sectionId: section!.id, status: "available" });
  const card = await api.query<{ instance: { code: string } }>("dieInstance.get", { id });
  return { id, code: card.instance.code };
}

async function retire(api: OwnerApi, id: string) {
  // A copy back from the maker is on trial, one at nitriding must come back first: the cleanup is best effort.
  await api.mutate("dieInstance.update", { id, status: "retired" }).catch(() => undefined);
}

for (const width of WIDTHS) {
  test.describe(`die room flows at ${width}`, () => {
    test("maker: send a copy, see it out with the maker, receive it back on trial", async ({ page }) => {
      const api = await ownerApi();
      const copy = await newCopy(api, "13072");
      const makerName = `E2E maker ${width} ${run}`;
      await api.mutate("dieInstance.maker.create", { name: makerName, city: "Rajkot" });
      try {
        await open(page, `/dies/copies/${copy.id}`, width);
        await page.getByRole("tab", { name: "Maker" }).click();
        await expect(page.getByText("Not with a die maker")).toBeVisible();

        await page.getByRole("button", { name: "Send to maker" }).first().click();
        const send = page.getByRole("dialog");
        await expect(send).toBeVisible();
        await send.getByRole("combobox").first().click();
        await page.getByRole("option", { name: new RegExp(makerName) }).click();
        await send.getByRole("radio", { name: "Correction" }).click();
        await send.getByRole("button", { name: "Send to maker" }).click();
        await expect(send).toBeHidden();

        // Out with the maker: the job is open, the copy is "At die maker", and sending again is not offered.
        const job = page.getByTestId("maker-open-job");
        await expect(job).toBeVisible();
        await expect(job).toContainText(makerName);
        await expect(job).toContainText("Out with the maker");
        await expect(page.getByRole("button", { name: "Send to maker" })).toHaveCount(0);
        const status = await api.query<{ instance: { status: string } }>("dieInstance.get", { id: copy.id });
        expect(status.instance.status).toBe("at_maker");
        await expectNoHorizontalScroll(page);

        await job.getByRole("button", { name: "Receive" }).click();
        const receive = page.getByRole("dialog");
        await expect(receive).toBeVisible();
        await receive.getByRole("button", { name: "Receive" }).click();
        await expect(receive).toBeHidden();
        await expect(page.getByTestId("maker-open-job")).toHaveCount(0);
        // The copy came back (on trial while the plant setting is on, else on the rack) and the job is history.
        const back = await api.query<{ instance: { status: string } }>("dieInstance.get", { id: copy.id });
        expect(["on_trial", "available"]).toContain(back.instance.status);
        await expect(page.getByRole("heading", { name: "Earlier jobs" })).toBeVisible();
        await expect(page.getByRole("heading", { name: "Earlier jobs" }).locator("xpath=following-sibling::ul[1]")).toContainText(makerName);
        await expect(page.getByRole("heading", { name: "Earlier jobs" }).locator("xpath=following-sibling::ul[1]")).toContainText("Received");
        await expectNoHorizontalScroll(page);
      } finally {
        await retire(api, copy.id);
        await api.dispose();
      }
    });

    test("nitriding: out with open and used only, the server works out the close, then back with the HV", async ({ page }) => {
      const api = await ownerApi();
      const copy = await newCopy(api, "11262");
      try {
        await open(page, `/dies/copies/${copy.id}`, width);
        await page.getByRole("tab", { name: "Nitriding" }).click();
        await expect(page.getByText("No nitriding yet")).toBeVisible();

        await page.getByRole("button", { name: "Send to nitriding" }).first().click();
        const send = page.getByRole("dialog");
        await expect(send).toBeVisible();
        await send.getByLabel("HV before").fill("1050");
        const cr4 = send.getByRole("group", { name: "CR4" });
        await cr4.getByLabel("Open").fill("5000");
        await cr4.getByLabel("Used").fill("1200");
        // The sheet shows what is left; the server stores its own figure.
        await expect(cr4.getByText("5,000 - 1,200 = 3,800 g left")).toBeVisible();
        await send.getByRole("button", { name: "Send to nitriding" }).click();
        await expect(send).toBeHidden();

        await expect(page.getByText(`${copy.code} is out at nitriding`).first()).toBeVisible();
        await expect(page.getByText("open 5,000 g, used 1,200 g, close 3,800 g")).toBeVisible();
        await expect(page.getByText("HV 1050")).toBeVisible();
        expect((await api.query<{ instance: { status: string } }>("dieInstance.get", { id: copy.id })).instance.status).toBe("at_nitriding");
        // Out at nitriding: only "Back from nitriding" is offered.
        await expect(page.getByRole("button", { name: "Send to nitriding" })).toHaveCount(0);
        await expectNoHorizontalScroll(page);

        await page.getByRole("button", { name: "Back from nitriding" }).first().click();
        const back = page.getByRole("dialog");
        await back.getByLabel("HV after treatment").fill("1090");
        await back.getByRole("button", { name: "Back from nitriding" }).click();
        await expect(back).toBeHidden();
        await expect(page.getByText(`${copy.code} is back in the rack`).first()).toBeVisible();
        const after = await api.query<{ instance: { status: string; hardness: number | null } }>("dieInstance.get", { id: copy.id });
        expect(after.instance).toMatchObject({ status: "available", hardness: 1090 });
        await expect(page.getByRole("button", { name: "Send to nitriding" }).first()).toBeVisible();
        await expectNoHorizontalScroll(page);
      } finally {
        await retire(api, copy.id);
        await api.dispose();
      }
    });
  });
}

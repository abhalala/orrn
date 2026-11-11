import { expect, test, type Page } from "@playwright/test";

import { signInViaApi, type LocalRole } from "./helpers/accounts";
import { closeOrders, confirmedOrder, m, makeParty, packFor, q } from "./helpers/orders-api";
import { WEB_ORIGIN } from "./helpers/ports";

async function open(page: Page, role: LocalRole, path: string) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await signInViaApi(page, role);
  await page.goto(path);
  await expect(page.getByRole("heading", { level: 1, name: "Approvals" })).toBeVisible();
}

function requestCard(page: Page, serial: string) {
  return page.getByTestId("approval-card").filter({ hasText: serial });
}

test("a manager reviews off-band requests, the requester cannot decide, and decisions leave Pending", async ({ page, browser }) => {
  test.setTimeout(180_000);
  await open(page, "owner", "/approvals?kind=dispatch_off_band");

  const party = await makeParty(page, "Approvals");
  const order = await confirmedOrder(page, party.id, [{ pcs: 100 }]);
  const detail = await q<{ lines: { kgPer12ftMilli: number }[] }>(page, "orders.get", { id: order.id });
  const onBandKg = (detail.lines[0]!.kgPer12ftMilli * 10) / 1000;
  const serials = await packFor(page, order.lineIds[0]!, [onBandKg + 10, onBandKg + 25]);
  const dispatchIds: string[] = [];
  const managerContext = await browser.newContext({ baseURL: WEB_ORIGIN });
  const manager = await managerContext.newPage();

  try {
    for (const serial of serials) {
      const made = await m<{ id: string }>(page, "dispatch.create", { salesOrderId: order.id, vehicleNo: "GJ05AB1234" });
      dispatchIds.push(made.id);
      await m(page, "dispatch.addBundlesBySerial", { id: made.id, serials: [serial] });
    }

    await open(manager, "manager", "/approvals?kind=dispatch_off_band");
    await expect(manager.getByText("Waiting for a decision")).toBeVisible();
    const first = requestCard(manager, serials[0]!);
    await expect(first).toBeVisible();
    await first.getByRole("button", { name: /^Review/ }).click();
    const managerSheet = manager.getByRole("dialog");
    await expect(managerSheet.getByTestId("live-off-band")).toContainText(serials[0]!);
    await expect(managerSheet.getByRole("button", { name: "Approve" })).toBeEnabled();
    await manager.keyboard.press("Escape");
    await expect(managerSheet).toBeHidden();

    await page.reload();
    const ownCard = requestCard(page, serials[0]!);
    await expect(ownCard).toContainText("Someone else has to approve your request.");
    await ownCard.getByRole("button", { name: /^View/ }).click();
    const ownSheet = page.getByRole("dialog");
    await expect(ownSheet.getByText("Someone else has to approve your request.")).toBeVisible();
    await expect(ownSheet.getByRole("button", { name: "Approve" })).toHaveCount(0);
    await expect(ownSheet.getByRole("button", { name: "Reject" })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(ownSheet).toBeHidden();

    await first.getByRole("button", { name: /^Review/ }).click();
    await managerSheet.getByRole("button", { name: "Approve" }).click();
    await expect(managerSheet).toBeHidden();
    await expect(first).toHaveCount(0);
    await manager.goto("/approvals?status=approved&kind=dispatch_off_band");
    await expect(requestCard(manager, serials[0]!)).toContainText("Approved");

    await manager.goto("/approvals?kind=dispatch_off_band");
    const second = requestCard(manager, serials[1]!);
    await second.getByRole("button", { name: /^Review/ }).click();
    await expect(managerSheet.getByTestId("live-off-band")).toContainText(serials[1]!);
    await managerSheet.getByLabel("Note").fill("Check this bundle weight before it leaves");
    await managerSheet.getByRole("button", { name: "Reject" }).click();
    await expect(managerSheet).toBeHidden();
    await expect(second).toHaveCount(0);
    await manager.goto("/approvals?status=rejected&kind=dispatch_off_band");
    const rejected = requestCard(manager, serials[1]!);
    await expect(rejected).toContainText("Rejected");
    await expect(rejected).toContainText("Check this bundle weight before it leaves");
  } finally {
    await managerContext.close();
    for (const id of dispatchIds) await m(page, "dispatch.cancel", { id }).catch(() => undefined);
    await closeOrders(page, [order.id]);
  }
});

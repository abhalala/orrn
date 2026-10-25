import { expect, type Locator } from "@playwright/test";

/**
 * BACKLOG 62: the Dispatch sheet asks for the vehicle number when the header has none. Flows that
 * are not about the vehicle type one in; the sheet either asks or names the vehicle it has.
 */
export async function fillVehicleIfAsked(sheet: Locator, vehicleNo = "GJ05AB1234") {
  const field = sheet.getByTestId("dispatch-vehicle");
  const ready = sheet.getByTestId("dispatch-vehicle-ready");
  await expect(field.or(ready)).toBeVisible();
  if (await field.isVisible()) await field.fill(vehicleNo);
}

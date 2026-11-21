import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { FormActions } from "@orrn/ui/components/form-actions";
import { TOAST_LIFT_VAR } from "@orrn/ui/hooks/use-toast-lift";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";

import { installDom, settle } from "@/features/buddy/test-dom";

import { StickyBar } from "./sticky-bar";

const env = installDom();
beforeAll(() => env.install());
afterAll(() => env.uninstall());

async function liftWith(node: ReactNode): Promise<string> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(node));
  await settle();
  const lift = document.documentElement.style.getPropertyValue(TOAST_LIFT_VAR);
  await act(async () => root.unmount());
  host.remove();
  return lift;
}

/**
 * Buddy fix round S9: the closed Buddy button reads `--orrn-toast-bottom`. A pinned form bar must set it, or the button
 * sits on the bar's primary pill on a phone. A bar in the normal flow (a laptop) must not.
 */
describe("sticky bars lift the Buddy button and toasts", () => {
  test("FormActions, pinned, sets the lift; unmounted, it clears it", async () => {
    expect(await liftWith(<FormActions style={{ position: "sticky", bottom: "12px" }}>Save</FormActions>)).toMatch(/^\d+px$/);
    expect(document.documentElement.style.getPropertyValue(TOAST_LIFT_VAR)).toBe("");
  });

  test("FormActions in the normal flow sets nothing", async () => {
    expect(await liftWith(<FormActions style={{ position: "static" }}>Save</FormActions>)).toBe("");
  });

  test("a screen's own sticky bar (new lot, lot detail, bundle) sets the lift too", async () => {
    expect(await liftWith(<StickyBar style={{ position: "sticky", bottom: "12px" }}>Add</StickyBar>)).toMatch(/^\d+px$/);
    expect(await liftWith(<StickyBar style={{ position: "sticky", bottom: "12px", display: "none" }}>Add</StickyBar>)).toBe("");
  });
});

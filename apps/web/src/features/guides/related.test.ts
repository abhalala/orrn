import { describe, expect, test } from "bun:test";
import { en } from "@orrn/i18n/en";
import { GUIDE_SLUGS } from "@orrn/i18n/guides";
import type { Me } from "@orrn/server/lib/permissions";

import { RELATED_SCREENS, relatedScreensFor } from "./related";

function meAs(role: string): Me {
  return {
    user: { id: "u", name: "U", email: "u@orrn.local" },
    company: { id: "c", name: "C", slug: "c", status: "active", plan: null, role },
    isPlatformAdmin: false,
  } as unknown as Me;
}

describe("guide related screens", () => {
  test("every guide has at least one related screen", () => {
    for (const slug of GUIDE_SLUGS) expect(RELATED_SCREENS[slug].length).toBeGreaterThan(0);
  });

  test("every label key is a real English string", () => {
    const lookup = (key: string) => key.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], en);
    for (const slug of GUIDE_SLUGS)
      for (const screen of RELATED_SCREENS[slug]) expect(typeof lookup(screen.labelKey)).toBe("string");
  });

  test("a screen the role cannot open is not linked", () => {
    expect(relatedScreensFor("invite-member", meAs("viewer"))).toEqual([]);
    expect(relatedScreensFor("pack-session", meAs("viewer")).map((s) => s.to)).toEqual(["/stock/bundles"]);
    expect(relatedScreensFor("pack-session", meAs("packer")).map((s) => s.to)).toEqual(["/pack", "/stock/bundles"]);
  });

  test("the access-request guide links to Godseye only for platform staff", () => {
    expect(relatedScreensFor("approve-access-request", meAs("owner"))).toEqual([]);
  });
});

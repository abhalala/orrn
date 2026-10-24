import type { GuideSlug, MessageKey } from "@orrn/i18n";
import { canAny, type Action, type Me } from "@orrn/server/lib/permissions";

/**
 * Screens each guide points to. A link shows only when the person can open the
 * screen: `requires` mirrors the nav item for the same page.
 */
export type RelatedScreen = {
  to: string;
  labelKey: MessageKey;
  requires?: readonly Action[];
};

const PACK: RelatedScreen = { to: "/pack", labelKey: "nav.pack", requires: ["bundle.create"] };
const STOCK: RelatedScreen = { to: "/stock", labelKey: "nav.stock" };
const BUNDLES: RelatedScreen = { to: "/stock/bundles", labelKey: "stock.list.title" };
const DISPATCH: RelatedScreen = { to: "/dispatch", labelKey: "nav.dispatch" };
const PRINTING: RelatedScreen = { to: "/printing", labelKey: "nav.printing", requires: ["spool.view_queue"] };
const TODAY: RelatedScreen = { to: "/today", labelKey: "nav.today" };

export const RELATED_SCREENS: Record<GuideSlug, readonly RelatedScreen[]> = {
  "pack-session": [PACK, BUNDLES],
  "reprint-label": [BUNDLES, PRINTING],
  "scan-bundle": [STOCK, BUNDLES],
  "build-dispatch": [DISPATCH, STOCK],
  "hold-and-dispatch": [DISPATCH],
  "void-bundle": [BUNDLES, STOCK],
  "edit-die": [{ to: "/dies", labelKey: "nav.dies" }],
  "add-customer": [{ to: "/customers", labelKey: "nav.customers" }],
  "invite-member": [
    {
      to: "/settings",
      labelKey: "nav.settings",
      requires: ["settings.update", "member.invite", "member.updateRole", "member.remove", "users.manage"],
    },
  ],
  "printer-trouble": [PRINTING],
  "stock-by-die": [STOCK, BUNDLES],
  "stock-count": [STOCK, BUNDLES],
  "approve-access-request": [{ to: "/admin/requests", labelKey: "nav.adminRequests", requires: ["platform.waitlist.review"] }],
  "floor-tablet-signin": [TODAY, PACK],
};

/** The related screens this person can open. */
export function relatedScreensFor(slug: GuideSlug, me: Me | null | undefined): RelatedScreen[] {
  return RELATED_SCREENS[slug].filter((screen) => !screen.requires || canAny(me, screen.requires));
}

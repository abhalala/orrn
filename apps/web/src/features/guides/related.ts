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
const PURCHASE: RelatedScreen = {
  to: "/purchase",
  labelKey: "nav.purchase",
  requires: ["purchase.receipt", "purchase.dcnote", "reports.read", "masters.publish"],
};
const STORE: RelatedScreen = { to: "/store", labelKey: "nav.store", requires: ["store.txn", "masters.publish"] };

const ORDERS: RelatedScreen = { to: "/orders", labelKey: "nav.orders", requires: ["order.manage", "order.plan"] };
const PRESS: RelatedScreen = { to: "/press", labelKey: "nav.press", requires: ["press.run", "press.close", "reports.read"] };
const DIES: RelatedScreen = { to: "/dies", labelKey: "nav.dies" };
const CUSTOMERS: RelatedScreen = { to: "/customers", labelKey: "nav.customers" };
const MASTERS: RelatedScreen = { to: "/masters", labelKey: "nav.masters", requires: ["masters.publish", "masters.draft"] };
const APPROVALS: RelatedScreen = {
  to: "/approvals",
  labelKey: "nav.approvals",
  requires: ["masters.publish", "purchase.dcnote", "die.rerank", "cast.close", "cast.enter"],
};

const FOUNDRY: RelatedScreen = {
  to: "/casts",
  labelKey: "nav.foundry",
  requires: ["cast.enter", "cast.close", "melt.enter"],
};
const AGEING: RelatedScreen = { to: "/ageing", labelKey: "nav.ageing", requires: ["ageing.view", "ageing.enter"] };
const AGEING_LOAD: RelatedScreen = { to: "/ageing/load", labelKey: "ageing.load.title", requires: ["ageing.load"] };

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
  "weigh-scrap-lot": [PURCHASE],
  "store-entries": [STORE],
  "stock-by-die": [STOCK, BUNDLES],
  "stock-count": [STOCK, BUNDLES],
  "approve-access-request": [{ to: "/admin/requests", labelKey: "nav.adminRequests", requires: ["platform.waitlist.review"] }],
  "floor-tablet-signin": [TODAY, PACK],
  "book-order": [ORDERS, CUSTOMERS],
  "hold-for-order": [ORDERS, BUNDLES],
  "reallocate-bundles": [ORDERS, APPROVALS],
  "plan-press-run": [ORDERS, PRESS],
  "press-station-day": [PRESS, TODAY],
  "press-late-entry": [PRESS, APPROVALS],
  "press-downtime": [PRESS],
  "die-reading": [DIES],
  "die-issue-return": [DIES, PRESS],
  "die-trial": [DIES, PRESS],
  "bulk-drawings": [DIES],
  "dispatch-from-order": [DISPATCH, ORDERS],
  "truck-capacity": [DISPATCH],
  "packing-list-revisions": [DISPATCH],
  "combine-packing-lists": [DISPATCH],
  "settle-count": [STOCK, APPROVALS],
  "portal-login": [CUSTOMERS, { to: "/settings", labelKey: "nav.settings", requires: ["settings.update", "users.manage"] }],
  "issue-certificate": [DISPATCH],
  "reason-codes": [MASTERS],
  "open-cast": [FOUNDRY, MASTERS],
  "melt-entry": [FOUNDRY],
  "spectro-attach": [FOUNDRY],
  "cast-close-count": [FOUNDRY, APPROVALS],
  "load-trolley": [AGEING_LOAD, AGEING],
  "age-and-release": [AGEING, APPROVALS],
  "pack-from-trolley": [PACK, AGEING],
  "die-share-link": [DIES],
  "approvals-review": [APPROVALS],
};

/** The related screens this person can open. */
export function relatedScreensFor(slug: GuideSlug, me: Me | null | undefined): RelatedScreen[] {
  return RELATED_SCREENS[slug].filter((screen) => !screen.requires || canAny(me, screen.requires));
}

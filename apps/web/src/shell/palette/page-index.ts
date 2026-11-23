import type { MessageKey } from "@orrn/i18n";
import type { Action } from "@orrn/server/lib/permissions";
import type { CompanyModule } from "@orrn/domain";

/**
 * Keyword alternatives and the main words inside each page (owner decision 2026-11-18).
 *
 * Hindi and Gujarati words are copied from the dictionaries in packages/i18n/src (hi.ts, gu.ts, gu-more/*,
 * foundry/hi.ts, ageing/*.hi.ts); none are new translations. page-index.test.ts checks each one is present there.
 * The nav labels in Hindi and Gujarati are listed too, so a word typed in either script finds the page whatever
 * the UI language is.
 */

/** Extra words that find a nav page, keyed by nav item `key` (nav-items.ts). */
export const PAGE_ALIASES: Readonly<Record<string, readonly string[]>> = {
  today: ["home", "dashboard", "आज", "આજે"],
  pack: [
    "packing",
    "receipt",
    "new bundle",
    "label",
    "sticker",
    "पैकिंग",
    "लेबल",
    "स्टिकर",
    "પૅકિંગ",
    "લેબલ",
  ],
  stock: [
    "section",
    "profile",
    "yard",
    "lengths",
    "inventory",
    "स्टॉक",
    "सेक्शन",
    "प्रोफाइल",
    "સ્ટોક",
    "સેક્શન",
    "પ્રોફાઇલ",
  ],
  dispatch: [
    "challan",
    "PL",
    "packing list",
    "shipment",
    "invoice",
    "truck",
    "डिस्पैच",
    "पैकिंग लिस्ट",
    "પૅકિંગ લિસ્ટ",
  ],
  ingest: ["import", "upload", "excel", "sheet", "xlsx", "csv", "इम्पोर्ट", "ઇમ્પોર્ટ"],
  orders: [
    "PO",
    "order book",
    "sales order",
    "purchase order",
    "ऑर्डर",
    "ऑर्डर बुक",
    "सेल्स ऑर्डर",
    "ઓર્ડર",
    "ઓર્ડર બુક",
    "સેલ્સ ઓર્ડર",
  ],
  press: ["press line", "extrusion", "run", "प्रेस", "प्रेस प्लान", "પ્રેસ", "પ્રેસ કન્સોલ"],
  foundry: [
    "billet",
    "log",
    "furnace",
    "melt",
    "heat",
    "cast",
    "spectro",
    "फाउंड्री",
    "कास्ट",
    "फर्नेस",
    "बिलेट",
    "मेल्ट",
    "ફાઉન્ડ્રી",
    "કાસ્ટ",
    "મેલ્ટ",
    "બિલેટ",
  ],
  ageing: ["aging", "oven", "trolley", "heat treatment", "एजिंग", "ओवन", "ट्रॉली", "એજિંગ", "ઓવન", "ટ્રોલી"],
  jobwork: ["job work", "jobwork", "vendor job", "anodise", "anodising", "powder coat", "pvd", "finishing", "coating", "जॉब वर्क"],
  drawbench: ["draw bench", "drawing", "tube", "rod", "ड्रॉ बेंच"],
  fabrication: ["cut to length", "punch", "cnc", "drill", "machining", "फ़ैब्रिकेशन"],
  reports: ["analytics", "report", "रिपोर्ट", "રિપોર્ટ"],
  purchase: [
    "scrap",
    "scrap lot",
    "kanta",
    "weighbridge",
    "maal",
    "खरीद",
    "स्क्रैप लॉट",
    "कांटा",
    "ખરીદી",
    "કાંટો",
  ],
  approvals: ["approve", "pending", "मंज़ूरी", "મંજૂરી"],
  dies: ["die", "matrix", "bolster", "die room", "डाई", "डाई रूम", "बोल्स्टर", "ડાઈ", "બોલ્સ્ટર"],
  customers: ["party", "client", "buyer", "ग्राहक", "पार्टी", "ગ્રાહક", "પાર્ટી"],
  store: ["maal", "spares", "consumables", "स्टोर", "माल", "સ્ટોર"],
  printing: [
    "print",
    "label",
    "sticker",
    "QR",
    "printer",
    "spool",
    "प्रिंटिंग",
    "प्रिंटर",
    "प्रिंट",
    "પ્રિન્ટિંગ",
    "પ્રિન્ટર",
    "પ્રિન્ટ",
  ],
  masters: ["master data", "lists", "मास्टर", "માસ્ટર"],
  guides: ["help", "how to", "SOP", "गाइड", "ગાઇડ"],
  settings: ["preferences", "company", "सेटिंग्स", "સેટિંગ"],
  audit: ["audit log", "history", "who changed", "ऑडिट", "इतिहास", "ઑડિટ લૉગ", "ઇતિહાસ"],
};

export type PageSection = {
  /** Unique, e.g. "foundry.melt-times". */
  id: string;
  /** Nav item `key` this section belongs to; it inherits that item's permission and module gating. */
  parentKey: string;
  /** Label: a dictionary key when one exists, else plain English. */
  labelKey?: MessageKey;
  label?: string;
  /** Route path the page already supports. */
  to: string;
  /** Search params the page already reads (tab ids), if any. */
  search?: Readonly<Record<string, string>>;
  /** Main words used inside this section, and its aliases. */
  terms: readonly string[];
  /**
   * Extra gate on top of the parent's: the section page itself refuses people without one of these (canAny).
   * Absent means the parent's gate is enough.
   */
  requires?: readonly Action[];
  /** Extra module gate on top of the parent's (a reports card that needs its module). */
  module?: CompanyModule;
};

export const PAGE_SECTIONS: readonly PageSection[] = [
  // Pack
  {
    id: "pack.new",
    parentKey: "pack",
    labelKey: "pack.new.title",
    to: "/pack/new",
    terms: ["new pack", "start packing", "source", "review", "PO"],
    requires: ["bundle.pack"],
  },

  // Stock
  { id: "stock.lengths", parentKey: "stock", labelKey: "stock.lengths", to: "/stock/lengths", terms: ["cut length", "pcs", "held", "oldest"] },
  { id: "stock.bundles", parentKey: "stock", labelKey: "stock.list.title", to: "/stock/bundles", terms: ["bundles", "serial", "bundle list", "बंडल", "બંડલ"] },
  { id: "stock.yards", parentKey: "stock", labelKey: "stock.yards", to: "/stock/yards", terms: ["yard", "location"] },
  {
    id: "stock.count",
    parentKey: "stock",
    labelKey: "stock.count.title",
    to: "/stock/count",
    terms: ["stock take", "stocktake", "counts in progress", "missing", "स्टॉक की गिनती", "સ્ટોકની ગણતરી"],
  },

  // Dispatch
  {
    id: "dispatch.new",
    parentKey: "dispatch",
    labelKey: "dispatch.new.title",
    to: "/dispatch/new",
    terms: ["new challan", "new PL", "ship date", "from sales order"],
    requires: ["dispatch.create"],
  },

  // Orders
  {
    id: "orders.new",
    module: "orders",
    parentKey: "orders",
    labelKey: "orders.new",
    to: "/orders/new",
    terms: ["new PO", "customer PO", "expected date"],
    requires: ["order.manage"],
  },
  { id: "orders.plan", parentKey: "orders", labelKey: "press.plan.title", to: "/orders/plan", terms: ["plan", "by die", "by order", "प्रेस प्लान"], module: "orders" },

  // Press
  { id: "press.alerts", parentKey: "press", labelKey: "press.alerts.title", to: "/press/alerts", terms: ["alerts", "reading", "limit", "प्रेस अलर्ट", "પ્રેસ એલર્ટ"] },
  { id: "press.lines", parentKey: "press", labelKey: "press.linesPage.title", to: "/press/lines", terms: ["press line", "tonnes", "lines"] },
  { id: "press.report", parentKey: "press", labelKey: "press.report.title", to: "/press/report", terms: ["shift", "press report", "प्रेस रिपोर्ट", "પ્રેસ રિપોર્ટ"], requires: ["reports.read"] },
  { id: "press.summary", parentKey: "press", labelKey: "press.summary.title", to: "/press/summary", terms: ["daily", "recovery", "downtime", "pressed today"] },

  // Foundry
  { id: "foundry.inbox", parentKey: "foundry", labelKey: "foundry.inbox.title", to: "/casts/inbox", terms: ["spectro", "inbox", "waiting", "files"] },
  {
    id: "foundry.inbox.arriving",
    parentKey: "foundry",
    labelKey: "foundry.inbox.tabs.arriving",
    to: "/casts/inbox",
    search: { tab: "arriving" },
    terms: ["spectro arriving"],
  },
  {
    id: "foundry.inbox.handled",
    parentKey: "foundry",
    labelKey: "foundry.inbox.tabs.handled",
    to: "/casts/inbox",
    search: { tab: "handled" },
    terms: ["spectro handled"],
  },
  { id: "foundry.new", parentKey: "foundry", labelKey: "foundry.newCast.title", to: "/casts/new", terms: ["new cast", "alloy", "furnace", "कास्ट"], requires: ["cast.enter"] },
  { id: "foundry.stock", parentKey: "foundry", labelKey: "foundry.stock.title", to: "/foundry/stock", terms: ["billet", "billet stock", "log", "return streams", "बिलेट स्टॉक"] },

  // Ageing
  {
    id: "ageing.load",
    parentKey: "ageing",
    labelKey: "ageing.load.title",
    to: "/ageing/load",
    terms: ["load", "trolley", "from the press", "ट्रॉली", "ટ્રોલી"],
    requires: ["ageing.load"],
  },
  {
    id: "ageing.history",
    parentKey: "ageing",
    labelKey: "ageing.history.title",
    to: "/ageing/history",
    terms: ["history", "oven", "recipe", "verdict", "इतिहास", "ઇતિહાસ"],
  },

  // Job work (the register, At vendors, the line and the vendors are tabs on /jobwork; only the new challan is its own page)
  {
    id: "jobwork.new",
    parentKey: "jobwork",
    labelKey: "jw.new.title",
    to: "/jobwork/new",
    terms: ["new job work", "send to vendor", "send bundles", "anodise", "powder coat", "vehicle", "expected return"],
    requires: ["jobwork.send"],
  },

  // Reports (cards on the reports index are hidden by module; the same module gates the section)
  { id: "reports.production", parentKey: "reports", labelKey: "reports.list.production", to: "/reports/production", terms: ["recovery", "die copy", "shift"], module: "press" },
  { id: "reports.die-life", parentKey: "reports", labelKey: "reports.list.dieLife", to: "/reports/die-life", terms: ["die life", "retired copies"], module: "dies" },
  { id: "reports.stock-age", parentKey: "reports", labelKey: "reports.list.stockAge", to: "/reports/stock-age", terms: ["stock age", "old stock", "plant stock"], module: "bundles" },
  {
    id: "reports.foundry-yield",
    parentKey: "reports",
    labelKey: "reports.list.foundryYield",
    to: "/reports/foundry-yield",
    terms: ["yield", "metal in", "scrap lots"],
    module: "foundry",
  },
  { id: "reports.orders", parentKey: "reports", labelKey: "reports.list.orders", to: "/reports/orders", terms: ["order book", "late orders", "by party", "ऑर्डर बुक", "ઓર્ડર બુક"] },
  { id: "reports.ageing", parentKey: "reports", labelKey: "ageing.report.title", to: "/reports/ageing", terms: ["hardness", "oven", "एजिंग रिपोर्ट", "એજિંગ રિપોર્ટ"], module: "ageing" },

  // Purchase
  {
    id: "purchase.new",
    module: "purchase",
    parentKey: "purchase",
    labelKey: "purchase.new.title",
    to: "/purchase/new",
    terms: ["new lot", "scrap lot", "bill book", "party kg", "our kg", "kanta"],
    requires: ["purchase.receipt"],
  },

  // Dies
  { id: "dies.issues", parentKey: "dies", labelKey: "dieRoom.issues.title", to: "/dies/issues", terms: ["issue", "return", "issues", "press run"] },
  { id: "dies.makers", parentKey: "dies", labelKey: "dieRoom.maker.makers", to: "/dies/makers", terms: ["makers", "die maker", "maker", "मेकर", "મેકર"] },

  // Store
  { id: "store.items", parentKey: "store", labelKey: "store.items", to: "/store/items", terms: ["items", "spares", "category", "unit"], module: "store" },
  { id: "store.issue", parentKey: "store", labelKey: "store.issue.title", to: "/store/issue", terms: ["issue", "माल दें"], requires: ["store.txn"], module: "store" },
  { id: "store.receive", parentKey: "store", labelKey: "store.receive.title", to: "/store/receive", terms: ["receive", "challan", "माल लें", "चालान"], requires: ["store.txn"], module: "store" },
  { id: "store.exchange", parentKey: "store", labelKey: "store.exchange.title", to: "/store/exchange", terms: ["exchange", "old for new"], requires: ["store.txn"], module: "store" },

  // Printing (tabs in ?tab=; the queue is the default tab)
  { id: "printing.queue", parentKey: "printing", labelKey: "printing.tabs.queue", to: "/printing", terms: ["print queue", "jobs", "reprint"] },
  { id: "printing.printers", parentKey: "printing", labelKey: "printing.tabs.printers", to: "/printing", search: { tab: "printers" }, terms: ["printer", "label printer", "प्रिंटर", "પ્રિન્ટર"] },
  {
    id: "printing.labels",
    parentKey: "printing",
    labelKey: "printing.tabs.labels",
    to: "/printing",
    search: { tab: "labels" },
    terms: ["label", "sticker", "QR", "template", "QR कोड", "QR કોડ", "लेबल", "લેબલ"],
  },

  // Masters (the hub's own list, masters-model.ts)
  { id: "masters.vendors", parentKey: "masters", labelKey: "masters.hub.vendors", to: "/vendors", terms: ["vendor", "supplier", "GSTIN", "सप्लायर", "સપ્લાયર"], requires: ["purchase.receipt", "purchase.dcnote", "reports.read", "masters.publish"], module: "purchase" },
  { id: "masters.scrap", parentKey: "masters", labelKey: "masters.hub.scrap", to: "/masters/scrap", search: { tab: "items" }, terms: ["scrap", "scrap items", "स्क्रैप", "સ્ક્રેપ"] },
  { id: "masters.scrap.grades", parentKey: "masters", labelKey: "masters.scrap.tabs.grades", to: "/masters/scrap", search: { tab: "grades" }, terms: ["grades", "scrap grade"] },
  { id: "masters.scrap.streams", parentKey: "masters", labelKey: "masters.scrap.tabs.streams", to: "/masters/scrap", search: { tab: "streams" }, terms: ["return streams", "expected recovery"] },
  { id: "masters.locations", parentKey: "masters", labelKey: "masters.hub.locations", to: "/masters/locations", terms: ["location", "yard", "जगह", "જગ્યા"] },
  { id: "masters.dies", parentKey: "masters", labelKey: "masters.hub.dieCopies", to: "/masters/dies", terms: ["die copy", "tier", "डाई कॉपी", "ડાઈ કૉપી"] },
  { id: "masters.reasons", parentKey: "masters", labelKey: "masters.hub.reasons", to: "/masters/reasons", terms: ["reason codes", "downtime", "rejects", "void", "reprint", "ageing hold"] },
  { id: "masters.furnaces", parentKey: "masters", labelKey: "masters.hub.furnaces", to: "/masters/furnaces", terms: ["furnace", "capacity", "फर्नेस"], requires: ["masters.publish"] },
  { id: "masters.alloys", parentKey: "masters", labelKey: "masters.hub.alloys", to: "/masters/alloys", terms: ["alloy", "billet size", "limits", "अलॉय", "એલોય"], requires: ["masters.publish"] },
  { id: "masters.ovens", parentKey: "masters", labelKey: "masters.hub.ovens", to: "/masters/ovens", terms: ["oven", "temperature", "ओवन", "ઓવન"] },
  { id: "masters.trolleys", parentKey: "masters", labelKey: "masters.hub.trolleys", to: "/masters/trolleys", terms: ["trolley", "ट्रॉली", "ટ્રોલી"] },
  { id: "masters.recipes", parentKey: "masters", labelKey: "masters.hub.recipes", to: "/masters/recipes", terms: ["recipe", "soak", "hardness", "cycle"] },

  // Settings (tabs in ?tab=; company is the default tab; a hidden tab falls back to the first visible one)
  { id: "settings.company", parentKey: "settings", labelKey: "settings.tabs.company", to: "/settings", terms: ["company", "કંપની"] },
  { id: "settings.units", parentKey: "settings", labelKey: "settings.tabs.units", to: "/settings", search: { tab: "units" }, terms: ["units", "kg", "feet", "mm"] },
  { id: "settings.shifts", parentKey: "settings", labelKey: "settings.tabs.shifts", to: "/settings", search: { tab: "shifts" }, terms: ["shift", "shift timings"] },
  { id: "settings.standards", parentKey: "settings", labelKey: "settings.tabs.standards", to: "/settings", search: { tab: "standards" }, terms: ["standards"] },
  { id: "settings.modules", parentKey: "settings", labelKey: "settings.tabs.modules", to: "/settings", search: { tab: "modules" }, terms: ["modules", "portal"] },
  { id: "settings.team", parentKey: "settings", labelKey: "settings.tabs.team", to: "/settings", search: { tab: "team" }, terms: ["team", "members", "users", "invite", "roles", "टीम", "सदस्य", "ટીમ", "સભ્યો"] },
  { id: "settings.devices", parentKey: "settings", labelKey: "settings.tabs.devices", to: "/settings", search: { tab: "devices" }, terms: ["devices"], requires: ["users.manage"] },
  { id: "settings.backup", parentKey: "settings", labelKey: "settings.tabs.backup", to: "/settings", search: { tab: "backup" }, terms: ["backup", "restore"], requires: ["settings.update"] },
  { id: "settings.support", parentKey: "settings", labelKey: "settings.tabs.support", to: "/settings", search: { tab: "support" }, terms: ["support", "help"], requires: ["support.request"] },
  { id: "settings.about", parentKey: "settings", labelKey: "settings.tabs.about", to: "/settings", search: { tab: "about" }, terms: ["about"] },
  { id: "settings.printing", parentKey: "settings", labelKey: "settings.tabs.printing", to: "/settings", search: { tab: "printing" }, terms: ["print settings"] },
  { id: "settings.data", parentKey: "settings", labelKey: "settings.tabs.data", to: "/settings", search: { tab: "data" }, terms: ["data"] },
];

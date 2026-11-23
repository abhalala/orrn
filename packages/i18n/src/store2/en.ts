import { store2IndentEn } from "./indent.en";
import { store2PoEn } from "./po.en";
import { store2ValueEn } from "./value.en";

/**
 * XE store (rows 69 to 73): buying for the store. Indents (a department asks), purchase orders to a
 * vendor, GRNs against an order, reorder levels and the store's value. An office namespace: Gujarati
 * falls back to English. Plant words stay as the floor says them (PO, GRN, GST, kg).
 */
export const store2En = {
  buy: {
    title: "Buying",
    subtitle: "Indents, purchase orders and what the store is worth",
    tabs: {
      indents: "Indents",
      orders: "Purchase orders",
      value: "Store value",
    },
    noAccess: "Buying is for department heads, the office, the store and managers.",
    openStore: "Store",
  },
  status: {
    indent: {
      open: "Waiting",
      approved: "Approved",
      rejected: "Rejected",
      ordered: "Ordered",
      cancelled: "Cancelled",
    },
    po: {
      draft: "Draft",
      issued: "Sent",
      part_received: "Part received",
      closed: "Closed",
      cancelled: "Cancelled",
    },
  },
  money: {
    noRate: "No rate",
    perUnit: "{rate} per {unit}",
    ratePending: "Rate pending",
  },
  grn: {
    entryPo: "Purchase order",
    entryRate: "Rate",
    entryValue: "Value",
    poLine: "Against a purchase order",
    noPo: "No purchase order",
    poLineOption: "{po} line {line}, {vendor}: {left} {unit} still to come",
    poLineHint: "Pick the order line this delivery is for. The rate comes from the order.",
    noOpenLines: "No open purchase order has this item.",
    rate: "Rate per {unit}",
    rateHint: "Rupees, from the vendor's bill. Leave empty if you do not know it yet.",
    rateFromPo: "From the order: {rate}",
    rateByOffice: "The office sets the rate. Until then this delivery counts at the average rate.",
    rateInvalid: "Enter the rate in rupees, like 84.50",
    rejected: "Rejected at inspection",
    rejectedHint: "What you turned back. It does not go into the store.",
    accepted: "Accepted into the store",
    left: "Still to come on this line: {qty}",
  },
  item: {
    levels: "Reorder levels",
    min: "Minimum",
    minHint: "Below this, Today asks for an indent.",
    reorder: "Reorder quantity",
    reorderHint: "How much one indent asks for. Empty means enough to reach the minimum.",
    none: "Not set",
    showLevels: "Minimum {min}, reorder {reorder}",
  },
  today: {
    title: "Store items running low",
    open: "Open the store",
    have: "{have} left, minimum {min}",
    makeIndent: "Make indent",
    making: "Making indent",
    made: "Indent {number} made",
    already: "Indent {number} is already raised",
    openIndent: "Open {number}",
    failed: "The indent was not made. Try again.",
  },
  errors: {
    overReceipt: "{po} line {line} can take only {qty} {unit} more. Check the delivery, or ask the office to raise the order.",
    poWrongItem: "That order line is for another item.",
    poNotOpen: "{po} is not open for deliveries.",
    tooLarge: "Quantity times rate is too large. Check both numbers.",
    notFound: "Not found. It may have been removed, or it belongs to another plant.",
    vendorNotConfirmed: "This vendor is not confirmed yet. Ask a manager to confirm it in Masters.",
    wrongStatus: "{number} has moved on. Open it again to see where it stands.",
    indentNotApproved: "Only an approved indent can become a purchase order.",
    indentChanged: "The indent changed meanwhile. Open it again.",
    poHasGoods: "{po} already has goods in. Close it short instead of cancelling.",
    noLines: "Add at least one item.",
    tooManyLines: "At most 40 items on one document.",
    sameItemTwice: "The same item is on it twice. Put it on one line.",
    notBelow: "This item is not below its minimum any more.",
    forbidden: "You do not have permission to do that.",
    rateOfficeOnlyPo: "Only the office can change the order's rate. Leave the rate as the order has it.",
    rateOfficeOnly: "Only the office can set a rate. Leave it empty and the office will set it.",
    allRated: "All of this item in the store already has a rate.",
    issuedSince: "Some stock from this delivery has already gone out. Record a return to the vendor instead.",
    openingRated: "Opening rate was already given to this delivery's stock. Record a return to the vendor instead.",
    unknown: "That did not work. Try again.",
  },
  indent: store2IndentEn,
  po: store2PoEn,
  value: store2ValueEn,
};

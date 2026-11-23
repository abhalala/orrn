/**
 * XE parity lane ADM: plant masters, number formats, approver rules, tool room extras, the document
 * register. Office and die room screens; none are public keys. Gujarati falls back to English (no
 * namespace here is in GU_FLOOR_NAMESPACES). Keep `hi.ts` in the same shape.
 *
 * `masters` holds the Masters area screens (en-masters.ts), `floor` the pieces inside other screens:
 * the die card, the order line, the dispatch, members, Today (en-floor.ts).
 */
import { admFloorEn } from "./en-floor";
import { admMastersEn } from "./en-masters";

export const admEn = {
  /** Packing list header rows (screen view; print and sheet stay English). */
  pl: {
    packingMode: "Packing",
    insurance: "Transit insurance",
    insuranceValue: "{policy}, {insurer}",
  },
  kinds: {
    department: "Departments",
    designation: "Designations",
    packing_mode: "Modes of packing",
    die_category: "Die categories",
  },
  kindOne: {
    department: "Department",
    designation: "Designation",
    packing_mode: "Mode of packing",
    die_category: "Die category",
  },
  tooling: {
    bolster: "Bolster",
    backer: "Backer",
    die_ring: "Die ring",
    container: "Container",
    liner: "Liner",
    other: "Other",
  },
  toolingStatus: {
    awaiting_inspection: "Waiting for inspection",
    in_store: "In store",
    in_use: "In use",
    at_maker: "At maker",
    failed: "Failed inspection",
    retired: "Retired",
  },
  docKinds: {
    procedure: "Procedure",
    customer_spec: "Customer spec",
    drawing: "Drawing",
    certificate: "Certificate",
    other: "Other",
  },
  inspection: {
    pass: "Passed",
    fail: "Failed",
    none: "Not inspected",
  },
  masters: admMastersEn,
  floor: admFloorEn,
};

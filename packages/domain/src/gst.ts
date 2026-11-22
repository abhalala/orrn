/**
 * XE-BILL row 14: GST facts and local validators (no network). Re-implemented from the published rules
 * (GSTN GSTIN structure, GST state codes, India Post pincode zones); india-compliance (GPL) was read for the
 * list of checks only, no code is copied.
 *
 * - GSTIN: 15 characters, 2-digit state code, 10-character PAN, entity number, "Z" (by default), and a
 *   mod-36 check digit (`gstinCheckDigit`). Pinned in gst.test.ts with GSTINs published by GSTN.
 * - State codes: the GST state code table (01 Jammu and Kashmir .. 38 Ladakh, 96 foreign, 97 other territory).
 * - Pincode to state: India Post three-digit prefixes per state. Ranges overlap (Goa sits inside Maharashtra's
 *   400-445, Uttarakhand inside Uttar Pradesh's), so this answers "can this pincode be in this state", never
 *   "which state is this pincode".
 */

export const GSTIN_CHARSET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const GSTIN_SHAPE = /^[0-9]{2}[A-Z0-9]{13}$/;
/** A regular taxpayer: state, PAN (5 letters, 4 digits, letter), entity, Z, check. */
const GSTIN_REGULAR = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/** The 15th character a GSTIN must carry for its first 14 (mod-36, alternating factors 1 and 2). */
export function gstinCheckDigit(first14: string): string {
  const s = first14.toUpperCase();
  if (s.length !== 14) throw new RangeError("A GSTIN check digit needs the first 14 characters");
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const v = GSTIN_CHARSET.indexOf(s[i]!);
    if (v < 0) throw new RangeError(`Not a GSTIN character: ${s[i]}`);
    const product = v * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return GSTIN_CHARSET[(36 - (sum % 36)) % 36]!;
}

export type GstinProblem = "empty" | "shape" | "state" | "check_digit";

/** Why a GSTIN is not valid, or null when it is. Upper-cases and trims first. */
export function gstinProblem(raw: string | null | undefined): GstinProblem | null {
  const g = normaliseGstin(raw);
  if (!g) return "empty";
  if (!GSTIN_SHAPE.test(g)) return "shape";
  if (!GST_STATE_CODES[g.slice(0, 2)] || g.slice(0, 2) === "96") return "state";
  if (gstinCheckDigit(g.slice(0, 14)) !== g[14]) return "check_digit";
  return null;
}

export function isValidGstin(raw: string | null | undefined): boolean {
  return gstinProblem(raw) === null;
}

/** A regular (normal taxpayer) GSTIN: valid AND shaped like PAN + entity + Z. */
export function isRegularGstin(raw: string | null | undefined): boolean {
  const g = normaliseGstin(raw);
  return isValidGstin(g) && GSTIN_REGULAR.test(g);
}

export function normaliseGstin(raw: string | null | undefined): string {
  return (raw ?? "").replace(/\s+/g, "").toUpperCase();
}

/** The state code a GSTIN belongs to ("24"), or null when it is not valid. */
export function gstinState(raw: string | null | undefined): string | null {
  const g = normaliseGstin(raw);
  return isValidGstin(g) ? g.slice(0, 2) : null;
}

/** The 10-character PAN inside a GSTIN. */
export function gstinPan(raw: string): string {
  return normaliseGstin(raw).slice(2, 12);
}

/** GST state codes (two digits) and their names. 96 = a foreign country (export place of supply). */
export const GST_STATE_CODES: Readonly<Record<string, string>> = {
  "01": "Jammu and Kashmir",
  "02": "Himachal Pradesh",
  "03": "Punjab",
  "04": "Chandigarh",
  "05": "Uttarakhand",
  "06": "Haryana",
  "07": "Delhi",
  "08": "Rajasthan",
  "09": "Uttar Pradesh",
  "10": "Bihar",
  "11": "Sikkim",
  "12": "Arunachal Pradesh",
  "13": "Nagaland",
  "14": "Manipur",
  "15": "Mizoram",
  "16": "Tripura",
  "17": "Meghalaya",
  "18": "Assam",
  "19": "West Bengal",
  "20": "Jharkhand",
  "21": "Odisha",
  "22": "Chhattisgarh",
  "23": "Madhya Pradesh",
  "24": "Gujarat",
  "26": "Dadra and Nagar Haveli and Daman and Diu",
  "27": "Maharashtra",
  "29": "Karnataka",
  "30": "Goa",
  "31": "Lakshadweep",
  "32": "Kerala",
  "33": "Tamil Nadu",
  "34": "Puducherry",
  "35": "Andaman and Nicobar Islands",
  "36": "Telangana",
  "37": "Andhra Pradesh",
  "38": "Ladakh",
  "96": "Other country",
  "97": "Other territory",
};

export const FOREIGN_STATE_CODE = "96";

export function isStateCode(code: string | null | undefined): code is string {
  return typeof code === "string" && Object.prototype.hasOwnProperty.call(GST_STATE_CODES, code);
}

/**
 * India Post three-digit pincode prefixes per GST state, inclusive ranges. Overlaps are real (see the
 * file header). 97 (other territory) and 96 (foreign) accept anything.
 */
const STATE_PIN_PREFIXES: Readonly<Record<string, readonly (readonly [number, number])[]>> = {
  "01": [[180, 194]],
  "02": [[171, 177]],
  "03": [[140, 160]],
  "04": [[160, 160]],
  "05": [[244, 263]],
  "06": [[121, 136]],
  "07": [[110, 110]],
  "08": [[301, 345]],
  "09": [[201, 285]],
  "10": [[800, 855]],
  "11": [[737, 737]],
  "12": [[790, 792]],
  "13": [[797, 798]],
  "14": [[795, 795]],
  "15": [[796, 796]],
  "16": [[799, 799]],
  "17": [[793, 794]],
  "18": [[781, 788]],
  "19": [[700, 743]],
  "20": [[813, 835]],
  "21": [[751, 770]],
  "22": [[490, 497]],
  "23": [[450, 488]],
  "24": [[360, 396]],
  "26": [[362, 362], [396, 396]],
  "27": [[400, 445]],
  "29": [[560, 591]],
  "30": [[403, 403]],
  "31": [[682, 682]],
  "32": [[670, 695]],
  "33": [[600, 643]],
  "34": [[533, 533], [605, 605], [607, 607], [609, 609], [673, 673]],
  "35": [[744, 744]],
  "36": [[500, 509]],
  "37": [[500, 535]],
  "38": [[194, 194]],
};

export function isPincode(raw: string | null | undefined): boolean {
  return typeof raw === "string" && /^[1-9][0-9]{5}$/.test(raw.trim());
}

/** Can this pincode be in this state? False for a malformed pincode or an unknown state. */
export function pincodeFitsState(pincode: string | null | undefined, stateCode: string | null | undefined): boolean {
  if (!isPincode(pincode) || !isStateCode(stateCode)) return false;
  if (stateCode === "96" || stateCode === "97") return true;
  const prefix = Number(pincode!.trim().slice(0, 3));
  return (STATE_PIN_PREFIXES[stateCode] ?? []).some(([a, b]) => prefix >= a && prefix <= b);
}

/** UQC codes the plant bills aluminium in (GSTN unit list); KGS is the default. */
export const GST_UQC = ["KGS", "MTS", "NOS", "PCS", "MTR", "BDL", "SET", "OTH"] as const;
export type GstUqc = (typeof GST_UQC)[number];

/** HSN must be 4, 6 or 8 digits (turnover-based minimum; 4 is enough below Rs 5 Cr for B2B). */
export function isHsnCode(raw: string | null | undefined): boolean {
  return typeof raw === "string" && /^([0-9]{4}|[0-9]{6}|[0-9]{8})$/.test(raw.trim());
}

/** Seed HSN rows for an aluminium extrusion plant (the plant edits them). Rates in basis points. */
export const ALUMINIUM_HSN_SEED: readonly { code: string; description: string; rateBp: number; uqc: GstUqc; isDefault: boolean }[] = [
  { code: "7604", description: "Aluminium bars, rods and profiles", rateBp: 1800, uqc: "KGS", isDefault: true },
  { code: "7608", description: "Aluminium tubes and pipes", rateBp: 1800, uqc: "KGS", isDefault: false },
  { code: "7610", description: "Aluminium structures and parts of structures", rateBp: 1800, uqc: "KGS", isDefault: false },
];

// ---------------------------------------------------------------------------
// Supply type
// ---------------------------------------------------------------------------

export const GST_TAX_CATEGORIES = [
  "regular",
  "unregistered",
  "sez_with_payment",
  "sez_without_payment",
  "export_with_payment",
  "export_without_payment",
] as const;
export type TaxCategory = (typeof GST_TAX_CATEGORIES)[number];

/**
 * intra: CGST + SGST. inter: IGST. SEZ and export with payment: IGST. SEZ and export without payment
 * (under LUT or bond): zero-rated, no tax charged.
 */
export const SUPPLY_TYPES = ["intra", "inter", "sez_wp", "sez_wop", "exp_wp", "exp_wop"] as const;
export type SupplyType = (typeof SUPPLY_TYPES)[number];

export function supplyTypeFor(input: { plantState: string; placeOfSupply: string; category: TaxCategory }): SupplyType {
  switch (input.category) {
    case "sez_with_payment":
      return "sez_wp";
    case "sez_without_payment":
      return "sez_wop";
    case "export_with_payment":
      return "exp_wp";
    case "export_without_payment":
      return "exp_wop";
    default:
      return input.plantState === input.placeOfSupply ? "intra" : "inter";
  }
}

export type TaxHeads = "cgst_sgst" | "igst" | "none";

export function taxHeadsFor(supply: SupplyType): TaxHeads {
  if (supply === "intra") return "cgst_sgst";
  if (supply === "sez_wop" || supply === "exp_wop") return "none";
  return "igst";
}

/**
 * Place of supply for goods (IGST Act s.10(1)(a), (b)): where the movement ends, except that goods
 * delivered to a third person on the buyer's direction are supplied at the BUYER's place. orrn's ship-to
 * party is exactly that case, so the default is the bill-to state; a plant that needs otherwise sets it
 * per customer (`customer_gst.place_of_supply`). Exports: 96.
 */
export function placeOfSupplyFor(input: { category: TaxCategory; billToState: string; explicit?: string | null }): string {
  if (input.category === "export_with_payment" || input.category === "export_without_payment") return FOREIGN_STATE_CODE;
  return input.explicit && isStateCode(input.explicit) ? input.explicit : input.billToState;
}

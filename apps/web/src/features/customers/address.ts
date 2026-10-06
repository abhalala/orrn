/**
 * Customer billing and shipping addresses. The server stores each as a JSON object; the shape in
 * use (dev seed, packing list snapshot) is `{ line1, line2, city, state, postalCode, country }`.
 * The form edits the first five and keeps every other key it finds (country, anything imported),
 * so saving never loses data the form doesn't show.
 */
export type AddressDraft = { line1: string; line2: string; city: string; state: string; postalCode: string };

export const ADDRESS_FIELDS = ["line1", "line2", "city", "state", "postalCode"] as const;

export const EMPTY_ADDRESS: AddressDraft = { line1: "", line2: "", city: "", state: "", postalCode: "" };

type Stored = Record<string, unknown> | null | undefined;

function text(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return "";
}

export function addressToDraft(stored: Stored): AddressDraft {
  const out = { ...EMPTY_ADDRESS };
  if (!stored) return out;
  for (const key of ADDRESS_FIELDS) out[key] = text(stored[key]);
  return out;
}

/**
 * The address to save: trimmed fields, emptied ones dropped, other stored keys kept. Null when no
 * edited field has text (a lone `country` is not an address).
 */
export function draftToAddress(draft: AddressDraft, base: Stored): Record<string, unknown> | null {
  const out: Record<string, unknown> = { ...(base ?? {}) };
  let any = false;
  for (const key of ADDRESS_FIELDS) {
    const value = draft[key].trim();
    if (value) {
      out[key] = value;
      any = true;
    } else {
      delete out[key];
    }
  }
  return any ? out : null;
}

export function sameDraft(a: AddressDraft, b: AddressDraft): boolean {
  return ADDRESS_FIELDS.every((k) => a[k].trim() === b[k].trim());
}

/** Lines for display: street lines, then "City, State PIN". */
export function addressLines(stored: Stored): string[] {
  const d = addressToDraft(stored);
  const place = [d.city.trim(), d.state.trim()].filter(Boolean).join(", ");
  const last = [place, d.postalCode.trim()].filter(Boolean).join(" ");
  return [d.line1.trim(), d.line2.trim(), last].filter(Boolean);
}

/** GSTINs are stored upper case without spaces. */
export function normalizeGstin(value: string): string {
  return value.replace(/\s+/g, "").toUpperCase();
}

/** 15 letters and digits (the form's check; the full checksum is the GST portal's job). */
export function isValidGstin(value: string): boolean {
  return /^[0-9A-Z]{15}$/.test(value);
}

/**
 * What the form saves for the GSTIN field and what it says about it. A new or changed GSTIN must be
 * 15 letters and numbers (stored upper case, no spaces). A stored one the person did not touch is
 * sent back exactly and only flagged when it is malformed: imports keep legacy partial GSTINs
 * (T25 ruling), and fixing a customer's phone must not wait on their GST certificate.
 */
export function gstinField(
  text: string,
  stored: string | null,
): { value: string | null; error?: "customers.form.gstinInvalid"; warning?: "customers.form.gstinLegacy" } {
  if (stored !== null && text === stored) {
    if (!stored.trim()) return { value: null };
    return isValidGstin(normalizeGstin(stored)) ? { value: stored } : { value: stored, warning: "customers.form.gstinLegacy" };
  }
  const gstin = normalizeGstin(text);
  if (!gstin) return { value: null };
  return isValidGstin(gstin) ? { value: gstin } : { value: null, error: "customers.form.gstinInvalid" };
}

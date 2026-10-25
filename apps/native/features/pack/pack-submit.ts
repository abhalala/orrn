import type { MessageKey, Translate } from "@orrn/i18n";

import { writeFailureKind } from "@/lib/request-timeout";

import type { DraftReject } from "./pack-math";
import { parsePieces, parseWeightG } from "./pack-math";

/**
 * Saving a packing session (BACKLOG 50, rank 50): pure pieces behind the New session screen.
 * One nonce per session (kept in the draft) plus a hash of what is being sent gives the
 * `clientRequestId`: the same bundles sent again (a lost reply on yard Wi-Fi, Save tapped twice, the app
 * killed and reopened) carry the same id and the server answers with the first result instead of packing
 * them twice; any change to the bundles, rejects or choices gives a new id.
 */

/** FNV-1a over the text, as 8 hex digits (a content tag, not a security hash). */
function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** A fresh session nonce (letters and digits; `fresh` gives 16 or more random hex characters). */
export function newSessionKey(fresh: () => string): string {
  return fresh().slice(0, 32);
}

/** The `clientRequestId` of a save: the session nonce, a dash and a tag of the payload (25 characters for a 16 character nonce). */
export function receiptRequestKey(sessionKey: string, payload: unknown): string {
  return `${sessionKey}-${fnv1a(JSON.stringify(payload))}`;
}

/** True for a nonce the server's `clientRequestId` rule accepts once the tag is added (letters, digits, dash, underscore; 8 to 55 long). */
export function validSessionKey(key: unknown): key is string {
  return typeof key === "string" && /^[A-Za-z0-9_-]{8,55}$/.test(key);
}

/** The payload with its request id. The id is not part of what the hash covers. */
export function withRequestKey<T extends object>(sessionKey: string, payload: T): T & { clientRequestId: string } {
  return { ...payload, clientRequestId: receiptRequestKey(sessionKey, payload) };
}

// ---------------------------------------------------------------------------
// Rejects
// ---------------------------------------------------------------------------

/** The seeded `qc_reject` reasons a packer picks from; `other` needs a note. Checked against the domain table in the tests. */
export const REJECT_CODES = ["dimension", "surface", "bend", "crack", "short_length", "other"] as const;

export type RejectForm = { pcs: string; kg: string; reasonCode: string; note: string };
export const EMPTY_REJECT: RejectForm = { pcs: "", kg: "", reasonCode: "", note: "" };
export type RejectErrors = { pcs?: true; reason?: true; note?: true; kg?: true };

/** Validates the reject form; returns the reject or what is wrong (field keys the screen words). */
export function readReject(f: RejectForm): { ok: true; reject: DraftReject } | { ok: false; errors: RejectErrors } {
  const pcs = parsePieces(f.pcs);
  const errors: RejectErrors = {};
  if (pcs === null) errors.pcs = true;
  if (!f.reasonCode) errors.reason = true;
  if (f.reasonCode === "other" && !f.note.trim()) errors.note = true;
  const kgTyped = f.kg.trim() !== "";
  const weightG = kgTyped ? parseWeightG(f.kg) : null;
  if (kgTyped && weightG === null) errors.kg = true;
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    reject: {
      pcs: pcs!,
      ...(weightG !== null ? { weightG } : {}),
      reasonCode: f.reasonCode,
      ...(f.note.trim() ? { note: f.note.trim() } : {}),
    },
  };
}

export const rejectPieces = (rejects: readonly DraftReject[]) => rejects.reduce((s, r) => s + r.pcs, 0);

// ---------------------------------------------------------------------------
// Save errors
// ---------------------------------------------------------------------------

/**
 * What a failed `bundle.createReceipt` means for the packer (the same classes as the web):
 * - `forbidden`: their role cannot pack.
 * - `yard`: the chosen yard was retired or removed since the yards loaded.
 * - `unsure`: orrn never answered or failed (5xx). It may have saved, but Save again is safe: the same
 *   request id replays the first answer.
 * - `owned`: the die belongs to a customer (FP-PK-10); `ownerName` names them.
 * - `cast` / `copy`: the Source step needed a cast or a die copy.
 * - `reason`: a typed weight with a scale connected needs a reason; `scale`: no scale is connected any more.
 * - `order`: the order line was closed or is of another section; `pin`: the line pins another copy.
 * - `failed`: orrn refused it; nothing was saved.
 */
export type SaveErrorKind = "forbidden" | "yard" | "unsure" | "owned" | "cast" | "copy" | "reason" | "scale" | "order" | "pin" | "retired" | "failed";

type TrpcLike = { data?: { code?: string; httpStatus?: number } | null; message?: unknown };

export function saveErrorKind(error: unknown): SaveErrorKind {
  if (writeFailureKind(error) === "unsure") return "unsure";
  const e = (error && typeof error === "object" ? error : {}) as TrpcLike;
  const code = e.data?.code;
  const message = typeof e.message === "string" ? e.message : "";
  if (code === "FORBIDDEN") return /^This die belongs to/i.test(message) ? "owned" : "forbidden";
  if (code === "BAD_REQUEST" || code === "NOT_FOUND" || code === "CONFLICT") {
    if (/^Pick the cast|^Cast .* has no melt|^Cast not found/i.test(message)) return "cast";
    if (/^Pick the die copy|^This section has no copies/i.test(message)) return "copy";
    if (/say why the weight was typed/i.test(message)) return "reason";
    if (/no scale is connected|a scale weight must be/i.test(message)) return "scale";
    if (/is pinned to/i.test(message)) return "pin";
    if (/is retired|is at the die maker/i.test(message) && /Die copy/i.test(message)) return "retired";
    if (/pick an open order|another section|Order line not found|changed meanwhile/i.test(message)) return "order";
    if (/\b(yard|location)/i.test(message)) return "yard";
  }
  return "failed";
}

/** The owner named in "This die belongs to {name}", for the notice. */
export function ownerNameOf(error: unknown): string | null {
  const message = error && typeof error === "object" ? (error as TrpcLike).message : null;
  const m = typeof message === "string" ? /^This die belongs to (.+)$/i.exec(message) : null;
  return m?.[1] && !/^another customer$/i.test(m[1]) ? m[1] : null;
}

const KEY: Record<Exclude<SaveErrorKind, "unsure" | "owned" | "failed" | "forbidden">, MessageKey> = {
  yard: "native.pack.yardRequired",
  cast: "pack.new.saveCast",
  copy: "pack.new.saveCopy",
  reason: "pack.new.saveReason",
  scale: "pack.new.saveScale",
  order: "pack.new.saveOrder",
  pin: "native.pack.savePin",
  retired: "native.pack.saveRetired",
};

/** Title and body in the person's language for a failed save. Never the server's English. */
export function packSaveText(t: Translate, error: unknown): { kind: SaveErrorKind; title: string; body: string } {
  const kind = saveErrorKind(error);
  switch (kind) {
    case "unsure":
      return { kind, title: t("native.saveUnsureTitle"), body: t("pack.new.saveUnsure") };
    case "forbidden":
      return { kind, title: t("pack.new.saveFailed"), body: t("pack.new.forbidden") };
    case "owned": {
      const name = ownerNameOf(error);
      return { kind, title: t("pack.new.saveFailed"), body: name ? t("pack.dieOwned", { name }) : t("pack.dieOwnedOther") };
    }
    case "failed":
      return { kind, title: t("pack.new.saveFailed"), body: "" };
    default:
      return { kind, title: t("pack.new.saveFailed"), body: t(KEY[kind]) };
  }
}

// ---------------------------------------------------------------------------
// After the save
// ---------------------------------------------------------------------------

/**
 * The customer's own bundle numbers a save made (FP-PK-07), first to last. Null when the bundles carry no
 * party number of their own (the number on the label is then the plant serial).
 */
export { partyRange, partyNoLabel } from "./party";

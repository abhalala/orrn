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

export type RejectForm = { pcs: string; kg: string; reasonCode: string; note: string };
export const EMPTY_REJECT: RejectForm = { pcs: "", kg: "", reasonCode: "", note: "" };
export type RejectErrors = { pcs?: true; reason?: true; note?: true; kg?: true };

/**
 * Validates the reject form; returns the reject or what is wrong (field keys the screen words).
 * `needsNote`: the picked code asks for a note (`other`, or a code the plant set so in Masters).
 */
export function readReject(f: RejectForm, needsNote = f.reasonCode === "other"): { ok: true; reject: DraftReject } | { ok: false; errors: RejectErrors } {
  const pcs = parsePieces(f.pcs);
  const errors: RejectErrors = {};
  if (pcs === null) errors.pcs = true;
  if (!f.reasonCode) errors.reason = true;
  if (f.reasonCode && needsNote && !f.note.trim()) errors.note = true;
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

export type PackRefusal = {
  re: RegExp;
  kind: Exclude<SaveErrorKind, "unsure" | "forbidden" | "failed">;
  /** A real server message the pattern must match. */
  sample: string;
  /** A fixed piece of the server's text; a test checks the server source still carries it. */
  src: string;
};

/**
 * The server's plain-English refusals for `bundle.createReceipt`, in the order they are tried. The server
 * sends only its tRPC code and a sentence (no machine code for these), so the sentence is the key: each
 * entry carries a `sample` and a `src`, and `pack-submit.test.ts` checks both against the server source, so
 * a reworded sentence fails a test instead of silently degrading. A sentence matching none of them gets the
 * generic line in `packSaveText`, never the server's words.
 */
export const PACK_REFUSALS: readonly PackRefusal[] = [
  { re: /^Pick the cast these bundles came from$/, kind: "cast", sample: "Pick the cast these bundles came from", src: "Pick the cast these bundles came from" },
  { re: /^Cast .* has no melt yet/, kind: "cast", sample: "Cast C-12 has no melt yet; pick another cast", src: "has no melt yet; pick another cast" },
  { re: /^Cast not found$/, kind: "cast", sample: "Cast not found", src: "Cast not found" },
  { re: /^Pick the die copy$/, kind: "copy", sample: "Pick the die copy", src: "Pick the die copy" },
  { re: /^This section has no copies$/, kind: "copy", sample: "This section has no copies", src: "This section has no copies" },
  { re: /say why the weight was typed instead of weighed/, kind: "reason", sample: "Row 2: say why the weight was typed instead of weighed", src: "say why the weight was typed instead of weighed" },
  { re: /no scale is connected; type the weight and say why/, kind: "scale", sample: "Row 1: no scale is connected; type the weight and say why", src: "no scale is connected; type the weight and say why" },
  { re: /a scale weight must be the reading/, kind: "scale", sample: "Row 1: a scale weight must be the reading", src: "a scale weight must be the reading" },
  { re: /^This line is pinned to /, kind: "pin", sample: "This line is pinned to 12170-2", src: "This line is pinned to" },
  { re: /^Die copy \S+ is (retired|at the die maker)$/, kind: "retired", sample: "Die copy 12170-2 is at the die maker", src: "is at the die maker" },
  { re: /pick an open order$/, kind: "order", sample: "Order 2610 is closed; pick an open order", src: "pick an open order" },
  { re: /^That order line is for another section$/, kind: "order", sample: "That order line is for another section", src: "That order line is for another section" },
  { re: /^Order line not found$/, kind: "order", sample: "Order line not found", src: "Order line not found" },
  { re: /^That order line changed meanwhile/, kind: "order", sample: "That order line changed meanwhile (closed, cancelled or removed). Pick the line again.", src: "That order line changed meanwhile" },
  { re: /^Pick the yard location for these bundles$/, kind: "yard", sample: "Pick the yard location for these bundles", src: "Pick the yard location for these bundles" },
  { re: /^Location not found$/, kind: "yard", sample: "Location not found", src: "Location not found" },
  { re: /^Location \S+ is retired$/, kind: "yard", sample: "Location Y2 is retired", src: "is retired" },
  { re: /^Bundles go to a yard location, not /, kind: "yard", sample: "Bundles go to a yard location, not Y2", src: "Bundles go to a yard location, not" },
];

export function saveErrorKind(error: unknown): SaveErrorKind {
  if (writeFailureKind(error) === "unsure") return "unsure";
  const e = (error && typeof error === "object" ? error : {}) as TrpcLike;
  const code = e.data?.code;
  const message = typeof e.message === "string" ? e.message : "";
  if (code === "FORBIDDEN") return /^This die belongs to/i.test(message) ? "owned" : "forbidden";
  if (code === "BAD_REQUEST" || code === "NOT_FOUND" || code === "CONFLICT") {
    for (const r of PACK_REFUSALS) if (r.re.test(message)) return r.kind;
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
      return { kind, title: t("pack.new.saveFailed"), body: t("errors.generic") };
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

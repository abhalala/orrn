/**
 * Pure model of the bought-in logs screen (XE row 42): the receive form check (what the server takes) and
 * the receipt size line. No React. Weights are grams and sizes whole mm on the wire; the drafts are text in
 * kg and mm (the plant boxes convert to those).
 */
import { parseDecimal } from "@orrn/domain";

import { kgToG } from "./melt-form";

/** The server's limits (`foundry.logs.receive`). */
export const LOG_DIAMETER_MM = { min: 20, max: 1_000 } as const;
export const LOG_LENGTH_MM = { min: 100, max: 10_000 } as const;
export const LOG_KG_MAX_G = 100_000_000;
export const LOG_PCS_MAX = 100_000;

export type ReceiveDraft = {
  vendorId: string;
  alloyId: string;
  receivedOn: string;
  diameterMm: string;
  lengthMm: string;
  pcs: string;
  kg: string;
  vendorCastNo: string;
  challanNo: string;
  note: string;
};

export function blankReceive(today: string): ReceiveDraft {
  return { vendorId: "", alloyId: "", receivedOn: today, diameterMm: "", lengthMm: "", pcs: "", kg: "", vendorCastNo: "", challanNo: "", note: "" };
}

export type ReceiveField = "vendor" | "alloy" | "day" | "future" | "diameter" | "length" | "pcs" | "kg";

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function wholeMm(text: string, range: { min: number; max: number }): number | null | "bad" {
  if (text.trim() === "") return null;
  const n = parseDecimal(text);
  if (n === null || !Number.isInteger(n) || n < range.min || n > range.max) return "bad";
  return n;
}

export type ReceiveResult =
  | {
      ok: true;
      input: {
        vendorId: string;
        alloyId: string;
        receivedOn: string;
        pcs: number;
        kgG: number;
        diameterMm?: number;
        lengthMm?: number;
        vendorCastNo?: string;
        challanNo?: string;
        note?: string;
      };
    }
  | { ok: false; field: ReceiveField };

/** The first bad field (in screen order) or the call's input. `today` is the plant's day; a later day is refused. */
export function receiveInput(d: ReceiveDraft, today: string): ReceiveResult {
  if (!d.vendorId) return { ok: false, field: "vendor" };
  if (!d.alloyId) return { ok: false, field: "alloy" };
  if (!DAY_RE.test(d.receivedOn)) return { ok: false, field: "day" };
  if (d.receivedOn > today) return { ok: false, field: "future" };
  const dia = wholeMm(d.diameterMm, LOG_DIAMETER_MM);
  if (dia === "bad") return { ok: false, field: "diameter" };
  const len = wholeMm(d.lengthMm, LOG_LENGTH_MM);
  if (len === "bad") return { ok: false, field: "length" };
  const pcsN = parseDecimal(d.pcs);
  if (pcsN === null || !Number.isInteger(pcsN) || pcsN < 1 || pcsN > LOG_PCS_MAX) return { ok: false, field: "pcs" };
  const kgG = kgToG(d.kg);
  if (kgG === null || kgG < 1 || kgG > LOG_KG_MAX_G) return { ok: false, field: "kg" };
  const castNo = d.vendorCastNo.trim();
  const challan = d.challanNo.trim();
  const note = d.note.trim();
  return {
    ok: true,
    input: {
      vendorId: d.vendorId,
      alloyId: d.alloyId,
      receivedOn: d.receivedOn,
      pcs: pcsN,
      kgG,
      ...(dia !== null ? { diameterMm: dia } : {}),
      ...(len !== null ? { lengthMm: len } : {}),
      ...(castNo ? { vendorCastNo: castNo } : {}),
      ...(challan ? { challanNo: challan } : {}),
      ...(note ? { note } : {}),
    },
  };
}

/** Which size parts a receipt has: both, one, or none (the screen words each case). */
export function sizeParts(r: { diameterMm: number | null; lengthMm: number | null }): "both" | "diameter" | "length" | "none" {
  if (r.diameterMm && r.lengthMm) return "both";
  if (r.diameterMm) return "diameter";
  if (r.lengthMm) return "length";
  return "none";
}

/** MTC files the server takes: a PDF or a photo (`beginMtc`). */
export function mtcFileOk(name: string): boolean {
  return /\.(pdf|jpe?g|png|webp|heic|heif)$/i.test(name.trim());
}

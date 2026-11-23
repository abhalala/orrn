import { kgToG, parseDecimal, withoutGrouping } from "@orrn/domain";

import type { DeviceHealth } from "@orrn/domain";

/** The chip colour of a device state. Colour is never the only signal: the chip says the word too. */
export function healthTone(h: DeviceHealth): "green" | "amber" | "red" | "neutral" {
  return h === "live" ? "green" : h === "late" ? "amber" : h === "silent" ? "red" : "neutral";
}

/** The Today tile colour from the counts: any silent device is red, any late one amber, all live green. */
export function tileTone(c: { live: number; late: number; silent: number; total: number }): "green" | "amber" | "red" | "neutral" {
  if (c.silent > 0) return "red";
  if (c.late > 0) return "amber";
  return c.live > 0 && c.live === c.total ? "green" : "neutral";
}

export const DEVICE_KIND_LIST = ["weighbridge", "profile_scanner", "utm", "spectro", "scale", "plc", "oven"] as const;
export type DeviceKindId = (typeof DEVICE_KIND_LIST)[number];
export const DEVICE_PROTOCOL_LIST = ["modbus_tcp", "opc_ua", "serial", "file", "sim"] as const;
export type DeviceProtocolId = (typeof DEVICE_PROTOCOL_LIST)[number];

export const TOLERANCE_BP_MAX = 1000;
export const HEARTBEAT_MIN = 10;
export const HEARTBEAT_MAX = 3600;
export const CSV_MAX_BYTES = 512 * 1024;

/** 50 -> "0.5", 125 -> "1.25", 100 -> "1". */
export function bpToPercentText(bp: number): string {
  const whole = Math.floor(bp / 100);
  const frac = bp % 100;
  if (frac === 0) return String(whole);
  return `${whole}.${String(frac).padStart(2, "0").replace(/0$/, "")}`;
}

/** "0.5" -> 50, "1.25" -> 125; null when blank, not a number, over 10 percent or finer than 2 decimals. */
export function percentTextToBp(text: string): number | null {
  const t = text.trim();
  if (t === "") return null;
  const plain = withoutGrouping(t);
  if (plain === null || !/^\d+(\.\d{1,2})?$/.test(plain)) return null;
  const n = parseDecimal(t);
  if (n === null) return null;
  const bp = Math.round(n * 100);
  return bp >= 0 && bp <= TOLERANCE_BP_MAX ? bp : null;
}

/** A whole number of seconds in 10 to 3600, else null. */
export function heartbeatFrom(text: string): number | null {
  const t = text.trim();
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return n >= HEARTBEAT_MIN && n <= HEARTBEAT_MAX ? n : null;
}

/** A device code as the server wants it: 2 to 24 letters, digits or dashes, upper case. */
export function isCode(code: string): boolean {
  return /^[A-Z0-9][A-Z0-9-]{1,23}$/.test(code.trim().toUpperCase());
}

/** The import error codes the screen has words for; any other code reads as "other". */
const KNOWN_IMPORT_CODES = ["bad_number", "bad_time", "missing", "net_mismatch", "tare_above_gross", "too_many"] as const;
export function importErrorKey(code: string): (typeof KNOWN_IMPORT_CODES)[number] | "other" {
  return (KNOWN_IMPORT_CODES as readonly string[]).includes(code) ? (code as (typeof KNOWN_IMPORT_CODES)[number]) : "other";
}

/** Which refusal sentence key a failed write says, from the tRPC code (the server's English is never shown). */
export function errorKey(error: unknown): "conflict" | "notFound" | "forbidden" | "bad" | "failed" {
  const code = (error as { data?: { code?: string } } | null)?.data?.code;
  if (code === "CONFLICT") return "conflict";
  if (code === "NOT_FOUND") return "notFound";
  if (code === "FORBIDDEN") return "forbidden";
  if (code === "BAD_REQUEST") return "bad";
  return "failed";
}

/** Where a weigh's lot or load lives: the lot page or the dispatch page. */
export function weighSubjectPath(type: string, id: string): string {
  return type === "purchase_lot" ? `/purchase/${encodeURIComponent(id)}` : `/dispatch/${encodeURIComponent(id)}`;
}

/** What a lab reading carries, as plain numbers: tensile and yield in MPa, elongation in percent (stored x10). */
export function labValues(kind: string, values: unknown): { points: number | null; tensile: string; yield: string; elong: string } {
  const v = (values ?? {}) as { points?: unknown; tensileMpa?: unknown; yieldMpa?: unknown; elongationX10?: unknown };
  const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : null);
  const tensile = num(v.tensileMpa);
  const yld = num(v.yieldMpa);
  const el = num(v.elongationX10);
  return {
    points: kind === "dimension" && Array.isArray(v.points) ? v.points.length : null,
    tensile: tensile === null ? "-" : `${tensile} MPa`,
    yield: yld === null ? "-" : `${yld} MPa`,
    elong: el === null ? "-" : `${el / 10}%`,
  };
}

/** The smallest allowed weight difference, from the form's kg draft, in whole grams. Zero is allowed; blank or a bad number is null. */
export function minWeightG(draft: string): number | null {
  if (draft.trim() === "") return null;
  const kg = parseDecimal(draft);
  if (kg === null || kg < 0) return null;
  const g = kgToG(kg);
  return g <= 1_000_000 ? g : null;
}

/** The heaviest weight a person may type for a lot or a truck: 200 tonnes, the server's ceiling. */
export const TYPED_MAX_G = 200_000_000;

/** A typed weight from the form's kg draft, in whole grams: at least 1 g and at most 200 tonnes, else null. */
export function typedWeightG(draft: string): number | null {
  if (draft.trim() === "") return null;
  const kg = parseDecimal(draft);
  if (kg === null || kg <= 0) return null;
  const g = kgToG(kg);
  return g >= 1 && g <= TYPED_MAX_G ? g : null;
}

/**
 * Plant connections (XE parity lane DEVICES, module `devices`, opt-in): the weighbridge, the profile
 * scanner, the tensile tester (UTM) and the existing collectors' devices. Pure rules only: the weigh
 * tolerance (the kanta check), the device clock, device health and the CSV files a device PC exports.
 *
 * Units: grams for weights, micrometres for lengths, MPa and x10 integers for the tensile test (the
 * QA check's units). A CSV says its own unit; nothing here guesses kg against tonnes.
 *
 * No real device is connected anywhere yet (owner items: weighbridge, scanner and PLC makes, a plant to
 * install in). Every reading says whether it was simulated, and a simulated reading never becomes a
 * weight on a lot or a quality check.
 */

export const DEVICE_KINDS = ["weighbridge", "profile_scanner", "utm", "spectro", "scale", "plc", "oven"] as const;
export type DeviceKind = (typeof DEVICE_KINDS)[number];

/** How the edge box talks to the device. `file` = the device PC drops files; `sim` = the edge simulator. */
export const DEVICE_PROTOCOLS = ["modbus_tcp", "opc_ua", "serial", "file", "sim"] as const;
export type DeviceProtocol = (typeof DEVICE_PROTOCOLS)[number];

/** What a reading carries. A weighbridge ticket, a set of measured dimensions, or one tensile test. */
export const DEVICE_READING_KINDS = ["weighbridge", "dimension", "mechanical"] as const;
export type DeviceReadingKind = (typeof DEVICE_READING_KINDS)[number];

/** The reading kinds each device kind may send. */
export const DEVICE_KIND_READINGS: Record<DeviceKind, readonly DeviceReadingKind[]> = {
  weighbridge: ["weighbridge"],
  profile_scanner: ["dimension"],
  utm: ["mechanical"],
  spectro: [],
  scale: [],
  plc: [],
  oven: [],
};

export function deviceMaySend(kind: DeviceKind, reading: DeviceReadingKind): boolean {
  return DEVICE_KIND_READINGS[kind].includes(reading);
}

// ---------------------------------------------------------------------------
// Plant settings (`company.settings.devices`)
// ---------------------------------------------------------------------------

export type DeviceSettings = {
  /** A typed weight may differ from the bridge by this share (basis points of the bridge net) ... */
  weighToleranceBp: number;
  /** ... or by this many grams, whichever is larger. */
  weighToleranceMinG: number;
  /** A device that has not been heard from in 2 heartbeats is late, in 10 it is silent. */
  heartbeatSec: number;
};

export const DEVICE_SETTINGS_DEFAULTS: DeviceSettings = { weighToleranceBp: 50, weighToleranceMinG: 20_000, heartbeatSec: 60 };
export const DEVICE_TOLERANCE_BP_MAX = 1000;
export const DEVICE_TOLERANCE_MIN_G_MAX = 1_000_000;
export const DEVICE_HEARTBEAT_SEC_MIN = 10;
export const DEVICE_HEARTBEAT_SEC_MAX = 3600;

function intIn(v: unknown, min: number, max: number): number | null {
  return typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : null;
}

/** Tolerant reader: a missing or malformed value falls back to the default. */
export function readDeviceSettings(settings: Record<string, unknown> | null | undefined): DeviceSettings {
  const raw = settings && typeof settings.devices === "object" && settings.devices ? (settings.devices as Record<string, unknown>) : {};
  return {
    weighToleranceBp: intIn(raw.weighToleranceBp, 0, DEVICE_TOLERANCE_BP_MAX) ?? DEVICE_SETTINGS_DEFAULTS.weighToleranceBp,
    weighToleranceMinG: intIn(raw.weighToleranceMinG, 0, DEVICE_TOLERANCE_MIN_G_MAX) ?? DEVICE_SETTINGS_DEFAULTS.weighToleranceMinG,
    heartbeatSec: intIn(raw.heartbeatSec, DEVICE_HEARTBEAT_SEC_MIN, DEVICE_HEARTBEAT_SEC_MAX) ?? DEVICE_SETTINGS_DEFAULTS.heartbeatSec,
  };
}

// ---------------------------------------------------------------------------
// Weighbridge (row 48)
// ---------------------------------------------------------------------------

/** Net = gross - tare. A tare above the gross is not a ticket. */
export function weighbridgeNet(grossG: number, tareG: number): number | null {
  if (!Number.isInteger(grossG) || !Number.isInteger(tareG) || grossG <= 0 || tareG < 0 || tareG >= grossG) return null;
  return grossG - tareG;
}

export type WeighCheck = { diffG: number; allowedG: number; flagged: boolean };

/**
 * The kanta check: a weight typed instead of taken from the bridge is flagged when it differs from the
 * bridge's net by more than the plant's tolerance (the larger of the share and the grams).
 */
export function weighMismatch(typedG: number, bridgeG: number, s: Pick<DeviceSettings, "weighToleranceBp" | "weighToleranceMinG">): WeighCheck {
  const diffG = typedG - bridgeG;
  const allowedG = Math.max(s.weighToleranceMinG, Math.floor((Math.abs(bridgeG) * s.weighToleranceBp) / 10_000));
  return { diffG, allowedG, flagged: Math.abs(diffG) > allowedG };
}

/** A ticket belongs to a truck when the numbers match once spaces and dashes are dropped. */
export function sameVehicle(a: string | null | undefined, b: string | null | undefined): boolean {
  const n = (v: string | null | undefined) => (v ?? "").replace(/[\s-]+/g, "").toUpperCase();
  return n(a) !== "" && n(a) === n(b);
}

/** How far back a ticket for the same truck is offered (and checked) for a lot or a load. */
export const WEIGH_TICKET_WINDOW_MS = 24 * 3600_000;

// ---------------------------------------------------------------------------
// Device clock (row 95)
// ---------------------------------------------------------------------------

/** A device clock this far from ORRN's (measured on the request's sent time) marks its times unconfirmed. */
export const DEVICE_SKEW_UNCONFIRMED_MS = 2 * 60_000;
/** A reading sampled more than this ahead of ORRN's clock (after correction) is refused, like a press frame. */
export const DEVICE_MAX_AHEAD_MS = 5 * 60_000;

export type DeviceClock = { skewMs: number; sampledAtMs: number; unconfirmed: boolean; refused: boolean };

/**
 * Skew is measured from the request's own sent time (`receivedAt - sentAt`), never from a reading's
 * sampled time: a buffered reading replayed after a network cut is old by design and is kept. A skew
 * within 2 minutes is the network; beyond it the device clock is wrong, the sampled time is moved by the
 * skew and marked unconfirmed. A reading still in the future after that is refused.
 */
export function deviceClock(o: { sentAtMs: number; receivedAtMs: number; sampledAtMs: number }): DeviceClock {
  const skewMs = o.receivedAtMs - o.sentAtMs;
  const unconfirmed = Math.abs(skewMs) > DEVICE_SKEW_UNCONFIRMED_MS;
  const sampledAtMs = unconfirmed ? o.sampledAtMs + skewMs : o.sampledAtMs;
  return { skewMs, sampledAtMs, unconfirmed, refused: sampledAtMs > o.receivedAtMs + DEVICE_MAX_AHEAD_MS };
}

// ---------------------------------------------------------------------------
// Device health (row 95)
// ---------------------------------------------------------------------------

export const DEVICE_HEALTH = ["live", "late", "silent", "never", "revoked"] as const;
export type DeviceHealth = (typeof DEVICE_HEALTH)[number];

export function deviceHealth(o: { revoked: boolean; lastSeenAtMs: number | null; nowMs: number; heartbeatSec: number }): DeviceHealth {
  if (o.revoked) return "revoked";
  if (o.lastSeenAtMs == null) return "never";
  const age = o.nowMs - o.lastSeenAtMs;
  if (age <= 2 * o.heartbeatSec * 1000) return "live";
  if (age <= 10 * o.heartbeatSec * 1000) return "late";
  return "silent";
}

export type DeviceHealthCounts = Record<DeviceHealth, number> & { simulated: number; total: number };

export function healthCounts(rows: readonly { health: DeviceHealth; simulated: boolean }[]): DeviceHealthCounts {
  const out: DeviceHealthCounts = { live: 0, late: 0, silent: 0, never: 0, revoked: 0, simulated: 0, total: 0 };
  for (const r of rows) {
    out[r.health] += 1;
    if (r.simulated && r.health !== "revoked") out.simulated += 1;
    if (r.health !== "revoked") out.total += 1;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Sample codes (row 94)
// ---------------------------------------------------------------------------

/** The code printed on a sample (a press run number, a bundle serial, an ageing batch number). */
export function normaliseSampleCode(raw: string | null | undefined): string {
  return (raw ?? "").trim().replace(/\s+/g, "").toUpperCase();
}

/** A device code: letters, digits and dashes, 2 to 24 characters (WB-1, SCAN-2, UTM). */
export function isDeviceCode(code: string): boolean {
  return /^[A-Z0-9][A-Z0-9-]{1,23}$/.test(code);
}

// ---------------------------------------------------------------------------
// CSV files from a device PC
// ---------------------------------------------------------------------------

export const DEVICE_CSV_MAX_ROWS = 500;
export const DEVICE_CSV_MAX_BYTES = 512 * 1024;

/** RFC 4180 lite: commas or semicolons, double quotes, CRLF or LF. Blank lines are dropped. */
export function parseCsv(text: string): string[][] {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const sep = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else cell += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === sep) {
      row.push(cell.trim());
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      row.push(cell.trim());
      if (row.some((c) => c !== "")) rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  row.push(cell.trim());
  if (row.some((c) => c !== "")) rows.push(row);
  return rows;
}

export type CsvRowError = { line: number; code: "bad_number" | "missing" | "bad_time" | "tare_above_gross" | "net_mismatch" | "too_many" };

const header = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, "");

function column(headers: string[], ...names: string[]): number {
  for (const n of names) {
    const at = headers.indexOf(n);
    if (at >= 0) return at;
  }
  return -1;
}

/** A decimal string as an integer multiple of 1/scale (e.g. "12.345" t at 1e6 -> 12 345 000 g). */
export function decimalToInt(raw: string, scale: number): number | null {
  const s = raw.replace(/,/g, "").trim();
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const v = Math.round(Number(s) * scale);
  return Number.isSafeInteger(v) ? v : null;
}

/** Milliseconds since the epoch; a time with no offset is plant time and is moved by `offsetMin`. */
function timeMs(raw: string, offsetMin: number): number | null {
  if (!raw) return null;
  const iso = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?/.test(raw) ? raw.replace(" ", "T") : null;
  const dmy = raw.match(/^(\d{2})[/.-](\d{2})[/.-](\d{4})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
  const s = iso ?? (dmy ? `${dmy[3]}-${dmy[2]}-${dmy[1]}T${dmy[4]}:${dmy[5]}:${dmy[6] ?? "00"}` : null);
  if (!s) return null;
  // A time without an offset is plant time; the caller passes the plant's offset in minutes.
  const hasOffset = /[zZ]|[+-]\d{2}:?\d{2}$/.test(s);
  const ms = Date.parse(hasOffset ? s : `${s}Z`);
  if (!Number.isFinite(ms)) return null;
  return hasOffset ? ms : ms - offsetMin * 60_000;
}

export type WeighCsvUnit = "kg" | "t";
export type WeighCsvRow = { line: number; ticketNo: string; vehicleNo: string | null; grossG: number; tareG: number; netG: number; atMs: number };

/**
 * A weighbridge PC's ticket export: ticket, vehicle, gross, tare, (net), time. `unit` is the file's unit
 * (the person picks it on import); `offsetMin` is the plant's UTC offset for times with no offset.
 */
export function parseWeighbridgeCsv(text: string, unit: WeighCsvUnit, offsetMin: number): { rows: WeighCsvRow[]; errors: CsvRowError[] } {
  const all = parseCsv(text);
  const head = (all[0] ?? []).map(header);
  const c = {
    ticket: column(head, "ticket", "ticketno", "slip", "slipno", "serial", "rst", "rstno"),
    vehicle: column(head, "vehicle", "vehicleno", "truck", "truckno"),
    gross: column(head, "gross", "grosswt", "grossweight"),
    tare: column(head, "tare", "tarewt", "tareweight"),
    net: column(head, "net", "netwt", "netweight"),
    time: column(head, "time", "datetime", "date", "weighedat", "grossdatetime"),
  };
  const scale = unit === "t" ? 1_000_000 : 1000;
  const rows: WeighCsvRow[] = [];
  const errors: CsvRowError[] = [];
  const body = all.slice(1);
  if (body.length > DEVICE_CSV_MAX_ROWS) return { rows: [], errors: [{ line: 0, code: "too_many" }] };
  body.forEach((r, i) => {
    const line = i + 2;
    const get = (at: number) => (at >= 0 ? (r[at] ?? "") : "");
    const ticketNo = get(c.ticket);
    if (!ticketNo || c.gross < 0 || c.tare < 0) return void errors.push({ line, code: "missing" });
    const grossG = decimalToInt(get(c.gross), scale);
    const tareG = decimalToInt(get(c.tare), scale);
    if (grossG == null || tareG == null) return void errors.push({ line, code: "bad_number" });
    const netG = weighbridgeNet(grossG, tareG);
    if (netG == null) return void errors.push({ line, code: "tare_above_gross" });
    if (c.net >= 0 && get(c.net)) {
      const typedNet = decimalToInt(get(c.net), scale);
      if (typedNet == null) return void errors.push({ line, code: "bad_number" });
      if (Math.abs(typedNet - netG) > scale / 1000) return void errors.push({ line, code: "net_mismatch" });
    }
    const t = timeMs(get(c.time), offsetMin);
    if (t == null) return void errors.push({ line, code: "bad_time" });
    const vehicle = get(c.vehicle).replace(/[\s-]+/g, "").toUpperCase();
    rows.push({ line, ticketNo: ticketNo.slice(0, 40), vehicleNo: vehicle ? vehicle.slice(0, 15) : null, grossG, tareG, netG, atMs: t });
  });
  return { rows, errors };
}

export type ScanPoint = { name: string; measuredUm: number; nominalUm: number | null; minusUm: number | null; plusUm: number | null };
export type ScanCsvSample = { line: number; sampleCode: string; atMs: number; points: ScanPoint[] };

/**
 * A profile scanner's export: one line per measured dimension (sample, dimension, measured mm, and the
 * drawing's nominal, minus and plus in mm when the scanner knows them). Lines of one sample code and time
 * make one reading.
 */
export function parseScannerCsv(text: string, offsetMin: number): { samples: ScanCsvSample[]; errors: CsvRowError[] } {
  const all = parseCsv(text);
  const head = (all[0] ?? []).map(header);
  const c = {
    sample: column(head, "sample", "samplecode", "code", "lot", "run"),
    name: column(head, "dimension", "dim", "name", "feature"),
    measured: column(head, "measured", "measuredmm", "actual", "value"),
    nominal: column(head, "nominal", "nominalmm"),
    minus: column(head, "minus", "minusmm", "lowertol", "tolminus"),
    plus: column(head, "plus", "plusmm", "uppertol", "tolplus"),
    time: column(head, "time", "datetime", "date", "measuredat"),
  };
  const errors: CsvRowError[] = [];
  const body = all.slice(1);
  if (body.length > DEVICE_CSV_MAX_ROWS) return { samples: [], errors: [{ line: 0, code: "too_many" }] };
  const by = new Map<string, ScanCsvSample>();
  body.forEach((r, i) => {
    const line = i + 2;
    const get = (at: number) => (at >= 0 ? (r[at] ?? "") : "");
    const code = normaliseSampleCode(get(c.sample));
    const name = get(c.name);
    if (!code || !name) return void errors.push({ line, code: "missing" });
    const measuredUm = decimalToInt(get(c.measured), 1000);
    if (measuredUm == null) return void errors.push({ line, code: "bad_number" });
    const opt = (at: number) => {
      const v = get(at);
      return v ? decimalToInt(v, 1000) : null;
    };
    const nominalUm = opt(c.nominal);
    const minusUm = opt(c.minus);
    const plusUm = opt(c.plus);
    if ((get(c.nominal) && nominalUm == null) || (get(c.minus) && minusUm == null) || (get(c.plus) && plusUm == null)) return void errors.push({ line, code: "bad_number" });
    const t = timeMs(get(c.time), offsetMin);
    if (t == null) return void errors.push({ line, code: "bad_time" });
    const key = `${code}|${t}`;
    const s = by.get(key) ?? { line, sampleCode: code, atMs: t, points: [] };
    s.points.push({ name: name.slice(0, 40), measuredUm, nominalUm, minusUm: minusUm == null ? null : Math.abs(minusUm), plusUm });
    by.set(key, s);
  });
  return { samples: [...by.values()], errors };
}

export type UtmCsvRow = { line: number; sampleCode: string; atMs: number; tensileMpa: number | null; yieldMpa: number | null; elongationX10: number | null };

/** A tensile tester's export: sample, tensile MPa, yield MPa (0.2 % proof), elongation %, time. */
export function parseUtmCsv(text: string, offsetMin: number): { rows: UtmCsvRow[]; errors: CsvRowError[] } {
  const all = parseCsv(text);
  const head = (all[0] ?? []).map(header);
  const c = {
    sample: column(head, "sample", "samplecode", "code", "specimen"),
    tensile: column(head, "tensile", "tensilempa", "uts", "utsmpa", "rm"),
    yield: column(head, "yield", "yieldmpa", "proof", "rp02"),
    elong: column(head, "elongation", "elongationpct", "elong", "a"),
    time: column(head, "time", "datetime", "date", "testedat"),
  };
  const errors: CsvRowError[] = [];
  const rows: UtmCsvRow[] = [];
  const body = all.slice(1);
  if (body.length > DEVICE_CSV_MAX_ROWS) return { rows: [], errors: [{ line: 0, code: "too_many" }] };
  body.forEach((r, i) => {
    const line = i + 2;
    const get = (at: number) => (at >= 0 ? (r[at] ?? "") : "");
    const code = normaliseSampleCode(get(c.sample));
    if (!code) return void errors.push({ line, code: "missing" });
    const num = (at: number, scale: number) => {
      const v = get(at);
      if (!v) return { ok: true as const, v: null };
      const n = decimalToInt(v, scale);
      return n == null || n < 0 ? { ok: false as const } : { ok: true as const, v: n };
    };
    const t1 = num(c.tensile, 1);
    const y1 = num(c.yield, 1);
    const e1 = num(c.elong, 10);
    if (!t1.ok || !y1.ok || !e1.ok) return void errors.push({ line, code: "bad_number" });
    if (t1.v == null && y1.v == null && e1.v == null) return void errors.push({ line, code: "missing" });
    const t = timeMs(get(c.time), offsetMin);
    if (t == null) return void errors.push({ line, code: "bad_time" });
    rows.push({ line, sampleCode: code, atMs: t, tensileMpa: t1.v, yieldMpa: y1.v, elongationX10: e1.v });
  });
  return { rows, errors };
}

/**
 * Fill a scanned point's drawing values from the quality plan when the scanner did not send them (matched
 * by dimension name, case and spaces ignored). A point with no nominal anywhere is left out of the verdict.
 */
export function withPlanNominals(
  points: readonly ScanPoint[],
  plan: readonly { name: string; nominalUm: number; minusUm: number; plusUm: number }[],
): { complete: { name: string; nominalUm: number; minusUm: number; plusUm: number; measuredUm: number }[]; unknown: string[] } {
  const key = (s: string) => s.toLowerCase().replace(/\s+/g, "");
  const byName = new Map(plan.map((d) => [key(d.name), d]));
  const complete: { name: string; nominalUm: number; minusUm: number; plusUm: number; measuredUm: number }[] = [];
  const unknown: string[] = [];
  for (const p of points) {
    const d = byName.get(key(p.name));
    const nominalUm = p.nominalUm ?? d?.nominalUm ?? null;
    const minusUm = p.minusUm ?? d?.minusUm ?? null;
    const plusUm = p.plusUm ?? d?.plusUm ?? null;
    if (nominalUm == null || minusUm == null || plusUm == null) unknown.push(p.name);
    else complete.push({ name: p.name, nominalUm, minusUm, plusUm, measuredUm: p.measuredUm });
  }
  return { complete, unknown };
}

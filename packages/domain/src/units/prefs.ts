/** Unit preferences and the two resolvers. Pure functions: no storage, no UI. Design: UNITS-DESIGN.md sections 3 and 4.4. */
import { isKind, isUnitId, KINDS, UNITS, type Kind, type UnitId } from "./registry";
import { DEFAULT_NUMBER_STYLE, type NumberStyle } from "./style";

export type Context = "entry" | "screen" | "total" | "print" | "export" | "axis";
export const CONTEXTS: readonly Context[] = ["entry", "screen", "total", "print", "export", "axis"];
export type DocType = "packing_list" | "label" | "certificate" | "order_sheet" | "portal";
export const DOC_TYPES: readonly DocType[] = ["packing_list", "label", "certificate", "order_sheet", "portal"];

export type UnitPrefs = {
  v?: 1;
  units?: Partial<Record<Kind, UnitId>>;
  inchGrid?: 4 | 8 | 16;
  number?: Partial<NumberStyle>;
  currency?: { symbol?: "₹" | "Rs" | "INR"; compact?: "indian" | "international" };
  date?: { order?: "dmy" | "mdy" | "ymd"; month?: "short" | "numeric" };
  clock?: "h23" | "h12";
  precision?: Partial<Record<`${Kind}.${Context}`, number>>;
};

export type PlantUnitSettings = UnitPrefs & {
  lock?: readonly Kind[];
  documents?: Partial<Record<DocType, UnitPrefs & { fixed?: readonly Kind[] }>>;
};

export type ResolvedPrefs = {
  v: 1;
  units: Record<Kind, UnitId>;
  inchGrid: 4 | 8 | 16;
  number: NumberStyle;
  currency: { symbol: "₹" | "Rs" | "INR"; compact: "indian" | "international" };
  date: { order: "dmy" | "mdy" | "ymd"; month: "short" | "numeric" };
  clock: "h23" | "h12";
  precision: Record<string, number>;
};

export const ORRN_DEFAULT_PREFS: ResolvedPrefs = Object.freeze({
  v: 1,
  units: Object.freeze({
    mass: "kg", length: "mm", linear_mass: "kg_12ft", money: "inr", money_per_mass: "inr_kg", ratio: "pct",
    temperature: "c", pressure: "bar", speed: "mm_s", volume: "l", duration: "min", count: "pcs",
  }) as Record<Kind, UnitId>,
  inchGrid: 4,
  number: Object.freeze({ ...DEFAULT_NUMBER_STYLE }),
  currency: Object.freeze({ symbol: "₹", compact: "indian" }),
  date: Object.freeze({ order: "dmy", month: "short" }),
  clock: "h23",
  precision: Object.freeze({}) as Record<string, number>,
}) as ResolvedPrefs;

/** Today's packing list and labels: kg at 2 places, feet and inches on a quarter grid, kg/12ft at 3. */
export const LEGACY_DOC_UNITS: ResolvedPrefs = Object.freeze({
  ...ORRN_DEFAULT_PREFS,
  units: Object.freeze({ ...ORRN_DEFAULT_PREFS.units, length: "ft_in" }) as Record<Kind, UnitId>,
  precision: Object.freeze({ "mass.print": 2, "linear_mass.print": 3 }) as Record<string, number>,
}) as ResolvedPrefs;

const MAX_BYTES = 2048;

const NUMBER_GROUPING = ["indian", "international", "none"] as const;
const NUMBER_DECIMAL = [".", ","] as const;
const NUMBER_GROUP = [",", ".", " ", " "] as const;

function pick<T extends string | number>(allowed: readonly T[], v: unknown): T | undefined {
  return allowed.includes(v as T) ? (v as T) : undefined;
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);

/** Shared walk. In tolerant mode junk is dropped; in strict mode each piece of junk adds an error. */
function readLayer(raw: unknown, errors: string[] | null): UnitPrefs {
  const out: UnitPrefs = {};
  const bad = (msg: string) => errors?.push(msg);
  if (!isObj(raw)) {
    if (raw !== undefined && raw !== null) bad("prefs must be an object");
    return out;
  }
  if (isObj(raw.units)) {
    const units: Partial<Record<Kind, UnitId>> = {};
    for (const [k, u] of Object.entries(raw.units)) {
      if (!isKind(k)) bad(`unknown kind ${k}`);
      else if (!isUnitId(u)) bad(`unknown unit ${String(u)} for ${k}`);
      else if (UNITS[u].kind !== k) bad(`${u} is not a unit of ${k}`);
      else if (UNITS[u].noEntry) bad(`${u} is not offered as a display unit`);
      else units[k] = u;
    }
    if (Object.keys(units).length) out.units = units;
  } else if (raw.units !== undefined) bad("units must be an object");
  if (raw.inchGrid !== undefined) {
    const g = pick([4, 8, 16] as const, raw.inchGrid);
    if (g) out.inchGrid = g;
    else bad("inchGrid must be 4, 8 or 16");
  }
  if (isObj(raw.number)) {
    const n: Partial<NumberStyle> = {};
    const g = pick(NUMBER_GROUPING, raw.number.grouping);
    const d = pick(NUMBER_DECIMAL, raw.number.decimal);
    const m = pick(NUMBER_GROUP, raw.number.group);
    if (g) n.grouping = g; else if (raw.number.grouping !== undefined) bad("bad number.grouping");
    if (d) n.decimal = d; else if (raw.number.decimal !== undefined) bad("bad number.decimal");
    if (m) n.group = m; else if (raw.number.group !== undefined) bad("bad number.group");
    if (n.decimal && (n.group ?? "") === n.decimal) bad("decimal mark and group mark must differ");
    if (Object.keys(n).length) out.number = n;
  } else if (raw.number !== undefined) bad("number must be an object");
  if (isObj(raw.currency)) {
    const symbol = pick(["₹", "Rs", "INR"] as const, raw.currency.symbol);
    const compact = pick(["indian", "international"] as const, raw.currency.compact);
    if (raw.currency.symbol !== undefined && !symbol) bad("bad currency.symbol");
    if (raw.currency.compact !== undefined && !compact) bad("bad currency.compact");
    if (symbol || compact) out.currency = { ...(symbol ? { symbol } : {}), ...(compact ? { compact } : {}) };
  } else if (raw.currency !== undefined) bad("currency must be an object");
  if (isObj(raw.date)) {
    const order = pick(["dmy", "mdy", "ymd"] as const, raw.date.order);
    const month = pick(["short", "numeric"] as const, raw.date.month);
    if (raw.date.order !== undefined && !order) bad("bad date.order");
    if (raw.date.month !== undefined && !month) bad("bad date.month");
    if (order || month) out.date = { ...(order ? { order } : {}), ...(month ? { month } : {}) };
  } else if (raw.date !== undefined) bad("date must be an object");
  const clock = pick(["h23", "h12"] as const, raw.clock);
  if (clock) out.clock = clock;
  else if (raw.clock !== undefined) bad("clock must be h23 or h12");
  if (isObj(raw.precision)) {
    const precision: Record<string, number> = {};
    for (const [key, v] of Object.entries(raw.precision)) {
      const [k, c] = key.split(".");
      const okKey = isKind(k) && CONTEXTS.includes(c as Context);
      if (okKey && Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 8) precision[key] = v as number;
      else bad(`bad precision ${key}`);
    }
    if (Object.keys(precision).length) out.precision = precision as UnitPrefs["precision"];
  }
  if (out.units || out.inchGrid || out.number || out.currency || out.date || out.clock || out.precision) out.v = 1;
  return out;
}

const kindsOf = (x: unknown): Kind[] => (Array.isArray(x) ? x.filter(isKind) : []);

function readDocuments(raw: unknown, errors: string[] | null): PlantUnitSettings["documents"] | undefined {
  if (!isObj(raw)) return undefined;
  const docs: NonNullable<PlantUnitSettings["documents"]> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!DOC_TYPES.includes(k as DocType)) {
      errors?.push(`unknown document type ${k}`);
      continue;
    }
    const layer = readLayer(v, errors);
    const fixed = isObj(v) ? kindsOf(v.fixed) : [];
    docs[k as DocType] = fixed.length ? { ...layer, fixed } : layer;
  }
  return Object.keys(docs).length ? docs : undefined;
}

/** Tolerant reader for `company.settings`: the `units` block plus the legacy `lengthUnit`. Junk gives defaults. */
export function readUnitSettings(raw: unknown): PlantUnitSettings {
  const settings = isObj(raw) ? raw : {};
  const block = isObj(settings.units) ? settings.units : {};
  const layer = readLayer(block, null);
  const out: PlantUnitSettings = { ...layer };
  const lock = kindsOf(block.lock);
  if (lock.length) out.lock = lock;
  const documents = readDocuments(block.documents, null);
  if (documents) out.documents = documents;
  if (!(out.units && "length" in out.units)) {
    if (settings.lengthUnit === "inch") {
      out.units = { ...out.units, length: "ft_in" };
      out.inchGrid ??= 4;
      out.v = 1;
    } else if (settings.lengthUnit === "mm") {
      out.units = { ...out.units, length: "mm" };
      out.v = 1;
    }
  }
  return out;
}

/**
 * A plant write laid over what the plant has: the keys sent win, and the maps of choices (`units`, `number`, `date`,
 * `currency`) merge one level deeper, so a write that names only the clock keeps the plant's weight, length and
 * marks. The Units tab sends only the choices the person changed, so two admins' saves do not undo each other.
 */
export function mergeUnitSettings(current: PlantUnitSettings, sent: Record<string, unknown>): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...current, ...sent };
  for (const key of ["units", "number", "date", "currency"] as const) {
    const before = (current as Record<string, unknown>)[key];
    if (isObj(before) && isObj(sent[key])) merged[key] = { ...before, ...sent[key] };
  }
  return merged;
}

/** Tolerant reader for one person's stored preferences: unknown ids dropped, never throws. */
export function readUserPrefs(raw: unknown): UnitPrefs {
  return readLayer(raw, null);
}

/** For writes: refuses unknown ids, wrong kind, junk values and anything over 2 kB. */
export function validateUnitPrefs(input: unknown): { ok: true; prefs: UnitPrefs } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  let size = 0;
  try {
    size = JSON.stringify(input ?? {}).length;
  } catch {
    return { ok: false, errors: ["not JSON"] };
  }
  if (size > MAX_BYTES) return { ok: false, errors: [`over ${MAX_BYTES} bytes`] };
  const prefs = readLayer(input, errors);
  return errors.length ? { ok: false, errors } : { ok: true, prefs };
}

/** For plant writes: the same checks, plus `lock` and `documents`. */
export function validatePlantUnitSettings(
  input: unknown,
): { ok: true; settings: PlantUnitSettings } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  let size = 0;
  try {
    size = JSON.stringify(input ?? {}).length;
  } catch {
    return { ok: false, errors: ["not JSON"] };
  }
  if (size > MAX_BYTES) return { ok: false, errors: [`over ${MAX_BYTES} bytes`] };
  const layer = readLayer(input, errors);
  // The plant's marks are laid over the default set, so a layer that sends only one mark must still differ from the other (the default's).
  if (layer.number && !errors.some((e) => e.includes("must differ"))) {
    const merged = { ...ORRN_DEFAULT_PREFS.number, ...layer.number };
    if (merged.decimal === merged.group) errors.push("decimal mark and group mark must differ");
  }
  const settings: PlantUnitSettings = { ...layer };
  if (isObj(input)) {
    if (input.lock !== undefined) {
      const lock = kindsOf(input.lock);
      if (!Array.isArray(input.lock) || lock.length !== input.lock.length) errors.push("lock must list known kinds");
      if (lock.length) settings.lock = lock;
    }
    const documents = readDocuments(input.documents, errors);
    if (documents) settings.documents = documents;
  }
  return errors.length ? { ok: false, errors } : { ok: true, settings };
}

type Mutable = {
  -readonly [K in keyof ResolvedPrefs]: ResolvedPrefs[K];
};

function copy(p: ResolvedPrefs): Mutable {
  return {
    v: 1,
    units: { ...p.units },
    inchGrid: p.inchGrid,
    number: { ...p.number },
    currency: { ...p.currency },
    date: { ...p.date },
    clock: p.clock,
    precision: { ...p.precision },
  };
}

/** Lay one layer over the resolved set. Kinds in `blocked` keep what they have (units and precision both). */
function apply(base: Mutable, layer: UnitPrefs | undefined, blocked: readonly Kind[] = []): Mutable {
  if (!layer) return base;
  for (const [k, u] of Object.entries(layer.units ?? {})) {
    if (!blocked.includes(k as Kind) && u) base.units[k as Kind] = u;
  }
  if (layer.inchGrid) base.inchGrid = layer.inchGrid;
  if (layer.number) {
    const before = base.number;
    base.number = { ...before, ...layer.number };
    // A layer that sends only one mark can land on the other layer's mark (decimal "," over the default group ","). Never resolve
    // to a set whose decimal and group marks are the same: keep the group mark we had, or take the one that differs.
    if (base.number.decimal === base.number.group) {
      const other = base.number.decimal === "," ? "." : ",";
      base.number = { ...base.number, group: before.group !== base.number.decimal ? before.group : other };
    }
  }
  if (layer.currency) base.currency = { ...base.currency, ...layer.currency };
  if (layer.date) base.date = { ...base.date, ...layer.date };
  if (layer.clock) base.clock = layer.clock;
  for (const [key, v] of Object.entries(layer.precision ?? {})) {
    const kind = key.split(".")[0] as Kind;
    if (!blocked.includes(kind) && typeof v === "number") base.precision[key] = v;
  }
  return base;
}

/** Screens and input: orrn default, then plant, then user. The user layer skips kinds the plant locked. */
export function screenPrefs(plant: PlantUnitSettings, user?: UnitPrefs): ResolvedPrefs {
  const out = apply(copy(ORRN_DEFAULT_PREFS), plant);
  return apply(out, user, plant.lock ?? []);
}

/** Documents that leave the plant: default, plant, plant's document type, then customer minus the type's fixed kinds. */
export function documentPrefs(plant: PlantUnitSettings, doc: DocType, customer?: UnitPrefs | null): ResolvedPrefs {
  const docLayer = plant.documents?.[doc];
  const out = apply(apply(copy(ORRN_DEFAULT_PREFS), plant), docLayer);
  return apply(out, customer ?? undefined, docLayer?.fixed ?? []);
}

/** Stable key of a resolved set: sorted JSON. Two equal sets give the same key. */
export function prefsKey(p: ResolvedPrefs): string {
  const sortObj = (o: Record<string, unknown>) => Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));
  return JSON.stringify({
    v: p.v,
    units: sortObj(p.units),
    inchGrid: p.inchGrid,
    number: sortObj(p.number),
    currency: sortObj(p.currency),
    date: sortObj(p.date),
    clock: p.clock,
    precision: sortObj(p.precision),
  });
}

export const ALL_KINDS = KINDS;

/**
 * Search params of `/devices` (XE parity lane DEVICES). Plain functions, no imports: `validateSearch` stays in the
 * route entry chunk (AGENTS.md "Route files and the `/` budget").
 */
export const DEVICE_TABS = ["devices", "readings", "weigh", "lab", "import", "settings"] as const;
export type DeviceTab = (typeof DEVICE_TABS)[number];

export const READING_KINDS = ["weighbridge", "dimension", "mechanical"] as const;
export type ReadingKind = (typeof READING_KINDS)[number];

export type DevicesSearch = {
  /** Missing means the Devices tab. */
  tab?: DeviceTab;
  /** Readings: filter by kind. */
  kind?: ReadingKind;
};

const pick = <T extends string>(all: readonly T[], v: unknown): T | undefined => (typeof v === "string" && (all as readonly string[]).includes(v) ? (v as T) : undefined);

export function parseDevicesSearch(raw: Record<string, unknown>): DevicesSearch {
  const out: DevicesSearch = {};
  const tab = pick(DEVICE_TABS, raw.tab);
  if (tab && tab !== "devices") out.tab = tab;
  const kind = pick(READING_KINDS, raw.kind);
  if (kind) out.kind = kind;
  return out;
}

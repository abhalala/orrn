import type { PlSnapshotV2 } from "@orrn/server/lib/packingListSnapshot";
import { z } from "zod";

/**
 * The packing list snapshot as stored in D1, parsed once (W17) wherever it is
 * shown or exported. Only what the packing list needs is kept: unknown keys
 * are dropped, and the stored `totals` (with the meaningless sum of cut
 * lengths, S12/W7) are not read at all; totals are counted from the rows.
 *
 * Tolerant of the snapshot versions in the wild: v1 (today: `groupId` is
 * `groupLabel ?? bundle.groupId`) and later ones that add `groupLabel` and a
 * die `name`.
 */
const text = z.string();
const optionalText = z.string().nullish();

const customerSchema = z.object({
  name: text.default(""),
  phone: optionalText,
  email: optionalText,
  taxId: optionalText,
  billingAddress: z.record(z.string(), z.unknown()).nullish(),
  shippingAddress: z.record(z.string(), z.unknown()).nullish(),
});

const itemSchema = z.object({
  bundleSerial: text,
  die: z.object({
    series: text.default(""),
    sectionCode: text.default(""),
    name: optionalText,
  }),
  /** v1: the packing group label, or else the bundle's packing session id. Never shown as is. */
  groupId: optionalText,
  /** Later snapshots: the packing group label alone (null = none). */
  groupLabel: optionalText,
  quantity: z.number().finite().nonnegative(),
  weightG: z.number().finite().nonnegative(),
  lengthMm: z.number().finite().nonnegative(),
});

export const packingListSnapshotSchema = z.object({
  dispatch: z.object({
    code: text,
    customer: customerSchema,
    shipDate: optionalText,
    notes: optionalText,
    completedAt: optionalText,
  }),
  company: z.object({ name: text.default("") }),
  items: z.array(itemSchema),
  generatedAt: text,
  /** PL-8 v2 blocks, kept as stored (built and typed server-side); `isPlSnapshotV2` checks them. */
  version: z.number().int().optional(),
  header: z.custom<PlSnapshotV2["header"]>((v) => v != null && typeof v === "object").optional(),
  columns: z.custom<PlSnapshotV2["columns"]>((v) => Array.isArray(v)).optional(),
  groups: z.custom<PlSnapshotV2["groups"]>((v) => Array.isArray(v)).optional(),
  summary: z.custom<PlSnapshotV2["summary"]>((v) => v != null && typeof v === "object").optional(),
});

export type PackingListSnapshot = z.output<typeof packingListSnapshotSchema>;
export type PackingListSnapshotItem = PackingListSnapshot["items"][number];

/** Parse a stored snapshot; throws a ZodError when it is not a packing list. */
export function parsePackingListSnapshot(raw: unknown): PackingListSnapshot {
  return packingListSnapshotSchema.parse(raw);
}

export function safeParsePackingListSnapshot(raw: unknown) {
  return packingListSnapshotSchema.safeParse(raw);
}

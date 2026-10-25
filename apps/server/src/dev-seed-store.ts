/**
 * Store demo for the dev seed (PL-W6): five items the foundry and the die room draw on, each with a
 * GRN, and three issues (MRS) against melt, nitriding and maintenance. The kg ledger rows are exactly
 * what `store.receive` / `store.issue` post (`store_item` at the Central store, grams = milli units).
 *
 * The names avoid the ones the store e2e creates for itself (Cover flux, LDO, CR4 nitriding salt, Caustic
 * soda, ...), so its balances stay its own. GRN / MRS counters are written past the seeded numbers.
 */
import { docPeriod } from "@orrn/server/lib/docNumber";
import { nameKey } from "@orrn/server/lib/purchase";
import type { docSeries } from "@orrn/db/schema/series";
import type { stockLedger } from "@orrn/db/schema/stock";
import { storeItem, storeTxn, type StoreCategory, type StoreUnit } from "@orrn/db/schema/store";

import { devLocationId, type SeedClock } from "./dev-seed-kit";

type InsertRow<T extends { $inferInsert: unknown }> = T["$inferInsert"];

export type StoreSeed = {
  items: InsertRow<typeof storeItem>[];
  txns: InsertRow<typeof storeTxn>[];
  ledger: InsertRow<typeof stockLedger>[];
  series: InsertRow<typeof docSeries>[];
};

const ITEMS: { key: string; name: string; unit: StoreUnit; category: StoreCategory; grnMilli: number; mrs?: { milli: number; purpose: "melt" | "nitriding" | "maintenance"; note: string } }[] = [
  { key: "grain", name: "Grain refiner", unit: "kg", category: "chemical", grnMilli: 60_000, mrs: { milli: 7_500, purpose: "melt", note: "Cast K2 charge" } },
  { key: "degasser", name: "Degasser tablets", unit: "kg", category: "chemical", grnMilli: 40_000, mrs: { milli: 4_000, purpose: "melt", note: "Furnace F1" } },
  { key: "silicon", name: "Silicon metal", unit: "kg", category: "chemical", grnMilli: 120_000 },
  { key: "heater", name: "Container heater element", unit: "piece", category: "spare", grnMilli: 6_000, mrs: { milli: 1_000, purpose: "maintenance", note: "Press 2 heater tripped" } },
  { key: "oil", name: "Hydraulic oil", unit: "litre", category: "other", grnMilli: 400_000 },
];

export function buildStore(input: { companyId: string; clock: SeedClock; storekeeperId: string; nextSeq: () => number }): StoreSeed {
  const { companyId, clock, storekeeperId } = input;
  const store = devLocationId("STORE");
  const items: StoreSeed["items"] = [];
  const txns: StoreSeed["txns"] = [];
  const ledger: StoreSeed["ledger"] = [];
  const counters = new Map<string, number>();
  const next = (kind: "grn" | "mrs", at: number) => {
    const period = docPeriod(kind, new Date(at));
    const key = `${kind}|${period}`;
    const n = (counters.get(key) ?? 0) + 1;
    counters.set(key, n);
    return { period, number: `${kind.toUpperCase()}-${n}` };
  };
  ITEMS.forEach((def, i) => {
    const itemId = `dev-store-item-${def.key}`;
    const createdAt = new Date(clock.pastAt(14 - i, 10));
    items.push({
      id: itemId,
      companyId,
      serverSeq: input.nextSeq(),
      name: def.name,
      nameKey: nameKey(def.name),
      unit: def.unit,
      category: def.category,
      createdBy: storekeeperId,
      createdAt,
      updatedAt: createdAt,
    });
    const post = (kind: "grn" | "mrs", milli: number, at: number, extra: Partial<InsertRow<typeof storeTxn>>) => {
      const { period, number } = next(kind, at);
      const id = `dev-store-${kind}-${def.key}`;
      txns.push({
        id,
        companyId,
        serverSeq: input.nextSeq(),
        kind,
        number,
        period,
        itemId,
        qtyMilli: milli,
        locationId: store,
        createdBy: storekeeperId,
        createdAt: new Date(at),
        updatedAt: new Date(at),
        ...extra,
      });
      ledger.push({
        id: `dev-ledger-${id}`,
        companyId,
        serverSeq: input.nextSeq(),
        voucherType: kind === "grn" ? "store_grn" : "store_mrs",
        voucherId: id,
        line: 1,
        itemKind: "store_item",
        itemRef: itemId,
        locationId: store,
        qtyG: kind === "grn" ? milli : -milli,
        postedAt: new Date(at),
        reason: number,
        createdBy: storekeeperId,
        createdAt: new Date(at),
      });
    };
    post("grn", def.grnMilli, clock.pastAt(13 - i, 11), { note: "Opening stock from the paper register" });
    if (def.mrs) post("mrs", def.mrs.milli, clock.pastAt(6 - i, 9), { purpose: def.mrs.purpose, note: def.mrs.note });
  });
  const series: StoreSeed["series"] = [...counters.entries()].map(([key, value]) => {
    const [kind, period] = key.split("|") as ["grn" | "mrs", string];
    return { id: `dev-series-${kind}-${period}`, companyId, docType: kind, period, value, createdBy: storekeeperId };
  });
  return { items, txns, ledger, series };
}

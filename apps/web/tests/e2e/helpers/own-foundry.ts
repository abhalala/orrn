import type { OwnerApi } from "./owner-api";

/**
 * Foundry set-up for specs through the owner's API: a cast of its own and, when asked, a locked melt on
 * it. Specs never touch the seeded casts (they are shared); every cast made here is the spec's own.
 */

const DAY_MS = 86_400_000;

/** A lot with plenty of kg left (the seed's LOT-6 has thousands). */
export async function bigLot(api: OwnerApi, minG = 2_000_000): Promise<{ id: string; number: string; remainingG: number }> {
  const res = await api.query<{ lots: { id: string; number: string; remainingG: number }[] }>("foundry.lots.available", undefined);
  const lot = res.lots.find((l) => l.remainingG >= minG);
  if (!lot) throw new Error("no scrap lot with enough kg for a foundry spec");
  return lot;
}

export async function openOwnCast(api: OwnerApi, alloy: "6063" | "6061" = "6063"): Promise<{ id: string; number: string }> {
  return api.mutate<{ id: string; number: string }>("foundry.casts.open", { alloy, clientRequestId: crypto.randomUUID() });
}

/** Epoch ms of yesterday at `hh:mm` UTC (always in the past, inside the 72 h span, after the cast opened today at worst 1 day back). */
export function yesterdayAt(hh: number, mm = 0): number {
  const d = new Date(Date.now() - DAY_MS);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hh, mm);
}

/** The same body the stepper saves: `kg` of one lot in, logs/dross/Fe out, spectro typed after. */
export async function lockOwnMelt(api: OwnerApi, castId: string, opts: { inKg?: number; logsKg?: number; drossKg?: number; feKg?: number } = {}) {
  const inKg = opts.inKg ?? 100;
  const logsKg = opts.logsKg ?? 95;
  const lot = await bigLot(api);
  const furnaces = await api.query<{ items: { id: string; status: string }[] }>("foundry.furnaces.list", undefined);
  const furnaceId = furnaces.items.find((f) => f.status === "active")?.id;
  const draft = await api.mutate<{ id: string }>("foundry.melts.save", {
    castId,
    furnaceId,
    times: {
      chargingStart: yesterdayAt(1, 0),
      chargingEnd: yesterdayAt(2, 0),
      castingStart: yesterdayAt(3, 0),
      castingEnd: yesterdayAt(4, 0),
    },
    inputs: [{ kind: "lot", ref: lot.id, kgG: inKg * 1000 }],
    logs: [{ pcs: 4, lengthMm: 3658, kgG: logsKg * 1000 }],
    drossG: (opts.drossKg ?? 3) * 1000,
    feG: (opts.feKg ?? 1) * 1000,
    spectroReason: "Spectro comes later (e2e)",
    balanceNote: "Burn noted for the e2e",
  });
  const locked = await api.mutate<{ id: string; seq: number }>("foundry.melts.lock", { meltId: draft.id, clientMutationId: crypto.randomUUID() });
  return { meltId: locked.id, seq: locked.seq, lotId: lot.id };
}

import type { AppRouter } from "@orrn/server/routers/index";
import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";

type Out = inferRouterOutputs<AppRouter>["foundry"];

/** What `melts.save` takes: the form's input is checked against it (`satisfies`), never cast away. */
export type MeltSaveCall = inferRouterInputs<AppRouter>["foundry"]["melts"]["save"];
/**
 * `MeltSaveCall` with the chemical lines left open. The form (shared with the web) types a free-text chemical unit as
 * kg/g/l/ml/pcs while the server takes its store units (kg, litre, piece, ...); the phone cannot add such a line, and a
 * line picked from the store carries no unit. Every other field is still checked.
 */
export type MeltSaveBody = Omit<MeltSaveCall, "chemicals"> & { chemicals: readonly object[] };

/** `foundry.casts.get`: the cast, its melts (inputs, outputs, spectro), the live close-out and its approval. */
export type CastData = Out["casts"]["get"];
export type MeltRow = CastData["melts"][number];
export type SpectroResult = MeltRow["spectro"][number];
/** `foundry.casts.list` item (the Cast tab's switcher). */
export type CastItem = Out["casts"]["list"]["items"][number];
/** What `melts.save` and `melts.preview` answer: the figures and the lock gates, all the server's. */
export type DraftView = Out["melts"]["save"];
export type BilletStockData = Out["stock"]["billets"];

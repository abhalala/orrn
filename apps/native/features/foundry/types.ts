import type { AppRouter } from "@orrn/server/routers/index";
import type { inferRouterOutputs } from "@trpc/server";

type Out = inferRouterOutputs<AppRouter>["foundry"];

/** `foundry.casts.get`: the cast, its melts (inputs, outputs, spectro), the live close-out and its approval. */
export type CastData = Out["casts"]["get"];
export type MeltRow = CastData["melts"][number];
export type SpectroResult = MeltRow["spectro"][number];
/** `foundry.casts.list` item (the Cast tab's switcher). */
export type CastItem = Out["casts"]["list"]["items"][number];
/** What `melts.save` and `melts.preview` answer: the figures and the lock gates, all the server's. */
export type DraftView = Out["melts"]["save"];
export type BilletStockData = Out["stock"]["billets"];

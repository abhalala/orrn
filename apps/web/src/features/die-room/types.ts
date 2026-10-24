import type { AppRouter } from "@orrn/server/routers/index";
import type { inferRouterOutputs } from "@trpc/server";

type Outputs = inferRouterOutputs<AppRouter>;

/** `dieInstance.get`: the die card, every figure server-computed. */
export type CardData = Outputs["dieInstance"]["get"];
export type RunRow = Outputs["dieInstance"]["runs"][number];
export type MakerRow = Outputs["dieInstance"]["maker"]["list"][number];
export type MakerJobRow = Outputs["dieInstance"]["maker"]["jobs"]["list"][number];
export type IssueRow = Outputs["dieInstance"]["issues"]["list"][number];
export type BandList = Outputs["die"]["bands"]["list"];

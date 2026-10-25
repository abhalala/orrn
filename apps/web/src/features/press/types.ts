import type { AppRouter } from "@orrn/server/routers/index";
import type { inferRouterOutputs } from "@trpc/server";

export type PressOutputs = inferRouterOutputs<AppRouter>["press"];
export type QueueCard = PressOutputs["queue"]["list"]["cards"][number];
export type QueueLine = QueueCard["lines"][number];
export type RunDetail = PressOutputs["runs"]["get"];
export type RunPreview = PressOutputs["runs"]["preview"];
export type ReportOut = PressOutputs["report"];
export type SummaryOut = PressOutputs["summary"];
export type LineRow = PressOutputs["lines"]["list"][number];

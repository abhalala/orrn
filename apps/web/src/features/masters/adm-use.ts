import type { AppRouter } from "@orrn/server/routers/index";
import { useQueryClient } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import { useCallback } from "react";

import { can, canAny, useMe } from "@/shared/lib/me";
import { trpc } from "@/shared/utils/trpc";

type Outputs = inferRouterOutputs<AppRouter>;
export type PlantListRow = Outputs["masters"]["lists"]["list"][number];
export type BankRow = Outputs["masters"]["bank"]["list"][number];
export type NumberFormatRow = Outputs["masters"]["numberFormats"]["get"][number];
export type ApprovalRuleRow = Outputs["masters"]["approvalRules"]["get"][number];
export type InsuranceRow = NonNullable<Outputs["masters"]["insurance"]["get"]>;
export type DocRow = Outputs["docs"]["list"]["items"][number];
export type ToolingRow = Outputs["toolRoom"]["tooling"]["list"][number];
export type MakerCostRow = Outputs["toolRoom"]["cost"]["byMaker"][number];

/** Who may do what on the plant screens (the server decides; this only hides controls). */
export function useAdmAccess() {
  const { data: me } = useMe();
  return {
    me,
    canPublish: can(me, "masters.publish"),
    canFormat: can(me, "refFormat.manage"),
    canRules: can(me, "approvalRule.manage"),
    canDocs: can(me, "docs.manage"),
    canTooling: canAny(me, ["die.card", "masters.publish"]),
    canInspect: canAny(me, ["die.card", "die.maker", "masters.publish"]),
    canCost: canAny(me, ["masters.publish", "analytics.view"]),
    canBank: canAny(me, ["masters.publish", "order.price", "export.accounts", "invoice.link"]),
  };
}

/** After a write, refetch what it can change. */
export function useAdmInvalidate() {
  const queryClient = useQueryClient();
  return {
    lists: useCallback(() => queryClient.invalidateQueries(trpc.masters.lists.pathFilter()), [queryClient]),
    bank: useCallback(() => queryClient.invalidateQueries(trpc.masters.bank.pathFilter()), [queryClient]),
    insurance: useCallback(() => queryClient.invalidateQueries(trpc.masters.insurance.pathFilter()), [queryClient]),
    formats: useCallback(() => queryClient.invalidateQueries(trpc.masters.numberFormats.pathFilter()), [queryClient]),
    rules: useCallback(() => queryClient.invalidateQueries(trpc.masters.approvalRules.pathFilter()), [queryClient]),
    docs: useCallback(() => queryClient.invalidateQueries(trpc.docs.pathFilter()), [queryClient]),
    tooling: useCallback(
      () => Promise.all([queryClient.invalidateQueries(trpc.toolRoom.tooling.pathFilter()), queryClient.invalidateQueries(trpc.toolRoom.shortfalls.pathFilter()), queryClient.invalidateQueries(trpc.toolRoom.minStock.pathFilter())]),
      [queryClient],
    ),
  };
}

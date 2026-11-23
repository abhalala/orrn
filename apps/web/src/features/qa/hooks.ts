import "@orrn/i18n/refusal-qa";
import { isModuleOn } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import type { AppRouter } from "@orrn/server/routers/index";
import { useQueryClient } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import { useCallback } from "react";

import { serverRefusal } from "@/features/shared/server-refusal";
import { useMe } from "@/shared/lib/me";
import { trpc } from "@/shared/utils/trpc";

type Outputs = inferRouterOutputs<AppRouter>["qa"];
export type QaCheckRow = Outputs["checks"]["list"]["items"][number];
export type QaHoldRow = Outputs["holds"]["list"]["items"][number];
export type QaWaitingRow = Outputs["waiting"]["list"]["items"][number];
export type QaSettingsView = Outputs["settings"]["get"];
export type QaRunView = Outputs["run"];
export type QaToday = Outputs["today"];
export type QaTemper = Outputs["tempers"]["list"]["items"][number];
export type QaPlanRow = Outputs["plans"]["list"]["items"][number];
export type QaStationRow = Outputs["stations"]["list"]["items"][number];
export type QaSubstituteRow = Outputs["substitutes"]["list"]["items"][number];
export type QaInstrumentRow = Outputs["instruments"]["list"]["items"][number];
export type QaLineAlloy = Outputs["substitutes"]["forLine"];

/** The quality refusal sentences, said in the person's language (the table is registered by the import above). */
export function useQaRefusal() {
  const { t } = useT();
  return useCallback((error: unknown) => serverRefusal(t, error), [t]);
}

/** After a quality write: every quality read, Today, the audit log, bundles (a hold) and the order strip. */
export function useQaInvalidate() {
  const queryClient = useQueryClient();
  return useCallback(
    () =>
      Promise.all([
        queryClient.invalidateQueries(trpc.qa.pathFilter()),
        queryClient.invalidateQueries(trpc.dashboard.pathFilter()),
        queryClient.invalidateQueries(trpc.audit.pathFilter()),
      ]),
    [queryClient],
  );
}

/** Quality is on for this plant (`isModuleOn`: an empty module list means every module is on). */
export function useQaModuleOn(): boolean {
  const { data: me } = useMe();
  return isModuleOn((me?.company?.modules ?? []).map((m) => m.toLowerCase()), "qa");
}

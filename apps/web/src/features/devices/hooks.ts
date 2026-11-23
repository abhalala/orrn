import { isModuleOn } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import type { AppRouter } from "@orrn/server/routers/index";
import { useQueryClient } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import { useCallback } from "react";

import { canAny, useMe, type Action } from "@/shared/lib/me";
import { trpc } from "@/shared/utils/trpc";

import { errorKey } from "./model";

type Outputs = inferRouterOutputs<AppRouter>["devices"];
export type DeviceListData = Outputs["list"];
export type DeviceRow = Outputs["list"]["devices"][number];
export type DeviceSource = Outputs["list"]["sources"][number];
export type DeviceCounts = Outputs["health"];
export type DeviceReading = Outputs["readings"]["list"]["items"][number];
export type DeviceSettings = Outputs["settings"]["get"];
export type WeighView = Outputs["weigh"]["forSubject"];
export type WeighMismatch = Outputs["weigh"]["mismatches"]["items"][number];
export type LabInbox = Outputs["lab"]["inbox"];
export type LabForSubject = Outputs["lab"]["forSubject"];

/** Plant devices are on for this plant (`isModuleOn`: opt-in, so an empty module list means off). */
export function useDevicesModuleOn(): boolean {
  const { data: me } = useMe();
  return isModuleOn((me?.company?.modules ?? []).map((m) => m.toLowerCase()), "devices");
}

/** Who reads the device cards on other screens. */
export const DEVICE_VIEWERS: readonly Action[] = ["device.view", "device.manage"];
/** Who reads a weigh: the subject's own desk, or a device reader (the server checks the same per subject type). */
export const WEIGH_PEOPLE: Record<"purchase_lot" | "dispatch", readonly Action[]> = {
  purchase_lot: ["purchase.receipt", "device.view"],
  dispatch: ["dispatch.complete", "device.view"],
};
/** Who reads lab results on a run or a die copy. */
export const LAB_PEOPLE: readonly Action[] = ["device.view", "qa.check", "press.run", "die.card"];

/** A card shows, and its query fires, only with the module on and one of the actions held. */
export function useDevicesFlagOn(people: readonly Action[]): boolean {
  const { data: me } = useMe();
  const moduleOn = useDevicesModuleOn();
  return moduleOn && canAny(me, people);
}

/** After a device write: every device read, Today, the audit log, and the lot or load screens a weigh touches. */
export function useDevInvalidate() {
  const queryClient = useQueryClient();
  return useCallback(
    () =>
      Promise.all([
        queryClient.invalidateQueries(trpc.devices.pathFilter()),
        queryClient.invalidateQueries(trpc.dashboard.pathFilter()),
        queryClient.invalidateQueries(trpc.audit.pathFilter()),
        queryClient.invalidateQueries(trpc.purchase.pathFilter()),
        queryClient.invalidateQueries(trpc.dispatch.pathFilter()),
        queryClient.invalidateQueries(trpc.qa.pathFilter()),
      ]),
    [queryClient],
  );
}

/** The sentence for a failed device write, in the person's language. */
export function useDevError() {
  const { t } = useT();
  return useCallback(
    (error: unknown): string => {
      const k = errorKey(error);
      // A refusal the person can act on ("Ticket X names no truck", "This load has left") is the server's own sentence.
      if (k === "bad") return (error as { message?: string }).message || t("dev3.failed");
      return k === "failed" ? t("dev3.failed") : t(`dev3.errors.${k}`);
    },
    [t],
  );
}

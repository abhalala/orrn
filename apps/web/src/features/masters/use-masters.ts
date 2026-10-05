import type { AppRouter } from "@orrn/server/routers/index";
import { useQueryClient } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import { useCallback } from "react";

import { can, canAny, useMe } from "@/shared/lib/me";
import { trpc } from "@/shared/utils/trpc";

import { DIE_CARD_EDITORS, PURCHASE_READERS } from "./masters-model";

type Outputs = inferRouterOutputs<AppRouter>;
export type LocationRow = Outputs["stock"]["locations"]["list"]["items"][number];
export type LocationStock = Outputs["stock"]["byLocation"]["locations"][number];
export type ScrapItemRow = Outputs["purchase"]["scrapItems"]["list"]["items"][number];
export type ScrapGradeRow = Outputs["purchase"]["scrapGrades"]["list"]["items"][number];
export type StreamRow = Outputs["foundry"]["returnStreams"]["list"]["items"][number];
export type DieCopyRow = Outputs["dieInstance"]["list"]["items"][number];
export type VendorRow = Outputs["vendor"]["list"]["items"][number];
export type VendorDetail = Outputs["vendor"]["get"];

/**
 * Who may do what on the masters screens (the server decides; this only hides controls):
 * - publish (masters.publish: manager, admin, owner) edits every list here;
 * - vendors are read by the server's purchase readers (rates are commercial);
 * - die copies are also edited by the die room (die.card, ruling RP7).
 */
export function useMastersAccess() {
  const { data: me } = useMe();
  return {
    me,
    canPublish: can(me, "masters.publish"),
    canReadVendors: canAny(me, PURCHASE_READERS),
    canEditDieCopies: canAny(me, DIE_CARD_EDITORS),
  };
}

/** After a masters write, refetch the lists it can change (and the pickers built on them). */
export function useInvalidate() {
  const queryClient = useQueryClient();
  return {
    locations: useCallback(
      () =>
        Promise.all([
          queryClient.invalidateQueries(trpc.stock.locations.pathFilter()),
          queryClient.invalidateQueries(trpc.stock.byLocation.pathFilter()),
        ]),
      [queryClient],
    ),
    scrap: useCallback(
      () =>
        Promise.all([
          queryClient.invalidateQueries(trpc.purchase.scrapItems.pathFilter()),
          queryClient.invalidateQueries(trpc.purchase.scrapGrades.pathFilter()),
        ]),
      [queryClient],
    ),
    streams: useCallback(() => queryClient.invalidateQueries(trpc.foundry.returnStreams.pathFilter()), [queryClient]),
    dieCopies: useCallback(() => queryClient.invalidateQueries(trpc.dieInstance.pathFilter()), [queryClient]),
    vendors: useCallback(() => queryClient.invalidateQueries(trpc.vendor.pathFilter()), [queryClient]),
  };
}

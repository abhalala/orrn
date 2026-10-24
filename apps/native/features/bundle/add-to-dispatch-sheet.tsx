import { formatKgTotal, gToKg } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Text } from "react-native";

import { Can } from "@/components/can";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ListRow } from "@/components/ui/list-row";
import { Sheet } from "@/components/ui/sheet";
import { ErrorBlock, LoadingBlock } from "@/components/ui/state";
import { addOutcome, renderScanMessage } from "@/features/scan/outcome";
import { announce } from "@/lib/a11y";
import { feedback } from "@/lib/feedback";
import { writeFailureKind } from "@/lib/request-timeout";
import { saveErrorText } from "@/lib/save-error";
import { queryClient, trpc } from "@/utils/trpc";

import type { BundleNotice } from "./notice";

/**
 * "Add to dispatch": a sheet listing the dispatches being built (Building).
 * One tap adds the bundle through `dispatch.addBundlesBySerial`, whose report
 * says what happened without failing the request: added, already there
 * (calm), or blocked with the server's reason.
 */
export function AddToDispatchSheet({
  visible,
  onClose,
  serial,
  onDone,
}: {
  visible: boolean;
  onClose: () => void;
  serial: string;
  onDone: (notice: BundleNotice) => void;
}) {
  const { t } = useT();
  const router = useRouter();
  const [failure, setFailure] = useState<string | null>(null);
  const drafts = useQuery({ ...trpc.dispatch.listDispatches.queryOptions({ status: "draft", limit: 50 }), enabled: visible });
  const add = useMutation(trpc.dispatch.addBundlesBySerial.mutationOptions());

  const refresh = () => {
    void queryClient.invalidateQueries(trpc.dispatch.pathFilter());
    void queryClient.invalidateQueries(trpc.bundle.pathFilter());
  };

  const choose = (d: { id: string; code: string }) => {
    if (add.isPending) return;
    setFailure(null);
    add.mutate(
      { id: d.id, serials: [serial] },
      {
        onSuccess: (report) => {
          const outcome = addOutcome(report, serial);
          refresh();
          if (outcome.kind === "added") {
            const text = t("bundle.addedToDispatch", { code: d.code });
            feedback.success();
            announce(text);
            onClose();
            onDone({ tone: "success", text, dispatchId: d.id });
          } else if (outcome.kind === "already") {
            const text = t("bundle.alreadyInDispatch", { code: d.code });
            announce(text);
            onClose();
            onDone({ tone: "neutral", text, dispatchId: d.id });
          } else if (outcome.kind === "rejected") {
            // Held, dispatched or voided since the page loaded: the page refreshes to show it.
            const text = renderScanMessage(t, outcome.message);
            feedback.error();
            announce(text);
            onClose();
            onDone({ tone: "error", text });
          } else {
            feedback.error();
            setFailure(t("bundle.addNotFound"));
          }
        },
        onError: (error) => {
          feedback.error();
          const code = (error as { data?: { code?: unknown } } | null)?.data?.code;
          if (writeFailureKind(error) === "unsure") {
            // It may have been added: re-read, and tell the person to check before trying again.
            refresh();
            const unsure = saveErrorText(t, error);
            setFailure(`${unsure.title}. ${unsure.body}`);
          } else {
            setFailure(code === "FORBIDDEN" ? t("stock.noPermission") : code === undefined ? t("bundle.addFailed") : saveErrorText(t, error).body);
          }
        },
      },
    );
  };

  const items = drafts.data?.items ?? [];
  return (
    <Sheet visible={visible} onClose={onClose} title={t("bundle.addToDispatch")}>
      {failure ? (
        <Text accessibilityLiveRegion="polite" className="font-sans-medium text-[15px] leading-6 text-destructive">
          {failure}
        </Text>
      ) : null}
      {drafts.isPending || add.isPending ? (
        <LoadingBlock />
      ) : drafts.isError ? (
        <ErrorBlock error={drafts.error} onRetry={() => void drafts.refetch()} retrying={drafts.isFetching} />
      ) : items.length === 0 ? (
        <EmptyState title={t("bundle.noBuildingDispatches")} />
      ) : (
        items.map((d) => (
          <ListRow
            key={d.id}
            title={d.code}
            subtitle={`${d.customerName} · ${t("units.bundlesKg", { bundles: Number(d.itemCount), kg: formatKgTotal(gToKg(Number(d.totalWeightG))) })}`}
            accessibilityHint={t("bundle.chooseDispatch")}
            onPress={() => choose(d)}
          />
        ))
      )}
      <Can do="dispatch.create">
        {items.length === 0 && !drafts.isPending && !drafts.isError ? (
          <Button
            label={t("bundle.newDispatch")}
            onPress={() => {
              onClose();
              router.push("/dispatch/new");
            }}
          />
        ) : null}
      </Can>
    </Sheet>
  );
}

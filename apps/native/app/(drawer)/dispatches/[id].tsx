import { StatusBadge } from "@orrn/ui/components/badge";
import { Button } from "@orrn/ui/components/button";
import { Input, TextArea } from "@orrn/ui/components/input";
import { buildLiveSnapshot, type PLSnapshot } from "@orrn/documents/packing-list";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, Stack, useLocalSearchParams, useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  Share,
  Text,
  type TextInput,
  View,
} from "react-native";
import { format } from "date-fns";

import {
  ErpEmpty,
  ErpListCard,
  ErpLoading,
  ErpMutedText,
  ErpRowBetween,
  ErpScreen,
  ErpSectionTitle,
  ErpTitleText,
} from "@/components/erp";
import { Can } from "@/components/can";
import { sharePackingListPdf, sharePackingListXlsx } from "@/lib/packing-list-export";
import { queryClient, trpc } from "../../../utils/trpc";
import { useLengthUnit } from "../../../utils/length";
import { useMe } from "../../../utils/me";

export default function DispatchDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const scanInputRef = useRef<TextInput>(null);
  const [scanToken, setScanToken] = useState("");
  const [scanFeedback, setScanFeedback] = useState("");
  const [bulkTokens, setBulkTokens] = useState("");
  const [invoiceNoDraft, setInvoiceNoDraft] = useState<string>();
  const [previewing, setPreviewing] = useState(false);
  const lu = useLengthUnit();
  const { data: me } = useMe();

  const { data, isLoading } = useQuery({
    ...trpc.dispatch.getDispatch.queryOptions({ id: id as string }),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: trpc.dispatch.getDispatch.queryKey({ id: id as string }) });
    queryClient.invalidateQueries({ queryKey: trpc.dispatch.listDispatches.queryKey() });
    queryClient.invalidateQueries({ queryKey: trpc.bundle.listBundles.queryKey() });
    queryClient.invalidateQueries({ queryKey: trpc.bundle.stockSummary.queryKey() });
  };

  const scanMutation = useMutation({
    ...trpc.dispatch.addBundlesBySerial.mutationOptions(),
    onSuccess: (_res, variables) => {
      setScanToken("");
      setScanFeedback(`Added ${variables.serials[0]}`);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      invalidate();
    },
    onError: (e) => {
      setScanFeedback(e.message || "Failed to scan bundle");
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    },
    onSettled: () => scanInputRef.current?.focus(),
  });

  const bulkMutation = useMutation({
    ...trpc.dispatch.addBundlesBySerial.mutationOptions(),
    onSuccess: (res) => {
      Alert.alert("Added", `${res.added} bundle(s) added`);
      setBulkTokens("");
      invalidate();
    },
    onError: (e) => Alert.alert("Error", e.message || "Failed to add"),
  });

  const removeMutation = useMutation({
    ...trpc.dispatch.removeBundle.mutationOptions(),
    onSuccess: () => invalidate(),
    onError: (e) => Alert.alert("Error", e.message || "Failed to remove"),
  });

  const invoiceNoMutation = useMutation({
    ...trpc.dispatch.update.mutationOptions(),
    onSuccess: () => {
      setInvoiceNoDraft(undefined);
      invalidate();
    },
    onError: (e) => Alert.alert("Error", e.message || "Failed to update invoice number"),
  });

  const reserveMutation = useMutation({
    ...trpc.dispatch.reserve.mutationOptions(),
    onSuccess: () => {
      Alert.alert("Success", "Dispatch reserved");
      invalidate();
    },
    onError: (e) => Alert.alert("Error", e.message || "Failed to reserve"),
  });

  const unreserveMutation = useMutation({
    ...trpc.dispatch.unreserve.mutationOptions(),
    onSuccess: () => invalidate(),
    onError: (e) => Alert.alert("Error", e.message || "Failed to unreserve"),
  });

  const completeMutation = useMutation({
    ...trpc.dispatch.complete.mutationOptions(),
    onSuccess: () => {
      Alert.alert("Completed", "Bundles marked dispatched");
      invalidate();
    },
    onError: (e) => Alert.alert("Error", e.message || "Failed to complete"),
  });

  const cancelMutation = useMutation({
    ...trpc.dispatch.cancel.mutationOptions(),
    onSuccess: () => {
      Alert.alert("Cancelled", "Dispatch cancelled");
      invalidate();
    },
    onError: (e) => Alert.alert("Error", e.message || "Failed to cancel"),
  });

  const deleteMutation = useMutation({
    ...trpc.dispatch.softDelete.mutationOptions(),
    onSuccess: () => {
      invalidate();
      router.back();
    },
    onError: (e) => Alert.alert("Error", e.message || "Failed to delete"),
  });

  if (isLoading) {
    return (
      <ErpScreen>
        <ErpLoading />
      </ErpScreen>
    );
  }
  if (!data) {
    return (
      <ErpScreen>
        <ErpMutedText className="mt-5 text-center">Dispatch not found.</ErpMutedText>
      </ErpScreen>
    );
  }

  const { dispatch: d, customer: c, items } = data;
  const canAddOrRemove = d.status === "draft" || d.status === "reserved";
  const canEditInvoiceNo = d.status === "draft" || d.status === "reserved";
  const canReserve = d.status === "draft" && items.length > 0;
  const canUnreserve = d.status === "reserved";
  const canComplete = d.status === "reserved" && items.length > 0;
  const canCancel = d.status === "draft" || d.status === "reserved";
  const canDelete = d.status === "draft" || d.status === "cancelled";
  const setting = (me?.company?.settings as { packingGroupKey?: unknown } | undefined)?.packingGroupKey;
  const packingGroupKey = setting === "die" || setting === "weightRange" ? setting : "manual";
  const liveSnapshot = c && me?.company && canAddOrRemove ? buildLiveSnapshot({
    company: { id: me.company.id, name: me.company.name },
    customer: c,
    dispatch: d,
    items,
    packingGroupKey,
  }) : null;

  const handleScan = () => {
    const token = scanToken.trim();
    if (!token) return;
    setScanFeedback("");
    scanMutation.mutate({ id: id as string, serials: [token] });
  };

  const handleAddBulk = () => {
    const serials = bulkTokens
      .split(/[\n,\s]+/)
      .map((x) => x.trim())
      .filter(Boolean);
    if (serials.length === 0) {
      Alert.alert("Validation", "Enter at least one uid or serial");
      return;
    }
    bulkMutation.mutate({ id: id as string, serials });
  };

  const confirm = (title: string, body: string, onConfirm: () => void, destructive = false) => {
    Alert.alert(title, body, [
      { text: "Cancel", style: "cancel" },
      { text: title, style: destructive ? "destructive" : "default", onPress: onConfirm },
    ]);
  };

  return (
    <FlatList
      className="flex-1 bg-background"
      data={items}
      keyExtractor={(it) => it.itemId}
      contentContainerClassName="pb-8"
      contentInsetAdjustmentBehavior="automatic"
      ListHeaderComponent={
        <View>
          <Stack.Screen options={{ title: d.code }} />

          <ErpListCard className="mx-4 mt-4 gap-2">
            <ErpRowBetween>
              <ErpTitleText mono>{d.code}</ErpTitleText>
              <StatusBadge kind="dispatch" value={d.status} />
            </ErpRowBetween>
            <ErpMutedText>Customer: {c?.name ?? "(deleted)"}</ErpMutedText>
            {d.shipDate ? (
              <ErpMutedText>Ship: {format(new Date(d.shipDate), "PP")}</ErpMutedText>
            ) : null}
            {canEditInvoiceNo ? (
              <Can do="dispatch.update" fallback={<ErpMutedText>Inv No: {d.invoiceNo || "—"}</ErpMutedText>}>
                <View className="flex-row items-center gap-2">
                  <Input
                    className="flex-1"
                    value={invoiceNoDraft ?? d.invoiceNo ?? ""}
                    onChangeText={setInvoiceNoDraft}
                    maxLength={64}
                    placeholder="Invoice no"
                    autoCapitalize="characters"
                    autoCorrect={false}
                  />
                  <Button
                    variant="outline"
                    disabled={invoiceNoMutation.isPending}
                    onPress={() => invoiceNoMutation.mutate({
                      id: id as string,
                      invoiceNo: (invoiceNoDraft ?? d.invoiceNo ?? "").trim() || null,
                    })}
                  >
                    Save
                  </Button>
                </View>
              </Can>
            ) : <ErpMutedText>Inv No: {d.invoiceNo || "—"}</ErpMutedText>}
            {d.notes ? <ErpMutedText>Notes: {d.notes}</ErpMutedText> : null}
            <ErpMutedText>
              {items.length} bundles · {items.reduce((sum, x) => sum + x.weightG, 0)} g total
            </ErpMutedText>
            {d.completedAt ? (
              <ErpMutedText>
                Completed {format(new Date(d.completedAt), "PP p")}
              </ErpMutedText>
            ) : null}
          </ErpListCard>

          <ErpListCard className="mx-4 mt-4 gap-3">
            <ErpSectionTitle>Actions</ErpSectionTitle>
            <View className="flex-row flex-wrap gap-2">
              <Can do="dispatch.reserve">
                <View className="min-h-12 min-w-[47%] flex-grow">
                  <Button
                    size="lg"
                    disabled={!canReserve || reserveMutation.isPending}
                    onPress={() =>
                      confirm("Reserve", "Reserve all bundles for this dispatch?", () =>
                        reserveMutation.mutate({ id: id as string }),
                      )
                    }
                  >
                    Reserve
                  </Button>
                </View>
                <View className="min-h-12 min-w-[47%] flex-grow">
                  <Button
                    size="lg"
                    variant="outline"
                    disabled={!canUnreserve || unreserveMutation.isPending}
                    onPress={() => unreserveMutation.mutate({ id: id as string })}
                  >
                    Unreserve
                  </Button>
                </View>
              </Can>
              <Can do="dispatch.complete">
                <View className="min-h-12 min-w-[47%] flex-grow">
                  <Button
                    size="lg"
                    disabled={!canComplete || completeMutation.isPending}
                    onPress={() =>
                      confirm(
                        "Complete",
                        "Mark all bundles as dispatched? This cannot be undone.",
                        () => completeMutation.mutate({ id: id as string }),
                      )
                    }
                  >
                    Complete
                  </Button>
                </View>
              </Can>
              <Can do="dispatch.cancel">
                <View className="min-h-12 min-w-[47%] flex-grow">
                  <Button
                    size="lg"
                    variant="destructive"
                    disabled={!canCancel || cancelMutation.isPending}
                    onPress={() =>
                      confirm(
                        "Cancel",
                        "Cancel this dispatch?",
                        () => cancelMutation.mutate({ id: id as string, reason: null }),
                        true,
                      )
                    }
                  >
                    Cancel
                  </Button>
                </View>
              </Can>
              <Can do="dispatch.delete">
                {canDelete ? (
                  <View className="min-h-12 min-w-[47%] flex-grow">
                    <Button
                      size="lg"
                      variant="ghost"
                      disabled={deleteMutation.isPending}
                      onPress={() =>
                        confirm(
                          "Delete",
                          "Hide this dispatch from active views?",
                          () => deleteMutation.mutate({ id: id as string }),
                          true,
                        )
                      }
                    >
                      Delete
                    </Button>
                  </View>
                ) : null}
              </Can>
            </View>
          </ErpListCard>

          <Can do="dispatch.addBundle">
            {canAddOrRemove ? (
              <ErpListCard className="mx-4 mt-4 gap-3">
                <ErpSectionTitle>Scan bundle sticker</ErpSectionTitle>
                <Input
                  ref={scanInputRef}
                  value={scanToken}
                  onChangeText={setScanToken}
                  onSubmitEditing={handleScan}
                  placeholder="Scan uid or enter serial"
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="done"
                  submitBehavior="submit"
                  autoFocus
                  editable={!scanMutation.isPending}
                />
                {scanFeedback ? (
                  <ErpMutedText>{scanFeedback}</ErpMutedText>
                ) : (
                  <ErpMutedText>Scanner input is added when it sends Enter.</ErpMutedText>
                )}
                <View className="min-h-12">
                  <Button size="lg" disabled={scanMutation.isPending} onPress={handleScan}>
                    {scanMutation.isPending ? "Adding…" : "Add scanned bundle"}
                  </Button>
                </View>
                <ErpSectionTitle>Bulk paste uids or serials</ErpSectionTitle>
                <TextArea
                  value={bulkTokens}
                  onChangeText={setBulkTokens}
                  placeholder={"cm123exampleuid\n26H1903"}
                  autoCapitalize="none"
                  autoCorrect={false}
                  rows={4}
                />
                <View className="mt-1 min-h-12">
                  <Button
                    size="lg"
                    disabled={bulkMutation.isPending}
                    onPress={handleAddBulk}
                  >
                    {bulkMutation.isPending ? "Adding…" : "Add pasted bundles"}
                  </Button>
                </View>
              </ErpListCard>
            ) : null}
          </Can>

          {liveSnapshot ? (
            <ErpListCard className="mx-4 mt-4 gap-3">
              <ErpSectionTitle>Live packing list preview</ErpSectionTitle>
              <ErpMutedText>DRAFT · {items.length} bundles · {(items.reduce((sum, item) => sum + item.weightG, 0) / 1000).toFixed(3)} kg</ErpMutedText>
              <View className="min-h-12"><Button size="lg" variant="outline" disabled={previewing} onPress={async () => { setPreviewing(true); try { await sharePackingListPdf(liveSnapshot, `DRAFT-${d.code}`, lu.unit, { draft: true }); } catch { Alert.alert("Error", "Failed to preview packing list"); } finally { setPreviewing(false); } }}>{previewing ? "Preparing…" : "Preview packing list (DRAFT)"}</Button></View>
            </ErpListCard>
          ) : null}

          {d.status === "completed" ? <PackingListCard dispatchId={d.id} /> : null}

          <Text className="px-4 pb-2 pt-4 text-xs font-semibold uppercase tracking-wide text-muted">
            Items ({items.length})
          </Text>
        </View>
      }
      renderItem={({ item }) => (
        <View className="mx-4 mb-2 min-h-14 flex-row items-center rounded-lg border border-border bg-card p-3">
          <Link href={`/bundles/${item.bundleId}`} asChild>
            <Pressable className="min-h-11 flex-1">
              <ErpTitleText mono>{item.serial}</ErpTitleText>
              <ErpMutedText className="mt-1">
                {item.dieSeries} / {item.dieSectionCode} · {item.weightG}g ·{" "}
                {lu.formatLength(item.lengthMm)}
              </ErpMutedText>
            </Pressable>
          </Link>
          {canAddOrRemove ? (
            <Can do="dispatch.addBundle">
              <Pressable
                className="min-h-11 justify-center rounded-lg bg-danger/10 px-3 py-2.5"
                disabled={removeMutation.isPending}
                onPress={() => removeMutation.mutate({ id: id as string, bundleId: item.bundleId })}
              >
                <Text className="text-sm font-semibold text-danger">Remove</Text>
              </Pressable>
            </Can>
          ) : null}
        </View>
      )}
      ListEmptyComponent={<ErpEmpty>No bundles in this dispatch yet.</ErpEmpty>}
    />
  );
}

function PackingListCard({ dispatchId }: { dispatchId: string }) {
  const lu = useLengthUnit();
  const [exporting, setExporting] = useState<"pdf" | "xlsx" | "text" | null>(null);

  const { data: pl, isLoading } = useQuery({
    ...trpc.packingList.byDispatch.queryOptions({ dispatchId }),
  });

  async function handleShareText() {
    if (!pl) return;
    const snap = pl.snapshot as PLSnapshot;
    const cust = snap.dispatch?.customer?.name ?? "—";
    const totals = snap.totals ?? {};
    const lines: string[] = [
      `Packing List: ${pl.code}`,
      `Dispatch: ${snap.dispatch?.code ?? ""}`,
      `Customer: ${cust}`,
      `Bundles: ${totals.totalBundles ?? 0}`,
      `Total Qty: ${totals.totalQuantity ?? 0}`,
      `Total Weight: ${totals.totalWeightKg ?? 0} kg`,
      `Total Length: ${lu.formatLength((totals.totalLengthM ?? 0) * 1000)}`,
      "",
      "Items:",
      ...(snap.items ?? []).map((item: PLSnapshot["items"][number], i: number) =>
        `${i + 1}. ${item.bundleSerial} | ${item.die?.series}/${item.die?.sectionCode} | qty ${item.quantity} | ${(item.weightG / 1000).toFixed(3)} kg`,
      ),
    ];
    try {
      await Share.share({ message: lines.join("\n"), title: `${pl.code} Packing List` });
    } catch {
      Alert.alert("Error", "Failed to share packing list");
    }
  }

  async function handleExportPdf() {
    if (!pl) return;
    setExporting("pdf");
    try {
      await sharePackingListPdf(pl.snapshot as PLSnapshot, pl.code, lu.unit);
    } catch {
      Alert.alert("Error", "Failed to export PDF");
    } finally {
      setExporting(null);
    }
  }

  async function handleExportXlsx() {
    if (!pl) return;
    setExporting("xlsx");
    try {
      await sharePackingListXlsx(pl.snapshot as PLSnapshot, pl.code, lu.unit);
    } catch {
      Alert.alert("Error", "Failed to export XLSX");
    } finally {
      setExporting(null);
    }
  }

  return (
    <ErpListCard className="mx-4 mt-4 gap-3">
      <ErpSectionTitle>Packing list</ErpSectionTitle>
      {isLoading ? (
        <ActivityIndicator size="small" />
      ) : !pl ? (
        <ErpMutedText>No packing list available.</ErpMutedText>
      ) : (
        <View className="gap-3">
          <ErpTitleText mono>{pl.code}</ErpTitleText>
          <ErpMutedText>
            Generated {format(new Date((pl.snapshot as PLSnapshot).generatedAt), "PP p")}
          </ErpMutedText>
          <View className="flex-row flex-wrap gap-2">
            <View className="min-h-12 min-w-[30%] flex-1">
              <Button
                size="lg"
                variant="outline"
                disabled={exporting !== null}
                onPress={handleExportPdf}
              >
                {exporting === "pdf" ? "Exporting…" : "PDF"}
              </Button>
            </View>
            <View className="min-h-12 min-w-[30%] flex-1">
              <Button
                size="lg"
                variant="outline"
                disabled={exporting !== null}
                onPress={handleExportXlsx}
              >
                {exporting === "xlsx" ? "Exporting…" : "XLSX"}
              </Button>
            </View>
            <View className="min-h-12 min-w-[30%] flex-1">
              <Button
                size="lg"
                variant="outline"
                disabled={exporting !== null}
                onPress={handleShareText}
              >
                Text
              </Button>
            </View>
          </View>
        </View>
      )}
    </ErpListCard>
  );
}

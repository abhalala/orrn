import Feather from "@expo/vector-icons/Feather";
import { MAX_HOLD_BUNDLES } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { Text, View } from "react-native";

import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Field } from "@/components/ui/field";
import { PressableScale } from "@/components/ui/pressable-scale";
import { Sheet } from "@/components/ui/sheet";
import { LoadingBlock } from "@/components/ui/state";
import { announce } from "@/lib/a11y";
import { feedback } from "@/lib/feedback";
import { useThemeColor } from "@/lib/theme";
import { useLengthUnit } from "@/utils/length";
import { trpc } from "@/utils/trpc";

import { SheetErrors } from "./hold-ui";
import { holdableItems, orderErrorLines, orderKgText, pcsText } from "./order-model";
import { claimWrite, selectionInItems } from "./write-selection";

export type HoldTarget = {
  lineId: string;
  lineNo: number;
  orderNumber: string;
  sectionId: string;
  cutLengthMm: number;
  customerId: string;
};

function refreshAfterHold(queryClient: QueryClient) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: trpc.orders.get.queryKey() }),
    queryClient.invalidateQueries({ queryKey: trpc.orders.timeline.queryKey() }),
    queryClient.invalidateQueries({ queryKey: trpc.orders.matchStock.queryKey() }),
    queryClient.invalidateQueries({ queryKey: trpc.orders.holds.queryKey() }),
    queryClient.invalidateQueries({ queryKey: trpc.orders.list.queryKey() }),
  ]);
}

type StockItem = {
  id: string;
  serial: string;
  weightG: number;
  pcs: number;
  lengthMm: number;
  allocation: "plant" | "unassigned" | "same_customer" | "other_customer";
  orderNumber: string | null;
  poNumber: string | null;
  lengthMatch: boolean;
  needsApproval: boolean;
};

const GROUPS = ["plant", "unassigned", "same_customer", "other_customer"] as const;

function SelectableRow({ selected, onToggle, children, label }: { selected: boolean; onToggle: () => void; children: React.ReactNode; label: string }) {
  const check = useThemeColor("card");
  return (
    <PressableScale
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked: selected }}
      onPress={onToggle}
      className="min-h-14 flex-row items-center gap-3 rounded-card border border-hairline bg-surface px-3 py-3"
    >
      <View className={`h-6 w-6 items-center justify-center rounded-input border ${selected ? "border-primary bg-primary" : "border-control bg-surface"}`}>
        {selected ? <Feather name="check" size={18} color={check} /> : null}
      </View>
      {children}
    </PressableScale>
  );
}

function StockList({ items, selected, onToggle }: { items: readonly StockItem[]; selected: ReadonlySet<string>; onToggle: (id: string) => void }) {
  const { t } = useT();
  const { formatLength } = useLengthUnit();
  return (
    <>
      {GROUPS.map((group) => {
        const rows = items.filter((item) => item.allocation === group);
        if (rows.length === 0) return null;
        return (
          <View key={group} className="gap-2">
            <Text accessibilityRole="header" className="font-sans-semibold text-[13px] text-ink-muted">
              {t(`orders.stock.group.${group}`)}
            </Text>
            {rows.map((item) => (
              <SelectableRow key={item.id} label={item.serial} selected={selected.has(item.id)} onToggle={() => onToggle(item.id)}>
                <View className="min-w-0 flex-1 gap-1">
                  <Text className="font-mono-semibold text-[15px] text-ink">{item.serial}</Text>
                  <Text className="font-mono text-[13px] text-ink-muted">
                    {orderKgText(item.weightG)} {t("units.kg")} · {pcsText(item.pcs)} {t("units.pcs")}
                  </Text>
                  <View className="flex-row flex-wrap items-center gap-2">
                    <Text className="font-sans text-[13px] text-ink-muted">{formatLength(item.lengthMm)}</Text>
                    {item.orderNumber ? <Text className="font-mono text-[13px] text-ink-muted">{item.orderNumber}{item.poNumber ? ` · ${item.poNumber}` : ""}</Text> : null}
                    {item.lengthMatch ? <Chip tone="green" label={t("orders.stock.sameLength")} /> : null}
                    {item.needsApproval ? <Chip tone="amber" label={t("orders.stock.needsApproval")} /> : null}
                  </View>
                </View>
              </SelectableRow>
            ))}
          </View>
        );
      })}
    </>
  );
}

type HoldDone = {
  held: string[];
  alreadyHeld: string[];
  kgG: number;
  warnings: { serial: string; bundleLengthMm: number; lineLengthMm: number }[];
};

export function HoldStockSheet({ target, onClose }: { target: HoldTarget; onClose: () => void }) {
  const { t } = useT();
  const queryClient = useQueryClient();
  const { formatLength } = useLengthUnit();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [done, setDone] = useState<HoldDone | null>(null);
  const writing = useRef(false);
  const stock = useQuery(trpc.orders.matchStock.queryOptions({ sectionId: target.sectionId, cutLengthMm: target.cutLengthMm, customerId: target.customerId, limit: 100 }));
  const hold = useMutation(trpc.orders.hold.mutationOptions());
  const items = useMemo(() => holdableItems(stock.data?.items ?? [], target.lineId), [stock.data?.items, target.lineId]);
  const currentSelected = selectionInItems(selected, items);
  const tooMany = currentSelected.size > MAX_HOLD_BUNDLES;

  useEffect(() => {
    setSelected((current) => {
      const next = selectionInItems(current, items);
      return next.size === current.size ? current : next;
    });
  }, [items]);

  const toggle = (id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const submit = async () => {
    if (currentSelected.size === 0 || !claimWrite(writing)) return;
    setErrors([]);
    try {
      const result = await hold.mutateAsync({ lineId: target.lineId, bundleIds: [...currentSelected], ...(note.trim() ? { note: note.trim() } : {}) });
      setDone({ held: result.held, alreadyHeld: result.alreadyHeld, kgG: result.kgG, warnings: result.warnings });
      feedback.success();
      announce(t("orders.hold.heldDone", { count: result.held.length, kg: orderKgText(result.kgG) }));
      await refreshAfterHold(queryClient);
    } catch (error) {
      feedback.error();
      setErrors(orderErrorLines(t, error));
      await refreshAfterHold(queryClient);
    } finally {
      writing.current = false;
    }
  };

  return (
    <Sheet visible onClose={onClose} title={t("orders.hold.sheetTitle", { n: target.lineNo })}>
      <Text className="font-sans text-[15px] leading-6 text-ink-muted">{t("orders.hold.hint")}</Text>
      {done ? (
        <View accessibilityLiveRegion="polite" className="gap-2">
          <Text className="font-sans-medium text-[15px] leading-6 text-ink">{t("orders.hold.heldDone", { count: done.held.length, kg: orderKgText(done.kgG) })}</Text>
          {done.alreadyHeld.length > 0 ? <Text className="font-sans text-sm leading-5 text-ink-muted">{t("orders.hold.alreadyList", { serials: done.alreadyHeld.join(", ") })}</Text> : null}
          {done.warnings.map((warning) => (
            <Text key={warning.serial} className="font-sans-medium text-sm leading-5 text-tone-amber-ink">
              {t("orders.hold.lengthWarning", { serial: warning.serial, length: formatLength(warning.bundleLengthMm), lineLength: formatLength(warning.lineLengthMm) })}
            </Text>
          ))}
          <Button label={t("common.done")} onPress={onClose} />
        </View>
      ) : (
        <>
          {stock.isPending ? <LoadingBlock /> : stock.isError ? <Text accessibilityRole="alert" className="font-sans text-sm text-destructive">{t("errors.generic")}</Text> : items.length === 0 ? <Text className="font-sans text-sm text-ink-muted">{t("orders.hold.none")}</Text> : <StockList items={items} selected={currentSelected} onToggle={toggle} />}
          {tooMany ? <Text accessibilityRole="alert" className="font-sans text-[13px] text-destructive">{t("orders.hold.tooMany", { max: MAX_HOLD_BUNDLES })}</Text> : null}
          <Field label={t("common.note")} value={note} onChangeText={setNote} multiline maxLength={500} />
          <SheetErrors lines={errors} />
          <Button variant="secondary" label={t("common.cancel")} onPress={onClose} />
          <Button size="lg" testID="hold-stock-submit" label={t("orders.hold.submit", { count: currentSelected.size })} loading={hold.isPending} loadingLabel={t("common.saving")} disabled={currentSelected.size === 0 || tooMany} onPress={() => void submit()} />
        </>
      )}
    </Sheet>
  );
}

export function HeldSheet({ target, onClose }: { target: HoldTarget; onClose: () => void }) {
  const { t } = useT();
  const queryClient = useQueryClient();
  const { formatLength } = useLengthUnit();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<string[]>([]);
  const holds = useQuery(trpc.orders.holds.queryOptions({ lineId: target.lineId, limit: 200 }));
  const release = useMutation(trpc.orders.release.mutationOptions());
  const items = useMemo(() => holds.data?.items ?? [], [holds.data?.items]);
  const currentSelected = selectionInItems(selected, items);

  useEffect(() => {
    setSelected((current) => {
      const next = selectionInItems(current, items);
      return next.size === current.size ? current : next;
    });
  }, [items]);

  const submit = async (bundleIds: string[] | null) => {
    setErrors([]);
    try {
      const result = await release.mutateAsync({ lineId: target.lineId, ...(bundleIds ? { bundleIds } : {}) });
      setSelected(new Set());
      feedback.success();
      announce(t("orders.hold.released", { count: result.released.length }));
      await refreshAfterHold(queryClient);
    } catch (error) {
      feedback.error();
      setErrors(orderErrorLines(t, error));
      await refreshAfterHold(queryClient);
    }
  };

  return (
    <Sheet visible onClose={onClose} title={t("orders.hold.listTitle", { n: target.lineNo })}>
      {holds.isPending ? <LoadingBlock /> : holds.isError ? <Text accessibilityRole="alert" className="font-sans text-sm text-destructive">{t("errors.generic")}</Text> : items.length === 0 ? <Text className="font-sans text-sm text-ink-muted">{t("orders.hold.empty")}</Text> : items.map((item) => (
        <SelectableRow
          key={item.id}
          label={item.serial}
          selected={selected.has(item.id)}
          onToggle={() => setSelected((current) => {
            const next = new Set(current);
            if (next.has(item.id)) next.delete(item.id);
            else next.add(item.id);
            return next;
          })}
        >
          <View className="min-w-0 flex-1 gap-1">
            <Text className="font-mono-semibold text-[15px] text-ink">{item.serial}</Text>
            <Text className="font-mono text-[13px] text-ink-muted">
              {formatLength(item.lengthMm)} · {pcsText(item.pcs)} {t("units.pcs")} · {orderKgText(item.weightG)} {t("units.kg")}
            </Text>
            {item.dispatchCode ? <View className="items-start"><Chip tone="amber" label={t("orders.hold.onDispatch", { code: item.dispatchCode })} /></View> : null}
          </View>
        </SelectableRow>
      ))}
      <SheetErrors lines={errors} />
      <Button variant="secondary" label={t("common.done")} onPress={onClose} />
      {items.length > 0 ? (
        <>
          <Button variant="secondary" testID="release-selected" label={t("orders.hold.releaseSelected", { count: currentSelected.size })} loading={release.isPending} disabled={currentSelected.size === 0} onPress={() => void submit([...currentSelected])} />
          <Button size="lg" testID="release-all" label={t("orders.hold.releaseAll")} loading={release.isPending} onPress={() => void submit(null)} />
        </>
      ) : null}
    </Sheet>
  );
}

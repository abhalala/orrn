import Feather from "@expo/vector-icons/Feather";
import { useT, type MessageKey } from "@orrn/i18n";
import { cn } from "@orrn/ui/lib/utils";
import { useState, type ReactNode } from "react";
import { Text, View } from "react-native";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { ListRow } from "@/components/ui/list-row";
import { NumberInput } from "@/components/ui/number-input";
import { PressableScale } from "@/components/ui/pressable-scale";
import { Sheet } from "@/components/ui/sheet";
import { useThemeColor } from "@/lib/theme";

import { MELT_MORE_TIMES, MELT_PAIR, bpText } from "./foundry-model";
import {
  figuresOf,
  kgToG,
  lineKey,
  MAX_LOG_LINES,
  MAX_LOT_LINES,
  MAX_STREAM_RETURNS,
  type FormIssue,
  type MeltForm,
} from "./melt-form";
import { nowTimeIn, resolveMeltTimes, type MeltTimeKey } from "./melt-times";
import { kgOf, Note } from "./ui";

export type Lot = { id: string; number: string; itemName: string; gradeCode: string; remainingG: number };
export type Stream = { id: string; code: string; name: string; kind: string; active: boolean; balanceG: number };
export type FurnaceOpt = { id: string; code: string; name: string; capacityG: number; status: string };
export type AlloyOpt = { id: string; code: string; status: string };

export type SectionProps = {
  form: MeltForm;
  patch: (next: Partial<MeltForm>) => void;
  /** The first problem the last save attempt found, to mark its line. */
  issue: FormIssue | null;
};

const TIME_LABEL: Record<MeltTimeKey, MessageKey> = {
  preheatStart: "foundry.melt.times.preheatStart",
  chargingStart: "foundry.melt.times.chargingStart",
  chargingEnd: "foundry.melt.times.chargingEnd",
  castingStart: "foundry.melt.times.castingStart",
  castingEnd: "foundry.melt.times.castingEnd",
};

// --- A section that opens and closes -----------------------------------------------------------------------------

/** One part of the melt sheet. The header says what it is and how it stands; opening it shows the fields. */
export function Accordion({ title, summary, open, onToggle, children }: { title: string; summary?: string; open: boolean; onToggle: () => void; children: ReactNode }) {
  const ink = useThemeColor("foreground");
  return (
    <View className="rounded-card border border-hairline bg-surface">
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={summary ? `${title}, ${summary}` : title}
        accessibilityState={{ expanded: open }}
        onPress={onToggle}
        className="min-h-14 flex-row items-center gap-3 px-4 py-3"
      >
        <View className="min-w-0 flex-1 gap-0.5">
          <Text className="font-display-bold text-lg text-ink">{title}</Text>
          {summary ? <Text className="font-sans text-sm text-ink-muted">{summary}</Text> : null}
        </View>
        <Feather name={open ? "chevron-up" : "chevron-down"} size={22} color={ink} importantForAccessibility="no" />
      </PressableScale>
      {open ? <View className="gap-4 px-4 pb-4">{children}</View> : null}
    </View>
  );
}

// --- A picker in a sheet -------------------------------------------------------------------------------------------------

export type PickOption = { value: string; title: string; subtitle?: string; disabled?: boolean };

/** A field that looks like an input and opens a list of choices in a sheet. */
export function PickerField({ label, valueLabel, placeholder, title, options, value, onPick, error }: { label: string; valueLabel?: string; placeholder: string; title: string; options: readonly PickOption[]; value: string; onPick: (value: string) => void; error?: string | null }) {
  const muted = useThemeColor("muted-foreground");
  const [open, setOpen] = useState(false);
  return (
    <View className="gap-1.5">
      <Text className="font-sans-medium text-sm text-ink">{label}</Text>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={`${label}, ${valueLabel || placeholder}`}
        onPress={() => setOpen(true)}
        className={cn("min-h-14 flex-row items-center gap-2 rounded-input border bg-surface px-4", error ? "border-destructive" : "border-control")}
      >
        <Text numberOfLines={2} className={cn("min-w-0 flex-1 font-sans text-base", valueLabel ? "text-ink" : "text-ink-muted")}>
          {valueLabel || placeholder}
        </Text>
        <Feather name="chevron-down" size={20} color={muted} importantForAccessibility="no" />
      </PressableScale>
      {error ? <Text className="font-sans text-sm text-destructive">{error}</Text> : null}
      <Sheet visible={open} onClose={() => setOpen(false)} title={title}>
        <View accessibilityRole="radiogroup" className="gap-2">
          {options.map((o) => {
            const selected = o.value === value;
            return (
              <ListRow
                key={o.value}
                title={o.title}
                subtitle={o.subtitle}
                className={cn(selected && "border-primary", o.disabled && "opacity-50")}
                radioChecked={selected}
                onPress={
                  o.disabled
                    ? undefined
                    : () => {
                        onPick(o.value);
                        setOpen(false);
                      }
                }
              />
            );
          })}
        </View>
      </Sheet>
    </View>
  );
}

function RemoveButton({ onPress }: { onPress: () => void }) {
  const { t } = useT();
  const ink = useThemeColor("foreground");
  return (
    <PressableScale accessibilityRole="button" accessibilityLabel={t("common.remove")} onPress={onPress} className="h-11 w-11 items-center justify-center rounded-full">
      <Feather name="trash-2" size={20} color={ink} />
    </PressableScale>
  );
}

const lineBox = "gap-3 rounded-card border border-hairline bg-canvas p-3";

// --- 1. Furnace, alloy and times -------------------------------------------------------------------------------------

function TimeField({ k, form, patch, timeZone, invalid, nextDay }: { k: MeltTimeKey; form: MeltForm; patch: SectionProps["patch"]; timeZone: string; invalid: boolean; nextDay: boolean }) {
  const { t } = useT();
  return (
    <View className="flex-row items-end gap-2">
      <Field
        className="min-w-0 flex-1"
        mono
        label={t(TIME_LABEL[k])}
        hint={nextDay ? t("foundry.melt.nextDay") : undefined}
        error={invalid ? t("foundry.melt.issue.time") : null}
        value={form.times[k]}
        onChangeText={(v) => patch({ times: { ...form.times, [k]: v } })}
        keyboardType="numbers-and-punctuation"
        placeholder="14:20"
        maxLength={5}
      />
      <Button variant="secondary" label={t("foundry.melt.now")} onPress={() => patch({ times: { ...form.times, [k]: nowTimeIn(timeZone) } })} />
    </View>
  );
}

export function TimesSection({ form, patch, issue, furnaces, alloys, castAlloy, timeZone }: SectionProps & { furnaces: FurnaceOpt[]; alloys: AlloyOpt[]; castAlloy: string; timeZone: string }) {
  const { t } = useT();
  const [all, setAll] = useState(false);
  const resolved = resolveMeltTimes(form.date, form.times, timeZone);
  const picked = alloys.find((a) => a.id === form.alloyId);
  const differs = picked !== undefined && picked.code !== castAlloy;
  const furnace = furnaces.find((f) => f.id === form.furnaceId);
  return (
    <View className="gap-4">
      <PickerField
        label={t("foundry.melt.furnace")}
        valueLabel={furnace ? `${furnace.code} · ${kgOf(furnace.capacityG)} ${t("units.kg")}` : undefined}
        placeholder={furnaces.length === 0 ? t("foundry.melt.noFurnace") : t("foundry.melt.furnacePick")}
        title={t("foundry.melt.furnace")}
        options={furnaces.map((f) => ({ value: f.id, title: f.code, subtitle: `${kgOf(f.capacityG)} ${t("units.kg")}` }))}
        value={form.furnaceId}
        onPick={(v) => patch({ furnaceId: v })}
      />
      {alloys.length > 1 ? (
        <PickerField
          label={t("foundry.melt.alloy")}
          valueLabel={picked ? picked.code : t("foundry.melt.alloyAsCast", { alloy: castAlloy })}
          placeholder={t("foundry.melt.alloyAsCast", { alloy: castAlloy })}
          title={t("foundry.melt.alloy")}
          options={[{ value: "", title: t("foundry.melt.alloyAsCast", { alloy: castAlloy }) }, ...alloys.map((a) => ({ value: a.id, title: a.code }))]}
          value={form.alloyId}
          onPick={(v) => patch({ alloyId: v })}
        />
      ) : null}
      {differs ? <Field label={t("foundry.melt.alloyReason")} hint={t("foundry.melt.alloyReasonHint", { cast: castAlloy })} value={form.alloyReason} onChangeText={(v) => patch({ alloyReason: v })} maxLength={500} multiline /> : null}
      <Field
        mono
        label={t("foundry.melt.date")}
        value={form.date}
        onChangeText={(v) => patch({ date: v })}
        keyboardType="numbers-and-punctuation"
        placeholder="2026-10-25"
        maxLength={10}
        error={issue?.code === "date" ? t("foundry.melt.issue.date") : null}
      />
      {MELT_PAIR.map((k) => (
        <TimeField key={k} k={k} form={form} patch={patch} timeZone={timeZone} invalid={issue?.code === "time" && resolved.invalid.includes(k)} nextDay={resolved.nextDay[k]} />
      ))}
      {all ? (
        MELT_MORE_TIMES.map((k) => <TimeField key={k} k={k} form={form} patch={patch} timeZone={timeZone} invalid={issue?.code === "time" && resolved.invalid.includes(k)} nextDay={resolved.nextDay[k]} />)
      ) : (
        <Button variant="ghost" label={t("common.showMore")} onPress={() => setAll(true)} />
      )}
    </View>
  );
}

// --- 2. Charge ------------------------------------------------------------------------------------------------------------

export function ChargeSection({ form, patch, issue, lots, streams, capacityG }: SectionProps & { lots: Lot[]; streams: Stream[]; capacityG: number | null }) {
  const { t } = useT();
  const fig = figuresOf(form, capacityG);
  const takenLots = new Set(form.lots.map((l) => l.lotId));
  const takenStreams = new Set(form.streams.map((s) => s.streamId));
  const charge = streams.filter((s) => s.kind === "charge" && s.active);
  return (
    <View className="gap-5">
      <View className="gap-3">
        <Text accessibilityRole="header" className="font-sans-semibold text-base text-ink">
          {t("foundry.melt.charge.lots")}
        </Text>
        {lots.length === 0 ? <Note>{t("foundry.melt.charge.noLots")}</Note> : null}
        {form.lots.map((l, i) => {
          const lot = lots.find((x) => x.id === l.lotId);
          const g = kgToG(l.kgText);
          const over = lot !== undefined && g !== null && g > lot.remainingG;
          const marked = issue?.step === "charge" && issue.line === i && (issue.code === "lot" || issue.code === "kg" || issue.code === "kgTooLarge" || issue.code === "duplicateLot");
          const lotError = marked && (issue!.code === "lot" || issue!.code === "duplicateLot") ? (issue!.code === "lot" ? t("foundry.melt.issue.lot") : t("foundry.melt.issue.duplicateLot")) : null;
          const kgError = over ? t("foundry.melt.charge.over", { kg: kgOf(lot!.remainingG) }) : marked && issue!.code === "kg" ? t("foundry.melt.issue.kg") : marked && issue!.code === "kgTooLarge" ? t("foundry.melt.issue.kgTooLarge") : null;
          return (
            <View key={l.key} className={lineBox}>
              <PickerField
                label={t("foundry.melt.charge.lot")}
                valueLabel={lot ? `${lot.number} · ${[lot.itemName, lot.gradeCode].filter(Boolean).join(" ")}` : undefined}
                placeholder={t("foundry.melt.charge.lotPick")}
                title={t("foundry.melt.charge.lot")}
                options={lots.map((x) => ({ value: x.id, title: x.number, subtitle: `${[x.itemName, x.gradeCode].filter(Boolean).join(" ")} · ${t("foundry.melt.charge.left", { kg: kgOf(x.remainingG) })}`, disabled: takenLots.has(x.id) && x.id !== l.lotId }))}
                value={l.lotId}
                onPick={(v) => patch({ lots: form.lots.map((x) => (x.key === l.key ? { ...x, lotId: v } : x)) })}
                error={lotError}
              />
              <View className="flex-row items-end gap-2">
                <NumberInput
                  className="min-w-0 flex-1"
                  label={t("foundry.melt.charge.kg")}
                  unit={t("units.kg")}
                  hint={lot ? t("foundry.melt.charge.left", { kg: kgOf(lot.remainingG) }) : undefined}
                  error={kgError}
                  value={l.kgText}
                  onChangeText={(v) => patch({ lots: form.lots.map((x) => (x.key === l.key ? { ...x, kgText: v } : x)) })}
                />
                {lot ? <Button variant="secondary" label={t("foundry.melt.charge.all")} onPress={() => patch({ lots: form.lots.map((x) => (x.key === l.key ? { ...x, kgText: String(lot.remainingG / 1000) } : x)) })} /> : null}
                <RemoveButton onPress={() => patch({ lots: form.lots.filter((x) => x.key !== l.key) })} />
              </View>
            </View>
          );
        })}
        <Button variant="secondary" label={t("foundry.melt.charge.addLot")} disabled={form.lots.length >= MAX_LOT_LINES || lots.length === 0} onPress={() => patch({ lots: [...form.lots, { key: lineKey(), lotId: "", kgText: "" }] })} />
      </View>

      <View className="gap-3">
        <Text accessibilityRole="header" className="font-sans-semibold text-base text-ink">
          {t("foundry.melt.charge.streams")}
        </Text>
        {form.streams.map((s, i) => {
          const stream = charge.find((x) => x.id === s.streamId);
          const marked = issue?.step === "charge" && issue.line === i && issue.code !== "lot" && issue.code !== "duplicateLot" && issue.code !== "tooMany";
          return (
            <View key={s.key} className={lineBox}>
              <PickerField
                label={t("foundry.melt.charge.stream")}
                valueLabel={stream ? stream.code : undefined}
                placeholder={t("foundry.melt.charge.streamPick")}
                title={t("foundry.melt.charge.stream")}
                options={charge.map((x) => ({ value: x.id, title: x.code, subtitle: `${kgOf(x.balanceG)} ${t("units.kg")}`, disabled: takenStreams.has(x.id) && x.id !== s.streamId }))}
                value={s.streamId}
                onPick={(v) => patch({ streams: form.streams.map((x) => (x.key === s.key ? { ...x, streamId: v } : x)) })}
              />
              <View className="flex-row items-end gap-2">
                <NumberInput
                  className="min-w-0 flex-1"
                  label={t("foundry.melt.charge.kg")}
                  unit={t("units.kg")}
                  hint={stream ? t("foundry.melt.charge.left", { kg: kgOf(stream.balanceG) }) : undefined}
                  error={marked ? t("foundry.melt.issue.kg") : null}
                  value={s.kgText}
                  onChangeText={(v) => patch({ streams: form.streams.map((x) => (x.key === s.key ? { ...x, kgText: v } : x)) })}
                />
                <RemoveButton onPress={() => patch({ streams: form.streams.filter((x) => x.key !== s.key) })} />
              </View>
            </View>
          );
        })}
        <Button variant="secondary" label={t("foundry.melt.charge.addStream")} disabled={charge.length === 0} onPress={() => patch({ streams: [...form.streams, { key: lineKey(), streamId: "", kgText: "" }] })} />
      </View>

      <Text className="font-mono-semibold text-base text-ink">{t("foundry.melt.charge.total", { kg: kgOf(fig.balance.metalInG) })}</Text>
      {fig.load === "over" ? <Note tone="red">{t("foundry.melt.charge.overCapacity")}</Note> : fig.load === "near" ? <Note tone="amber">{t("foundry.melt.charge.nearCapacity")}</Note> : null}
    </View>
  );
}

// --- 3. Output ----------------------------------------------------------------------------------------------------------------

export function OutputSection({ form, patch, issue, streams, capacityG }: SectionProps & { streams: Stream[]; capacityG: number | null }) {
  const { t } = useT();
  const fig = figuresOf(form, capacityG);
  const b = fig.balance;
  const outside = b.metalInG > 0 && (b.needsReason || b.negativeBurn);
  const returnable = streams.filter((s) => s.kind === "charge" && s.active);
  return (
    <View className="gap-5">
      <View className="gap-3">
        <Text accessibilityRole="header" className="font-sans-semibold text-base text-ink">
          {t("foundry.melt.out.logs")}
        </Text>
        <Text className="font-sans text-sm text-ink-muted">{t("foundry.melt.out.logsHint")}</Text>
        {form.logs.map((l, i) => {
          const marked = issue?.step === "output" && issue.line === i && (issue.code === "log" || issue.code === "kgTooLarge");
          const set = (next: Partial<typeof l>) => patch({ logs: form.logs.map((x) => (x.key === l.key ? { ...x, ...next } : x)) });
          return (
            <View key={l.key} className={lineBox}>
              <View className="flex-row gap-3">
                <NumberInput className="flex-1" integer label={t("foundry.melt.out.pcs")} value={l.pcsText} onChangeText={(v) => set({ pcsText: v })} error={marked ? (issue!.code === "log" ? t("foundry.melt.issue.log") : t("foundry.melt.issue.kgTooLarge")) : null} />
                <NumberInput className="flex-1" label={t("foundry.melt.out.length")} unit={t("units.ft")} value={l.lengthText} onChangeText={(v) => set({ lengthText: v })} />
              </View>
              <View className="flex-row items-end gap-3">
                <NumberInput className="flex-1" label={t("foundry.melt.out.kg")} unit={t("units.kg")} value={l.kgText} onChangeText={(v) => set({ kgText: v })} />
                <NumberInput className="flex-1" label={t("foundry.melt.out.billetLength")} unit={t("units.ft")} hint={t("foundry.melt.out.billetLengthHint")} value={l.billetLengthText} onChangeText={(v) => set({ billetLengthText: v })} />
                <RemoveButton onPress={() => patch({ logs: form.logs.filter((x) => x.key !== l.key) })} />
              </View>
            </View>
          );
        })}
        <Button variant="secondary" label={t("foundry.melt.out.addLog")} disabled={form.logs.length >= MAX_LOG_LINES} onPress={() => patch({ logs: [...form.logs, { key: lineKey(), pcsText: "", lengthText: form.logs.at(-1)?.lengthText ?? "", billetLengthText: "", kgText: "" }] })} />
      </View>

      <View className="gap-3">
        <Text accessibilityRole="header" className="font-sans-semibold text-base text-ink">
          {t("foundry.melt.out.byproducts")}
        </Text>
        <View className="flex-row gap-3">
          <NumberInput className="flex-1" label={t("foundry.melt.out.dross")} unit={t("units.kg")} value={form.drossKg} onChangeText={(v) => patch({ drossKg: v })} />
          <NumberInput className="flex-1" label={t("foundry.melt.out.fe")} unit={t("units.kg")} value={form.feKg} onChangeText={(v) => patch({ feKg: v })} />
        </View>
      </View>

      <View className="gap-3">
        <Text accessibilityRole="header" className="font-sans-semibold text-base text-ink">
          {t("foundry.melt.out.returns")}
        </Text>
        {form.returns.map((r) => (
          <View key={r.key} className={lineBox}>
            <PickerField
              label={t("foundry.melt.charge.stream")}
              valueLabel={returnable.find((x) => x.id === r.streamId)?.code}
              placeholder={t("foundry.melt.charge.streamPick")}
              title={t("foundry.melt.charge.stream")}
              options={returnable.map((x) => ({ value: x.id, title: x.code }))}
              value={r.streamId}
              onPick={(v) => patch({ returns: form.returns.map((x) => (x.key === r.key ? { ...x, streamId: v } : x)) })}
            />
            <View className="flex-row items-end gap-2">
              <NumberInput className="min-w-0 flex-1" label={t("foundry.melt.out.kg")} unit={t("units.kg")} value={r.kgText} onChangeText={(v) => patch({ returns: form.returns.map((x) => (x.key === r.key ? { ...x, kgText: v } : x)) })} />
              <RemoveButton onPress={() => patch({ returns: form.returns.filter((x) => x.key !== r.key) })} />
            </View>
          </View>
        ))}
        <Button variant="ghost" label={t("foundry.melt.out.addReturn")} disabled={form.returns.length >= MAX_STREAM_RETURNS || returnable.length === 0} onPress={() => patch({ returns: [...form.returns, { key: lineKey(), streamId: "", kgText: "" }] })} />
      </View>

      {outside ? <Field label={t("foundry.melt.out.balanceNote")} hint={b.negativeBurn ? t("foundry.melt.out.moreOut") : t("foundry.melt.out.burnHigh")} value={form.balanceNote} onChangeText={(v) => patch({ balanceNote: v })} maxLength={500} multiline /> : null}
    </View>
  );
}

/** The running balance: kg in and out, burn and yield, worked out on the screen for the person typing (the server stores its own). */
export function Balance({ form, capacityG }: { form: MeltForm; capacityG: number | null }) {
  const { t } = useT();
  const fig = figuresOf(form, capacityG);
  const b = fig.balance;
  const tone = b.metalInG === 0 ? "bg-surface-sunken" : b.needsReason || b.negativeBurn ? "bg-tone-amber-tint" : "bg-tone-green-tint";
  const ink = b.metalInG === 0 ? "text-ink" : b.needsReason || b.negativeBurn ? "text-tone-amber-ink" : "text-tone-green-ink";
  return (
    <View accessibilityLiveRegion="polite" className={cn("gap-1 rounded-card px-4 py-3", tone)}>
      <Text className={cn("font-mono-semibold text-[15px]", ink)}>{t("foundry.melt.balance.in", { kg: kgOf(b.metalInG) })}</Text>
      <Text className={cn("font-mono-semibold text-[15px]", ink)}>{t("foundry.melt.balance.out", { kg: kgOf(fig.logsG + fig.drossG + fig.feG + fig.returnsG) })}</Text>
      <Text className={cn("font-mono-semibold text-[15px]", ink)}>{t("foundry.melt.balance.burn", { kg: kgOf(Math.abs(b.burnG)), pct: bpText(b.balanceBp === null ? null : Math.abs(b.balanceBp)) || "0.0" })}</Text>
      <Text className={cn("font-mono-semibold text-[15px]", ink)}>{t("foundry.melt.balance.yield", { pct: bpText(b.yieldBp) || "0.0" })}</Text>
    </View>
  );
}

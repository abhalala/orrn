import { useT } from "@orrn/i18n";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Stack, useRouter } from "expo-router";
import { useMemo, useRef, useState } from "react";
import { Text, View } from "react-native";

import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Field } from "@/components/ui/field";
import { ListRow } from "@/components/ui/list-row";
import { NumberInput } from "@/components/ui/number-input";
import { PageHeader } from "@/components/ui/page-header";
import { PressableScale } from "@/components/ui/pressable-scale";
import { Screen } from "@/components/ui/screen";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { LoadingBlock } from "@/components/ui/state";
import { CustomerPicker } from "@/features/dispatch/customer-picker";
import { ChoiceRow } from "@/features/dies/choice-row";
import { useDebounced } from "@/features/more/use-debounced";
import { announce } from "@/lib/a11y";
import { feedback } from "@/lib/feedback";
import { randomId } from "@/lib/random-id";
import { useLengthUnit } from "@/utils/length";
import { can, useMe } from "@/utils/me";
import { queryClient, trpc } from "@/utils/trpc";

import {
  addLine,
  afterBooked,
  bookingSubmit,
  completeLines,
  copyChoiceInput,
  cutLengthMm,
  lineComplete,
  lineProblems,
  newDraft,
  partyProblem,
  QUICK_FEET,
  quoteArgs,
  removeLine,
  toCreateInput,
  updateLine,
  type BookingDraft,
  type LineDraft,
  type QtyBasis,
  type QuoteArgs,
  type WeightBasis,
} from "./booking-form";
import { dieTitle, milliText, orderErrorLines, orderKgText, pcsText } from "./order-model";

type DieOption = { id: string; series: string; sectionCode: string; name: string | null };

/**
 * Book an order on the phone, one line at a time (spec E2 "Native"): customer and PO, then each line
 * (die, copy or tier, length, pieces or kg), then a review and Book. The server works out the other
 * side of every line (`orders.quote`); the phone only shows it. Nothing the person typed is cleared by
 * a failed save. A booking is not confirmed here: the order page confirms it.
 */
export function BookingScreen() {
  const { t } = useT();
  const router = useRouter();
  const { data: me } = useMe();
  const { unit } = useLengthUnit();
  const keys = useRef(0);
  const nextKey = () => `l${++keys.current}`;
  const [draft, setDraft] = useState<BookingDraft>(() => newDraft(nextKey()));
  const [errors, setErrors] = useState<string[]>([]);
  const [attempt, setAttempt] = useState<{ payload: string; id: string } | null>(null);
  const create = useMutation(trpc.orders.create.mutationOptions());

  if (!can(me, "order.manage")) {
    return (
      <Screen>
        <Text className="font-sans text-[15px] text-ink">{t("errors.forbidden")}</Text>
      </Screen>
    );
  }

  const line = draft.lines[draft.at]!;
  const edit = (next: BookingDraft) => {
    setErrors([]);
    setDraft(next);
  };

  async function book() {
    const base = toCreateInput(draft, unit, "");
    if (!base) return;
    // The same booking asked again after an unsure answer reuses its key, so it cannot be made twice.
    const sent = bookingSubmit(attempt, base, randomId);
    setAttempt(sent.attempt);
    setErrors([]);
    try {
      const done = await create.mutateAsync({ ...base, clientRequestId: sent.id });
      setAttempt(afterBooked());
      feedback.success();
      announce(t("orders.form.saved", { number: done.number }));
      void queryClient.invalidateQueries(trpc.orders.pathFilter());
      router.replace({ pathname: "/orders/[id]", params: { id: done.id } });
    } catch (e) {
      feedback.error();
      setErrors(orderErrorLines(t, e));
    }
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: t("orders.new") }} />
      <PageHeader
        title={t("orders.new")}
        subtitle={draft.step === "party" ? t("orders.form.party") : draft.step === "line" ? t("native.orders.lineOf", { n: draft.at + 1, total: draft.lines.length }) : t("native.orders.review")}
      />

      {draft.step === "party" ? (
        <PartyStep draft={draft} onChange={edit} onNext={() => edit({ ...draft, step: "line" })} />
      ) : draft.step === "line" ? (
        <LineStep
          line={line}
          onChange={(patch) => edit(updateLine(draft, draft.at, patch))}
          onBack={() => edit(draft.at > 0 ? { ...draft, at: draft.at - 1 } : { ...draft, step: "party" })}
          onAnother={() => edit(addLine(draft, nextKey()))}
          onReview={() => edit({ ...draft, step: "review" })}
        />
      ) : (
        <ReviewStep
          draft={draft}
          booking={create.isPending}
          errors={errors}
          onEdit={(i) => edit({ ...draft, at: i, step: "line" })}
          onRemove={(i) => edit(removeLine(draft, i))}
          onAnother={() => edit(addLine(draft, nextKey()))}
          onBack={() => edit({ ...draft, step: "line", at: draft.lines.length - 1 })}
          onBook={() => void book()}
        />
      )}
    </Screen>
  );
}

function PartyStep({ draft, onChange, onNext }: { draft: BookingDraft; onChange: (d: BookingDraft) => void; onNext: () => void }) {
  const { t } = useT();
  const [tried, setTried] = useState(false);
  const problem = partyProblem(draft);
  return (
    <View className="gap-4">
      <CustomerPicker
        selected={draft.customer}
        onSelect={(c) => onChange({ ...draft, customer: c })}
        onClear={() => onChange({ ...draft, customer: null })}
        error={tried && problem ? t(problem) : null}
      />
      <Field label={t("orders.poNumber")} hint={t("orders.form.poHint")} placeholder={t("orders.form.poPlaceholder")} value={draft.po} onChangeText={(po) => onChange({ ...draft, po })} autoCapitalize="characters" autoCorrect={false} maxLength={100} />
      <Button
        size="lg"
        label={t("common.next")}
        onPress={() => {
          if (problem) setTried(true);
          else onNext();
        }}
      />
    </View>
  );
}

function LineStep({
  line,
  onChange,
  onBack,
  onAnother,
  onReview,
}: {
  line: LineDraft;
  onChange: (patch: Partial<LineDraft>) => void;
  onBack: () => void;
  onAnother: () => void;
  onReview: () => void;
}) {
  const { t } = useT();
  const { unit } = useLengthUnit();
  const [tried, setTried] = useState(false);
  const problems = lineProblems(line, unit);
  const complete = lineComplete(line, unit);
  const go = (then: () => void) => {
    if (complete) {
      setTried(false);
      then();
    } else setTried(true);
  };

  return (
    <View className="gap-5">
      <DiePicker line={line} error={tried && problems.die ? t(problems.die) : null} onPick={(die) => onChange({ die, copy: "any" })} onClear={() => onChange({ die: null, copy: "any" })} />
      {line.die ? <CopyChoice sectionId={line.die.id} value={line.copy} onChange={(copy) => onChange({ copy })} /> : null}
      <LengthInputs line={line} error={tried && problems.length ? t(problems.length) : null} onChange={onChange} />
      <QtyInputs line={line} error={tried && problems.qty ? t(problems.qty) : null} onChange={onChange} />
      {line.die ? <QuoteView line={line} onChange={onChange} /> : null}

      <View className="gap-3">
        <Button size="lg" label={t("native.orders.toReview")} onPress={() => go(onReview)} />
        <Button variant="secondary" label={t("orders.form.addLine")} onPress={() => go(onAnother)} />
        <Button variant="ghost" label={t("common.back")} onPress={onBack} />
      </View>
    </View>
  );
}

function DiePicker({ line, error, onPick, onClear }: { line: LineDraft; error: string | null; onPick: (die: { id: string; label: string }) => void; onClear: () => void }) {
  const { t } = useT();
  const [text, setText] = useState("");
  const search = useDebounced(text.trim(), 250);
  const dies = useQuery({ ...trpc.die.list.queryOptions({ search: search || undefined, status: "active", limit: 20 }), enabled: !line.die });

  if (line.die) {
    return (
      <View className="gap-2">
        <Text className="font-sans-medium text-sm text-ink">{t("orders.line.die")}</Text>
        <View className="gap-3 rounded-card border border-hairline bg-surface p-4">
          <Text className="font-sans-semibold text-base text-ink">{line.die.label}</Text>
          <Button variant="secondary" label={t("native.orders.changeDie")} onPress={onClear} />
        </View>
      </View>
    );
  }
  const rows = (dies.data?.items ?? []) as DieOption[];
  return (
    <View className="gap-3">
      <Field label={t("orders.line.die")} placeholder={t("orders.form.dieSearch")} value={text} onChangeText={setText} error={error} autoCapitalize="characters" autoCorrect={false} returnKeyType="search" />
      {dies.isPending ? <LoadingBlock /> : null}
      {dies.isError ? <Text className="font-sans text-[15px] text-destructive">{t("errors.network")}</Text> : null}
      {dies.isSuccess && rows.length === 0 ? <Text className="font-sans text-[15px] text-ink-muted">{t("common.noResults", { query: search })}</Text> : null}
      {rows.map((d) => (
        <ListRow key={d.id} title={`${d.series} ${d.sectionCode}`} subtitle={d.name ?? undefined} onPress={() => onPick({ id: d.id, label: dieTitle({ sectionCode: `${d.series} ${d.sectionCode}`, name: d.name }) })} />
      ))}
    </View>
  );
}

/** Any copy (the die room picks), one copy, or "tier N or better" for a tier some copy holds. */
function CopyChoice({ sectionId, value, onChange }: { sectionId: string; value: string; onChange: (v: string) => void }) {
  const { t } = useT();
  const copies = useQuery(trpc.dieInstance.list.queryOptions({ sectionId, limit: 100 }));
  const live = (copies.data?.items ?? []).filter((c) => c.status !== "retired");
  const ranks = [...new Set(live.map((c) => c.tierRank).filter((r): r is number => r != null))].sort((a, b) => a - b);
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={t("orders.line.copy")} className="gap-2">
      <Text className="font-sans-medium text-sm text-ink">{t("orders.line.copy")}</Text>
      <ChoiceRow label={t("orders.line.anyCopy")} selected={value === "any"} onPress={() => onChange("any")} />
      {copies.isPending ? <LoadingBlock /> : null}
      {live.map((c) => (
        <ChoiceRow key={c.id} label={t("orders.line.copyCode", { code: c.code })} selected={value === `copy:${c.id}`} onPress={() => onChange(`copy:${c.id}`)} />
      ))}
      {ranks.map((r) => (
        <ChoiceRow key={`tier${r}`} label={t("orders.line.tierOrBetter", { rank: r })} selected={value === `tier:${r}`} onPress={() => onChange(`tier:${r}`)} />
      ))}
    </View>
  );
}

function LengthInputs({ line, error, onChange }: { line: LineDraft; error: string | null; onChange: (patch: Partial<LineDraft>) => void }) {
  const { t } = useT();
  const { unit } = useLengthUnit();
  if (unit === "mm") {
    return <NumberInput label={t("orders.line.cutLength")} unit={t("units.mm")} hint={t("orders.form.lengthHintMm")} integer value={line.mm} onChangeText={(mm) => onChange({ mm })} error={error} />;
  }
  return (
    <View className="gap-3">
      <View accessibilityRole="radiogroup" accessibilityLabel={t("orders.form.quickLengths")} className="flex-row flex-wrap gap-2">
        {QUICK_FEET.map((ft) => {
          const selected = line.feet === String(ft) && (line.inches === "" || line.inches === "0");
          return (
            <PressableScale
              key={ft}
              accessibilityRole="radio"
              accessibilityLabel={`${ft} ${t("units.ft")}`}
              accessibilityState={{ checked: selected, selected }}
              onPress={() => onChange({ feet: String(ft), inches: "" })}
              className={selected ? "min-h-11 justify-center rounded-full border border-primary bg-primary px-4" : "min-h-11 justify-center rounded-full border border-control bg-surface px-4"}
            >
              <Text className={selected ? "font-sans-semibold text-[14px] text-primary-foreground" : "font-sans-semibold text-[14px] text-ink"}>{`${ft} ${t("units.ft")}`}</Text>
            </PressableScale>
          );
        })}
      </View>
      <View className="flex-row gap-3">
        <NumberInput className="flex-1" label={t("orders.form.feet")} unit={t("units.ft")} integer value={line.feet} onChangeText={(feet) => onChange({ feet })} error={error} />
        <NumberInput className="flex-1" label={t("orders.form.inches")} unit={t("units.inch")} value={line.inches} onChangeText={(inches) => onChange({ inches })} />
      </View>
    </View>
  );
}

function QtyInputs({ line, error, onChange }: { line: LineDraft; error: string | null; onChange: (patch: Partial<LineDraft>) => void }) {
  const { t } = useT();
  const basis: QtyBasis = line.basis ?? "pcs";
  return (
    <View className="gap-3">
      <SegmentedControl<QtyBasis>
        label={t("orders.line.pcs")}
        options={[
          { value: "pcs", label: t("orders.qtyBasis.pcs") },
          { value: "kg", label: t("orders.qtyBasis.kg") },
        ]}
        value={basis}
        onChange={(b) => onChange({ basis: b })}
      />
      {basis === "pcs" ? (
        <NumberInput label={t("orders.line.pcs")} unit={t("units.pcs")} integer value={line.pcsText} onChangeText={(pcsText) => onChange({ pcsText, basis: "pcs" })} error={error} />
      ) : (
        <NumberInput label={t("orders.line.kg")} unit={t("units.kg")} value={line.kgText} onChangeText={(kgText) => onChange({ kgText, basis: "kg" })} error={error} />
      )}
    </View>
  );
}

/** The server's other side of the line, shown while the person types. Nothing here is worked out on the phone. */
function QuoteView({ line, onChange }: { line: LineDraft; onChange: (patch: Partial<LineDraft>) => void }) {
  const { t } = useT();
  const { unit } = useLengthUnit();
  const args = useMemo(() => quoteArgs(line, unit), [line, unit]);
  const key = useDebounced(args ? JSON.stringify(args) : "", 400);
  const settled = key ? (JSON.parse(key) as QuoteArgs) : null;
  const quote = useQuery({ ...trpc.orders.quote.queryOptions(settled!), enabled: settled !== null, retry: false });
  if (!args) return null;
  if (settled === null || key !== JSON.stringify(args) || quote.isFetching) return <Text className="font-sans text-[15px] text-ink-muted">{t("orders.form.quoting")}</Text>;
  if (quote.isError || !quote.data) return <Text accessibilityLiveRegion="polite" className="font-sans text-[15px] text-destructive">{t("orders.form.quoteFailed")}</Text>;
  const q = quote.data;
  const typedKg = line.basis === "kg" ? orderKgText(q.kgG) : null;
  const basisLine = q.basisNote
    ? t("orders.form.noReading")
    : q.weightBasis === "copy_current"
      ? t("orders.form.basisUsingCopy", { milli: milliText(q.basisMilli), copy: q.copyCode ?? "" })
      : t("orders.form.basisUsingBand", { milli: milliText(q.basisMilli) });
  return (
    <View accessibilityLiveRegion="polite" className="gap-2 rounded-card border border-hairline bg-surface p-4">
      <Text className="font-sans-semibold text-base text-ink">
        {typedKg ? t("orders.form.impliedLine", { pcs: pcsText(q.pcs), implied: orderKgText(q.impliedG), kg: typedKg }) : t("orders.form.quoteLine", { pcs: pcsText(q.pcs), kg: orderKgText(q.kgG) })}
      </Text>
      <Text className="font-sans text-sm text-ink-muted">{basisLine}</Text>
      {q.copyMilli != null ? (
        <SegmentedControl<WeightBasis>
          label={t("orders.form.weightBasis")}
          options={[
            { value: "copy_current", label: t("orders.form.basisCurrent") },
            { value: "band_start", label: t("orders.form.basisBandStart") },
          ]}
          value={line.weightBasis}
          onChange={(weightBasis) => onChange({ weightBasis })}
        />
      ) : null}
    </View>
  );
}

function ReviewStep({
  draft,
  booking,
  errors,
  onEdit,
  onRemove,
  onAnother,
  onBack,
  onBook,
}: {
  draft: BookingDraft;
  booking: boolean;
  errors: string[];
  onEdit: (i: number) => void;
  onRemove: (i: number) => void;
  onAnother: () => void;
  onBack: () => void;
  onBook: () => void;
}) {
  const { t } = useT();
  const { unit, formatLength } = useLengthUnit();
  const ready = completeLines(draft, unit).length === draft.lines.length && draft.customer !== null;
  return (
    <View className="gap-4">
      <View className="gap-1 rounded-card border border-hairline bg-surface p-4">
        <Text className="font-sans-semibold text-base text-ink">{draft.customer?.name ?? ""}</Text>
        <Text className="font-sans text-[15px] text-ink-muted">{draft.po.trim() ? `${t("orders.po")} ${draft.po.trim()}` : t("orders.noPo")}</Text>
      </View>
      {draft.lines.map((l, i) => {
        const mm = cutLengthMm(l, unit);
        const qty = l.basis === "kg" ? `${l.kgText} ${t("units.kg")}` : `${l.pcsText} ${t("units.pcs")}`;
        const copy = copyChoiceInput(l.copy);
        return (
          <View key={l.key} className="gap-3 rounded-card border border-hairline bg-surface p-4">
            <View className="gap-0.5">
              <Text className="font-sans-semibold text-base text-ink">{`${t("orders.form.lineTitle", { n: i + 1 })} ${l.die?.label ?? ""}`}</Text>
              <Text className="font-sans text-[15px] text-ink-muted">{[mm != null ? formatLength(mm) : null, qty, copy.dieInstanceId ? t("orders.line.copyPinned") : copy.tierRank ? t("orders.line.tierOrBetter", { rank: copy.tierRank }) : null].filter(Boolean).join(", ")}</Text>
            </View>
            {!lineComplete(l, unit) ? <Chip tone="amber" label={t("native.orders.incomplete")} /> : null}
            <View className="flex-row gap-3">
              <Button className="flex-1" variant="secondary" label={t("common.edit")} onPress={() => onEdit(i)} />
              {draft.lines.length > 1 ? <Button className="flex-1" variant="ghost" label={t("orders.form.removeLine", { n: i + 1 })} onPress={() => onRemove(i)} /> : null}
            </View>
          </View>
        );
      })}
      <Button variant="secondary" label={t("orders.form.addLine")} onPress={onAnother} />
      <Text className="font-sans text-sm text-ink-muted">{t("orders.form.subtitle")}</Text>
      {errors.length > 0 ? (
        <View accessibilityRole="alert" accessibilityLiveRegion="polite" className="gap-1 rounded-input bg-tone-red-tint px-4 py-3">
          {errors.map((e) => (
            <Text key={e} className="font-sans-medium text-[15px] leading-6 text-tone-red-ink">
              {e}
            </Text>
          ))}
        </View>
      ) : null}
      <Button size="lg" label={t("orders.form.book")} loading={booking} loadingLabel={t("common.saving")} disabled={!ready} onPress={onBook} />
      <Button variant="ghost" label={t("common.back")} onPress={onBack} />
    </View>
  );
}

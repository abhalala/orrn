import { formatKgTotal, gToKg } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { cn } from "@orrn/ui/lib/utils";
import { useState } from "react";
import { Text, View } from "react-native";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { NumberInput } from "@/components/ui/number-input";
import { PressableScale } from "@/components/ui/pressable-scale";
import { announce } from "@/lib/a11y";
import { reasonLabel } from "@/features/press/reason-label";

import type { DraftReject } from "./pack-math";
import { EMPTY_REJECT, readReject, REJECT_CODES, rejectPieces, type RejectErrors, type RejectForm } from "./pack-submit";

/**
 * Rejects at pack (FP-PK-14): pieces taken out of the pile that are not a bundle. Weighed rejects post
 * their kg at plant scrap; pieces with no weight only leave the count. Saved with the session.
 */
export function RejectsPanel({ rejects, onAdd, onRemove }: { rejects: readonly DraftReject[]; onAdd: (r: DraftReject) => void; onRemove: (index: number) => void }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<RejectForm>(EMPTY_REJECT);
  const [errors, setErrors] = useState<RejectErrors>({});
  const total = rejectPieces(rejects);

  const add = () => {
    const r = readReject(form);
    if (!r.ok) {
      setErrors(r.errors);
      return;
    }
    onAdd(r.reject);
    announce(t("pack.reject.added", { count: r.reject.pcs }));
    setForm(EMPTY_REJECT);
    setErrors({});
  };

  return (
    <View className="gap-3 rounded-card border border-hairline bg-surface p-4">
      <View className="flex-row flex-wrap items-center justify-between gap-2">
        <Text accessibilityRole="header" className="min-w-0 shrink font-display-bold text-lg text-ink">
          {t("pack.reject.title")}
          {total > 0 ? `  ${t("pack.reject.saved", { count: total })}` : ""}
        </Text>
        <Button variant="secondary" label={t("pack.reject.add")} onPress={() => setOpen((o) => !o)} />
      </View>

      {rejects.map((r, i) => (
        <View key={`${i}-${r.pcs}-${r.reasonCode}`} className="flex-row items-center gap-3">
          <Text className="min-w-0 flex-1 font-sans text-[15px] text-ink">
            {[
              t("pack.reject.saved", { count: r.pcs }),
              reasonLabel(t, "qc_reject", r.reasonCode, r.reasonCode),
              r.weightG ? `${formatKgTotal(gToKg(r.weightG))} ${t("units.kg")}` : t("pack.reject.noWeight"),
              r.note ?? null,
            ]
              .filter(Boolean)
              .join(", ")}
          </Text>
          <Button variant="ghost" label={t("pack.reject.remove", { n: i + 1 })} onPress={() => onRemove(i)} />
        </View>
      ))}

      {open ? (
        <View className="gap-3 rounded-input bg-surface-sunken p-3">
          <Text className="font-sans text-sm text-ink-muted">{t("pack.reject.hint")}</Text>
          <NumberInput label={t("pack.reject.piecesLabel")} integer value={form.pcs} onChangeText={(pcs) => setForm((f) => ({ ...f, pcs }))} error={errors.pcs ? t("pack.new.piecesRequired") : null} />
          <NumberInput label={t("pack.reject.kg")} unit={t("units.kg")} value={form.kg} hint={t("pack.reject.kgHint")} onChangeText={(kg) => setForm((f) => ({ ...f, kg }))} error={errors.kg ? t("pack.new.weightRequired") : null} />
          <View accessibilityRole="radiogroup" accessibilityLabel={t("pack.reject.reason")} className="gap-2">
            <Text className="font-sans-medium text-sm text-ink">{t("pack.reject.reason")}</Text>
            <View className="flex-row flex-wrap gap-2">
              {REJECT_CODES.map((code) => {
                const selected = form.reasonCode === code;
                const label = reasonLabel(t, "qc_reject", code, code);
                return (
                  <PressableScale
                    key={code}
                    accessibilityRole="radio"
                    accessibilityLabel={label}
                    accessibilityState={{ checked: selected, selected }}
                    onPress={() => setForm((f) => ({ ...f, reasonCode: code }))}
                    className={cn("min-h-11 justify-center rounded-full border px-4", selected ? "border-transparent bg-primary" : "border-control bg-surface")}
                  >
                    <Text className={cn("text-[15px]", selected ? "font-sans-semibold text-primary-foreground" : "font-sans text-ink")}>{label}</Text>
                  </PressableScale>
                );
              })}
            </View>
            {errors.reason ? <Text className="font-sans text-sm text-destructive">{t("pack.reject.reasonRequired")}</Text> : null}
          </View>
          {form.reasonCode === "other" ? (
            <Field label={t("common.note")} value={form.note} onChangeText={(note) => setForm((f) => ({ ...f, note }))} multiline maxLength={500} error={errors.note ? t("common.noteRequired") : null} />
          ) : null}
          <Button label={t("pack.reject.addLine")} onPress={add} />
        </View>
      ) : null}
    </View>
  );
}

import { formatKgTotal, gToKg } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Field, NumberInput } from "@orrn/ui/components/field";
import { TextArea } from "@orrn/ui/components/input";
import { NativeSelect } from "@orrn/ui/components/native-select";
import { cn } from "@orrn/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, X } from "lucide-react";
import { useId, useState } from "react";

import { reasonCodeText, reasonOptions } from "@/features/press/reason-label";
import { trpc } from "@/shared/utils/trpc";

import { EMPTY_REJECT, readReject, type RejectErrors, type RejectForm } from "./reject-form";
import type { DraftReject } from "./use-pack-draft";

/**
 * Rejects at pack (FP-PK-14): pieces taken out of the pile that are not a bundle. Weighed rejects
 * post their kg at plant scrap; pieces with no weight only leave the count. Saved with the session.
 */
export function RejectsPanel({
  rejects,
  onAdd,
  onRemove,
}: {
  rejects: readonly DraftReject[];
  onAdd(r: DraftReject): void;
  onRemove(index: number): void;
}) {
  const { t, locale } = useT();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<RejectForm>(EMPTY_REJECT);
  const [errors, setErrors] = useState<RejectErrors>({});
  // W4-MASTERS I-3: the plant's active qc_reject codes (Masters, Reason codes), never a fixed list.
  const reasons = useQuery({ ...trpc.press.reasons.queryOptions({ kind: "qc_reject" }), staleTime: 5 * 60_000 });
  const options = reasonOptions(t, "qc_reject", reasons.data, locale);
  const picked = options.find((o) => o.value === form.reasonCode);
  const needsNote = form.reasonCode === "other" || Boolean(picked?.requiresNote);
  const total = rejects.reduce((s, r) => s + r.pcs, 0);

  const add = () => {
    const r = readReject(form, needsNote);
    if (!r.ok) {
      setErrors(r.errors);
      return;
    }
    onAdd(r.reject);
    setForm(EMPTY_REJECT);
    setErrors({});
  };

  return (
    <section aria-labelledby={`${id}-h`} data-slot="rejects" className="flex flex-col gap-3 rounded-card border border-border bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={`${id}-h`} className="m-0 text-[15px] font-semibold">
          {t("pack.reject.title")}
          <span className="ml-3 font-mono font-normal text-muted-foreground tabular-nums" data-testid="reject-total">
            {t("pack.reject.saved", { count: total })}
          </span>
        </h3>
        <Button
          variant="secondary"
          aria-expanded={open}
          aria-controls={`${id}-form`}
          onClick={() => setOpen((o) => !o)}
        >
          <ChevronDown aria-hidden="true" strokeWidth={2} className={cn("transition-transform duration-[var(--dur-fast)]", open && "rotate-180")} />
          {t("pack.reject.add")}
        </Button>
      </div>

      {rejects.length > 0 ? (
        <ul className="m-0 flex list-none flex-col divide-y divide-border p-0" aria-label={t("pack.reject.title")}>
          {rejects.map((r, i) => (
            <li key={`${i}-${r.pcs}-${r.reasonCode}`} data-slot="reject-row" className="flex min-w-0 items-center gap-3 py-2">
              <span className="min-w-0 flex-1 text-[14px] leading-5">
                <span className="font-mono font-semibold tabular-nums">{t("pack.reject.saved", { count: r.pcs })}</span>
                <span className="text-muted-foreground">
                  {" · "}
                  {reasonCodeText(t, "qc_reject", r.reasonCode, reasons.data, locale)}
                  {r.weightG ? ` · ${formatKgTotal(gToKg(r.weightG))} ${t("units.kg")}` : ` · ${t("pack.reject.noWeight")}`}
                  {r.note ? ` · ${r.note}` : ""}
                </span>
              </span>
              <Button variant="ghost" size="sm" onClick={() => onRemove(i)} aria-label={t("pack.reject.remove", { n: i + 1 })}>
                <X aria-hidden="true" strokeWidth={2} />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}

      {open ? (
      <div id={`${id}-form`} className="flex flex-col gap-3 rounded-input bg-surface-sunken p-3 sm:p-4">
        <p className="m-0 text-[13px] leading-5 text-muted-foreground">{t("pack.reject.hint")}</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={t("pack.reject.piecesLabel")} error={errors.pcs ? t("pack.new.piecesRequired") : undefined}>
            <NumberInput value={form.pcs} onValueChange={(pcs) => setForm((f) => ({ ...f, pcs }))} suffix={t("units.pcs")} />
          </Field>
          <Field label={t("pack.reject.kg")} hint={t("pack.reject.kgHint")} error={errors.kg ? t("pack.new.weightRequired") : undefined}>
            <NumberInput value={form.kg} onValueChange={(kg) => setForm((f) => ({ ...f, kg }))} suffix={t("units.kg")} />
          </Field>
          <Field label={t("pack.reject.reason")} id="reject-reason" error={errors.reason ? t("pack.reject.reasonRequired") : undefined}>
            <NativeSelect
              id="reject-reason"
              value={form.reasonCode}
              onChange={(e) => {
                const reasonCode = e.currentTarget.value;
                setForm((f) => ({ ...f, reasonCode }));
              }}
            >
              <option value="">{t("pack.reject.pickReason")}</option>
              {options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </NativeSelect>
          </Field>
        </div>
        {needsNote ? (
          <Field label={t("common.note")} id="reject-note" error={errors.note ? t(form.reasonCode === "other" ? "common.noteRequired" : "common.noteRequiredReason") : undefined}>
            <TextArea id="reject-note" rows={2} value={form.note} onChangeText={(note) => setForm((f) => ({ ...f, note }))} maxLength={500} />
          </Field>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button onClick={add}>{t("pack.reject.addLine")}</Button>
        </div>
      </div>
      ) : null}
    </section>
  );
}

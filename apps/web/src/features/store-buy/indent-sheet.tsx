import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Field, TextInput } from "@orrn/ui/components/field";
import { TextArea } from "@orrn/ui/components/input";
import { NativeSelect } from "@orrn/ui/components/native-select";
import { Sheet } from "@orrn/ui/components/sheet";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Plus, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { qtyProblemText, unitShort } from "@/features/store/store-labels";
import type { StoreUnit } from "@/features/store/store-qty";
import { useFmt } from "@/shared/lib/fmt";
import { trpc } from "@/shared/utils/trpc";

import { buyErrorText } from "./buy-errors";
import { blankLine, checkIndent, MAX_INDENT_LINES, type IndentChecked, type IndentDraftLine } from "./indent-model";
import { StoreQtyBox } from "./qty-box";
import { useInvalidateBuy } from "./use-buy";

/**
 * Raise an indent (indent.raise): department, a needed-by day, a reason, and one or more items with
 * quantities in each item's own unit. Problems show once the person has tried to send.
 */
export function IndentSheet({ open, onOpenChange, onRaised }: { open: boolean; onOpenChange(open: boolean): void; onRaised?(id: string): void }) {
  const { t } = useT();
  const fmt = useFmt();
  const invalidate = useInvalidateBuy();
  const uid = useId().replace(/:/g, "");
  const formId = `indent-form-${uid}`;
  const keyRef = useRef(0);
  const nextKey = () => `l${++keyRef.current}`;

  const items = useQuery({ ...trpc.store.items.list.queryOptions(), enabled: open });
  const active = useMemo(() => (items.data?.items ?? []).filter((i) => i.active), [items.data]);
  const unitOf = (id: string) => (active.find((i) => i.id === id)?.unit ?? null) as StoreUnit | null;

  const [department, setDepartment] = useState("");
  const [neededBy, setNeededBy] = useState("");
  const [reason, setReason] = useState("");
  const [lines, setLines] = useState<IndentDraftLine[]>([]);
  const [attempted, setAttempted] = useState(false);
  const create = useMutation(trpc.store.indents.create.mutationOptions());

  useEffect(() => {
    if (!open) return;
    setDepartment("");
    setNeededBy("");
    setReason("");
    setLines([blankLine(nextKey())]);
    setAttempted(false);
    create.reset();
    // Only on open; the mutation is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const checked: IndentChecked = checkIndent({ department, neededBy, reason, lines }, unitOf);
  const problems = !checked.ok && attempted ? checked : null;
  const setLine = (key: string, patch: Partial<IndentDraftLine>) =>
    setLines((all) => all.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (create.isPending) return;
    setAttempted(true);
    if (!checked.ok) return;
    try {
      const res = await create.mutateAsync(checked.input);
      toast.success(t("store2.indent.form.raised", { number: res.number }));
      await invalidate();
      onOpenChange(false);
      onRaised?.(res.id);
    } catch {
      // Shown inline below.
    }
  };

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t("store2.indent.form.title")}
      dismissible={!create.isPending}
      footer={
        <>
          <Button variant="secondary" size="lg" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" form={formId} size="lg" loading={create.isPending}>
            {t("store2.indent.form.submit")}
          </Button>
        </>
      }
    >
      <form id={formId} noValidate onSubmit={(e) => void submit(e)} className="flex flex-col gap-5 pt-1">
        <Field
          label={t("store2.indent.form.department")}
          hint={t("store2.indent.form.departmentHint")}
          error={problems?.department ? t("store2.indent.form.departmentRequired") : undefined}
          required
        >
          <TextInput value={department} maxLength={100} autoComplete="off" onChangeText={setDepartment} />
        </Field>
        <Field
          label={t("store2.indent.form.neededBy")}
          hint={t("store2.indent.form.neededByHint")}
          error={problems?.neededBy ? t("store2.indent.form.neededByInvalid") : undefined}
        >
          <TextInput type="date" value={neededBy} onChangeText={setNeededBy} />
        </Field>
        <Field label={t("store2.indent.form.reason")} hint={t("store2.indent.form.reasonHint")}>
          <TextArea value={reason} maxLength={500} rows={2} onChangeText={setReason} />
        </Field>

        <fieldset className="m-0 flex min-w-0 flex-col gap-4 border-0 p-0">
          <legend className="mb-1 p-0 text-[14px] font-medium text-foreground">{t("store2.indent.form.items")}</legend>
          {items.data && active.length === 0 ? (
            <p className="m-0 text-[14px] text-muted-foreground">{t("store2.indent.form.noActiveItems")}</p>
          ) : null}
          {lines.map((l, index) => {
            const problem = problems?.lines[l.key];
            const unit = l.itemId ? unitOf(l.itemId) : null;
            const selectId = `indent-item-${uid}-${l.key}`;
            const itemError =
              problem === "item" ? t("store2.indent.form.itemRequired") : problem === "twice" ? t("store2.indent.form.twice") : undefined;
            const qtyError = problem && problem !== "item" && problem !== "twice" ? qtyProblemText(t, problem) : undefined;
            return (
              <div key={l.key} className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-2 gap-y-3 rounded-card border border-border p-3">
                <Field label={t("store2.indent.form.item", { n: String(index + 1) })} id={selectId} error={itemError}>
                  <NativeSelect
                    id={selectId}
                    value={l.itemId ?? ""}
                    onChange={(e) => setLine(l.key, { itemId: e.currentTarget.value || null })}
                  >
                    <option value="">{t("store2.indent.form.itemPlaceholder")}</option>
                    {active.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.name}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
                <Button
                  variant="ghost"
                  size="icon"
                  className="mt-7"
                  aria-label={t("store2.indent.form.removeItem", { n: String(index + 1) })}
                  disabled={lines.length === 1}
                  onClick={() => setLines((all) => all.filter((x) => x.key !== l.key))}
                >
                  <X aria-hidden="true" strokeWidth={2} />
                </Button>
                <div className="col-span-2">
                  <Field label={t("store2.indent.form.qty")} error={qtyError}>
                    <StoreQtyBox
                      unit={unit}
                      value={l.qty}
                      onValueChange={(qty) => setLine(l.key, { qty })}
                      suffix={l.itemId && unit ? unitShort(t, unit, 2000, fmt) : undefined}
                    />
                  </Field>
                </div>
              </div>
            );
          })}
          {problems?.noLines ? <p className="m-0 text-[14px] text-tone-red-ink">{t("store2.indent.form.noItems")}</p> : null}
          <div>
            <Button
              variant="secondary"
              disabled={lines.length >= MAX_INDENT_LINES}
              onClick={() => setLines((all) => [...all, blankLine(nextKey())])}
            >
              <Plus aria-hidden="true" strokeWidth={2} />
              {t("store2.indent.form.addItem")}
            </Button>
            {lines.length >= MAX_INDENT_LINES ? (
              <p className="mt-2 mb-0 text-[14px] text-muted-foreground">{t("store2.indent.form.tooMany")}</p>
            ) : null}
          </div>
        </fieldset>

        {create.error ? (
          <p role="alert" className="m-0 rounded-card bg-tone-red-tint px-4 py-3 text-[14px] font-medium text-tone-red-ink break-words">
            {buyErrorText(t, create.error)}
          </p>
        ) : null}
      </form>
    </Sheet>
  );
}

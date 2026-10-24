import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Field, TextInput } from "@orrn/ui/components/field";
import { NativeSelect } from "@orrn/ui/components/native-select";
import { Sheet } from "@orrn/ui/components/sheet";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Can } from "@/shared/components/can";
import { trpc } from "@/shared/utils/trpc";

import { storeErrorText } from "./store-errors";
import { categoryLabel, unitName, unitShort } from "./store-labels";
import { formatQty, STORE_CATEGORIES, STORE_UNITS, type StoreCategory, type StoreUnit } from "./store-qty";
import { ITEM_EDITORS, useInvalidateStore } from "./use-store";

export type EditableItem = { id: string; name: string; unit: string; category: string; active: boolean };

/** The server refuses a name with no letter or digit (it keys names on them); say so before sending. */
const HAS_LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;

/**
 * Add or edit a store item (store.txn or masters.publish, ruling RP19): name, unit, category. In
 * edit mode the item can be retired (only at a balance of 0: the button says why it is off while
 * stock is left; the server checks too) or brought back. The unit is locked by the server after
 * the first entry; the hint says so up front.
 */
export function StoreItemSheet({
  open,
  onOpenChange,
  item,
  balanceMilli = 0,
  onCreated,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  /** Edit this item; omit to add a new one. */
  item?: EditableItem;
  /** What is in the store for `item` now: Retire needs 0. */
  balanceMilli?: number;
  onCreated?(id: string): void;
}) {
  const { t } = useT();
  const invalidate = useInvalidateStore();
  const uid = useId().replace(/:/g, "");
  const formId = `store-item-form-${uid}`;
  const retireNoteId = `store-item-retire-${uid}`;
  const unitId = `store-item-unit-${uid}`;
  const categoryId = `store-item-category-${uid}`;
  const nameRef = useRef<HTMLInputElement | null>(null);

  const [name, setName] = useState("");
  const [unit, setUnit] = useState<StoreUnit>("kg");
  const [category, setCategory] = useState<StoreCategory>("chemical");
  const [nameError, setNameError] = useState<string | undefined>();

  const create = useMutation(trpc.store.items.create.mutationOptions());
  const update = useMutation(trpc.store.items.update.mutationOptions());
  const busy = create.isPending || update.isPending;
  const error = create.error ?? update.error;

  // Fill the fields each time the sheet opens.
  useEffect(() => {
    if (!open) return;
    setName(item?.name ?? "");
    setUnit((item?.unit as StoreUnit) ?? "kg");
    setCategory((item?.category as StoreCategory) ?? "chemical");
    setNameError(undefined);
    create.reset();
    update.reset();
    // Only on open; the mutations are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, item?.id]);

  const close = () => onOpenChange(false);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const trimmed = name.trim();
    if (!trimmed || !HAS_LETTER_OR_DIGIT.test(trimmed)) {
      setNameError(trimmed ? t("store.errors.nameInvalid") : t("store.itemForm.nameRequired"));
      nameRef.current?.focus();
      return;
    }
    try {
      if (item) {
        await update.mutateAsync({
          id: item.id,
          ...(trimmed !== item.name ? { name: trimmed } : {}),
          ...(unit !== item.unit ? { unit } : {}),
          ...(category !== item.category ? { category } : {}),
        });
        toast.success(t("store.itemForm.saved", { name: trimmed }));
      } else {
        const res = await create.mutateAsync({ name: trimmed, unit, category });
        toast.success(t("store.itemForm.added", { name: trimmed }));
        onCreated?.(res.id);
      }
      await invalidate();
      close();
    } catch {
      // Shown inline (error).
    }
  };

  const setActive = async (active: boolean) => {
    if (!item || busy) return;
    try {
      await update.mutateAsync({ id: item.id, active });
      toast.success(t(active ? "store.itemForm.restored" : "store.itemForm.retired", { name: item.name }));
      await invalidate();
      close();
    } catch {
      // Shown inline (error).
    }
  };

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={item ? t("store.itemForm.editTitle") : t("store.itemForm.addTitle")}
      footer={
        <>
          <Button variant="secondary" size="lg" onClick={close}>
            {t("common.cancel")}
          </Button>
          <Can do={ITEM_EDITORS}>
            <Button type="submit" form={formId} size="lg" loading={busy}>
              {t("store.itemForm.save")}
            </Button>
          </Can>
        </>
      }
    >
      <form id={formId} noValidate onSubmit={(e) => void save(e)} className="flex flex-col gap-5 pt-1">
        <Field label={t("store.itemForm.name")} hint={t("store.itemForm.nameHint")} error={nameError}>
          <TextInput
            ref={nameRef}
            value={name}
            maxLength={100}
            autoComplete="off"
            aria-required="true"
            onChangeText={(v) => {
              setName(v);
              if (nameError && v.trim()) setNameError(undefined);
            }}
          />
        </Field>
        <Field label={t("store.itemForm.unit")} hint={t("store.itemForm.unitHint")} id={unitId}>
          <NativeSelect
            id={unitId}
            aria-describedby={`${unitId}-hint`}
            value={unit}
            onChange={(e) => setUnit(e.currentTarget.value as StoreUnit)}
          >
            {STORE_UNITS.map((u) => (
              <option key={u} value={u}>
                {unitName(t, u)}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label={t("store.itemForm.category")} id={categoryId}>
          <NativeSelect
            id={categoryId}
            value={category}
            onChange={(e) => setCategory(e.currentTarget.value as StoreCategory)}
          >
            {STORE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {categoryLabel(t, c)}
              </option>
            ))}
          </NativeSelect>
        </Field>

        {error ? (
          <p
            role="alert"
            className="m-0 rounded-card bg-tone-red-tint px-4 py-3 text-[14px] font-medium text-tone-red-ink break-words"
          >
            {storeErrorText(t, error)}
          </p>
        ) : null}

        {item ? (
          <Can do={ITEM_EDITORS}>
            <div className="flex flex-col items-start gap-2 border-t border-border pt-4">
              <p id={retireNoteId} className="m-0 text-[14px] leading-6 text-muted-foreground">
                {item.active && balanceMilli > 0
                  ? t("store.itemForm.retireBlocked", {
                      qty: formatQty(balanceMilli),
                      unit: unitShort(t, item.unit, balanceMilli),
                    })
                  : t("store.itemForm.retireHint")}
              </p>
              <Button
                variant={item.active ? "ghost" : "secondary"}
                onClick={() => void setActive(!item.active)}
                aria-describedby={retireNoteId}
                disabled={busy || (item.active && balanceMilli > 0)}
              >
                {item.active ? t("store.itemForm.retire") : t("store.itemForm.restore")}
              </Button>
            </div>
          </Can>
        ) : null}
      </form>
    </Sheet>
  );
}

import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Field } from "@orrn/ui/components/field";
import { Sheet } from "@orrn/ui/components/sheet";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useId, useState, type FormEvent } from "react";

import { qtyProblemText, qtyText, unitShort } from "@/features/store/store-labels";
import { qtyToText, type StoreUnit } from "@/features/store/store-qty";
import { StoreSection } from "@/features/store/store-ui";
import { ITEM_EDITORS, useInvalidateStore } from "@/features/store/use-store";
import { Can } from "@/shared/components/can";
import { useFmt } from "@/shared/lib/fmt";
import { trpc } from "@/shared/utils/trpc";

import { buyErrorText } from "./buy-errors";
import { levelsInput, type LevelsDraft } from "./levels-model";
import { StoreQtyBox } from "./qty-box";

export type LevelsItem = { id: string; name: string; unit: string; active: boolean; minMilli: number | null; reorderMilli: number | null };

/**
 * Reorder levels on a store item's page (XE store row 72): the minimum and the reorder quantity. Below
 * the minimum, Today shows the item to the storekeeper with "Make indent". Item editors change them.
 */
export function ReorderLevels({ item }: { item: LevelsItem }) {
  const { t } = useT();
  const fmt = useFmt();
  const [open, setOpen] = useState(false);
  const show = (milli: number | null) => (milli === null || milli === 0 ? t("store2.item.none") : qtyText(t, milli, item.unit, fmt));
  return (
    <StoreSection
      id="store-item-levels"
      title={t("store2.item.levels")}
      actions={
        item.active ? (
          <Can do={ITEM_EDITORS}>
            <Button variant="secondary" aria-haspopup="dialog" onClick={() => setOpen(true)}>
              {t("store.itemPage.edit")}
            </Button>
          </Can>
        ) : null
      }
    >
      <p className="m-0 text-[15px] break-words" data-testid="store-item-levels">
        {t("store2.item.showLevels", { min: show(item.minMilli), reorder: show(item.reorderMilli) })}
      </p>
      <LevelsSheet open={open} onOpenChange={setOpen} item={item} />
    </StoreSection>
  );
}

function LevelsSheet({ open, onOpenChange, item }: { open: boolean; onOpenChange(open: boolean): void; item: LevelsItem }) {
  const { t } = useT();
  const fmt = useFmt();
  const invalidate = useInvalidateStore();
  const formId = `store-levels-${useId().replace(/:/g, "")}`;
  const unit = item.unit as StoreUnit;
  const [draft, setDraft] = useState<LevelsDraft>({ min: "", reorder: "" });
  const [shown, setShown] = useState(false);
  const save = useMutation(trpc.store.items.update.mutationOptions());

  useEffect(() => {
    if (!open) return;
    setDraft({
      min: item.minMilli ? qtyToText(item.minMilli) : "",
      reorder: item.reorderMilli ? qtyToText(item.reorderMilli) : "",
    });
    setShown(false);
    save.reset();
    // Only on open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, item.id]);

  const parsed = levelsInput(draft, unit);
  const suffix = unitShort(t, item.unit, 2000, fmt);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setShown(true);
    if (!parsed.ok) return;
    await save.mutateAsync({ id: item.id, minMilli: parsed.minMilli, reorderMilli: parsed.reorderMilli });
    await invalidate();
    onOpenChange(false);
  }

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t("store2.item.levels")}
      description={item.name}
      footer={
        <>
          <Button variant="secondary" size="lg" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" form={formId} size="lg" loading={save.isPending}>
            {t("common.save")}
          </Button>
        </>
      }
    >
      <form id={formId} noValidate onSubmit={(e) => void submit(e).catch(() => undefined)} className="flex flex-col gap-5 pt-1">
        <Field
          label={t("store2.item.min")}
          hint={t("store2.item.minHint")}
          error={shown && !parsed.ok && parsed.min ? qtyProblemText(t, parsed.min) : undefined}
        >
          <StoreQtyBox unit={unit} suffix={suffix} value={draft.min} onValueChange={(v) => setDraft((d) => ({ ...d, min: v }))} />
        </Field>
        <Field
          label={t("store2.item.reorder")}
          hint={t("store2.item.reorderHint")}
          error={shown && !parsed.ok && parsed.reorder ? qtyProblemText(t, parsed.reorder) : undefined}
        >
          <StoreQtyBox unit={unit} suffix={suffix} value={draft.reorder} onValueChange={(v) => setDraft((d) => ({ ...d, reorder: v }))} />
        </Field>
        {save.error ? (
          <p role="alert" className="m-0 rounded-card bg-tone-red-tint px-4 py-3 text-[14px] font-medium text-tone-red-ink break-words">
            {buyErrorText(t, save.error)}
          </p>
        ) : null}
      </form>
    </Sheet>
  );
}

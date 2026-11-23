import { useT } from "@orrn/i18n";
import { Field, TextInput } from "@orrn/ui/components/field";
import { NativeSelect } from "@orrn/ui/components/native-select";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useId } from "react";

import { qtyProblemText, qtyText, unitShort } from "@/features/store/store-labels";
import { formatQty, type StoreUnit } from "@/features/store/store-qty";
import { can, useMe } from "@/shared/lib/me";
import { useFmt } from "@/shared/lib/fmt";
import { trpc } from "@/shared/utils/trpc";

import type { GrnBuyDraft, GrnBuyInput } from "./grn-model";
import { paiseToText, rupees } from "./money";
import { StoreQtyBox } from "./qty-box";

/**
 * The buying part of the GRN form (XE store row 71): which purchase order line the delivery is for (the
 * rate comes from it), the rate when there is no order, and what was rejected at inspection. A GRN with
 * no order works as before: every field here may stay empty.
 */
export function GrnBuyFields({
  itemId,
  unit,
  draft,
  onChange,
  parsed,
  showErrors,
}: {
  itemId: string | null;
  unit: StoreUnit | null;
  draft: GrnBuyDraft;
  onChange(next: GrnBuyDraft): void;
  parsed: GrnBuyInput;
  showErrors: boolean;
}) {
  const { t } = useT();
  const fmt = useFmt();
  const { data: me } = useMe();
  const poId = `grn-po-${useId().replace(/:/g, "")}`;
  const lines = useQuery({
    ...trpc.store.po.openLines.queryOptions({ itemId: itemId ?? undefined }),
    enabled: itemId !== null && can(me, "store.txn"),
  });
  const open = lines.data?.items ?? [];
  const picked = open.find((l) => l.lineId === draft.poLineId) ?? null;

  // A line from another item (or one that closed meanwhile) no longer applies.
  useEffect(() => {
    if (draft.poLineId && lines.data && !picked) onChange({ ...draft, poLineId: null, rate: "" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines.data, draft.poLineId, picked]);

  // The rate is always per kilogram (or per piece, litre...) on the server, whatever unit the plant shows weights in.
  const rateUnit = unit ? unitShort(t, unit, 1000) : "";
  const qtyUnit = unit ? unitShort(t, unit, 2000, fmt) : "";

  return (
    <>
      {open.length > 0 ? (
        <Field
          label={t("store2.grn.poLine")}
          hint={picked ? t("store2.grn.left", { qty: qtyText(t, picked.roomMilli, picked.unit, fmt) }) : t("store2.grn.poLineHint")}
          id={poId}
        >
          <NativeSelect
            id={poId}
            value={draft.poLineId ?? ""}
            onChange={(e) => {
              const lineId = e.currentTarget.value || null;
              const line = open.find((l) => l.lineId === lineId);
              // "No purchase order" drops the rate the order filled in; a rate typed by hand stays.
              const keptRate = picked && draft.rate.trim() === paiseToText(picked.ratePaise) ? "" : draft.rate;
              onChange({ ...draft, poLineId: lineId, rate: line ? paiseToText(line.ratePaise) : keptRate });
            }}
          >
            <option value="">{t("store2.grn.noPo")}</option>
            {open.map((l) => (
              <option key={l.lineId} value={l.lineId}>
                {t("store2.grn.poLineOption", {
                  po: l.poNumber,
                  line: String(l.line),
                  vendor: l.vendorName,
                  left: formatQty(l.roomMilli, l.unit, fmt),
                  unit: unitShort(t, l.unit, l.roomMilli, fmt),
                })}
              </option>
            ))}
          </NativeSelect>
        </Field>
      ) : null}

      <Field
        label={unit ? t("store2.grn.rate", { unit: rateUnit }) : t("store2.po.form.rateNoUnit")}
        hint={picked ? t("store2.grn.rateFromPo", { rate: rupees(picked.ratePaise) }) : t("store2.grn.rateHint")}
        error={showErrors && !parsed.ok && parsed.rate ? t("store2.grn.rateInvalid") : undefined}
      >
        <TextInput
          value={draft.rate}
          onChangeText={(v) => onChange({ ...draft, rate: v })}
          inputMode="decimal"
          autoComplete="off"
          maxLength={14}
        />
      </Field>

      <Field
        label={t("store2.grn.rejected")}
        hint={t("store2.grn.rejectedHint")}
        error={showErrors && !parsed.ok && parsed.rejected ? qtyProblemText(t, parsed.rejected) : undefined}
      >
        <StoreQtyBox
          unit={unit}
          suffix={qtyUnit}
          value={draft.rejected}
          onValueChange={(v) => onChange({ ...draft, rejected: v })}
        />
      </Field>
    </>
  );
}

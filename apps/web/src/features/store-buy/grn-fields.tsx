import { useT } from "@orrn/i18n";
import { Field, TextInput } from "@orrn/ui/components/field";
import { NativeSelect } from "@orrn/ui/components/native-select";
import { Button } from "@orrn/ui/components/button";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useId } from "react";

import { qtyProblemText, qtyText, unitShort } from "@/features/store/store-labels";
import { formatQty, type StoreUnit } from "@/features/store/store-qty";
import { can, useMe } from "@/shared/lib/me";
import { useFmt } from "@/shared/lib/fmt";
import { useModuleOn } from "@/shared/lib/modules";
import { trpc } from "@/shared/utils/trpc";

import { poLineGone, type GrnBuyDraft, type GrnBuyInput } from "./grn-model";
import { paiseToText, rupees } from "./money";
import { StoreQtyBox } from "./qty-box";

/**
 * The open purchase order lines for an item (one query, shared by the form and these fields), in pages.
 * `data` is every line loaded so far, with `complete` false while more pages exist; `failed` is a lookup
 * that could not load and has nothing cached.
 */
export function useOpenPoLines(itemId: string | null) {
  const { data: me } = useMe();
  const on = useModuleOn("store_buy");
  const q = useInfiniteQuery({
    ...trpc.store.po.openLines.infiniteQueryOptions(
      { itemId: itemId ?? undefined },
      { getNextPageParam: (last) => last.nextCursor ?? undefined },
    ),
    enabled: on && itemId !== null && can(me, "store.txn"),
    // A failed lookup shows Retry at once: while retries back off, an empty picker would look like "no open order".
    retry: false,
  });
  const data = q.data ? { items: q.data.pages.flatMap((p) => p.items), complete: !q.hasNextPage } : undefined;
  return {
    data,
    failed: q.isError && !q.data,
    retrying: q.isFetching,
    refetch: () => void q.refetch(),
    hasMore: q.hasNextPage,
    loadingMore: q.isFetchingNextPage,
    loadMore: () => void q.fetchNextPage(),
  };
}

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
  const canRate = can(me, "store.rate");
  const poId = `grn-po-${useId().replace(/:/g, "")}`;
  const lines = useOpenPoLines(itemId);
  const open = lines.data?.items ?? [];
  const picked = open.find((l) => l.lineId === draft.poLineId) ?? null;
  const gone = poLineGone(lines.data, draft.poLineId);

  // The rate is always per kilogram (or per piece, litre...) on the server, whatever unit the plant shows weights in.
  const rateUnit = unit ? unitShort(t, unit, 1000) : "";
  const rateLabel = unit ? t("store2.grn.rate", { unit: rateUnit }) : t("store2.po.form.rateNoUnit");
  const qtyUnit = unit ? unitShort(t, unit, 2000, fmt) : "";

  return (
    <>
      {gone ? (
        <div role="alert" className="flex flex-col items-start gap-2 rounded-card bg-tone-red-tint px-4 py-3 text-[14px] font-medium text-tone-red-ink">
          <p className="m-0">{t("store2.grn.lineGone")}</p>
          <Button type="button" variant="secondary" onClick={() => onChange({ ...draft, poLineId: null, rate: "" })}>
            {t("store2.grn.dropPo")}
          </Button>
        </div>
      ) : null}
      {lines.failed ? (
        <div role="alert" className="flex flex-col items-start gap-2 rounded-card bg-tone-red-tint px-4 py-3 text-[14px] font-medium text-tone-red-ink">
          <p className="m-0">{draft.withoutPo ? t("store2.grn.lookupFailedChosen") : t("store2.grn.lookupFailed")}</p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" loading={lines.retrying} onClick={lines.refetch}>
              {t("common.retry")}
            </Button>
            {!draft.withoutPo ? (
              <Button type="button" variant="secondary" onClick={() => onChange({ ...draft, withoutPo: true })}>
                {t("store2.grn.dropPo")}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
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
              const keptRate = gone || (picked && draft.rate.trim() === paiseToText(picked.ratePaise)) ? "" : draft.rate;
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
          {lines.hasMore ? (
            <Button type="button" variant="secondary" size="sm" className="mt-2 self-start" disabled={lines.loadingMore} onClick={lines.loadMore}>
              {t("common.showMore")}
            </Button>
          ) : null}
        </Field>
      ) : null}

      {canRate ? (
        <Field
          label={rateLabel}
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
      ) : picked ? (
        // The order's rate, to read only: the server uses it, and the storekeeper never sends one.
        <Field label={rateLabel} hint={t("store2.grn.rateFromPo", { rate: rupees(picked.ratePaise) })}>
          <TextInput value={paiseToText(picked.ratePaise)} readOnly inputMode="decimal" />
        </Field>
      ) : (
        <p className="m-0 text-[14px] text-muted-foreground">{t("store2.grn.rateByOffice")}</p>
      )}

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

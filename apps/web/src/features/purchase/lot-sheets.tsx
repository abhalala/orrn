/**
 * The short tasks on a lot, each in a sheet (C2: sheets for short tasks,
 * dialogs for confirmations): edit the kanta weights, raise a D/C note, pick
 * the scrap store for OK, and the cancel confirmation. Each one calls one
 * procedure, announces the result in a toast with the button's verb, and
 * refreshes every purchase query (the lot, the list, the KPI row, approvals).
 */
import { parseDecimal } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Dialog } from "@orrn/ui/components/dialog";
import { Field, NumberInput, TextInput } from "@orrn/ui/components/field";
import { SegmentedControl } from "@orrn/ui/components/segmented-control";
import { Select } from "@orrn/ui/components/select";
import { Sheet } from "@orrn/ui/components/sheet";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { trpc } from "@/shared/utils/trpc";

import { kgText } from "./format";
import { kgTextToG, readKanta, MAX_LOT_KG } from "./kanta";
import { DiffText } from "./lot-ui";

/** Grams as the text a NumberInput starts with ("12450.5"). */
const gToText = (g: number | null) => (g === null ? "" : String(g / 1000));

export function useInvalidatePurchase() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: trpc.purchase.pathKey() }),
      queryClient.invalidateQueries({ queryKey: trpc.approval.pathKey() }),
    ]);
}

/* -------------------------------------------------------------------------- */
/* Weights                                                                    */
/* -------------------------------------------------------------------------- */

export function WeightsSheet({
  open,
  onOpenChange,
  lot,
  toleranceBp,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  lot: { id: string; partyKgG: number; fcKgG: number | null };
  toleranceBp: number;
}) {
  const { t } = useT();
  const invalidate = useInvalidatePurchase();
  const [party, setParty] = useState(gToText(lot.partyKgG));
  const [fc, setFc] = useState(gToText(lot.fcKgG));
  const [submitted, setSubmitted] = useState(false);
  useEffect(() => {
    if (!open) return;
    setParty(gToText(lot.partyKgG));
    setFc(gToText(lot.fcKgG));
    setSubmitted(false);
  }, [open, lot.partyKgG, lot.fcKgG]);

  const partyG = kgTextToG(party);
  const fcG = kgTextToG(fc);
  const partyError = partyG === null ? t("purchase.errors.party") : partyG > MAX_LOT_KG * 1000 ? t("purchase.errors.tooHeavy") : undefined;
  const fcError =
    fc.trim() !== "" && fcG === null ? t("purchase.errors.fc") : fcG !== null && fcG > MAX_LOT_KG * 1000 ? t("purchase.errors.tooHeavy") : undefined;

  const save = useMutation(
    trpc.purchase.lots.update.mutationOptions({
      onSuccess: async () => {
        await invalidate();
        toast.success(t("purchase.detail.weightsSaved"));
        onOpenChange(false);
      },
      onError: (e) => toast.error(e.message),
    }),
  );

  const submit = () => {
    setSubmitted(true);
    if (partyError || fcError || partyG === null) return;
    save.mutate({ id: lot.id, partyKgG: partyG, fcKgG: fcG });
  };

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t("purchase.detail.editWeights")}
      footer={
        <>
          <Button size="lg" variant="secondary" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button size="lg" loading={save.isPending} onClick={submit}>
            {t("purchase.detail.saveWeights")}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Field label={t("purchase.new.party")} hint={t("purchase.new.partyHint")} error={submitted ? partyError : undefined}>
          <NumberInput value={party} onValueChange={setParty} suffix="kg" />
        </Field>
        <Field label={t("purchase.new.fc")} hint={t("purchase.new.fcHint")} error={submitted ? fcError : undefined}>
          <NumberInput value={fc} onValueChange={setFc} suffix="kg" />
        </Field>
        <p aria-live="polite" className="m-0 rounded-card bg-surface-sunken px-4 py-3 text-[15px]">
          <DiffText reading={readKanta(party, fc, toleranceBp)} toleranceBp={toleranceBp} />
        </p>
        <button type="submit" hidden />
      </form>
    </Sheet>
  );
}

/* -------------------------------------------------------------------------- */
/* D/C note                                                                   */
/* -------------------------------------------------------------------------- */

type NoteType = "debit" | "credit";
type NoteReason = "weight" | "grade";

export function NoteSheet({
  open,
  onOpenChange,
  lot,
  minNoteG,
  suggestG,
  onSent,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  lot: { id: string; number: string; partyKgG: number; fcKgG: number | null };
  /** What a weight debit note must cover for OK (0 when none is needed). */
  minNoteG: number;
  /** Starting kg for a weight debit note: the whole short. */
  suggestG: number;
  onSent?(): void;
}) {
  const { t } = useT();
  const invalidate = useInvalidatePurchase();
  const [type, setType] = useState<NoteType>("debit");
  const [reason, setReason] = useState<NoteReason>("weight");
  const [kg, setKg] = useState("");
  const [bori, setBori] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [submitted, setSubmitted] = useState(false);
  useEffect(() => {
    if (!open) return;
    setType("debit");
    setReason("weight");
    setKg(suggestG > 0 ? gToText(suggestG) : "");
    setBori("");
    setAmount("");
    setNote("");
    setSubmitted(false);
  }, [open, suggestG]);

  const kgG = kg.trim() === "" ? 0 : kgTextToG(kg);
  const boriG = type === "debit" && bori.trim() !== "" ? kgTextToG(bori) : 0;
  const amountRupees = amount.trim() === "" ? null : parseDecimal(amount);
  const weightDebit = type === "debit" && reason === "weight";

  const errors: { kg?: string; bori?: string; amount?: string } = {};
  if (kgG === null) errors.kg = t("errors.invalidNumber");
  else if (kgG > lot.partyKgG) errors.kg = t("purchase.errors.noteTooBig");
  else if (weightDebit && minNoteG > 0 && kgG < minNoteG) errors.kg = t("purchase.errors.noteTooSmall");
  if (boriG === null || (boriG && lot.fcKgG !== null && boriG >= lot.fcKgG)) errors.bori = t("purchase.errors.bori");
  if (amount.trim() !== "" && amountRupees === null) errors.amount = t("errors.invalidNumber");
  if (!errors.kg && !errors.bori && !errors.amount && (kgG ?? 0) + (boriG ?? 0) === 0 && !(amountRupees && amountRupees > 0)) {
    errors.kg = t("errors.notPositive");
  }

  const send = useMutation(
    trpc.purchase.dcNotes.create.mutationOptions({
      onSuccess: async (res) => {
        await invalidate();
        toast.success(t("purchase.detail.noteSent", { number: res.number }));
        onOpenChange(false);
        onSent?.();
      },
      onError: (e) => toast.error(e.message),
    }),
  );

  const submit = () => {
    setSubmitted(true);
    if (Object.keys(errors).length > 0) return;
    send.mutate({
      lotId: lot.id,
      type,
      reason,
      kgDiffG: kgG ?? 0,
      boriDeductionG: boriG ?? 0,
      ...(amountRupees !== null ? { amountPaise: Math.round(amountRupees * 100) } : {}),
      ...(note.trim() ? { note: note.trim() } : {}),
    });
  };

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t("purchase.detail.noteSheetTitle")}
      description={t("purchase.detail.noteSheetBody")}
      footer={
        <>
          <Button size="lg" variant="secondary" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button size="lg" loading={send.isPending} onClick={submit}>
            {t("purchase.detail.sendNote")}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="flex flex-col gap-2">
          <span className="text-[14px] font-semibold">{t("purchase.detail.type")}</span>
          <SegmentedControl
            label={t("purchase.detail.type")}
            value={type}
            onChange={setType}
            options={[
              { value: "debit", label: t("purchase.detail.noteType.debit") },
              { value: "credit", label: t("purchase.detail.noteType.credit") },
            ]}
          />
        </div>
        <div className="flex flex-col gap-2">
          <span className="text-[14px] font-semibold">{t("purchase.detail.reason")}</span>
          <SegmentedControl
            label={t("purchase.detail.reason")}
            value={reason}
            onChange={setReason}
            options={[
              { value: "weight", label: t("purchase.detail.noteReason.weight") },
              { value: "grade", label: t("purchase.detail.noteReason.grade") },
            ]}
          />
        </div>
        <Field
          label={t("purchase.detail.kgDiff")}
          hint={weightDebit && minNoteG > 0 ? t("purchase.new.noteKgHint", { min: kgText(minNoteG) }) : undefined}
          error={submitted ? errors.kg : undefined}
        >
          <NumberInput value={kg} onValueChange={setKg} suffix="kg" />
        </Field>
        {type === "debit" ? (
          <Field label={t("purchase.new.bori")} hint={t("purchase.new.boriHint")} error={submitted ? errors.bori : undefined}>
            <NumberInput value={bori} onValueChange={setBori} suffix="kg" />
          </Field>
        ) : null}
        <Field label={t("purchase.detail.amountOptional")} hint={t("purchase.detail.amountHint")} error={submitted ? errors.amount : undefined}>
          <NumberInput value={amount} onValueChange={setAmount} suffix="₹" />
        </Field>
        <Field label={t("purchase.new.noteText")}>
          <TextInput value={note} onChangeText={setNote} maxLength={500} />
        </Field>
        <button type="submit" hidden />
      </form>
    </Sheet>
  );
}

/* -------------------------------------------------------------------------- */
/* OK with a choice of scrap store                                            */
/* -------------------------------------------------------------------------- */

export function StoreSheet({
  open,
  onOpenChange,
  stores,
  pending,
  onConfirm,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  stores: { id: string; code: string; name: string }[];
  pending: boolean;
  onConfirm(locationId: string): void;
}) {
  const { t } = useT();
  const [store, setStore] = useState(stores[0]?.id ?? "");
  useEffect(() => {
    if (open) setStore(stores[0]?.id ?? "");
  }, [open, stores]);
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t("purchase.detail.markOk")}
      footer={
        <Button size="lg" loading={pending} disabled={!store} onClick={() => onConfirm(store)}>
          {t("purchase.detail.markOk")}
        </Button>
      }
    >
      <Field label={t("purchase.detail.store")}>
        <Select
          value={store}
          onValueChange={setStore}
          options={stores.map((s) => ({ value: s.id, label: `${s.code}, ${s.name}` }))}
        />
      </Field>
    </Sheet>
  );
}

/* -------------------------------------------------------------------------- */
/* Cancel                                                                     */
/* -------------------------------------------------------------------------- */

export function CancelLotDialog({
  open,
  onOpenChange,
  lotId,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  lotId: string;
}) {
  const { t } = useT();
  const invalidate = useInvalidatePurchase();
  const [reason, setReason] = useState("");
  const [submitted, setSubmitted] = useState(false);
  useEffect(() => {
    if (open) {
      setReason("");
      setSubmitted(false);
    }
  }, [open]);
  const cancel = useMutation(
    trpc.purchase.lots.cancel.mutationOptions({
      onSuccess: async () => {
        await invalidate();
        toast.success(t("purchase.detail.cancelled"));
        onOpenChange(false);
      },
      onError: (e) => toast.error(e.message),
    }),
  );
  const error = reason.trim() === "" ? t("purchase.errors.reason") : undefined;
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("purchase.detail.cancelTitle")}
      description={t("purchase.detail.cancelBody")}
      actions={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t("purchase.detail.keep")}
          </Button>
          <Button
            variant="danger"
            loading={cancel.isPending}
            onClick={() => {
              setSubmitted(true);
              if (!error) cancel.mutate({ id: lotId, reason: reason.trim() });
            }}
          >
            {t("purchase.detail.cancel")}
          </Button>
        </>
      }
    >
      <Field label={t("purchase.detail.cancelReason")} error={submitted ? error : undefined}>
        <TextInput value={reason} onChangeText={setReason} maxLength={500} />
      </Field>
    </Dialog>
  );
}


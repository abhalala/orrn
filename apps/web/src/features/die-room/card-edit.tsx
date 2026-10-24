import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Field, NumberInput, TextInput } from "@orrn/ui/components/field";
import { Sheet } from "@orrn/ui/components/sheet";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { trpc } from "@/shared/utils/trpc";

import { gramsToWholeKg, parseWholeKgToGrams } from "./die-room-model";
import type { CardData } from "./types";
import { useRefreshDieRoom, useRefusal } from "./use-die-room";

const text = (v: string | null | undefined) => v ?? "";
const orNull = (v: string) => (v.trim() === "" ? null : v.trim());
const intOrNull = (v: string): number | null | undefined => {
  if (v.trim() === "") return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 ? n : undefined;
};

/** The die-room fields of a copy's card. Code, tier and band never change here. */
export function EditCardSheet({ open, onOpenChange, card }: { open: boolean; onOpenChange(open: boolean): void; card: CardData }) {
  // Mounted only while open, so a cancelled edit never leaks into the next one.
  return open ? <EditForm open onOpenChange={onOpenChange} card={card} /> : null;
}

function EditForm({ open, onOpenChange, card }: { open: boolean; onOpenChange(open: boolean): void; card: CardData }) {
  const { t } = useT();
  const refresh = useRefreshDieRoom();
  const refusal = useRefusal();
  const { instance } = card;
  const [cavities, setCavities] = useState(text(instance.cavityCount == null ? null : String(instance.cavityCount)));
  const [bolster, setBolster] = useState(text(instance.bolster));
  const [backer, setBacker] = useState(text(instance.backerNo));
  const [sub, setSub] = useState(text(instance.subBolster));
  const [rack, setRack] = useState(text(instance.rackNo));
  const [hardness, setHardness] = useState(text(instance.hardness == null ? null : String(instance.hardness)));
  const [life, setLife] = useState(gramsToWholeKg(instance.lifeG));
  const [makerDie, setMakerDie] = useState(text(instance.makerDieNo));
  const [makerProject, setMakerProject] = useState(text(instance.makerProjectNo));
  const [supplier, setSupplier] = useState(text(instance.supplier));
  const [ftr, setFtr] = useState(text(instance.ftr));
  const [notes, setNotes] = useState(text(instance.notes));
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    ...trpc.dieInstance.update.mutationOptions(),
    onSuccess: async () => {
      await refresh();
      toast.success(t("dieRoom.card.saved"));
      onOpenChange(false);
    },
    onError: (e) => setError(refusal(e)),
  });

  const submit = () => {
    const cav = intOrNull(cavities);
    const hv = intOrNull(hardness);
    const lifeG = life.trim() === "" ? null : parseWholeKgToGrams(life);
    // An empty life clears it; text that is not a whole number of kg is a mistake, never a clear.
    const lifeBad = life.trim() !== "" && lifeG === null;
    if (cav === undefined || hv === undefined || lifeBad) {
      setError(t("dieRoom.card.fieldsInvalid"));
      return;
    }
    setError(null);
    save.mutate({
      id: instance.id,
      cavityCount: cav,
      bolster: orNull(bolster),
      backerNo: orNull(backer),
      subBolster: orNull(sub),
      rackNo: orNull(rack),
      hardness: hv,
      lifeG,
      makerDieNo: orNull(makerDie),
      makerProjectNo: orNull(makerProject),
      supplier: orNull(supplier),
      ftr: orNull(ftr),
      notes: orNull(notes),
    });
  };

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t("dieRoom.card.editTitle", { code: instance.code })}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button onClick={submit} loading={save.isPending}>
            {t("common.save")}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("dieRoom.card.cavities")}>
            <NumberInput value={cavities} onValueChange={setCavities} decimal={false} />
          </Field>
          <Field label={t("dieRoom.card.hardness")}>
            <NumberInput value={hardness} onValueChange={setHardness} decimal={false} />
          </Field>
          <Field label={t("dieRoom.card.bolster")}>
            <TextInput value={bolster} onChangeText={setBolster} maxLength={40} />
          </Field>
          <Field label={t("dieRoom.copies.rack")}>
            <TextInput value={rack} onChangeText={setRack} maxLength={20} />
          </Field>
          <Field label={t("dieRoom.card.backer")}>
            <TextInput value={backer} onChangeText={setBacker} maxLength={40} />
          </Field>
          <Field label={t("dieRoom.card.subBolster")}>
            <TextInput value={sub} onChangeText={setSub} maxLength={40} />
          </Field>
        </div>
        <Field label={t("dieRoom.card.lifeKg")} hint={t("dieRoom.card.lifeHint")}>
          <NumberInput value={life} onValueChange={setLife} decimal={false} suffix={t("units.kg")} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("dieRoom.card.makerDieNo")}>
            <TextInput value={makerDie} onChangeText={setMakerDie} maxLength={60} />
          </Field>
          <Field label={t("dieRoom.card.makerProjectNo")}>
            <TextInput value={makerProject} onChangeText={setMakerProject} maxLength={60} />
          </Field>
        </div>
        <Field label={t("dieRoom.card.supplier")}>
          <TextInput value={supplier} onChangeText={setSupplier} maxLength={200} />
        </Field>
        <Field label={t("dieRoom.card.ftr")}>
          <TextInput value={ftr} onChangeText={setFtr} maxLength={200} />
        </Field>
        <Field label={t("common.notes")}>
          <TextInput value={notes} onChangeText={setNotes} maxLength={500} />
        </Field>
        {error ? (
          <p role="alert" className="m-0 text-[14px] leading-5 font-medium text-destructive">
            {error}
          </p>
        ) : null}
      </form>
    </Sheet>
  );
}

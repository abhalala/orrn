import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Field, NumberInput } from "@orrn/ui/components/field";
import { Sheet } from "@orrn/ui/components/sheet";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { requestIdFor } from "@/features/dispatch/request-key";
import { trpc } from "@/shared/utils/trpc";

import { bandTitle, parseKgToMilli, refusalText } from "./die-room-model";
import { PlantInput } from "@/shared/components/plant-input";
import { followsPlant, keypadStep, MASS_KG, SECTION_KG12 } from "@/shared/lib/plant-input";
import { useFmt } from "@/shared/lib/fmt";
import { sectionText, sectionUnit } from "@/shared/lib/fmt-text";

/** What the keypad may build up: three digits and three places in kg per 12 ft; a little more room in a finer unit (kg per metre, lb per foot). */
const KG12_TEXT = /^\d{0,3}(\.\d{0,3})?$/;
const PLANT_TEXT = /^\d{0,4}(\.\d{0,4})?$/;
const KEYS = ["7", "8", "9", "4", "5", "6", "1", "2", "3", ".", "0", "back"] as const;

/**
 * Keypad for one kg/12ft reading. It shows the copy's band and last reading to read against and
 * nothing computed: the server stores the reading and answers with the percent and tone, which
 * the card shows once it reloads.
 */
export function ReadingPad({
  open,
  onOpenChange,
  dieInstanceId,
  code,
  lastMilli,
  band,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  dieInstanceId: string;
  code: string;
  lastMilli: number | null;
  band: { wallTenthMm: number; weightMinG: number; weightMaxG: number } | null;
}) {
  const fmt = useFmt();
  const { t } = useT();
  const queryClient = useQueryClient();
  // `text` is the draft in kg per 12 ft (what the model reads). `typed` is what the person sees, in the plant's unit; on a plant
  // that already reads kg per 12 ft the two are the same text.
  const [text, setText] = useState("");
  const [typed, setTyped] = useState("");
  const native = followsPlant(fmt, SECTION_KG12);
  const [error, setError] = useState<string | null>(null);
  const parsed = parseKgToMilli(text);
  // BACKLOG 47: one request id per reading. Save tapped twice, or sent again after a lost reply, is
  // the same reading; a different value is a new one. Cleared once a reading has landed.
  const sent = useRef<{ id: string; body: string } | null>(null);

  const add = useMutation({
    ...trpc.dieInstance.addReading.mutationOptions(),
    onSuccess: async (r) => {
      sent.current = null;
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: trpc.dieInstance.pathKey() }),
        queryClient.invalidateQueries({ queryKey: trpc.die.pathKey() }),
      ]);
      toast.success(t("dieRoom.reading.saved", { code, kg: sectionText(fmt, r.kgPer12ftMilli) }));
      setText("");
      setTyped("");
      setError(null);
      onOpenChange(false);
    },
    onError: (e) => setError(refusalText(e, t)),
  });

  const push = (key: string) => {
    setError(null);
    // The keypad edits the text in the plant's unit (2.5 on a kg per metre plant is 2.5 kg/m); the draft follows from it.
    const step = keypadStep(fmt, SECTION_KG12, native ? text : typed, key, native ? KG12_TEXT : PLANT_TEXT);
    if (!step) return;
    if (!native) setTyped(step.typed);
    setText(step.draft);
  };

  const close = () => {
    setText("");
    setTyped("");
    setError(null);
    onOpenChange(false);
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
        else onOpenChange(true);
      }}
      title={t("dieRoom.reading.title", { code })}
      description={
        lastMilli === null
          ? t("dieRoom.reading.noneYet")
          : t("dieRoom.reading.last", { kg: sectionText(fmt, lastMilli) })
      }
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            {t("common.cancel")}
          </Button>
          <Button
            loading={add.isPending}
            disabled={parsed === null}
            onClick={() => {
              if (parsed === null) return;
              sent.current = requestIdFor(sent.current, { dieInstanceId, kgPer12ftMilli: parsed });
              add.mutate({ dieInstanceId, kgPer12ftMilli: parsed, clientRequestId: sent.current.id });
            }}
          >
            {t("dieRoom.reading.add")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label={t("dieRoom.reading.weight")} hint={sectionUnit(fmt)}>
          <PlantInput spec={SECTION_KG12}
            value={text}
            typed={typed}
            onTypedChange={setTyped}
            onValueChange={(v) => {
              setError(null);
              if (!native || KG12_TEXT.test(v)) setText(v);
            }}
            className="font-mono text-[28px]"
            data-testid="reading-value"
          />
        </Field>
        {band ? (
          <p className="m-0 text-[13px] leading-5 text-muted-foreground">
            {t("dieRoom.reading.bandHint", { band: bandTitle(band, t("units.mm"), sectionUnit(fmt), fmt) })}
          </p>
        ) : null}
        <p className="m-0 text-[13px] leading-5 text-muted-foreground">{t("dieRoom.reading.serverFigures")}</p>
        {error ? (
          <p role="alert" className="m-0 text-[14px] leading-5 font-medium text-destructive">
            {error}
          </p>
        ) : null}
        <div className="grid grid-cols-3 gap-2">
          {KEYS.map((key) => (
            <Button
              key={key}
              variant="secondary"
              onClick={() => push(key)}
              aria-label={key === "back" ? t("dieRoom.reading.backspace") : key}
            >
              {key === "back" ? "⌫" : key}
            </Button>
          ))}
        </div>
      </div>
    </Sheet>
  );
}

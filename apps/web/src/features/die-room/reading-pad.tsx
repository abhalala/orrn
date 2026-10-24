import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Field, NumberInput } from "@orrn/ui/components/field";
import { Sheet } from "@orrn/ui/components/sheet";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { trpc } from "@/shared/utils/trpc";

import { bandTitle, milliKgText, parseKgToMilli, refusalText } from "./die-room-model";

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
  const { t } = useT();
  const queryClient = useQueryClient();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const parsed = parseKgToMilli(text);

  const add = useMutation({
    ...trpc.dieInstance.addReading.mutationOptions(),
    onSuccess: async (r) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: trpc.dieInstance.pathKey() }),
        queryClient.invalidateQueries({ queryKey: trpc.die.pathKey() }),
      ]);
      toast.success(t("dieRoom.reading.saved", { code, kg: milliKgText(r.kgPer12ftMilli) }));
      setText("");
      setError(null);
      onOpenChange(false);
    },
    onError: (e) => setError(refusalText(e, { forbidden: t("errors.forbidden"), generic: t("errors.generic") })),
  });

  const push = (key: string) => {
    setError(null);
    setText((prev) => {
      if (key === "back") return prev.slice(0, -1);
      if (key === "." && prev.includes(".")) return prev;
      const next = prev + key;
      return /^\d{0,3}(\.\d{0,3})?$/.test(next) ? next : prev;
    });
  };

  const close = () => {
    setText("");
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
          : t("dieRoom.reading.last", { kg: milliKgText(lastMilli) })
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
              add.mutate({ dieInstanceId, kgPer12ftMilli: parsed });
            }}
          >
            {t("dieRoom.reading.add")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label={t("dieRoom.reading.weight")} hint={t("units.kgPer12ft")}>
          <NumberInput
            value={text}
            onValueChange={(v) => {
              setError(null);
              if (/^\d{0,3}(\.\d{0,3})?$/.test(v)) setText(v);
            }}
            suffix={t("units.kg")}
            className="font-mono text-[28px]"
            data-testid="reading-value"
          />
        </Field>
        {band ? (
          <p className="m-0 text-[13px] leading-5 text-muted-foreground">
            {t("dieRoom.reading.bandHint", { band: bandTitle(band, t("units.mm")) })}
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

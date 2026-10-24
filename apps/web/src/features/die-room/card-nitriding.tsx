import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Card, CardTitle } from "@orrn/ui/components/card";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Field, NumberInput } from "@orrn/ui/components/field";
import { Sheet } from "@orrn/ui/components/sheet";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { Can } from "@/shared/components/can";
import { trpc } from "@/shared/utils/trpc";

import { parseGrams, shortDate } from "./die-room-model";
import type { CardData } from "./types";
import { useRefreshDieRoom, useRefusal } from "./use-die-room";

const CHEMICALS = ["cr4", "cr2", "k2s", "caustic"] as const;
type Chemical = (typeof CHEMICALS)[number];

const grams = (n: number) => n.toLocaleString("en-IN");

/** Nitriding log of the copy, and the two moves: out to nitriding, back to the rack. */
export function NitridingPanel({ card }: { card: CardData }) {
  const { t } = useT();
  const [outOpen, setOutOpen] = useState(false);
  const [backOpen, setBackOpen] = useState(false);
  const status = card.instance.status;

  return (
    <div className="flex flex-col gap-4">
      <Can do="die.card">
        <div className="flex flex-wrap gap-2">
          {status === "available" ? <Button onClick={() => setOutOpen(true)}>{t("dieRoom.nitriding.send")}</Button> : null}
          {status === "at_nitriding" ? <Button onClick={() => setBackOpen(true)}>{t("dieRoom.nitriding.back")}</Button> : null}
        </div>
      </Can>
      {card.nitriding.length === 0 ? (
        <EmptyState title={t("dieRoom.nitriding.empty")} body={t("dieRoom.nitriding.emptyBody")} />
      ) : (
        <ol className="m-0 flex list-none flex-col gap-3 p-0">
          {card.nitriding.map((row) => (
            <li key={row.id}>
              <Card>
                <CardTitle>{shortDate(row.nitridedAt)}</CardTitle>
                <p className="m-0 text-[14px] leading-6">
                  {row.hardness == null ? t("dieRoom.nitriding.noHardness") : t("dieRoom.nitriding.hardness", { hv: row.hardness })}
                </p>
                <ul className="m-0 flex list-none flex-col gap-1 p-0 font-mono text-[14px] tabular-nums">
                  {CHEMICALS.map((c) => {
                    const open = row[`${c}OpenG` as const];
                    const used = row[`${c}UsedG` as const];
                    const close = row[`${c}CloseG` as const];
                    if (open == null || used == null || close == null) return null;
                    return (
                      <li key={c}>
                        {t(`dieRoom.nitriding.chem.${c}`)}: {t("dieRoom.nitriding.balance", { open: grams(open), used: grams(used), close: grams(close) })}
                      </li>
                    );
                  })}
                </ul>
                {row.notes ? <p className="m-0 text-[13px] text-muted-foreground">{row.notes}</p> : null}
              </Card>
            </li>
          ))}
        </ol>
      )}
      <SendSheet open={outOpen} onOpenChange={setOutOpen} card={card} />
      <BackSheet open={backOpen} onOpenChange={setBackOpen} card={card} />
    </div>
  );
}

type Draft = Record<Chemical, { open: string; used: string }>;
const EMPTY: Draft = {
  cr4: { open: "", used: "" },
  cr2: { open: "", used: "" },
  k2s: { open: "", used: "" },
  caustic: { open: "", used: "" },
};

function SendSheet({ open, onOpenChange, card }: { open: boolean; onOpenChange(open: boolean): void; card: CardData }) {
  const { t } = useT();
  const refresh = useRefreshDieRoom();
  const refusal = useRefusal();
  const [hv, setHv] = useState("");
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [error, setError] = useState<string | null>(null);

  const send = useMutation({
    ...trpc.dieInstance.nitridingOut.mutationOptions(),
    onSuccess: async () => {
      await refresh();
      toast.success(t("dieRoom.nitriding.sent", { code: card.instance.code }));
      setDraft(EMPTY);
      setHv("");
      setError(null);
      onOpenChange(false);
    },
    onError: (e) => setError(refusal(e)),
  });

  const submit = () => {
    const input: Record<string, { openG: number; usedG: number; closeG: number }> = {};
    for (const c of CHEMICALS) {
      const { open: o, used: u } = draft[c];
      if (o.trim() === "" && u.trim() === "") continue;
      const openG = parseGrams(o);
      const usedG = parseGrams(u);
      if (openG === null || usedG === null || usedG > openG) {
        setError(t("dieRoom.nitriding.chemInvalid", { name: t(`dieRoom.nitriding.chem.${c}`) }));
        return;
      }
      input[c] = { openG, usedG, closeG: openG - usedG };
    }
    const hardness = hv.trim() === "" ? undefined : Number(hv);
    if (hardness !== undefined && (!Number.isInteger(hardness) || hardness < 1)) {
      setError(t("dieRoom.nitriding.hvInvalid"));
      return;
    }
    setError(null);
    send.mutate({ dieInstanceId: card.instance.id, ...(hardness ? { hardness } : {}), ...input });
  };

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t("dieRoom.nitriding.sendTitle", { code: card.instance.code })}
      description={t("dieRoom.nitriding.sendBody")}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button onClick={submit} loading={send.isPending}>
            {t("dieRoom.nitriding.send")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label={t("dieRoom.nitriding.hvLabel")} hint={t("common.optional")}>
          <NumberInput value={hv} onValueChange={setHv} decimal={false} />
        </Field>
        {CHEMICALS.map((c) => {
          const o = parseGrams(draft[c].open);
          const u = parseGrams(draft[c].used);
          return (
            <fieldset key={c} className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
              <legend className="mb-1 text-[14px] font-semibold">{t(`dieRoom.nitriding.chem.${c}`)}</legend>
              <div className="grid grid-cols-2 gap-3">
                <Field label={t("dieRoom.nitriding.open")}>
                  <NumberInput value={draft[c].open} onValueChange={(v) => setDraft((d) => ({ ...d, [c]: { ...d[c], open: v } }))} decimal={false} suffix={t("units.g")} />
                </Field>
                <Field label={t("dieRoom.nitriding.used")}>
                  <NumberInput value={draft[c].used} onValueChange={(v) => setDraft((d) => ({ ...d, [c]: { ...d[c], used: v } }))} decimal={false} suffix={t("units.g")} />
                </Field>
              </div>
              {o !== null && u !== null && u <= o ? (
                <p className="m-0 font-mono text-[13px] text-muted-foreground tabular-nums">
                  {t("dieRoom.nitriding.closeLine", { open: grams(o), used: grams(u), close: grams(o - u) })}
                </p>
              ) : null}
            </fieldset>
          );
        })}
        {error ? (
          <p role="alert" className="m-0 text-[14px] leading-5 font-medium text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    </Sheet>
  );
}

function BackSheet({ open, onOpenChange, card }: { open: boolean; onOpenChange(open: boolean): void; card: CardData }) {
  const { t } = useT();
  const refresh = useRefreshDieRoom();
  const refusal = useRefusal();
  const [hv, setHv] = useState("");
  const [error, setError] = useState<string | null>(null);

  const back = useMutation({
    ...trpc.dieInstance.nitridingBack.mutationOptions(),
    onSuccess: async () => {
      await refresh();
      toast.success(t("dieRoom.nitriding.returned", { code: card.instance.code }));
      setHv("");
      setError(null);
      onOpenChange(false);
    },
    onError: (e) => setError(refusal(e)),
  });

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t("dieRoom.nitriding.backTitle", { code: card.instance.code })}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button
            loading={back.isPending}
            onClick={() => {
              const hardness = hv.trim() === "" ? undefined : Number(hv);
              if (hardness !== undefined && (!Number.isInteger(hardness) || hardness < 1)) {
                setError(t("dieRoom.nitriding.hvInvalid"));
                return;
              }
              back.mutate({ dieInstanceId: card.instance.id, ...(hardness ? { hardness } : {}) });
            }}
          >
            {t("dieRoom.nitriding.back")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label={t("dieRoom.nitriding.hvAfter")} hint={t("common.optional")}>
          <NumberInput value={hv} onValueChange={setHv} decimal={false} />
        </Field>
        {error ? (
          <p role="alert" className="m-0 text-[14px] leading-5 font-medium text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    </Sheet>
  );
}

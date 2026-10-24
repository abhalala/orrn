import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Card, CardTitle } from "@orrn/ui/components/card";
import { Chip } from "@orrn/ui/components/chip";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Field, NumberInput } from "@orrn/ui/components/field";

import { Select } from "@orrn/ui/components/select";
import { SegmentedControl } from "@orrn/ui/components/segmented-control";
import { Sheet } from "@orrn/ui/components/sheet";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { FieldTextArea } from "@/features/catalog/field-text-area";
import { Can } from "@/shared/components/can";
import { INLINE_ERROR_META } from "@/shared/lib/query-errors";
import { trpc } from "@/shared/utils/trpc";

import { milliKgText, parseKgToMilli, shortDate } from "./die-room-model";
import type { CardData } from "./types";
import { useRefreshDieRoom, useRefusal } from "./use-die-room";

const PURPOSES = ["trial", "correction", "repair"] as const;
type Purpose = (typeof PURPOSES)[number];

/** Maker tab: where the copy is with a die maker, the job, and the send / receive moves. */
export function MakerPanel({ card }: { card: CardData }) {
  const { t } = useT();
  const { instance, openMakerJob } = card;
  const [sendOpen, setSendOpen] = useState(false);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const refresh = useRefreshDieRoom();
  const refusal = useRefusal();

  const jobs = useQuery({
    ...trpc.dieInstance.maker.jobs.list.queryOptions({ dieInstanceId: instance.id }),
    meta: INLINE_ERROR_META,
  });

  const cancel = useMutation({
    ...trpc.dieInstance.maker.jobs.cancel.mutationOptions(),
    onSuccess: async () => {
      await refresh();
      await jobs.refetch();
      toast.success(t("dieRoom.maker.cancelled"));
    },
    onError: (e) => toast.error(refusal(e)),
  });

  const current = jobs.data?.find((j) => j.status === "sent") ?? null;

  return (
    <div className="flex flex-col gap-4">
      {openMakerJob ? (
        <Card data-testid="maker-open-job">
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle>{t("dieRoom.maker.job", { number: openMakerJob.number })}</CardTitle>
            <Chip tone="amber" truncate={false}>
              {t("dieRoom.status.at_maker")}
            </Chip>
          </div>
          <dl className="m-0 grid grid-cols-2 gap-3">
            <div>
              <dt className="text-[12px] font-medium text-muted-foreground">{t("dieRoom.maker.makerName")}</dt>
              <dd className="m-0 text-[14px]">{current?.makerName ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-[12px] font-medium text-muted-foreground">{t("dieRoom.maker.purpose")}</dt>
              <dd className="m-0 text-[14px]">{t(`dieRoom.maker.${openMakerJob.purpose}`)}</dd>
            </div>
            <div>
              <dt className="text-[12px] font-medium text-muted-foreground">{t("dieRoom.maker.sent")}</dt>
              <dd className="m-0 text-[14px]">{shortDate(openMakerJob.sentAt)}</dd>
            </div>
            <div>
              <dt className="text-[12px] font-medium text-muted-foreground">{t("dieRoom.maker.statusLabel")}</dt>
              <dd className="m-0 text-[14px]">{t("dieRoom.maker.statusSent")}</dd>
            </div>
          </dl>
          <Can do="die.maker">
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => setReceiveOpen(true)}>{t("dieRoom.maker.receive")}</Button>
              <Button variant="secondary" loading={cancel.isPending} onClick={() => cancel.mutate({ id: openMakerJob.id })}>
                {t("dieRoom.maker.cancel")}
              </Button>
            </div>
          </Can>
        </Card>
      ) : (
        <EmptyState
          title={t("dieRoom.maker.none")}
          body={instance.status === "available" ? t("dieRoom.maker.noneBody") : t("dieRoom.maker.notOnRack", { status: t(`dieRoom.status.${instance.status}`) })}
          action={
            instance.status === "available" ? (
              <Can do="die.maker">
                <Button onClick={() => setSendOpen(true)}>{t("dieRoom.maker.send")}</Button>
              </Can>
            ) : undefined
          }
        />
      )}

      {jobs.data && jobs.data.some((j) => j.status !== "sent") ? (
        <section className="flex flex-col gap-2">
          <h3 className="m-0 text-[15px] font-semibold">{t("dieRoom.maker.history")}</h3>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {jobs.data
              .filter((j) => j.status !== "sent")
              .map((j) => (
                <li key={j.id} className="flex flex-wrap items-center gap-2 rounded-card border border-border bg-card p-3 text-[14px]">
                  <span className="font-mono font-semibold tabular-nums">{j.number}</span>
                  <span>{j.makerName}</span>
                  <span className="text-muted-foreground">{t(`dieRoom.maker.${j.purpose}`)}</span>
                  <span className="text-[13px] text-muted-foreground">
                    {shortDate(j.sentAt)}
                    {j.receivedAt ? ` → ${shortDate(j.receivedAt)}` : ""}
                  </span>
                  <Chip tone={j.status === "received" ? "green" : "neutral"} truncate={false}>
                    {t(`dieRoom.maker.status.${j.status}`)}
                  </Chip>
                </li>
              ))}
          </ul>
        </section>
      ) : null}

      <SendSheet open={sendOpen} onOpenChange={setSendOpen} card={card} />
      {openMakerJob ? <ReceiveSheet open={receiveOpen} onOpenChange={setReceiveOpen} card={card} jobId={openMakerJob.id} number={openMakerJob.number} /> : null}
    </div>
  );
}

function SendSheet({ open, onOpenChange, card }: { open: boolean; onOpenChange(open: boolean): void; card: CardData }) {
  const { t } = useT();
  const refresh = useRefreshDieRoom();
  const refusal = useRefusal();
  const makers = useQuery({ ...trpc.dieInstance.maker.list.queryOptions(), enabled: open, meta: INLINE_ERROR_META });
  const [makerId, setMakerId] = useState("");
  const [purpose, setPurpose] = useState<Purpose>("correction");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const send = useMutation({
    ...trpc.dieInstance.maker.jobs.send.mutationOptions(),
    onSuccess: async (r) => {
      await refresh();
      toast.success(t("dieRoom.maker.sentToast", { number: r.number, code: card.instance.code }));
      setNote("");
      setError(null);
      onOpenChange(false);
    },
    onError: (e) => setError(refusal(e)),
  });

  const list = makers.data ?? [];
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t("dieRoom.maker.sendTitle", { code: card.instance.code })}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button
            loading={send.isPending}
            disabled={list.length === 0}
            onClick={() => {
              const id = makerId || list[0]?.id;
              if (!id) return setError(t("dieRoom.maker.pickMaker"));
              send.mutate({ dieInstanceId: card.instance.id, dieMakerId: id, purpose, ...(note.trim() ? { note: note.trim() } : {}) });
            }}
          >
            {t("dieRoom.maker.send")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {makers.isSuccess && list.length === 0 ? (
          <p className="m-0 text-[14px] leading-6">
            {t("dieRoom.maker.noMakers")}{" "}
            <Link to="/dies/makers" className="font-semibold text-foreground">
              {t("dieRoom.maker.addMakerLink")}
            </Link>
          </p>
        ) : (
          <Field label={t("dieRoom.maker.makerName")}>
            <Select
              value={makerId || list[0]?.id || ""}
              onValueChange={setMakerId}
              options={list.map((m) => ({ value: m.id, label: m.city ? `${m.name}, ${m.city}` : m.name }))}
              placeholder={t("dieRoom.maker.pickMaker")}
            />
          </Field>
        )}
        <div className="flex min-w-0 flex-col gap-1.5">
          <span className="text-[14px] font-semibold">{t("dieRoom.maker.purpose")}</span>
          <SegmentedControl
            label={t("dieRoom.maker.purpose")}
            value={purpose}
            onChange={setPurpose}
            options={PURPOSES.map((p) => ({ value: p, label: t(`dieRoom.maker.${p}`) }))}
          />
        </div>
        <Field label={t("common.note")} hint={t("common.optional")}>
          <FieldTextArea value={note} onChangeText={setNote} rows={2} maxLength={500} />
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

function ReceiveSheet({
  open,
  onOpenChange,
  card,
  jobId,
  number,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  card: CardData;
  jobId: string;
  number: string;
}) {
  const { t } = useT();
  const refresh = useRefreshDieRoom();
  const refusal = useRefusal();
  const [trial, setTrial] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const hasTrial = card.instance.trialKgPer12ftMilli != null;

  const receive = useMutation({
    ...trpc.dieInstance.maker.jobs.receive.mutationOptions(),
    onSuccess: async () => {
      await refresh();
      toast.success(t("dieRoom.maker.receivedToast", { number, code: card.instance.code }));
      setTrial("");
      setNote("");
      setError(null);
      onOpenChange(false);
    },
    onError: (e) => setError(refusal(e)),
  });

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t("dieRoom.maker.receiveTitle", { number })}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button
            loading={receive.isPending}
            onClick={() => {
              let trialMilli: number | undefined;
              if (!hasTrial && trial.trim() !== "") {
                const parsed = parseKgToMilli(trial);
                if (parsed === null) return setError(t("dieRoom.band.kgInvalid"));
                trialMilli = parsed;
              }
              receive.mutate({ id: jobId, ...(note.trim() ? { note: note.trim() } : {}), ...(trialMilli ? { trialKgPer12ftMilli: trialMilli } : {}) });
            }}
          >
            {t("dieRoom.maker.receive")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {hasTrial ? (
          <p className="m-0 text-[14px] leading-6 text-muted-foreground">
            {t("dieRoom.maker.trialSet", { kg: milliKgText(card.instance.trialKgPer12ftMilli!) })}
          </p>
        ) : (
          <Field label={t("dieRoom.card.trial")} hint={t("dieRoom.maker.trialHint")}>
            <NumberInput value={trial} onValueChange={setTrial} suffix={t("units.kg")} />
          </Field>
        )}
        <Field label={t("common.note")} hint={t("common.optional")}>
          <FieldTextArea value={note} onChangeText={setNote} rows={2} maxLength={500} />
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

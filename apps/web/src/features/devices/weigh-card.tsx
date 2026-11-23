import { isModuleOn } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Card, CardTitle } from "@orrn/ui/components/card";
import { Field } from "@orrn/ui/components/field";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { FieldTextArea } from "@/features/catalog/field-text-area";
import { Can } from "@/shared/components/can";
import { PlantInput } from "@/shared/components/plant-input";
import { useFmt } from "@/shared/lib/fmt";
import { kgGrouped3, massUnit } from "@/shared/lib/fmt-text";
import { MASS_KG } from "@/shared/lib/plant-input";
import { trpc } from "@/shared/utils/trpc";

import { useMe } from "@/shared/lib/me";

import { useDevError, useDevInvalidate, useDevicesFlagOn, WEIGH_PEOPLE, type WeighView } from "./hooks";
import { typedWeightG } from "./model";
import { DevFormSheet, SimBadge } from "./ui";

export type WeighSubject = "purchase_lot" | "dispatch";

/**
 * The bridge's word on one scrap lot or one truck load: the live weigh, the kanta check, and (while the lot or
 * load is still open) a ticket to pick or a typed weight with a reason. Renders nothing, and asks nothing, unless
 * plant devices are on and the person holds a weighing or device action.
 */
export function WeighCard({ subjectType, subjectId, closed }: { subjectType: WeighSubject; subjectId: string; closed: boolean }) {
  const { data: me } = useMe();
  // The subject's own module too: the server refuses a weigh read where the lot or load screen is off.
  const subjectOn = isModuleOn((me?.company?.modules ?? []).map((m) => m.toLowerCase()), subjectType === "purchase_lot" ? "purchase" : "dispatches");
  const on = useDevicesFlagOn(WEIGH_PEOPLE[subjectType]) && subjectOn;
  const q = useQuery({ ...trpc.devices.weigh.forSubject.queryOptions({ subjectType, subjectId }), enabled: on, retry: false });
  if (!on || !q.data) return null;
  return <WeighCardBody data={q.data} subjectType={subjectType} subjectId={subjectId} closed={closed} />;
}

export function WeighCardBody({ data, subjectType, subjectId, closed }: { data: WeighView; subjectType: WeighSubject; subjectId: string; closed: boolean }) {
  const { t } = useT();
  const fmt = useFmt();
  const unit = massUnit(fmt);
  const g = (v: number) => kgGrouped3(fmt, v);
  const [typing, setTyping] = useState(false);
  const invalidate = useDevInvalidate();
  const use = useMutation(
    trpc.devices.weigh.useTicket.mutationOptions({
      onSuccess: async () => {
        toast.success(t("dev3.card.saved"));
        await invalidate();
      },
    }),
  );
  const say = useDevError();
  const action = subjectType === "purchase_lot" ? "purchase.receipt" : "dispatch.complete";
  const live = data.use;
  const ticket = data.ticket;
  const flag = data.kanta && data.kanta.flagged ? data.kanta : null;
  const load = subjectType === "dispatch" ? data.load : null;
  const candidates = [...data.tickets.sameTruck, ...data.tickets.others];
  const diff = (n: number) => g(Math.abs(n));
  return (
    <Card data-testid={`dev3-weigh-card-${subjectType}`} className="min-w-0">
      <CardTitle>{subjectType === "purchase_lot" ? t("dev3.card.lot") : t("dev3.card.truck")}</CardTitle>
      {live ? (
        <p className="m-0 flex flex-wrap items-center gap-2 text-[15px] font-semibold break-words" data-testid="dev3-weigh-live">
          {live.typedG !== null
            ? t("dev3.card.typedLine", { kg: g(live.typedG), massUnit: unit, reason: live.reason ?? "" })
            : ticket && ticket.netG !== null
              ? t("dev3.card.ticketNet", { ticket: ticket.ticketNo ?? "", kg: g(ticket.netG), massUnit: unit })
              : null}
          {ticket?.simulated ? <SimBadge /> : null}
        </p>
      ) : (
        <p className="m-0 text-[15px] text-muted-foreground">{t("dev3.card.none")}</p>
      )}
      {flag ? (
        <p role="status" data-testid="dev3-kanta-flag" className="m-0 rounded-card bg-tone-red-tint px-4 py-3 text-[15px] font-semibold text-tone-red-ink">
          {t("dev3.card.kanta", { diff: diff(flag.diffG), allowed: g(flag.allowedG), massUnit: unit })}
        </p>
      ) : data.kanta && subjectType === "purchase_lot" ? (
        <p data-testid="dev3-kanta-ok" className="m-0 text-[14px] text-muted-foreground">{t("dev3.card.kantaOk", { allowed: g(data.kanta.allowedG), massUnit: unit })}</p>
      ) : null}
      {load ? (
        <div data-testid="dev3-load-check" className="flex min-w-0 flex-col gap-1">
          <p className="m-0 text-[14px] font-semibold">{t("dev3.card.loadTitle")}</p>
          <p className={load.flagged ? "m-0 rounded-card bg-tone-red-tint px-4 py-3 text-[15px] font-semibold text-tone-red-ink" : "m-0 text-[14px] text-muted-foreground"}>
            {load.flagged ? t("dev3.card.loadFlag", { diff: diff(load.diffG), allowed: g(load.allowedG), massUnit: unit }) : t("dev3.card.loadOk", { allowed: g(load.allowedG), massUnit: unit })}
          </p>
        </div>
      ) : null}
      {!closed ? (
        <Can do={action}>
          <div className="flex min-w-0 flex-col gap-3" data-testid="dev3-weigh-actions">
            {!live ? (
              <div className="flex min-w-0 flex-col gap-2">
                <p className="m-0 text-[14px] font-semibold">{t("dev3.card.pick")}</p>
                {candidates.length === 0 ? (
                  <p className="m-0 text-[14px] text-muted-foreground">{t("dev3.card.noTickets")}</p>
                ) : (
                  <ul className="m-0 flex list-none flex-col gap-2 p-0">
                    {candidates.map((r, i) => (
                      <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-card border border-border px-3 py-2">
                        <span className="flex min-w-0 flex-col gap-0.5 text-[14px]">
                          <span className="flex flex-wrap items-center gap-2 font-semibold">
                            <span className="font-mono">{r.ticketNo}</span>
                            {r.simulated ? <SimBadge /> : null}
                            {i < data.tickets.sameTruck.length ? <span className="text-[12px] font-normal text-muted-foreground">{t("dev3.card.sameTruck")}</span> : null}
                          </span>
                          <span className="text-muted-foreground">
                            {r.vehicleNo ? `${r.vehicleNo}, ` : ""}
                            {r.netG !== null ? `${g(r.netG)} ${unit}` : ""}
                          </span>
                        </span>
                        <Button
                          variant="secondary"
                          disabled={r.simulated || use.isPending}
                          title={r.simulated ? t("dev3.card.simNoUse") : undefined}
                          onClick={() => use.mutate({ subjectType, subjectId, readingId: r.id })}
                          data-testid={`dev3-use-${r.ticketNo}`}
                        >
                          {t("dev3.card.use")}
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : null}
            <Button variant="ghost" className="self-start" onClick={() => setTyping(true)} data-testid="dev3-type-open">
              {t("dev3.card.typeInstead")}
            </Button>
            {use.error ? <p role="alert" className="m-0 text-[14px] text-tone-red-ink">{say(use.error)}</p> : null}
          </div>
        </Can>
      ) : null}
      <TypeSheet open={typing} onOpenChange={setTyping} subjectType={subjectType} subjectId={subjectId} />
    </Card>
  );
}

function TypeSheet({ open, onOpenChange, subjectType, subjectId }: { open: boolean; onOpenChange(o: boolean): void; subjectType: WeighSubject; subjectId: string }) {
  const { t } = useT();
  const invalidate = useDevInvalidate();
  const [kg, setKg] = useState("");
  const [reason, setReason] = useState("");
  const [tried, setTried] = useState(false);
  useEffect(() => {
    if (!open) return;
    setKg("");
    setReason("");
    setTried(false);
  }, [open]);
  const type = useMutation(
    trpc.devices.weigh.typeWeight.mutationOptions({
      onSuccess: async () => {
        toast.success(t("dev3.card.saved"));
        await invalidate();
        onOpenChange(false);
      },
    }),
  );
  const typedG = typedWeightG(kg);
  const weightBad = typedG === null;
  const reasonBad = reason.trim().length < 3;
  return (
    <DevFormSheet
      open={open}
      onOpenChange={onOpenChange}
      title={t("dev3.card.typeTitle")}
      description={t("dev3.card.typeHint")}
      busy={type.isPending}
      error={type.error}
      submitLabel={t("dev3.card.save")}
      testId="dev3-type-form"
      onSubmit={() => {
        setTried(true);
        if (weightBad || reasonBad || typedG === null) return;
        type.mutate({ subjectType, subjectId, typedG, reason: reason.trim() });
      }}
    >
      <Field label={t("dev3.card.weight")} error={tried && weightBad ? t("dev3.required") : undefined}>
        <PlantInput spec={MASS_KG} value={kg} onValueChange={setKg} data-testid="dev3-type-weight" />
      </Field>
      <Field label={t("dev3.card.reason")} hint={t("dev3.card.reasonHint")} error={tried && reasonBad ? t("dev3.required") : undefined}>
        <FieldTextArea value={reason} maxLength={300} onChange={(e) => setReason(e.currentTarget.value)} data-testid="dev3-type-reason" />
      </Field>
    </DevFormSheet>
  );
}

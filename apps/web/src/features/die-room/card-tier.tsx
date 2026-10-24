import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Card, CardTitle } from "@orrn/ui/components/card";
import { Chip } from "@orrn/ui/components/chip";
import { Field, NumberInput } from "@orrn/ui/components/field";
import { Sheet } from "@orrn/ui/components/sheet";
import { TextArea } from "@orrn/ui/components/input";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { Can } from "@/shared/components/can";
import { INLINE_ERROR_META } from "@/shared/lib/query-errors";
import { trpc } from "@/shared/utils/trpc";

import { bandRangeText, parseRank, shortDate } from "./die-room-model";
import type { CardData } from "./types";
import { useRefreshDieRoom, useRefusal } from "./use-die-room";

/** Tier and band lift. Nothing here changes a tier: a proposal waits for a manager's decision. */
export function TierPanel({ card }: { card: CardData }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const { instance, pendingTierChange: pending } = card;
  const sectionId = instance.sectionId;
  const bands = useQuery({
    ...trpc.die.bands.list.queryOptions({ sectionId, includeRetired: true }),
    meta: INLINE_ERROR_META,
  });
  const bandName = (id: string | null) => {
    if (id == null) {
      const p = bands.data?.primary;
      return p ? bandRangeText(p.weightMinG, p.weightMaxG) : t("dieRoom.bands.primary");
    }
    const b = bands.data?.bands.find((x) => x.id === id);
    return b ? bandRangeText(b.weightMinG, b.weightMaxG) : "";
  };

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardTitle>
          {instance.tierRank == null ? t("dieRoom.copies.untiered") : t("dieRoom.copies.tier", { rank: instance.tierRank })}
        </CardTitle>
        {pending ? (
          <div role="status" className="flex flex-col gap-2 rounded-card border border-border bg-tone-amber-tint px-4 py-3 text-tone-amber-ink" data-testid="tier-pending">
            <p className="m-0 text-[15px] font-semibold">{t("dieRoom.tier.waitingManager")}</p>
            <p className="m-0 text-[14px] leading-6">
              {pending.isLift
                ? t("dieRoom.tier.pendingLift", { band: bandName(pending.toBandId) })
                : t("dieRoom.tier.pendingRank", { rank: pending.toRank })}
              {pending.reason ? ` · ${pending.reason}` : ""}
            </p>
            <Link to="/approvals" className="text-[14px] font-semibold text-tone-amber-ink">
              {t("dieRoom.tier.openApprovals")}
            </Link>
          </div>
        ) : (
          <p className="m-0 text-[14px] leading-6 text-muted-foreground">{t("dieRoom.tier.noPending")}</p>
        )}
        <Can do="die.rerank">
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setOpen(true)} disabled={Boolean(pending) || instance.status === "retired"}>
              {t("dieRoom.tier.propose")}
            </Button>
            <Button variant="secondary" asChild>
              <Link to="/dies/copies/$copyId/lift" params={{ copyId: instance.id }}>
                {t("dieRoom.tier.lift")}
              </Link>
            </Button>
          </div>
        </Can>
      </Card>

      {card.tierChanges.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h3 className="m-0 text-[15px] font-semibold">{t("dieRoom.tier.history")}</h3>
          <ol className="m-0 flex list-none flex-col gap-2 p-0">
            {card.tierChanges.map((c) => (
              <li key={c.id} className="flex min-w-0 flex-wrap items-center gap-2 rounded-card border border-border bg-card p-3 text-[14px] leading-6">
                <span className="font-semibold">
                  {c.isLift
                    ? t("dieRoom.tier.liftedTo", { band: bandName(c.toBandId) })
                    : c.fromRank == null
                      ? t("dieRoom.tier.firstTier", { rank: c.toRank })
                      : t("dieRoom.tier.rankChange", { from: c.fromRank, to: c.toRank })}
                </span>
                <Chip tone={c.status === "applied" ? "green" : c.status === "pending" ? "amber" : "neutral"} truncate={false}>
                  {t(`dieRoom.tier.status.${c.status}`)}
                </Chip>
                <span className="text-[13px] text-muted-foreground">{shortDate(c.effectiveAt ?? c.createdAt)}</span>
                {c.reason && c.reason !== "initial" ? <span className="min-w-0 text-[13px] break-words text-muted-foreground">{c.reason}</span> : null}
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <ProposeSheet open={open} onOpenChange={setOpen} card={card} />
    </div>
  );
}

function ProposeSheet({ open, onOpenChange, card }: { open: boolean; onOpenChange(open: boolean): void; card: CardData }) {
  const { t } = useT();
  const refresh = useRefreshDieRoom();
  const refusal = useRefusal();
  const [rank, setRank] = useState(card.instance.tierRank == null ? "" : String(card.instance.tierRank));
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const propose = useMutation({
    ...trpc.dieInstance.proposeTier.mutationOptions(),
    onSuccess: async () => {
      await refresh();
      toast.success(t("dieRoom.tier.sent"));
      setReason("");
      setError(null);
      onOpenChange(false);
    },
    onError: (e) => setError(refusal(e)),
  });

  const submit = () => {
    const r = parseRank(rank);
    if (r === null) return setError(t("dieRoom.tier.rankInvalid"));
    if (!reason.trim()) return setError(t("dieRoom.tier.reasonRequired"));
    setError(null);
    propose.mutate({ dieInstanceId: card.instance.id, rank: r, reason: reason.trim() });
  };

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t("dieRoom.tier.proposeTitle", { code: card.instance.code })}
      description={t("dieRoom.tier.proposeBody")}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button onClick={submit} loading={propose.isPending}>
            {t("common.askApproval")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label={t("dieRoom.tier.rankLabel")}>
          <NumberInput value={rank} onValueChange={setRank} decimal={false} />
        </Field>
        <Field label={t("common.reason")}>
          <TextArea value={reason} onChangeText={setReason} rows={3} maxLength={500} />
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



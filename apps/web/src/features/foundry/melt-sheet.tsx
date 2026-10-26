import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { Field } from "@orrn/ui/components/field";
import { PageHeader } from "@orrn/ui/components/page-header";
import { Sheet } from "@orrn/ui/components/sheet";
import type { AppRouter } from "@orrn/server/routers/index";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import type { inferRouterOutputs } from "@trpc/server";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { FieldTextArea } from "@/features/catalog/field-text-area";
import { kgFromG } from "@/features/press/model";
import { reasonOptions } from "@/features/press/reason-label";
import { Can } from "@/shared/components/can";
import { INLINE_ERROR_META } from "@/shared/lib/query-errors";
import { useOnceMutation } from "@/shared/lib/once-mutation";
import { trpc } from "@/shared/utils/trpc";

import { latestVerdict, MeltChip } from "./cast-view";
import { clockText, dayText } from "./format";
import { mmToFtText } from "./melt-form";
import { bpText } from "./model";
import { SpectroPanel } from "./spectro-panel";
import { ErrorLine, Figure, Note, Panel, useTimeZone, FieldSelect } from "./ui";

type CastData = inferRouterOutputs<AppRouter>["foundry"]["casts"]["get"];
type MeltRow = CastData["melts"][number];

const at = (v: unknown): number | null => (v === null || v === undefined ? null : new Date(v as string).getTime());

/**
 * A melt that is locked or cancelled (or that this person may not edit): every figure as the server
 * stored it, the spectro, and for a locked melt of an open cast the correction request. After the
 * lock nothing is edited; a correction is asked for, an approver agrees, and the melt is reopened as
 * a draft copy.
 */
export function MeltSheet({ data, melt }: { data: CastData; melt: MeltRow }) {
  const { t } = useT();
  const tz = useTimeZone();
  const alloys = useQuery({ ...trpc.foundry.alloys.list.queryOptions(), meta: INLINE_ERROR_META });
  const furnaces = useQuery({ ...trpc.foundry.furnaces.list.queryOptions(), meta: INLINE_ERROR_META });
  const cast = data.cast;
  const furnace = furnaces.data?.items.find((f) => f.id === melt.furnaceId);
  const alloy = alloys.data?.items.find((a) => a.id === (melt.alloyId ?? cast.alloyId)) ?? alloys.data?.items.find((a) => a.code === melt.alloy);
  const verdict = latestVerdict(melt.spectro);
  const times = [
    ["preheatStart", melt.preheatStartAt],
    ["chargingStart", melt.chargingStartAt],
    ["chargingEnd", melt.chargingEndAt],
    ["castingStart", melt.castingStartAt],
    ["castingEnd", melt.castingEndAt],
  ] as const;
  const logs = melt.outputs.filter((o) => o.kind === "logs");
  const returns = melt.outputs.filter((o) => o.kind === "return_stream");
  return (
    <>
      <PageHeader
        title={t("foundry.melt.titleOf", { n: melt.seq, number: cast.number })}
        back={{ to: `/casts/${cast.id}`, label: t("foundry.cast.back") }}
        actions={<MeltChip m={melt} />}
      />
      {melt.status === "cancelled" ? <Note tone="red">{t("foundry.melt.cancelledNote")}</Note> : null}
      {melt.status === "corrected" ? <Note testId="corrected-note">{t("foundry.melt.correctedNote")}</Note> : null}
      {melt.correctsMeltId ? (
        <Note testId="corrects-note">{t("foundry.melt.correctsNote", { n: data.melts.find((m) => m.id === melt.correctsMeltId)?.seq ?? "" })}</Note>
      ) : null}
      <Panel id="melt-figures" title={t("foundry.melt.sheet.figures")} testId="melt-sheet">
        <dl className="m-0 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
          <Figure label={t("foundry.melt.furnace")} value={furnace?.code ?? "-"} />
          <Figure label={t("foundry.melt.alloy")} value={alloy?.code ?? melt.alloy} />
          <Figure label={t("foundry.cast.panel.metalIn")} value={`${kgFromG(melt.inputG)} ${t("units.kg")}`} testId="sheet-in" />
          <Figure label={t("foundry.melt.out.logs")} value={`${kgFromG(melt.logsG)} ${t("units.kg")}`} hint={`${melt.logsPcs} ${t("units.pcs")}`} testId="sheet-logs" />
          <Figure label={t("foundry.melt.out.dross")} value={`${kgFromG(melt.drossG)} ${t("units.kg")}`} />
          <Figure label={t("foundry.melt.out.fe")} value={`${kgFromG(melt.feG)} ${t("units.kg")}`} />
          <Figure label={t("foundry.cast.panel.burn")} value={`${kgFromG(Math.abs(melt.lossG))} ${t("units.kg")}`} hint={`${bpText(Math.abs(melt.lossBp))}%`} testId="sheet-burn" />
          <Figure label={t("foundry.melt.balance.yieldLabel")} value={melt.yieldBp === null ? "-" : `${bpText(melt.yieldBp)}%`} testId="sheet-yield" />
        </dl>
        {melt.balanceNote ? <p className="m-0 text-[14px] break-words">{t("foundry.melt.sheet.balanceNote", { note: melt.balanceNote })}</p> : null}
        {melt.alloyReason ? <p className="m-0 text-[14px] break-words">{t("foundry.melt.sheet.alloyReason", { note: melt.alloyReason })}</p> : null}
        {melt.spectroReason ? <p className="m-0 text-[14px] break-words">{t("foundry.melt.sheet.spectroReason", { note: melt.spectroReason })}</p> : null}
        {melt.notes ? <p className="m-0 text-[14px] break-words">{melt.notes}</p> : null}
      </Panel>
      <Panel id="melt-times" title={t("foundry.melt.steps.times")}>
        <dl className="m-0 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-5">
          {times.map(([k, v]) => {
            const ms = at(v);
            return <Figure key={k} label={t(`foundry.melt.times.${k}`)} value={ms === null ? "-" : `${clockText(ms, tz)}`} hint={ms === null ? undefined : dayText(ms, tz)} />;
          })}
        </dl>
      </Panel>
      <Panel id="melt-charge" title={t("foundry.melt.charge.title")}>
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0" data-testid="sheet-inputs">
          {melt.inputs.map((i, n) => (
            <li key={n} className="flex flex-wrap items-baseline gap-x-3 text-[15px]">
              <span className="font-mono font-semibold">{i.lotNumber ?? i.streamCode}</span>
              <span className="text-muted-foreground">{[i.itemName, i.gradeCode].filter(Boolean).join(" · ") || i.streamName}</span>
              <span className="tabular-nums">{kgFromG(i.kgG)} {t("units.kg")}</span>
            </li>
          ))}
        </ul>
        {melt.chemicals.length > 0 ? (
          <ul className="m-0 flex list-none flex-col gap-1.5 border-t border-border p-0 pt-3" data-testid="sheet-chemicals">
            {melt.chemicals.map((c, n) => (
              <li key={n} className="flex flex-wrap items-baseline gap-x-3 text-[15px]">
                <span className="font-semibold">{c.name ?? t("foundry.melt.chem.storeItem")}</span>
                <span className="tabular-nums">{t("foundry.melt.chem.line", { open: c.openMilli / 1000, used: c.usedMilli / 1000, close: c.closeMilli / 1000 })}</span>
                {c.mrsNumber ? <span className="font-mono text-[13px] text-muted-foreground">{c.mrsNumber}</span> : null}
              </li>
            ))}
          </ul>
        ) : null}
        {logs.length > 0 ? (
          <ul className="m-0 flex list-none flex-col gap-1.5 border-t border-border p-0 pt-3" data-testid="sheet-logs-list">
            {logs.map((l, n) => (
              <li key={n} className="text-[15px] tabular-nums">
                {t("foundry.melt.out.logLine", { pcs: l.pcs ?? 0, ft: mmToFtText(l.lengthMm), kg: kgFromG(l.kgG) })}
              </li>
            ))}
            {returns.map((r, n) => (
              <li key={`r${n}`} className="text-[15px] tabular-nums">
                {r.streamCode}: {kgFromG(r.kgG)} {t("units.kg")}
              </li>
            ))}
          </ul>
        ) : null}
      </Panel>
      <Panel id="melt-spectro" title={t("foundry.spectro.title")} actions={verdict ? <Chip tone={verdict === "pass" ? "green" : verdict === "fail" ? "red" : "amber"}>{t(`foundry.spectro.verdict.${verdict}`)}</Chip> : undefined}>
        <SpectroPanel meltId={melt.status === "cancelled" || melt.status === "corrected" ? null : melt.id} results={melt.spectro} limits={alloy?.limits ?? []} alloyCode={alloy?.code ?? melt.alloy} draft={false} />
      </Panel>
      {melt.status === "locked" && cast.status === "open" ? (
        <>
          <Correction melt={melt} />
          <CancelMelt melt={melt} castNumber={cast.number} />
        </>
      ) : null}
    </>
  );
}

/**
 * Cancel a locked melt of an open cast (cast.close; the supervisor's own door, no approver needed):
 * the kg and the store draws are reversed and the melt keeps its number as cancelled. The server
 * refuses once the press used the cast's billets, and the sentence says so.
 */
function CancelMelt({ melt, castNumber }: { melt: MeltRow; castNumber: string }) {
  const { t } = useT();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState("");
  const [tried, setTried] = useState(false);
  const cancel = useOnceMutation(
    trpc.foundry.melts.cancel.mutationOptions({
      onSuccess: () => {
        toast.success(t("foundry.melt.cancel.done", { n: melt.seq, number: castNumber }));
        void queryClient.invalidateQueries({ queryKey: trpc.foundry.pathKey() });
        void queryClient.invalidateQueries({ queryKey: trpc.approval.pathKey() });
        done();
        void navigate({ to: "/casts/$id", params: { id: melt.castId } });
      },
    }),
  );
  const done = () => {
    setAsking(false);
    setReason("");
    setTried(false);
    cancel.reset();
  };
  return (
    <Can do="cast.close">
      <Panel id="melt-cancel" title={t("foundry.melt.cancel.title")} testId="melt-cancel">
        <p className="m-0 text-[14px] text-muted-foreground">{t("foundry.melt.cancel.body")}</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" onClick={() => setAsking(true)} data-testid="cancel-melt">
            {t("foundry.melt.cancel.button")}
          </Button>
        </div>
        <Sheet
          open={asking}
          onOpenChange={(o) => (o ? undefined : done())}
          title={t("foundry.melt.cancel.sheetTitle", { n: melt.seq, number: castNumber })}
          footer={
            <>
              <Button variant="secondary" size="lg" onClick={done}>{t("common.cancel")}</Button>
              <Button
                size="lg"
                variant="danger"
                loading={cancel.isPending}
                data-testid="cancel-melt-confirm"
                onClick={() => {
                  setTried(true);
                  if (reason.trim() !== "") cancel.mutate({ meltId: melt.id, reason: reason.trim() });
                }}
              >
                {t("foundry.melt.cancel.confirm")}
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-4 pt-1">
            <Field label={t("foundry.melt.cancel.reason")} error={tried && reason.trim() === "" ? t("foundry.melt.cancel.reasonRequired") : undefined}>
              <FieldTextArea value={reason} maxLength={500} onChange={(e) => setReason(e.currentTarget.value)} data-testid="cancel-melt-reason" />
            </Field>
            <ErrorLine error={cancel.error} />
          </div>
        </Sheet>
      </Panel>
    </Can>
  );
}

/** The correction request and what comes of it (approval `melt_correct`). */
function Correction({ melt }: { melt: MeltRow }) {
  const { t } = useT();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [asking, setAsking] = useState(false);
  // This melt's own requests, newest first (not the plant's newest hundred, which would drop an old pending one).
  const list = useQuery({ ...trpc.approval.list.queryOptions({ kind: "melt_correct", subjectId: melt.id, limit: 20, offset: 0 }), meta: INLINE_ERROR_META });
  const mine = list.data?.items ?? [];
  const open = mine.find((a) => a.status === "pending" || (a.status === "approved" && (a.meta as { usedAt?: unknown } | null)?.usedAt == null));
  const requestId = useRef(crypto.randomUUID());
  const correct = useOnceMutation(
    trpc.foundry.melts.correct.mutationOptions({
      onSuccess: (res) => {
        toast.success(t("foundry.melt.correction.done"));
        void queryClient.invalidateQueries({ queryKey: trpc.foundry.pathKey() });
        void queryClient.invalidateQueries({ queryKey: trpc.approval.pathKey() });
        void navigate({ to: "/casts/$id/melt/$meltId", params: { id: res.castId, meltId: res.draftId } });
      },
    }),
  );
  const rejected = !open ? mine.find((a) => a.status === "rejected") : undefined;
  return (
    <Can do="melt.correct">
      <Panel id="melt-correction" title={t("foundry.melt.correction.title")} testId="correction">
        <p className="m-0 text-[14px] text-muted-foreground">{t("foundry.melt.correction.body")}</p>
        {open?.status === "pending" ? <Note tone="amber" testId="correction-pending">{t("foundry.melt.correction.pending")}</Note> : null}
        {rejected ? <Note tone="red" testId="correction-rejected">{t("foundry.melt.correction.rejected")}{rejected.note ? ` ${rejected.note}` : ""}</Note> : null}
        <div className="flex flex-wrap gap-2">
          {open?.status === "approved" ? (
            <Button loading={correct.isPending} onClick={() => correct.mutate({ meltId: melt.id, clientMutationId: requestId.current })} data-testid="correct-now">
              {t("foundry.melt.correction.now")}
            </Button>
          ) : !open && !list.isPending ? (
            <Button variant="secondary" onClick={() => setAsking(true)} data-testid="ask-correction">
              {t("foundry.melt.correction.ask")}
            </Button>
          ) : null}
        </div>
        <ErrorLine error={correct.error} />
        <AskSheet meltId={melt.id} open={asking} onClose={() => setAsking(false)} />
      </Panel>
    </Can>
  );
}

function AskSheet({ meltId, open, onClose }: { meltId: string; open: boolean; onClose(): void }) {
  const { t, locale } = useT();
  const queryClient = useQueryClient();
  const reasons = useQuery({ ...trpc.press.reasons.queryOptions({ kind: "melt_correct" }), enabled: open });
  const options = reasonOptions(t, "melt_correct", reasons.data, locale);
  const [code, setCode] = useState("");
  const [note, setNote] = useState("");
  const [tried, setTried] = useState(false);
  const ask = useOnceMutation(
    trpc.foundry.melts.requestCorrection.mutationOptions({
      onSuccess: () => {
        toast.success(t("foundry.melt.correction.sent"));
        void queryClient.invalidateQueries({ queryKey: trpc.approval.pathKey() });
        done();
      },
    }),
  );
  const done = () => {
    setCode("");
    setNote("");
    setTried(false);
    ask.reset();
    onClose();
  };
  const row = reasons.data?.find((r) => r.code === code);
  const needsNote = options.find((o) => o.value === code)?.requiresNote ?? false;
  return (
    <Sheet
      open={open}
      onOpenChange={(o) => (o ? undefined : done())}
      title={t("foundry.melt.correction.askTitle")}
      footer={
        <>
          <Button variant="secondary" size="lg" onClick={done}>{t("common.cancel")}</Button>
          <Button
            size="lg"
            loading={ask.isPending}
            data-testid="ask-confirm"
            onClick={() => {
              setTried(true);
              if (!row || (needsNote && !note.trim())) return;
              ask.mutate({ meltId, reasonCodeId: row.id, ...(note.trim() ? { note: note.trim() } : {}) });
            }}
          >
            {t("foundry.melt.correction.send")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 pt-1">
        <Field label={t("foundry.melt.correction.reason")} error={tried && !row ? t("foundry.melt.correction.reasonRequired") : undefined}>
          <FieldSelect value={code} onChange={(e) => setCode(e.currentTarget.value)} data-testid="ask-reason">
            <option value="">{t("foundry.melt.correction.reasonPick")}</option>
            {options.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </FieldSelect>
        </Field>
        <Field label={t("foundry.melt.correction.note")} error={tried && needsNote && !note.trim() ? t("foundry.melt.correction.noteRequired") : undefined}>
          <FieldTextArea value={note} maxLength={500} onChange={(e) => setNote(e.currentTarget.value)} data-testid="ask-note" />
        </Field>
        <ErrorLine error={ask.error} />
      </div>
    </Sheet>
  );
}


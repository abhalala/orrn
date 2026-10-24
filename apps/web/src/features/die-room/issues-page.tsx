import { canCancelIssue, canReturnDie } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Card, CardTitle } from "@orrn/ui/components/card";
import { Chip } from "@orrn/ui/components/chip";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Field } from "@orrn/ui/components/field";

import { PageHeader } from "@orrn/ui/components/page-header";
import { SegmentedControl } from "@orrn/ui/components/segmented-control";
import { Select } from "@orrn/ui/components/select";
import { useMutation, useQuery, useQueries } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { FieldTextArea } from "@/features/catalog/field-text-area";
import { Can } from "@/shared/components/can";
import { INLINE_ERROR_META } from "@/shared/lib/query-errors";
import { trpc } from "@/shared/utils/trpc";

import { shortDate, shortDateTime } from "./die-room-model";
import { ConfirmDialog } from "./confirm-dialog";
import { CopyPicker, CustomerSearchPicker, type PickedCopy } from "./pickers";
import { useRefreshDieRoom, useRefusal } from "./use-die-room";

const PURPOSES = ["plan", "press", "pack", "dispatch"] as const;
type Purpose = (typeof PURPOSES)[number];

/** `/dies/issues`: hand a copy to a press line and take it back, and check who may use a customer's die. */
export function IssuesPage() {
  const { t } = useT();
  return (
    <>
      <PageHeader back={{ to: "/dies", label: t("nav.dies") }} title={t("dieRoom.issues.title")} subtitle={t("dieRoom.issues.subtitle")} />
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-5">
          <IssueForm />
          <OpenIssues />
        </div>
        <OwnerCheck />
      </div>
    </>
  );
}

function IssueForm() {
  const { t } = useT();
  const refresh = useRefreshDieRoom();
  const refusal = useRefusal();
  const [copy, setCopy] = useState<PickedCopy | null>(null);
  const [runId, setRunId] = useState("");
  const [lineId, setLineId] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Only to say "nothing on the rack"; the picker itself searches the server.
  const rack = useQuery({
    ...trpc.dieInstance.list.queryOptions({ status: "available", limit: 1 }),
    meta: INLINE_ERROR_META,
  });
  const lines = useQuery({ ...trpc.dieInstance.issues.pressLines.queryOptions(), meta: INLINE_ERROR_META });
  const copyId = copy?.id ?? "";
  const sectionId = copy?.sectionId;
  const runs = useQuery({
    ...trpc.dieInstance.issues.queuedRuns.queryOptions({ sectionId: sectionId ?? "" }),
    enabled: Boolean(sectionId),
    meta: INLINE_ERROR_META,
  });

  const issue = useMutation({
    ...trpc.dieInstance.issues.issue.mutationOptions(),
    onSuccess: async (r) => {
      await refresh();
      toast.success(t("dieRoom.issues.issuedToast"));
      if (r.warnings.some((w) => w.code === "life_reached")) toast.warning(t("dieRoom.issues.lifeReached"));
      setCopy(null);
      setRunId("");
      setNote("");
      setError(null);
    },
    onError: (e) => setError(refusal(e)),
  });

  const runList = runs.data ?? [];
  const runOptions = runList.map((r) => ({ value: r.id, label: r.pressLineCode ? `${r.number} \u00b7 ${r.pressLineCode}` : r.number }));
  const chosenRun = runList.find((r) => r.id === (runId || runList[0]?.id));
  const lineOptions = (lines.data ?? []).map((l) => ({ value: l.id, label: l.code === l.name ? l.code : `${l.code} \u00b7 ${l.name}` }));
  // The run knows its line: the person cannot pick another one (the server would refuse it).
  const lockedLine = chosenRun?.pressLineId ?? null;
  const chosenLine = lockedLine ?? (lineId || lineOptions[0]?.value || "");

  return (
    <Card data-testid="issue-form">
      <CardTitle>{t("dieRoom.issue.title")}</CardTitle>
      {rack.isSuccess && rack.data.total === 0 ? (
        <EmptyState title={t("dieRoom.issues.noneOnRack")} body={t("dieRoom.issues.noneOnRackBody")} className="py-6" />
      ) : (
        <Can
          do="die.issue"
          fallback={<p className="m-0 text-[14px] leading-6 text-muted-foreground">{t("dieRoom.issues.dieRoomOnly")}</p>}
        >
          <CopyPicker
            label={t("dieRoom.copies.copy")}
            value={copy?.id ?? null}
            valueLabel={copy?.code}
            status="available"
            placeholder={t("dieRoom.issues.pickCopy")}
            onChange={(c) => {
              setCopy(c);
              setRunId("");
              setLineId("");
              setError(null);
            }}
          />
          {copyId ? (
            runs.isSuccess && runList.length === 0 ? (
              <p role="status" className="m-0 text-[14px] leading-6 text-muted-foreground" data-testid="no-run">
                {t("dieRoom.issues.noRun")}
              </p>
            ) : (
              <Field label={t("dieRoom.issues.run")}>
                <Select
                  value={chosenRun?.id ?? ""}
                  onValueChange={(v) => {
                    setRunId(v);
                    setLineId("");
                  }}
                  options={runOptions}
                  placeholder={t("dieRoom.issues.pickRun")}
                />
              </Field>
            )
          ) : null}
          <Field label={t("dieRoom.issue.line")} hint={lockedLine ? t("dieRoom.issues.lineFromRun") : undefined}>
            <Select
              value={chosenLine}
              onValueChange={setLineId}
              options={lineOptions}
              placeholder={t("dieRoom.issues.pickLine")}
              disabled={Boolean(lockedLine)}
            />
          </Field>
          <Field label={t("common.note")} hint={t("common.optional")}>
            <FieldTextArea value={note} onChangeText={setNote} rows={2} maxLength={500} />
          </Field>
          {error ? (
            <p role="alert" className="m-0 text-[14px] leading-5 font-medium text-destructive">
              {error}
            </p>
          ) : null}
          <div>
            <Button
              loading={issue.isPending}
              onClick={() => {
                if (!copyId) return setError(t("dieRoom.issues.pickCopy"));
                if (!chosenRun) return setError(t("dieRoom.issues.pickRun"));
                if (!chosenLine) return setError(t("dieRoom.issues.pickLine"));
                setError(null);
                issue.mutate({
                  dieInstanceId: copyId,
                  pressLineId: chosenLine,
                  pressRunId: chosenRun.id,
                  ...(note.trim() ? { note: note.trim() } : {}),
                });
              }}
            >
              {t("dieRoom.issue.issue")}
            </Button>
          </div>
        </Can>
      )}
    </Card>
  );
}

function OpenIssues() {
  const { t } = useT();
  const refresh = useRefreshDieRoom();
  const refusal = useRefusal();
  const open = useQuery({
    ...trpc.dieInstance.issues.list.queryOptions({ status: "issued" }),
    meta: INLINE_ERROR_META,
  });
  const giveBack = useMutation({
    ...trpc.dieInstance.issues.return.mutationOptions(),
    onSuccess: async () => {
      await refresh();
      toast.success(t("dieRoom.issue.returned"));
    },
    onError: (e) => toast.error(refusal(e)),
  });
  const cancel = useMutation({
    ...trpc.dieInstance.issues.cancel.mutationOptions(),
    onSuccess: async () => {
      await refresh();
      setConfirming(null);
      toast.success(t("dieRoom.issues.cancelledToast"));
    },
    onError: (e) => {
      setConfirming(null);
      toast.error(refusal(e));
    },
  });
  const [confirming, setConfirming] = useState<{ id: string; code: string } | null>(null);

  return (
    <section className="flex min-w-0 flex-col gap-3" aria-labelledby="open-issues">
      <h2 id="open-issues" className="m-0 text-[17px] leading-6 font-semibold tracking-[-0.01em]">
        {t("dieRoom.issues.open")}
      </h2>
      {open.isError ? (
        <EmptyState
          title={t("dieRoom.issues.loadFailed")}
          action={
            <Button variant="secondary" onClick={() => open.refetch()}>
              {t("common.retry")}
            </Button>
          }
        />
      ) : open.isSuccess && open.data.items.length === 0 ? (
        <EmptyState title={t("dieRoom.issues.noneOpen")} body={t("dieRoom.issues.noneOpenBody")} />
      ) : (
        <ul className="m-0 flex list-none flex-col gap-3 p-0" data-testid="open-issues">
          {(open.data?.items ?? []).map((i) => (
            <li key={i.id} className="flex min-w-0 flex-col gap-2 rounded-card border border-border bg-card p-4" data-testid={`issue-${i.code}`}>
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <Link
                  to="/dies/copies/$copyId"
                  params={{ copyId: i.dieInstanceId }}
                  className="inline-flex min-h-11 items-center font-mono text-[16px] font-semibold tabular-nums text-foreground no-underline"
                >
                  {i.code}
                </Link>
                <Chip tone="blue" truncate={false}>
                  {t("dieRoom.issue.issued", { line: i.pressLineCode })}
                </Chip>
                {i.pressRunNumber ? <span className="font-mono text-[13px] text-muted-foreground">{i.pressRunNumber}</span> : null}
              </div>
              <p className="m-0 text-[13px] text-muted-foreground">
                {shortDateTime(i.issuedAt)}
                {i.note ? ` · ${i.note}` : ""}
              </p>
              <Can do="die.issue">
                {(() => {
                  const run = i.pressRunId ? { dieInAt: msOf(i.pressRunDieInAt), dieOutAt: msOf(i.pressRunDieOutAt), status: i.pressRunStatus ?? "" } : null;
                  const canBack = canReturnDie({ issueStatus: "issued", run }).ok;
                  const canUndo = canCancelIssue({ issueStatus: "issued", run });
                  return (
                    <div className="flex flex-col gap-2">
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="secondary"
                          disabled={!canBack}
                          loading={giveBack.isPending && giveBack.variables?.id === i.id}
                          onClick={() => giveBack.mutate({ id: i.id })}
                        >
                          {t("dieRoom.issue.return")}
                        </Button>
                        <Button
                          variant="secondary"
                          disabled={!canUndo}
                          loading={cancel.isPending && cancel.variables?.id === i.id}
                          onClick={() => setConfirming({ id: i.id, code: i.code })}
                        >
                          {t("dieRoom.issue.cancel")}
                        </Button>
                      </div>
                      {!canBack ? (
                        <p className="m-0 text-[13px] leading-5 text-muted-foreground" data-testid="return-blocked">
                          {t("dieRoom.issues.returnBlocked", { run: i.pressRunNumber ?? "" })}
                        </p>
                      ) : !canUndo ? (
                        <p className="m-0 text-[13px] leading-5 text-muted-foreground" data-testid="cancel-blocked">
                          {t("dieRoom.issues.cancelBlocked", { run: i.pressRunNumber ?? "" })}
                        </p>
                      ) : null}
                    </div>
                  );
                })()}
              </Can>
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={confirming !== null}
        title={t("dieRoom.issues.cancelTitle", { code: confirming?.code ?? "" })}
        body={t("dieRoom.issues.cancelBody", { code: confirming?.code ?? "" })}
        confirmLabel={t("dieRoom.issue.cancel")}
        keepLabel={t("dieRoom.issues.keepIssued")}
        loading={cancel.isPending}
        onConfirm={() => confirming && cancel.mutate({ id: confirming.id })}
        onClose={() => setConfirming(null)}
      />
    </section>
  );
}

/** A date the API sent (Date, ISO text or epoch ms) as epoch ms; null when absent. */
function msOf(value: unknown): number | null {
  if (value == null) return null;
  const n = new Date(value as string | number | Date).getTime();
  return Number.isNaN(n) ? null : n;
}

/** Read-only check of the owner gate, then (for roles that plan, press, pack or dispatch) a request for an exception. */
function OwnerCheck() {
  const { t } = useT();
  const refresh = useRefreshDieRoom();
  const refusal = useRefusal();
  const [copy, setCopy] = useState<PickedCopy | null>(null);
  const [party, setParty] = useState<{ id: string; name: string }>({ id: "plant", name: "" });
  const copyId = copy?.id ?? "";
  const customerId = party.id;
  const [purpose, setPurpose] = useState<Purpose>("pack");
  const [note, setNote] = useState("");
  const [asked, setAsked] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const check = useQuery({
    ...trpc.dieInstance.ownerCheck.queryOptions({
      dieInstanceId: copyId,
      customerId: customerId === "plant" ? null : customerId,
      purpose,
    }),
    enabled: copyId !== "",
    meta: INLINE_ERROR_META,
  });

  const request = useMutation({
    ...trpc.dieInstance.requestOwnerOverride.mutationOptions(),
    onSuccess: async () => {
      await refresh();
      setAsked(true);
      setError(null);
      toast.success(t("dieRoom.owner.requested"));
    },
    onError: (e) => setError(refusal(e)),
  });

  const result = check.data;
  const customerName = party.id === "plant" ? t("dieRoom.owner.plantStock") : party.name;

  return (
    <Card className="min-w-0 self-start" data-testid="owner-check">
      <CardTitle>{t("dieRoom.owner.checkTitle")}</CardTitle>
      <p className="m-0 text-[14px] leading-6 text-muted-foreground">{t("dieRoom.owner.checkBody")}</p>
      <CopyPicker
        label={t("dieRoom.copies.copy")}
        value={copy?.id ?? null}
        valueLabel={copy?.code}
        placeholder={t("dieRoom.issues.pickCopy")}
        onChange={(c) => {
          setCopy(c);
          setAsked(false);
          setError(null);
        }}
      />
      <CustomerSearchPicker
        label={t("dieRoom.owner.forParty")}
        value={party.id}
        valueLabel={party.id === "plant" ? t("dieRoom.owner.plantStock") : party.name}
        plantOption={t("dieRoom.owner.plantStock")}
        placeholder={t("dieRoom.owner.partySearch")}
        onChange={(p) => {
          setParty(p);
          setAsked(false);
          setError(null);
        }}
      />
      <div className="flex min-w-0 flex-col gap-1.5">
        <span className="text-[14px] font-semibold">{t("dieRoom.owner.purposeLabel")}</span>
        <SegmentedControl
          label={t("dieRoom.owner.purposeLabel")}
          value={purpose}
          onChange={(v) => {
            setPurpose(v);
            setAsked(false);
          }}
          options={PURPOSES.map((p) => ({ value: p, label: t(`dieRoom.owner.purpose.${p}`) }))}
        />
      </div>

      {copyId === "" ? (
        <p className="m-0 text-[14px] text-muted-foreground">{t("dieRoom.owner.pickToCheck")}</p>
      ) : check.isError ? (
        <p role="alert" className="m-0 text-[14px] font-medium text-destructive">
          {refusal(check.error)}
        </p>
      ) : result ? (
        <div data-testid="owner-result">
          {result.ok ? (
            <p role="status" className="m-0 rounded-card border border-border bg-tone-green-tint px-4 py-3 text-[15px] font-semibold text-tone-green-ink">
              {result.viaGrant
                ? t("dieRoom.owner.allowedByException", { name: customerName })
                : result.ownerName
                  ? t("dieRoom.owner.allowedOwner", { name: result.ownerName })
                  : t("dieRoom.owner.allowedPlant")}
            </p>
          ) : (
            <div role="alert" className="flex flex-col gap-3 rounded-card border border-border bg-tone-red-tint px-4 py-3 text-tone-red-ink">
              <p className="m-0 text-[15px] font-semibold">
                {result.block === "owned"
                  ? t("dieRoom.owner.belongsTo", { name: result.ownerName ?? "" })
                  : result.block === "no_copies"
                    ? t("dieRoom.owner.noCopies")
                    : t("dieRoom.owner.pickCopy")}
              </p>
              {result.block === "owned" && customerId !== "plant" ? (
                asked ? (
                  <p className="m-0 text-[14px] leading-6" data-testid="owner-waiting">
                    {t("dieRoom.owner.waitingManager", { name: customerName })}
                  </p>
                ) : (
                  <Can do={["order.manage", "order.plan", "press.run", "bundle.pack", "dispatch.create"]}>
                    <Field label={t("dieRoom.owner.whyLabel")}>
                      <FieldTextArea value={note} onChangeText={setNote} rows={2} maxLength={500} />
                    </Field>
                    {error ? (
                      <p role="alert" className="m-0 text-[14px] font-medium">
                        {error}
                      </p>
                    ) : null}
                    <div>
                      <Button
                        variant="secondary"
                        loading={request.isPending}
                        onClick={() => {
                          if (!note.trim()) return setError(t("dieRoom.owner.whyRequired"));
                          setError(null);
                          request.mutate({ dieInstanceId: copyId, customerId, purpose, note: note.trim() });
                        }}
                      >
                        {t("dieRoom.owner.requestOverride", { name: customerName })}
                      </Button>
                    </div>
                  </Can>
                )
              ) : null}
            </div>
          )}
        </div>
      ) : null}
      {copy ? <OpenExceptions copy={copy} /> : null}
    </Card>
  );
}

/**
 * The live exceptions on the picked copy (approved and not closed): party, what it was asked for,
 * the day it was approved. A manager closes one here, after which the owner gate says "belongs to"
 * again. Read-only for everyone else.
 */
function OpenExceptions({ copy }: { copy: PickedCopy }) {
  const { t } = useT();
  const refresh = useRefreshDieRoom();
  const refusal = useRefusal();
  const [closing, setClosing] = useState<{ id: string; name: string } | null>(null);
  const approved = useQuery({
    ...trpc.approval.list.queryOptions({ kind: "die_owner_override", status: "approved", limit: 200 }),
    meta: INLINE_ERROR_META,
  });
  const live = (approved.data?.items ?? []).filter(
    (a) => a.subjectId === copy.id && (a.meta as Record<string, unknown> | null)?.closedAt == null,
  );
  const partyIds = [...new Set(live.map((a) => String((a.meta as Record<string, unknown>).attemptedCustomerId ?? "")).filter(Boolean))];
  const partyQueries = useQueries({
    queries: partyIds.map((id) => ({ ...trpc.customer.get.queryOptions({ id }), meta: INLINE_ERROR_META, retry: false })),
  });
  const nameOf = (id: string) => {
    const i = partyIds.indexOf(id);
    return (partyQueries[i]?.data as { name?: string } | undefined)?.name ?? "\u2014";
  };

  const close = useMutation({
    ...trpc.dieInstance.closeOwnerOverride.mutationOptions(),
    onSuccess: async () => {
      await refresh();
      setClosing(null);
      toast.success(t("dieRoom.owner.closedToast"));
    },
    onError: (e) => {
      setClosing(null);
      toast.error(refusal(e));
    },
  });

  return (
    <section className="flex min-w-0 flex-col gap-2 border-t border-border pt-4" aria-labelledby="open-exceptions" data-testid="open-exceptions">
      <h3 id="open-exceptions" className="m-0 text-[15px] leading-6 font-semibold">
        {t("dieRoom.owner.exceptionsTitle", { code: copy.code })}
      </h3>
      {approved.isError ? (
        <p role="alert" className="m-0 text-[14px] font-medium text-destructive">
          {t("dieRoom.owner.exceptionsFailed")}
        </p>
      ) : approved.isSuccess && live.length === 0 ? (
        <p className="m-0 text-[14px] leading-6 text-muted-foreground">{t("dieRoom.owner.exceptionsNone")}</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {live.map((a) => {
            const meta = a.meta as Record<string, unknown>;
            const name = nameOf(String(meta.attemptedCustomerId ?? ""));
            return (
              <li key={a.id} className="flex min-w-0 flex-col gap-2 rounded-card border border-border bg-surface-sunken p-3" data-testid={`exception-${a.id}`}>
                <p className="m-0 text-[15px] leading-6">
                  <span className="font-semibold">{name}</span>
                  {" \u00b7 "}
                  {t(`dieRoom.owner.purpose.${String(meta.purpose) as "plan" | "press" | "pack" | "dispatch"}`)}
                </p>
                <p className="m-0 text-[13px] text-muted-foreground">
                  {t("dieRoom.owner.approvedOn", { date: shortDate(a.decidedAt as string | number | Date | null) })}
                  {a.requestNote ? ` \u00b7 ${a.requestNote}` : ""}
                </p>
                <Can do="masters.publish">
                  <div>
                    <Button variant="secondary" onClick={() => setClosing({ id: a.id, name })}>
                      {t("dieRoom.owner.closeException")}
                    </Button>
                  </div>
                </Can>
              </li>
            );
          })}
        </ul>
      )}
      <ConfirmDialog
        open={closing !== null}
        title={t("dieRoom.owner.closeTitle", { code: copy.code })}
        body={t("dieRoom.owner.closeBody", { name: closing?.name ?? "", code: copy.code })}
        confirmLabel={t("dieRoom.owner.closeException")}
        loading={close.isPending}
        onConfirm={() => closing && close.mutate({ approvalId: closing.id })}
        onClose={() => setClosing(null)}
      />
    </section>
  );
}

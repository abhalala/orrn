import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Card, CardTitle } from "@orrn/ui/components/card";
import { Chip } from "@orrn/ui/components/chip";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Field } from "@orrn/ui/components/field";

import { PageHeader } from "@orrn/ui/components/page-header";
import { SegmentedControl } from "@orrn/ui/components/segmented-control";
import { Select } from "@orrn/ui/components/select";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { FieldTextArea } from "@/features/catalog/field-text-area";
import { Can } from "@/shared/components/can";
import { INLINE_ERROR_META } from "@/shared/lib/query-errors";
import { trpc } from "@/shared/utils/trpc";

import { shortDateTime } from "./die-room-model";
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
  const [copyId, setCopyId] = useState("");
  const [lineId, setLineId] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const copies = useQuery({
    ...trpc.dieInstance.list.queryOptions({ status: "available", limit: 200 }),
    meta: INLINE_ERROR_META,
  });
  const lines = useQuery({ ...trpc.dieInstance.issues.pressLines.queryOptions(), meta: INLINE_ERROR_META });

  const issue = useMutation({
    ...trpc.dieInstance.issues.issue.mutationOptions(),
    onSuccess: async () => {
      await refresh();
      toast.success(t("dieRoom.issues.issuedToast"));
      setCopyId("");
      setNote("");
      setError(null);
    },
    onError: (e) => setError(refusal(e)),
  });

  const copyOptions = (copies.data?.items ?? []).map((c) => ({ value: c.id, label: c.code }));
  const lineOptions = (lines.data ?? []).map((l) => ({ value: l.id, label: l.code === l.name ? l.code : `${l.code} · ${l.name}` }));
  const chosenLine = lineId || lineOptions[0]?.value || "";

  return (
    <Card data-testid="issue-form">
      <CardTitle>{t("dieRoom.issue.title")}</CardTitle>
      {copies.isSuccess && copyOptions.length === 0 ? (
        <EmptyState title={t("dieRoom.issues.noneOnRack")} body={t("dieRoom.issues.noneOnRackBody")} className="py-6" />
      ) : (
        <Can
          do="die.issue"
          fallback={<p className="m-0 text-[14px] leading-6 text-muted-foreground">{t("dieRoom.issues.dieRoomOnly")}</p>}
        >
          <Field label={t("dieRoom.copies.copy")}>
            <Select value={copyId} onValueChange={setCopyId} options={copyOptions} placeholder={t("dieRoom.issues.pickCopy")} />
          </Field>
          <Field label={t("dieRoom.issue.line")}>
            <Select value={chosenLine} onValueChange={setLineId} options={lineOptions} placeholder={t("dieRoom.issues.pickLine")} />
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
                if (!chosenLine) return setError(t("dieRoom.issues.pickLine"));
                setError(null);
                issue.mutate({ dieInstanceId: copyId, pressLineId: chosenLine, ...(note.trim() ? { note: note.trim() } : {}) });
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
      toast.success(t("dieRoom.issues.cancelledToast"));
    },
    onError: (e) => toast.error(refusal(e)),
  });

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
      ) : open.isSuccess && open.data.length === 0 ? (
        <EmptyState title={t("dieRoom.issues.noneOpen")} body={t("dieRoom.issues.noneOpenBody")} />
      ) : (
        <ul className="m-0 flex list-none flex-col gap-3 p-0" data-testid="open-issues">
          {(open.data ?? []).map((i) => (
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
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" loading={giveBack.isPending && giveBack.variables?.id === i.id} onClick={() => giveBack.mutate({ id: i.id })}>
                    {t("dieRoom.issue.return")}
                  </Button>
                  <Button variant="secondary" loading={cancel.isPending && cancel.variables?.id === i.id} onClick={() => cancel.mutate({ id: i.id })}>
                    {t("dieRoom.issue.cancel")}
                  </Button>
                </div>
              </Can>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Read-only check of the owner gate, then (for roles that plan, press, pack or dispatch) a request for an exception. */
function OwnerCheck() {
  const { t } = useT();
  const refresh = useRefreshDieRoom();
  const refusal = useRefusal();
  const [copyId, setCopyId] = useState("");
  const [customerId, setCustomerId] = useState("plant");
  const [purpose, setPurpose] = useState<Purpose>("pack");
  const [note, setNote] = useState("");
  const [asked, setAsked] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const copies = useQuery({ ...trpc.dieInstance.list.queryOptions({ limit: 200 }), meta: INLINE_ERROR_META });
  const customers = useQuery({ ...trpc.customer.list.queryOptions({ limit: 100 }), meta: INLINE_ERROR_META });
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

  const copyOptions = (copies.data?.items ?? [])
    .filter((c) => c.status !== "retired")
    .map((c) => ({ value: c.id, label: c.code }));
  const customerOptions = [
    { value: "plant", label: t("dieRoom.owner.plantStock") },
    ...(customers.data?.items ?? []).map((c) => ({ value: c.id, label: c.name })),
  ];
  const result = check.data;
  const customerName = customerOptions.find((c) => c.value === customerId)?.label ?? "";

  return (
    <Card className="min-w-0 self-start" data-testid="owner-check">
      <CardTitle>{t("dieRoom.owner.checkTitle")}</CardTitle>
      <p className="m-0 text-[14px] leading-6 text-muted-foreground">{t("dieRoom.owner.checkBody")}</p>
      <Field label={t("dieRoom.copies.copy")}>
        <Select
          value={copyId}
          onValueChange={(v) => {
            setCopyId(v);
            setAsked(false);
            setError(null);
          }}
          options={copyOptions}
          placeholder={t("dieRoom.issues.pickCopy")}
        />
      </Field>
      <Field label={t("dieRoom.owner.forParty")}>
        <Select
          value={customerId}
          onValueChange={(v) => {
            setCustomerId(v);
            setAsked(false);
            setError(null);
          }}
          options={customerOptions}
        />
      </Field>
      <div className="flex min-w-0 flex-col gap-1.5">
        <span className="text-[14px] font-semibold">{t("dieRoom.maker.purpose")}</span>
        <SegmentedControl
          label={t("dieRoom.maker.purpose")}
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
    </Card>
  );
}

import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Field, NumberInput, TextInput } from "@orrn/ui/components/field";
import { ResponsiveList, type ResponsiveListColumn } from "@orrn/ui/components/responsive-list";
import { StatusBlock } from "@orrn/ui/components/status-block";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { FieldTextArea } from "@/features/catalog/field-text-area";
import { useCompanyWhen } from "@/features/stock/use-company-when";
import { Can } from "@/shared/components/can";
import { INLINE_ERROR_META, showsQueryError } from "@/shared/lib/query-errors";
import { trpc } from "@/shared/utils/trpc";

import { useDevInvalidate, type DeviceRow, type DeviceSource } from "./hooks";
import { DEVICE_KIND_LIST, DEVICE_PROTOCOL_LIST, heartbeatFrom, isCode, type DeviceKindId, type DeviceProtocolId } from "./model";
import { TokenSheet } from "./token-box";
import { Block, DevFormSheet, DevSelect, HealthChip, SimBadge } from "./ui";

/** Devices enrolled on an edge box with their own tokens, and the collectors that were already connected. */
export function DevicesTab() {
  const { t } = useT();
  const when = useCompanyWhen();
  const q = useQuery({ ...trpc.devices.list.queryOptions(), meta: INLINE_ERROR_META, refetchInterval: 30_000 });
  const [enrolling, setEnrolling] = useState(false);
  const [editing, setEditing] = useState<DeviceRow | null>(null);
  const [rotating, setRotating] = useState<DeviceRow | null>(null);
  const [revoking, setRevoking] = useState<DeviceRow | null>(null);
  // The token of a new or rotated device: held here only until the person says they copied it.
  const [issued, setIssued] = useState<{ code: string; token: string } | null>(null);

  if (showsQueryError(q)) {
    return <EmptyState title={t("dev3.loadFailed")} action={<Button variant="secondary" onClick={() => void q.refetch()}>{t("common.retry")}</Button>} />;
  }
  const data = q.data;
  const c = data?.counts;

  const seen = (at: Date | string | null) => (at ? when(at) : t("dev3.devices.never"));

  const columns: ResponsiveListColumn<DeviceRow>[] = [
    {
      key: "code",
      header: t("dev3.devices.cols.code"),
      cell: (r) => (
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-mono font-semibold whitespace-nowrap">{r.code}</span>
          {r.simulated ? <SimBadge /> : null}
        </span>
      ),
    },
    { key: "label", header: t("dev3.devices.cols.label"), cell: (r) => <span className="break-words">{r.label}</span> },
    { key: "kind", header: t("dev3.devices.cols.kind"), hideOnPhone: true, cell: (r) => t(`dev3.kind.${r.kind}`) },
    { key: "protocol", header: t("dev3.devices.cols.protocol"), hideOnPhone: true, cell: (r) => t(`dev3.protocol.${r.protocol}`) },
    { key: "box", header: t("dev3.devices.cols.box"), hideOnPhone: true, cell: (r) => r.nodeName ?? t("dev3.devices.noBox") },
    {
      key: "health",
      header: t("dev3.devices.cols.health"),
      phoneWide: true,
      cell: (r) => (
        <span className="flex flex-col items-start gap-1">
          <HealthChip health={r.health} />
          {r.revokedAt && r.revokeReason ? <span className="text-[13px] break-words text-muted-foreground">{t("dev3.devices.revokedWhy", { reason: r.revokeReason })}</span> : null}
        </span>
      ),
    },
    { key: "seen", header: t("dev3.devices.cols.seen"), cell: (r) => <span className="text-[14px]">{seen(r.lastSeenAt)}</span> },
    {
      key: "token",
      header: t("dev3.devices.cols.token"),
      hideOnPhone: true,
      cell: (r) => (r.tokenHint && !r.revokedAt ? <span className="font-mono text-[13px] text-muted-foreground">{t("dev3.devices.tokenEnds", { hint: r.tokenHint })}</span> : null),
    },
    {
      key: "act",
      header: t("dev3.devices.cols.actions"),
      headerHidden: true,
      cell: (r) =>
        r.revokedAt ? null : (
          <Can do="device.manage">
            <span className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => setEditing(r)} data-testid={`dev3-edit-${r.code}`}>
                {t("dev3.devices.edit")}
              </Button>
              <Button variant="secondary" onClick={() => setRotating(r)} data-testid={`dev3-rotate-${r.code}`}>
                {t("dev3.devices.rotate")}
              </Button>
              <Button variant="ghost" className="text-tone-red-ink" onClick={() => setRevoking(r)} data-testid={`dev3-revoke-${r.code}`}>
                {t("dev3.devices.revoke")}
              </Button>
            </span>
          </Can>
        ),
    },
  ];

  const sourceColumns: ResponsiveListColumn<DeviceSource>[] = [
    {
      key: "source",
      header: t("dev3.devices.connected.cols.source"),
      cell: (r) => (
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-semibold break-words">{r.label}</span>
          {r.simulated ? <SimBadge /> : null}
        </span>
      ),
    },
    { key: "kind", header: t("dev3.devices.connected.cols.kind"), cell: (r) => t(`dev3.devices.connected.kind.${r.kind}`) },
    { key: "health", header: t("dev3.devices.connected.cols.health"), phoneWide: true, cell: (r) => <HealthChip health={r.health} /> },
    { key: "seen", header: t("dev3.devices.connected.cols.seen"), cell: (r) => <span className="text-[14px]">{seen(r.lastSeenAt)}</span> },
  ];

  return (
    <>
      {c ? (
        <div data-testid="dev3-strip" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <StatusBlock tone="neutral" title={t("dev3.devices.strip.total")} value={c.total} countUp={false} />
          <StatusBlock tone={c.live > 0 ? "green" : "neutral"} title={t("dev3.devices.strip.live")} value={c.live} countUp={false} />
          <StatusBlock tone={c.late > 0 ? "amber" : "neutral"} title={t("dev3.devices.strip.late")} value={c.late} countUp={false} />
          <StatusBlock tone={c.silent > 0 ? "red" : "neutral"} title={t("dev3.devices.strip.silent")} value={c.silent} countUp={false} />
          <StatusBlock tone="neutral" title={t("dev3.devices.strip.never")} value={c.never} countUp={false} />
          <StatusBlock tone="blue" title={t("dev3.devices.strip.simulated")} value={c.simulated} countUp={false} />
        </div>
      ) : null}
      <Block
        id="dev3-devices"
        title={t("dev3.devices.title")}
        hint={t("dev3.devices.hint")}
        actions={
          <Can do="device.manage">
            <Button onClick={() => setEnrolling(true)} aria-haspopup="dialog" data-testid="dev3-enrol-open">
              {t("dev3.devices.enrol")}
            </Button>
          </Can>
        }
      >
        <ResponsiveList rows={data?.devices ?? []} columns={columns} rowKey={(r) => r.id} loading={q.isLoading} label={t("dev3.devices.title")} empty={<EmptyState title={t("dev3.devices.empty")} />} />
      </Block>
      <Block id="dev3-connected" title={t("dev3.devices.connected.title")} hint={t("dev3.devices.connected.hint")}>
        <ResponsiveList
          rows={data?.sources ?? []}
          columns={sourceColumns}
          rowKey={(r) => r.key}
          loading={q.isLoading}
          label={t("dev3.devices.connected.title")}
          empty={<EmptyState title={t("dev3.devices.connected.empty")} />}
        />
      </Block>
      <EnrolSheet open={enrolling} onOpenChange={setEnrolling} onIssued={(code, token) => setIssued({ code, token })} />
      <EditSheet row={editing} onClose={() => setEditing(null)} />
      <RotateSheet row={rotating} onClose={() => setRotating(null)} onIssued={(code, token) => setIssued({ code, token })} />
      <RevokeSheet row={revoking} onClose={() => setRevoking(null)} />
      <TokenSheet code={issued?.code ?? ""} token={issued?.token ?? null} onDone={() => setIssued(null)} />
    </>
  );
}

function EnrolSheet({ open, onOpenChange, onIssued }: { open: boolean; onOpenChange(o: boolean): void; onIssued(code: string, token: string): void }) {
  const { t } = useT();
  const invalidate = useDevInvalidate();
  const [code, setCode] = useState("");
  const [label, setLabel] = useState("");
  const [kind, setKind] = useState<DeviceKindId>("weighbridge");
  const [protocol, setProtocol] = useState<DeviceProtocolId>("file");
  const [box, setBox] = useState("");
  const [simulated, setSimulated] = useState(false);
  const [heartbeat, setHeartbeat] = useState("60");
  const [tried, setTried] = useState(false);
  const nodes = useQuery({ ...trpc.devices.nodes.queryOptions(), enabled: open, retry: false });
  useEffect(() => {
    if (!open) return;
    setCode("");
    setLabel("");
    setKind("weighbridge");
    setProtocol("file");
    setBox("");
    setSimulated(false);
    setHeartbeat("60");
    setTried(false);
  }, [open]);
  const enrol = useMutation(trpc.devices.enrol.mutationOptions());
  const hb = heartbeatFrom(heartbeat);
  return (
    <DevFormSheet
      open={open}
      onOpenChange={(o) => {
        if (!o) enrol.reset();
        onOpenChange(o);
      }}
      title={t("dev3.enrol.title")}
      description={t("dev3.enrol.hint")}
      busy={enrol.isPending}
      error={enrol.error}
      submitLabel={t("dev3.enrol.submit")}
      testId="dev3-enrol-form"
      onSubmit={() => {
        setTried(true);
        if (!isCode(code) || !label.trim() || hb === null) return;
        const typedCode = code.trim().toUpperCase();
        enrol.mutate(
          { code: typedCode, label: label.trim(), kind, protocol, deploymentId: box || null, simulated, heartbeatSec: hb },
          {
            onSuccess: async (res) => {
              const token = res.token;
              // Drop the response from the mutation cache at once: the token is held by the token sheet alone.
              enrol.reset();
              onOpenChange(false);
              onIssued(typedCode, token);
              await invalidate();
            },
          },
        );
      }}
    >
      <Field label={t("dev3.enrol.code")} hint={t("dev3.enrol.codeHint")} error={tried && !isCode(code) ? t("dev3.enrol.codeBad") : undefined}>
        <TextInput value={code} maxLength={24} autoComplete="off" className="font-mono uppercase" onChange={(e) => setCode(e.currentTarget.value)} data-testid="dev3-enrol-code" />
      </Field>
      <Field label={t("dev3.enrol.label")} error={tried && !label.trim() ? t("dev3.required") : undefined}>
        <TextInput value={label} maxLength={60} autoComplete="off" onChange={(e) => setLabel(e.currentTarget.value)} data-testid="dev3-enrol-label" />
      </Field>
      <Field label={t("dev3.enrol.kind")}>
        <DevSelect value={kind} onChange={(e) => setKind(e.currentTarget.value as DeviceKindId)}>
          {DEVICE_KIND_LIST.map((k) => (
            <option key={k} value={k}>
              {t(`dev3.kind.${k}`)}
            </option>
          ))}
        </DevSelect>
      </Field>
      <Field label={t("dev3.enrol.protocol")}>
        <DevSelect
          value={protocol}
          onChange={(e) => {
            const p = e.currentTarget.value as DeviceProtocolId;
            setProtocol(p);
            if (p === "sim") setSimulated(true);
          }}
        >
          {DEVICE_PROTOCOL_LIST.map((p) => (
            <option key={p} value={p}>
              {t(`dev3.protocol.${p}`)}
            </option>
          ))}
        </DevSelect>
      </Field>
      <Field label={t("dev3.enrol.box")}>
        <DevSelect value={box} onChange={(e) => setBox(e.currentTarget.value)}>
          <option value="">{t("dev3.enrol.boxNone")}</option>
          {(nodes.data ?? []).map((n) => (
            <option key={n.id} value={n.id}>
              {n.site ? `${n.name} (${n.site})` : n.name}
            </option>
          ))}
        </DevSelect>
      </Field>
      <label className="flex items-center gap-3 text-[15px]">
        <input type="checkbox" checked={simulated || protocol === "sim"} disabled={protocol === "sim"} onChange={(e) => setSimulated(e.currentTarget.checked)} className="size-5" data-testid="dev3-enrol-sim" />
        <span>{t("dev3.enrol.simulated")}</span>
      </label>
      <Field label={t("dev3.enrol.heartbeat")} hint={t("dev3.enrol.heartbeatHint")} error={tried && hb === null ? t("dev3.enrol.heartbeatBad") : undefined}>
        <NumberInput decimal={false} value={heartbeat} onValueChange={setHeartbeat} />
      </Field>
    </DevFormSheet>
  );
}

function EditSheet({ row, onClose }: { row: DeviceRow | null; onClose(): void }) {
  const { t } = useT();
  const invalidate = useDevInvalidate();
  const [label, setLabel] = useState("");
  const [heartbeat, setHeartbeat] = useState("60");
  const [tried, setTried] = useState(false);
  useEffect(() => {
    setLabel(row?.label ?? "");
    setHeartbeat(String(row?.heartbeatSec ?? 60));
    setTried(false);
  }, [row?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const update = useMutation(
    trpc.devices.update.mutationOptions({
      onSuccess: async () => {
        toast.success(t("dev3.saved"));
        await invalidate();
        onClose();
      },
    }),
  );
  const hb = heartbeatFrom(heartbeat);
  return (
    <DevFormSheet
      open={row !== null}
      onOpenChange={(o) => (o ? undefined : onClose())}
      title={t("dev3.edit.title", { code: row?.code ?? "" })}
      description={t("dev3.edit.hint")}
      busy={update.isPending}
      error={update.error}
      submitLabel={t("dev3.edit.save")}
      testId="dev3-edit-form"
      onSubmit={() => {
        setTried(true);
        if (!row || !label.trim() || hb === null) return;
        update.mutate({ id: row.id, label: label.trim(), heartbeatSec: hb });
      }}
    >
      <Field label={t("dev3.enrol.label")} error={tried && !label.trim() ? t("dev3.required") : undefined}>
        <TextInput value={label} maxLength={60} autoComplete="off" onChange={(e) => setLabel(e.currentTarget.value)} />
      </Field>
      <Field label={t("dev3.enrol.heartbeat")} hint={t("dev3.enrol.heartbeatHint")} error={tried && hb === null ? t("dev3.enrol.heartbeatBad") : undefined}>
        <NumberInput decimal={false} value={heartbeat} onValueChange={setHeartbeat} />
      </Field>
    </DevFormSheet>
  );
}

function RotateSheet({ row, onClose, onIssued }: { row: DeviceRow | null; onClose(): void; onIssued(code: string, token: string): void }) {
  const { t } = useT();
  const invalidate = useDevInvalidate();
  const rotate = useMutation(trpc.devices.rotateToken.mutationOptions());
  return (
    <DevFormSheet
      open={row !== null}
      onOpenChange={(o) => {
        if (!o) {
          rotate.reset();
          onClose();
        }
      }}
      title={t("dev3.rotate.title", { code: row?.code ?? "" })}
      description={t("dev3.rotate.body")}
      busy={rotate.isPending}
      error={rotate.error}
      submitLabel={t("dev3.rotate.confirm")}
      testId="dev3-rotate-form"
      onSubmit={() => {
        if (!row) return;
        const code = row.code;
        rotate.mutate(
          { id: row.id },
          {
            onSuccess: async (res) => {
              const token = res.token;
              rotate.reset();
              onClose();
              onIssued(code, token);
              await invalidate();
            },
          },
        );
      }}
    >
      <p className="m-0 text-[15px]">{t("dev3.rotate.body")}</p>
    </DevFormSheet>
  );
}

function RevokeSheet({ row, onClose }: { row: DeviceRow | null; onClose(): void }) {
  const { t } = useT();
  const invalidate = useDevInvalidate();
  const [reason, setReason] = useState("");
  const [tried, setTried] = useState(false);
  useEffect(() => {
    setReason("");
    setTried(false);
  }, [row?.id]);
  const revoke = useMutation(
    trpc.devices.revoke.mutationOptions({
      onSuccess: async () => {
        toast.success(t("dev3.revoke.done"));
        await invalidate();
        onClose();
      },
    }),
  );
  const bad = reason.trim().length < 3;
  return (
    <DevFormSheet
      open={row !== null}
      onOpenChange={(o) => (o ? undefined : onClose())}
      title={t("dev3.revoke.title", { code: row?.code ?? "" })}
      description={t("dev3.revoke.body")}
      busy={revoke.isPending}
      error={revoke.error}
      submitLabel={t("dev3.revoke.confirm")}
      testId="dev3-revoke-form"
      onSubmit={() => {
        setTried(true);
        if (!row || bad) return;
        revoke.mutate({ id: row.id, reason: reason.trim() });
      }}
    >
      <Field label={t("dev3.revoke.reason")} hint={t("dev3.revoke.reasonHint")} error={tried && bad ? t("dev3.required") : undefined}>
        <FieldTextArea value={reason} maxLength={300} onChange={(e) => setReason(e.currentTarget.value)} data-testid="dev3-revoke-reason" />
      </Field>
    </DevFormSheet>
  );
}

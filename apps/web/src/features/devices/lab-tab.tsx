import { isModuleOn } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Field, TextInput } from "@orrn/ui/components/field";
import { UiLink } from "@orrn/ui/components/link";
import { ResponsiveList, type ResponsiveListColumn } from "@orrn/ui/components/responsive-list";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { FieldTextArea } from "@/features/catalog/field-text-area";
import { useCompanyWhen } from "@/features/stock/use-company-when";
import { Can } from "@/shared/components/can";
import { useMe } from "@/shared/lib/me";
import { INLINE_ERROR_META, showsQueryError } from "@/shared/lib/query-errors";
import { trpc } from "@/shared/utils/trpc";

import { useDevInvalidate, type DeviceReading, type LabInbox } from "./hooks";
import { labValues } from "./model";
import { Block, DevFormSheet, SimBadge } from "./ui";

type Spectro = LabInbox["spectro"][number];

/**
 * Scanner and tensile readings that are on no check yet: attach each to a run, bundle or batch number, or set it aside
 * (both are `qa.check`). Spectro files only wait here: a person attaches them to a cast in the spectro inbox.
 */
export function LabTab() {
  const { t } = useT();
  const when = useCompanyWhen();
  const q = useQuery({ ...trpc.devices.lab.inbox.queryOptions({ limit: 100 }), meta: INLINE_ERROR_META });
  const [attaching, setAttaching] = useState<DeviceReading | null>(null);
  const [aside, setAside] = useState<DeviceReading | null>(null);
  const { data: me } = useMe();
  // Attaching writes a QA check, so Attach needs the quality module too (the server refuses without it).
  const qaOn = isModuleOn((me?.company?.modules ?? []).map((m) => m.toLowerCase()), "qa");

  const columns: ResponsiveListColumn<DeviceReading>[] = [
    {
      key: "when",
      header: t("dev3.lab.cols.when"),
      cell: (r) => (
        <span className="flex flex-wrap items-center gap-2 text-[14px]">
          <span>{when(r.sampledAt)}</span>
          {r.simulated ? <SimBadge /> : null}
        </span>
      ),
    },
    { key: "kind", header: t("dev3.lab.cols.kind"), cell: (r) => t(`dev3.lab.kind.${r.kind as "dimension" | "mechanical"}`) },
    { key: "sample", header: t("dev3.lab.cols.sample"), cell: (r) => (r.sampleCode ? <span className="font-mono whitespace-nowrap">{r.sampleCode}</span> : <span className="text-muted-foreground">{t("dev3.lab.noSample")}</span>) },
    {
      key: "result",
      header: t("dev3.lab.cols.result"),
      hideOnPhone: true,
      cell: (r) => {
        const v = labValues(r.kind, r.values);
        return <span className="text-[14px] break-words">{v.points !== null ? t("dev3.readings.points", { count: v.points }) : t("dev3.readings.tensile", { tensile: v.tensile, yield: v.yield, elong: v.elong })}</span>;
      },
    },
    {
      key: "act",
      header: t("dev3.lab.cols.actions"),
      headerHidden: true,
      cell: (r) => (
        <Can do="qa.check">
          <span className="flex flex-wrap gap-2">
            {qaOn ? (
              <Button variant="secondary" onClick={() => setAttaching(r)} data-testid={`dev3-attach-${r.id}`}>
                {t("dev3.lab.attach")}
              </Button>
            ) : null}
            <Button variant="ghost" onClick={() => setAside(r)} data-testid={`dev3-aside-${r.id}`}>
              {t("dev3.lab.setAside")}
            </Button>
          </span>
        </Can>
      ),
    },
  ];

  const spectroColumns: ResponsiveListColumn<Spectro>[] = [
    {
      key: "file",
      header: t("dev3.lab.spectro.file"),
      cell: (r) => (
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-semibold break-all">{r.fileName}</span>
          {r.simulated ? <SimBadge /> : null}
        </span>
      ),
    },
    { key: "sample", header: t("dev3.lab.spectro.sample"), cell: (r) => (r.sampleRef ? <span className="font-mono">{r.sampleRef}</span> : null) },
    { key: "added", header: t("dev3.lab.spectro.added"), cell: (r) => <span className="text-[14px]">{when(r.createdAt)}</span> },
  ];

  return (
    <>
      <Block id="dev3-lab" title={t("dev3.lab.title")} hint={t("dev3.lab.hint")}>
        {showsQueryError(q) ? (
          <EmptyState title={t("dev3.loadFailed")} action={<Button variant="secondary" onClick={() => void q.refetch()}>{t("common.retry")}</Button>} />
        ) : (
          <ResponsiveList rows={q.data?.items ?? []} columns={columns} rowKey={(r) => r.id} loading={q.isLoading} label={t("dev3.lab.title")} empty={<EmptyState title={t("dev3.lab.empty")} />} />
        )}
      </Block>
      <Block
        id="dev3-spectro"
        title={t("dev3.lab.spectro.title")}
        hint={t("dev3.lab.spectro.hint")}
        actions={
          <UiLink to="/casts/inbox" className="text-[14px] font-semibold underline underline-offset-4" data-testid="dev3-spectro-open">
            {t("dev3.lab.spectro.open")}
          </UiLink>
        }
      >
        <ResponsiveList rows={q.data?.spectro ?? []} columns={spectroColumns} rowKey={(r) => r.id} loading={q.isLoading} label={t("dev3.lab.spectro.title")} empty={<EmptyState title={t("dev3.lab.spectro.empty")} />} />
      </Block>
      <AttachSheet row={attaching} onClose={() => setAttaching(null)} />
      <AsideSheet row={aside} onClose={() => setAside(null)} />
    </>
  );
}

function AttachSheet({ row, onClose }: { row: DeviceReading | null; onClose(): void }) {
  const { t } = useT();
  const invalidate = useDevInvalidate();
  const [code, setCode] = useState("");
  const [tried, setTried] = useState(false);
  useEffect(() => {
    setCode(row?.sampleCode ?? "");
    setTried(false);
  }, [row?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const attach = useMutation(
    trpc.devices.lab.attach.mutationOptions({
      onSuccess: async () => {
        toast.success(t("dev3.lab.attached"));
        await invalidate();
        onClose();
      },
    }),
  );
  return (
    <DevFormSheet
      open={row !== null}
      onOpenChange={(o) => (o ? undefined : onClose())}
      title={t("dev3.lab.attachTitle")}
      description={t("dev3.lab.attachHint")}
      busy={attach.isPending}
      error={attach.error}
      submitLabel={t("dev3.lab.attach")}
      testId="dev3-attach-form"
      onSubmit={() => {
        setTried(true);
        if (!row || !code.trim()) return;
        attach.mutate({ readingId: row.id, code: code.trim() });
      }}
    >
      <Field label={t("dev3.lab.code")} error={tried && !code.trim() ? t("dev3.required") : undefined}>
        <TextInput value={code} maxLength={40} autoComplete="off" className="font-mono" onChange={(e) => setCode(e.currentTarget.value)} data-testid="dev3-attach-code" />
      </Field>
    </DevFormSheet>
  );
}

function AsideSheet({ row, onClose }: { row: DeviceReading | null; onClose(): void }) {
  const { t } = useT();
  const invalidate = useDevInvalidate();
  const [reason, setReason] = useState("");
  const [tried, setTried] = useState(false);
  useEffect(() => {
    setReason("");
    setTried(false);
  }, [row?.id]);
  const aside = useMutation(
    trpc.devices.lab.setAside.mutationOptions({
      onSuccess: async () => {
        toast.success(t("dev3.lab.asideDone"));
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
      title={t("dev3.lab.asideTitle")}
      description={t("dev3.lab.asideHint")}
      busy={aside.isPending}
      error={aside.error}
      submitLabel={t("dev3.lab.setAside")}
      testId="dev3-aside-form"
      onSubmit={() => {
        setTried(true);
        if (!row || bad) return;
        aside.mutate({ readingId: row.id, reason: reason.trim() });
      }}
    >
      <Field label={t("dev3.lab.reason")} hint={t("dev3.lab.reasonHint")} error={tried && bad ? t("dev3.required") : undefined}>
        <FieldTextArea value={reason} maxLength={300} onChange={(e) => setReason(e.currentTarget.value)} data-testid="dev3-aside-reason" />
      </Field>
    </DevFormSheet>
  );
}

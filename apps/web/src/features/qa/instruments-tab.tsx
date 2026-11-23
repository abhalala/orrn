import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Field, NumberInput, TextInput } from "@orrn/ui/components/field";
import { ResponsiveList, type ResponsiveListColumn } from "@orrn/ui/components/responsive-list";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Can } from "@/shared/components/can";
import { useFmt } from "@/shared/lib/fmt";
import { dayText } from "@/shared/lib/fmt-text";
import { INLINE_ERROR_META, showsQueryError } from "@/shared/lib/query-errors";
import { trpc, trpcClient } from "@/shared/utils/trpc";

import { useQaInvalidate, useQaRefusal, type QaInstrumentRow } from "./hooks";
import { optional, wholeFrom } from "./model";
import { Block, CalibrationChip, QaFormSheet } from "./ui";

/** Step 1 to 3 of a certificate upload: the server signs a PUT, the browser sends the bytes, the server records it. */
export async function uploadCertificate(instrumentId: string, file: File) {
  const begin = await trpcClient.qa.instruments.beginCertificate.mutate({ id: instrumentId, name: file.name, size: file.size, mime: file.type });
  const put = await fetch(begin.uploadUrl, { method: begin.method, headers: begin.headers, body: file });
  if (!put.ok) throw new Error(`upload failed (${put.status})`);
  return trpcClient.qa.instruments.commitCertificate.mutate({ id: instrumentId, uploadId: begin.uploadId });
}

/**
 * Row 38: gauges and instruments with last and next calibration, the overdue flag and the certificate
 * (stored where die files are). Adding and editing need `qa.masters`; a calibration and its certificate
 * need `qa.check`.
 */
export function InstrumentsTab() {
  const { t } = useT();
  const fmt = useFmt();
  const say = useQaRefusal();
  const invalidate = useQaInvalidate();
  const list = useQuery({ ...trpc.qa.instruments.list.queryOptions({ includeInactive: true }), meta: INLINE_ERROR_META });
  const [editing, setEditing] = useState<{ open: boolean; row?: QaInstrumentRow }>({ open: false });
  const [calibrating, setCalibrating] = useState<QaInstrumentRow | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  const fileFor = useRef<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const openCertificate = async (id: string) => {
    try {
      const { url } = await trpcClient.qa.instruments.certificateUrl.query({ id });
      window.open(url, "_blank", "noopener");
    } catch (e) {
      toast.error(say(e));
    }
  };

  const onFile = async (file: File | undefined) => {
    const id = fileFor.current;
    if (!file || !id) return;
    setUploading(id);
    try {
      await uploadCertificate(id, file);
      toast.success(t("qa.instruments.uploaded"));
      await invalidate();
    } catch (e) {
      toast.error(e instanceof Error && e.message.startsWith("upload failed") ? t("qa.instruments.uploadFailed") : say(e));
    } finally {
      setUploading(null);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const columns: ResponsiveListColumn<QaInstrumentRow>[] = [
    {
      key: "code",
      header: t("qa.instruments.code"),
      cell: (r) => (
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="font-mono whitespace-nowrap font-semibold">{r.code}</span>
          <span className="text-[13px] text-muted-foreground">{[r.name, r.rangeText].filter(Boolean).join(", ")}</span>
        </span>
      ),
    },
    { key: "place", header: t("qa.instruments.place"), hideOnPhone: true, cell: (r) => r.place ?? "-" },
    { key: "last", header: t("qa.instruments.last"), cell: (r) => (r.lastCalibratedOn ? dayText(fmt, r.lastCalibratedOn) : "-") },
    { key: "next", header: t("qa.instruments.next"), cell: (r) => (r.nextDueOn ? dayText(fmt, r.nextDueOn) : "-") },
    { key: "status", header: t("qa.instruments.status"), phoneWide: true, cell: (r) => <CalibrationChip state={r.state} /> },
    {
      key: "act",
      header: t("qa.instruments.calibrate"),
      headerHidden: true,
      cell: (r) => (
        <span className="flex flex-wrap gap-2">
          <Can do="qa.check">
            <Button variant="secondary" onClick={() => setCalibrating(r)} data-testid={`qa-calibrate-${r.code}`}>
              {t("qa.instruments.calibrate")}
            </Button>
            <Button
              variant="ghost"
              loading={uploading === r.id}
              onClick={() => {
                fileFor.current = r.id;
                fileInput.current?.click();
              }}
            >
              {t("qa.instruments.upload")}
            </Button>
          </Can>
          {r.hasCertificate ? (
            <Button variant="ghost" onClick={() => void openCertificate(r.id)} data-testid={`qa-certificate-${r.code}`}>
              {t("qa.instruments.view")}
            </Button>
          ) : null}
          <Can do="qa.masters">
            <Button variant="ghost" onClick={() => setEditing({ open: true, row: r })}>
              {t("qa.instruments.edit")}
            </Button>
          </Can>
        </span>
      ),
    },
  ];

  return (
    <Block
      id="qa-instruments"
      title={t("qa.tabs.instruments")}
      actions={
        <Can do="qa.masters">
          <Button onClick={() => setEditing({ open: true })} aria-haspopup="dialog" data-testid="qa-add-instrument">
            <Plus aria-hidden="true" strokeWidth={2} />
            {t("qa.instruments.add")}
          </Button>
        </Can>
      }
    >
      <input ref={fileInput} type="file" accept="application/pdf,image/*" className="hidden" aria-hidden="true" tabIndex={-1} onChange={(e) => void onFile(e.currentTarget.files?.[0])} />
      {showsQueryError(list) ? (
        <EmptyState title={t("qa.loadFailed")} action={<Button variant="secondary" onClick={() => void list.refetch()}>{t("common.retry")}</Button>} />
      ) : (
        <ResponsiveList rows={list.data?.items ?? []} columns={columns} rowKey={(r) => r.id} loading={list.isLoading} label={t("qa.tabs.instruments")} empty={<EmptyState title={t("qa.instruments.empty")} />} />
      )}
      <InstrumentSheet open={editing.open} row={editing.row} onOpenChange={(open) => setEditing((s) => ({ ...s, open }))} />
      <CalibrateSheet row={calibrating} today={list.data?.today ?? ""} onClose={() => setCalibrating(null)} />
    </Block>
  );
}

function InstrumentSheet({ open, row, onOpenChange }: { open: boolean; row?: QaInstrumentRow; onOpenChange(o: boolean): void }) {
  const { t } = useT();
  const invalidate = useQaInvalidate();
  const [f, setF] = useState({ code: "", name: "", range: "", place: "", interval: "", note: "", active: true });
  const [tried, setTried] = useState(false);
  useEffect(() => {
    if (!open) return;
    setF({ code: row?.code ?? "", name: row?.name ?? "", range: row?.rangeText ?? "", place: row?.place ?? "", interval: row?.intervalDays ? String(row.intervalDays) : "", note: row?.note ?? "", active: row?.active ?? true });
    setTried(false);
  }, [open, row?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = useMutation(
    trpc.qa.instruments.save.mutationOptions({
      onSuccess: async () => {
        toast.success(t("qa.saved"));
        await invalidate();
        onOpenChange(false);
      },
    }),
  );
  const interval = optional(f.interval, wholeFrom);
  const set = (k: keyof typeof f) => (v: string) => setF((s) => ({ ...s, [k]: v }));
  return (
    <QaFormSheet
      open={open}
      onOpenChange={onOpenChange}
      title={row ? t("qa.instruments.editTitle", { code: row.code }) : t("qa.instruments.add")}
      busy={save.isPending}
      error={save.error}
      submitLabel={t("common.save")}
      testId="qa-instrument-form"
      onSubmit={() => {
        setTried(true);
        if (!f.code.trim() || !f.name.trim() || interval.bad || (interval.value !== null && interval.value < 1)) return;
        save.mutate({
          ...(row ? { id: row.id } : {}),
          code: f.code.trim(),
          name: f.name.trim(),
          rangeText: f.range.trim() || null,
          place: f.place.trim() || null,
          intervalDays: interval.value,
          active: f.active,
          note: f.note.trim() || null,
        });
      }}
    >
      {tried && (!f.code.trim() || !f.name.trim()) ? (
        <p role="alert" className="m-0 text-[14px] font-medium text-tone-red-ink">
          {t("qa.instruments.invalid")}
        </p>
      ) : null}
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("qa.instruments.code")}>
          <TextInput value={f.code} maxLength={24} autoComplete="off" className="font-mono" onChange={(e) => set("code")(e.currentTarget.value)} data-testid="qa-instrument-code" />
        </Field>
        <Field label={t("qa.instruments.name")}>
          <TextInput value={f.name} maxLength={80} onChange={(e) => set("name")(e.currentTarget.value)} data-testid="qa-instrument-name" />
        </Field>
        <Field label={t("qa.instruments.range")}>
          <TextInput value={f.range} maxLength={60} onChange={(e) => set("range")(e.currentTarget.value)} />
        </Field>
        <Field label={t("qa.instruments.place")}>
          <TextInput value={f.place} maxLength={60} onChange={(e) => set("place")(e.currentTarget.value)} />
        </Field>
      </div>
      <Field label={t("qa.instruments.interval")}>
        <NumberInput decimal={false} value={f.interval} onValueChange={set("interval")} data-testid="qa-instrument-interval" />
      </Field>
      <Field label={t("qa.instruments.note")}>
        <TextInput value={f.note} maxLength={300} onChange={(e) => set("note")(e.currentTarget.value)} />
      </Field>
      {row ? (
        <div>
          <Button variant="secondary" onClick={() => setF((s) => ({ ...s, active: !s.active }))}>
            {f.active ? t("qa.instruments.retire") : t("qa.instruments.reactivate")}
          </Button>
        </div>
      ) : null}
    </QaFormSheet>
  );
}

function CalibrateSheet({ row, today, onClose }: { row: QaInstrumentRow | null; today: string; onClose(): void }) {
  const { t } = useT();
  const invalidate = useQaInvalidate();
  const [on, setOn] = useState("");
  const [interval, setInterval] = useState("");
  const [note, setNote] = useState("");
  useEffect(() => {
    setOn(today);
    setInterval(row?.intervalDays ? String(row.intervalDays) : "");
    setNote("");
  }, [row?.id, today]);
  const calibrate = useMutation(
    trpc.qa.instruments.calibrate.mutationOptions({
      onSuccess: async () => {
        toast.success(t("qa.saved"));
        await invalidate();
        onClose();
      },
    }),
  );
  const days = optional(interval, wholeFrom);
  return (
    <QaFormSheet
      open={row !== null}
      onOpenChange={(o) => (o ? undefined : onClose())}
      title={t("qa.instruments.calibrateTitle", { code: row?.code ?? "" })}
      busy={calibrate.isPending}
      error={calibrate.error}
      submitLabel={t("qa.instruments.calibrate")}
      testId="qa-calibrate-form"
      onSubmit={() => {
        if (!row || !/^\d{4}-\d{2}-\d{2}$/.test(on) || days.bad || (days.value !== null && days.value < 1)) return;
        calibrate.mutate({ id: row.id, calibratedOn: on, intervalDays: days.value, ...(note.trim() ? { note: note.trim() } : {}) });
      }}
    >
      <Field label={t("qa.instruments.calibratedOn")}>
        <TextInput type="date" value={on} max={today || undefined} onChange={(e) => setOn(e.currentTarget.value)} data-testid="qa-calibrated-on" />
      </Field>
      <Field label={t("qa.instruments.interval")}>
        <NumberInput decimal={false} value={interval} onValueChange={setInterval} />
      </Field>
      <Field label={t("qa.instruments.note")}>
        <TextInput value={note} maxLength={300} onChange={(e) => setNote(e.currentTarget.value)} />
      </Field>
    </QaFormSheet>
  );
}

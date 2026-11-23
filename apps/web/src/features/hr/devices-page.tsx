/** `/hr/devices`: biometric devices (column map, push token) and the punch file import with a preview first. */
import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Checkbox } from "@orrn/ui/components/checkbox";
import { Chip } from "@orrn/ui/components/chip";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Field, NumberInput, TextInput } from "@orrn/ui/components/field";
import { PageHeader } from "@orrn/ui/components/page-header";
import { Sheet } from "@orrn/ui/components/sheet";
import { Skeleton } from "@orrn/ui/components/skeleton";
import type { PunchColumnMap } from "@orrn/domain";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Can } from "@/shared/components/can";
import { useFmt } from "@/shared/lib/fmt";
import { whenText } from "@/shared/lib/fmt-text";
import { trpc, trpcClient } from "@/shared/utils/trpc";

import { fileHead, formFromMap, guessDelimiter, mapFromForm, MAX_PUNCH_TEXT, type MapForm, type MapProblem } from "./model";
import { HrGate, HrTabs, LoadError, Pick, Section, errorText, useCan } from "./ui";

export function DevicesPage() {
  const { t } = useT();
  const fmt = useFmt();
  const canManage = useCan("hr.manage");
  const list = useQuery(trpc.hr.devices.list.queryOptions());
  type Device = NonNullable<typeof list.data>[number];
  const [editing, setEditing] = useState<Device | "new" | null>(null);
  const [tokenFor, setTokenFor] = useState<{ name: string; token: string; path: string } | null>(null);
  const qc = useQueryClient();
  const newToken = useMutation({
    ...trpc.hr.devices.newToken.mutationOptions(),
    onSuccess: async (r, vars) => {
      const name = list.data?.find((d) => d.id === vars.id)?.name ?? "";
      setTokenFor({ name, token: r.token, path: r.path });
      await qc.invalidateQueries({ queryKey: trpc.hr.devices.pathKey() });
    },
    onError: (e) => toast.error(errorText(e, t("hr.saveFailed"))),
  });

  return (
    <HrGate needs={["hr.view", "attendance.manage"]}>
      <PageHeader
        title={t("hr.devices.title")}
        subtitle={t("hr.devices.subtitle")}
        back={{ to: "/hr", label: t("hr.title") }}
        actions={
          <Can do="hr.manage">
            <Button className="max-md:h-14 max-md:w-full max-md:text-[17px]" onClick={() => setEditing("new")}>
              {t("hr.devices.add")}
            </Button>
          </Can>
        }
      />
      <HrTabs current="devices" />
      {list.isPending ? <Skeleton className="h-32 w-full rounded-card" /> : null}
      {list.isError ? <LoadError onRetry={() => void list.refetch()} /> : null}
      {list.data && list.data.length === 0 ? <EmptyState title={t("hr.devices.empty")} /> : null}
      <ul className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2 lg:grid-cols-3">
        {(list.data ?? []).map((d) => (
          <li key={d.id} className="flex flex-col gap-2 rounded-card border border-border bg-card p-3">
            <p className="m-0 flex items-start justify-between gap-2 text-[15px] font-semibold">
              <span className="min-w-0">
                {d.name}
                {d.make ? <span className="block text-xs font-normal text-muted-foreground">{d.make}</span> : null}
              </span>
              <Chip tone={d.active ? "green" : "neutral"} truncate={false}>
                {d.active ? t("hr.devices.active") : t("hr.devices.off")}
              </Chip>
            </p>
            <p className="m-0 text-[13px] text-muted-foreground">
              {d.columnMap ? t("hr.devices.mapped") : t("hr.devices.notMapped")} · {d.pushSet ? t("hr.devices.pushSet") : t("hr.devices.pushNone")}
            </p>
            <p className="m-0 text-xs text-muted-foreground">{d.lastPushAt ? t("hr.devices.lastPunch", { when: whenText(fmt, d.lastPushAt) }) : t("hr.devices.noPunch")}</p>
            {canManage ? (
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" size="sm" onClick={() => setEditing(d)}>
                  {t("hr.devices.edit")}
                </Button>
                <Button variant="secondary" size="sm" loading={newToken.isPending && newToken.variables?.id === d.id} onClick={() => newToken.mutate({ id: d.id })}>
                  {t("hr.devices.newToken")}
                </Button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>

      <ImportSection devices={list.data ?? []} />
      <DeviceSheet device={editing === "new" ? null : editing} open={editing !== null} onOpenChange={(o) => !o && setEditing(null)} />
      <TokenSheet info={tokenFor} onClose={() => setTokenFor(null)} />
    </HrGate>
  );
}

function TokenSheet({ info, onClose }: { info: { name: string; token: string; path: string } | null; onClose: () => void }) {
  const { t } = useT();
  const [copied, setCopied] = useState(false);
  useEffect(() => setCopied(false), [info]);
  return (
    <Sheet
      open={info !== null}
      onOpenChange={(o) => !o && onClose()}
      title={t("hr.devices.tokenTitle", { name: info?.name ?? "" })}
      description={t("hr.devices.tokenHint")}
      footer={<Button onClick={onClose}>{t("hr.devices.tokenDone")}</Button>}
    >
      {info ? (
        <div className="flex flex-col gap-4">
          <p role="alert" className="m-0 rounded-card border border-border bg-surface-sunken p-3 text-[14px] font-semibold">
            {t("hr.devices.tokenOnce")}
          </p>
          <Field label={t("hr.devices.token")}>
            <TextInput readOnly value={info.token} className="font-mono" onFocus={(e) => e.currentTarget.select()} />
          </Field>
          <div>
            <Button
              variant="secondary"
              onClick={() => {
                void navigator.clipboard?.writeText(info.token).then(() => setCopied(true));
              }}
            >
              {copied ? t("hr.devices.copied") : t("hr.devices.copy")}
            </Button>
          </div>
          <Field label={t("hr.devices.pushPath")} hint={t("hr.devices.pushPathHint")}>
            <TextInput readOnly value={info.path} className="font-mono" />
          </Field>
          <pre className="m-0 overflow-x-auto rounded-card border border-border bg-surface-sunken p-3 text-xs">{`Authorization: Bearer ${info.token.slice(0, 8)}...\n{ "punches": [{ "code": "101", "at": "2026-11-03T07:52:10+05:30" }] }`}</pre>
        </div>
      ) : null}
    </Sheet>
  );
}

const DELIMS = [
  { value: ",", key: "comma" },
  { value: "\t", key: "tab" },
  { value: ";", key: "semicolon" },
  { value: "|", key: "bar" },
] as const;

type DeviceRow = { id: string; name: string; make: string | null; columnMap: PunchColumnMap | null; active: boolean };

function DeviceSheet({ device, open, onOpenChange }: { device: DeviceRow | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useT();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [make, setMake] = useState("");
  const [active, setActive] = useState(true);
  const [useMap, setUseMap] = useState(true);
  const [map, setMap] = useState<MapForm>(() => formFromMap(null));
  const [tried, setTried] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(device?.name ?? "");
    setMake(device?.make ?? "");
    setActive(device?.active ?? true);
    setUseMap(true);
    setMap(formFromMap(device?.columnMap ?? null));
    setTried(false);
  }, [open, device]);

  const save = useMutation({
    ...trpc.hr.devices.save.mutationOptions(),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: trpc.hr.devices.pathKey() });
      toast.success(t("hr.devices.saved"));
      onOpenChange(false);
    },
    onError: (e) => toast.error(errorText(e, t("hr.saveFailed"))),
  });

  const mapped = mapFromForm(map);
  const problems = new Set<MapProblem>(mapped.ok ? [] : mapped.problems);
  const nameOk = name.trim().length > 0;
  const setM = <K extends keyof MapForm>(k: K, v: MapForm[K]) => setMap((p) => ({ ...p, [k]: v }));
  const colErr = (p: MapProblem) => (tried && useMap && problems.has(p) ? t("hr.devices.colBad") : undefined);

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={device ? t("hr.devices.editTitle") : t("hr.devices.addTitle")}
      description={t("hr.devices.mapHint")}
      dismissible={!save.isPending}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button
            loading={save.isPending}
            onClick={() => {
              setTried(true);
              if (!nameOk || (useMap && !mapped.ok)) return;
              save.mutate({ id: device?.id, name: name.trim(), make: make.trim() || null, columnMap: useMap && mapped.ok ? mapped.value : null, active });
            }}
          >
            {t("hr.devices.save")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label={t("hr.devices.name")} required error={tried && !nameOk ? t("hr.devices.nameBad") : undefined}>
          <TextInput value={name} onChangeText={setName} maxLength={60} />
        </Field>
        <Field label={t("hr.devices.make")}>
          <TextInput value={make} onChangeText={setMake} maxLength={60} />
        </Field>
        <div className="flex min-h-11 items-center gap-3">
          <Checkbox id="dev-active" checked={active} onCheckedChange={(v) => setActive(v === true)} />
          <label htmlFor="dev-active" className="text-[14px]">
            {t("hr.devices.activeLabel")}
          </label>
        </div>
        <div className="flex min-h-11 items-center gap-3">
          <Checkbox id="dev-map" checked={useMap} onCheckedChange={(v) => setUseMap(v === true)} />
          <label htmlFor="dev-map" className="text-[14px]">
            {t("hr.devices.useMap")}
          </label>
        </div>
        {useMap ? (
          <fieldset className="m-0 flex min-w-0 flex-col gap-4 rounded-card border border-border p-3">
            <legend className="px-1 text-[14px] font-semibold">{t("hr.devices.mapTitle")}</legend>
            <p className="m-0 text-[13px] text-muted-foreground">{t("hr.devices.colsFrom1")}</p>
            <Field label={t("hr.devices.codeCol")} hint={t("hr.devices.codeColHint")} error={colErr("code")}>
              <NumberInput value={map.code} onValueChange={(v) => setM("code", v)} decimal={false} />
            </Field>
            <Field label={t("hr.devices.timeMode")}>
              <Pick
                value={map.mode}
                onChange={(v) => setM("mode", v as MapForm["mode"])}
                options={[
                  { value: "one", label: t("hr.devices.modeOne") },
                  { value: "two", label: t("hr.devices.modeTwo") },
                ]}
              />
            </Field>
            {map.mode === "one" ? (
              <Field label={t("hr.devices.dateTimeCol")} error={colErr("dateTime")}>
                <NumberInput value={map.dateTime} onValueChange={(v) => setM("dateTime", v)} decimal={false} />
              </Field>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <Field label={t("hr.devices.dateCol")} error={colErr("date")}>
                  <NumberInput value={map.date} onValueChange={(v) => setM("date", v)} decimal={false} />
                </Field>
                <Field label={t("hr.devices.timeCol")} error={colErr("time")}>
                  <NumberInput value={map.time} onValueChange={(v) => setM("time", v)} decimal={false} />
                </Field>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <Field label={t("hr.devices.dateOrder")}>
                <Pick
                  value={map.dateOrder}
                  onChange={(v) => setM("dateOrder", v as MapForm["dateOrder"])}
                  options={[
                    { value: "ymd", label: t("hr.devices.orderYmd") },
                    { value: "dmy", label: t("hr.devices.orderDmy") },
                  ]}
                />
              </Field>
              <Field label={t("hr.devices.delimiter")}>
                <Pick value={map.delimiter} onChange={(v) => setM("delimiter", v as MapForm["delimiter"])} options={DELIMS.map((d) => ({ value: d.value, label: t(`hr.devices.delim.${d.key}`) }))} />
              </Field>
            </div>
            <div className="flex min-h-11 items-center gap-3">
              <Checkbox id="dev-header" checked={map.hasHeader} onCheckedChange={(v) => setM("hasHeader", v === true)} />
              <label htmlFor="dev-header" className="text-[14px]">
                {t("hr.devices.hasHeader")}
              </label>
            </div>
          </fieldset>
        ) : null}
      </div>
    </Sheet>
  );
}

type Preview = Awaited<ReturnType<typeof trpcClient.hr.punches.preview.query>>;

function ImportSection({ devices }: { devices: { id: string; name: string; columnMap: PunchColumnMap | null; active: boolean }[] }) {
  const { t } = useT();
  const qc = useQueryClient();
  const canImport = useCan("attendance.manage");
  const [deviceId, setDeviceId] = useState("");
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const chosen = devices.find((d) => d.id === deviceId) ?? null;
  const tooBig = text.length > MAX_PUNCH_TEXT;

  const commit = useMutation({
    ...trpc.hr.punches.commit.mutationOptions(),
    onSuccess: async (r) => {
      await qc.invalidateQueries({ queryKey: trpc.hr.pathKey() });
      toast.success(t("hr.import.done", { inserted: r.inserted, duplicates: r.duplicates, days: r.daysWritten }));
      setText("");
      setFileName("");
      setPreview(null);
    },
    onError: (e) => toast.error(errorText(e, t("hr.saveFailed"))),
  });

  async function runPreview() {
    if (!chosen || !text.trim() || tooBig) return;
    setBusy(true);
    try {
      setPreview(await trpcClient.hr.punches.preview.query({ deviceId: chosen.id, text }));
    } catch (e) {
      setPreview(null);
      toast.error(errorText(e, t("hr.import.previewFailed")));
    } finally {
      setBusy(false);
    }
  }

  if (!canImport) return null;
  return (
    <Section id="hr-import" title={t("hr.import.title")} hint={t("hr.import.hint")}>
      <div className="grid gap-3 lg:grid-cols-2">
        <Field label={t("hr.import.device")}>
          <Pick
            value={deviceId}
            onChange={(v) => {
              setDeviceId(v);
              setPreview(null);
            }}
            options={[{ value: "", label: t("hr.import.devicePick") }, ...devices.filter((d) => d.active).map((d) => ({ value: d.id, label: d.name }))]}
          />
        </Field>
        <Field label={t("hr.import.file")} hint={fileName || t("hr.import.fileHint")}>
          <input
            ref={input}
            type="file"
            accept=".csv,.txt,text/csv,text/plain"
            aria-label={t("hr.import.file")}
            className="block w-full text-[14px] file:mr-3 file:h-11 file:rounded-full file:border file:border-border file:bg-card file:px-4 file:text-[14px] file:font-semibold"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              const body = await f.text();
              setText(body);
              setFileName(f.name);
              setPreview(null);
            }}
          />
        </Field>
      </div>
      <Field label={t("hr.import.paste")} hint={t("hr.import.pasteHint")}>
        <textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setPreview(null);
          }}
          rows={6}
          spellCheck={false}
          className="w-full min-w-0 rounded-input border border-input bg-card p-3 font-mono text-[13px]"
        />
      </Field>
      {tooBig ? <p role="alert" className="m-0 text-[13px] text-destructive">{t("hr.import.tooBig")}</p> : null}
      {chosen && !chosen.columnMap ? <p role="alert" className="m-0 text-[13px] text-destructive">{t("hr.import.noMap")}</p> : null}
      {text.trim() ? <p className="m-0 text-xs text-muted-foreground">{t("hr.import.delimiterGuess", { delim: t(`hr.devices.delim.${DELIMS.find((d) => d.value === guessDelimiter(text))!.key}`) })} · {fileHead(text, 1)[0]?.slice(0, 80)}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" loading={busy} disabled={!chosen || !chosen.columnMap || !text.trim() || tooBig} onClick={() => void runPreview()}>
          {t("hr.import.preview")}
        </Button>
        <Button loading={commit.isPending} disabled={!preview || preview.total === 0 || !chosen} onClick={() => chosen && commit.mutate({ deviceId: chosen.id, text })}>
          {t("hr.import.commit", { count: preview?.total ?? 0 })}
        </Button>
      </div>

      {preview ? (
        <div className="flex min-w-0 flex-col gap-3" aria-live="polite">
          <p className="m-0 text-[14px] font-semibold">{t("hr.import.read", { total: preview.total })}</p>
          {preview.unknownCodes.length > 0 ? (
            <div role="alert" className="rounded-card border border-border bg-surface-sunken p-3 text-[13px]">
              <p className="m-0 font-semibold">{t("hr.import.unknown", { count: preview.unknownCodes.length })}</p>
              <p className="m-0 font-mono">{preview.unknownCodes.slice(0, 40).join(", ")}</p>
              <p className="m-0 text-muted-foreground">{t("hr.import.unknownHint")}</p>
            </div>
          ) : null}
          {preview.errorCount > 0 ? (
            <div role="alert" className="rounded-card border border-border bg-surface-sunken p-3 text-[13px]">
              <p className="m-0 font-semibold">{t("hr.import.bad", { count: preview.errorCount })}</p>
              <ul className="m-0 list-disc pl-5">
                {preview.errors.slice(0, 20).map((e) => (
                  <li key={e.line}>{t("hr.import.badLine", { line: e.line, reason: t(`hr.import.reason.${e.reason}`) })}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {preview.sample.length > 0 ? (
            <div className="overflow-x-auto rounded-card border border-border">
              <table className="w-full min-w-[24rem] border-collapse text-[13px]">
                <thead>
                  <tr className="bg-surface-sunken text-left">
                    <th scope="col" className="px-3 py-2 font-medium">{t("hr.import.line")}</th>
                    <th scope="col" className="px-3 py-2 font-medium">{t("hr.person.deviceCode")}</th>
                    <th scope="col" className="px-3 py-2 font-medium">{t("hr.people.name")}</th>
                    <th scope="col" className="px-3 py-2 font-medium">{t("hr.import.at")}</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.sample.map((s) => (
                    <tr key={s.line} className="border-t border-border">
                      <td className="px-3 py-1.5 tabular-nums">{s.line}</td>
                      <td className="px-3 py-1.5 font-mono">{s.code}</td>
                      <td className="px-3 py-1.5">{s.name ?? <span className="text-destructive">{t("hr.import.noPerson")}</span>}</td>
                      <td className="px-3 py-1.5 font-mono tabular-nums">{s.local}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      ) : null}
    </Section>
  );
}

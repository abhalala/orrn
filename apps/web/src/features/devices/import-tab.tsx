import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Field } from "@orrn/ui/components/field";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { Can } from "@/shared/components/can";
import { trpc } from "@/shared/utils/trpc";

import { useDevError, useDevInvalidate } from "./hooks";
import { CSV_MAX_BYTES, importErrorKey } from "./model";
import { Block, DevErrorNote, DevSelect } from "./ui";

type ImportErrors = { line: number; code: string }[];
type Outcome = { added: number; duplicate: number; captured?: number; waiting?: number; errors: ImportErrors };

/** Read a picked file as text. A file over the server's limit is refused here, before anything is sent. */
async function readCsv(file: File | null): Promise<{ csv: string } | { problem: "noFile" | "tooBig" | "readFailed" }> {
  if (!file) return { problem: "noFile" };
  if (file.size > CSV_MAX_BYTES) return { problem: "tooBig" };
  try {
    const csv = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result ?? ""));
      r.onerror = () => reject(r.error);
      r.readAsText(file);
    });
    return csv.trim() ? { csv } : { problem: "readFailed" };
  } catch {
    return { problem: "readFailed" };
  }
}

function Result({ outcome, lab }: { outcome: Outcome; lab: boolean }) {
  const { t } = useT();
  return (
    <div data-testid={lab ? "dev3-import-lab-result" : "dev3-import-wb-result"} className="flex min-w-0 flex-col gap-2" role="status">
      <p className="m-0 rounded-card bg-surface-sunken px-4 py-3 text-[15px] font-semibold">
        {lab
          ? t("dev3.import.resultLab", { added: outcome.added, duplicate: outcome.duplicate, captured: outcome.captured ?? 0, waiting: outcome.waiting ?? 0 })
          : t("dev3.import.result", { added: outcome.added, duplicate: outcome.duplicate })}
      </p>
      {outcome.errors.length > 0 ? (
        <div className="flex min-w-0 flex-col gap-1">
          <p className="m-0 text-[14px] font-semibold">{t("dev3.import.errorsTitle")}</p>
          <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[14px]">
            {outcome.errors.map((e, i) => (
              <li key={`${e.line}-${i}`} className="break-words">
                {e.line > 0 ? `${t("dev3.import.line", { line: e.line })}: ` : ""}
                {t(`dev3.import.codes.${importErrorKey(e.code)}`)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/** Files from a device PC that cannot call in. The unit of a weighbridge file is picked, never guessed. */
export function ImportTab() {
  const { t } = useT();
  const devices = useQuery({ ...trpc.devices.list.queryOptions(), retry: false });
  const rows = devices.data?.devices.filter((d) => !d.revokedAt) ?? [];
  return (
    <>
      <p className="m-0 text-[14px] leading-6 text-muted-foreground">{t("dev3.import.hint")}</p>
      <Can do="device.manage">
        <WeighbridgeImport devices={rows.filter((d) => d.kind === "weighbridge")} />
      </Can>
      <LabImport devices={rows.filter((d) => d.kind === "profile_scanner" || d.kind === "utm")} />
    </>
  );
}

type DeviceOption = { id: string; code: string; label: string };

function DevicePick({ value, onChange, devices, required, error }: { value: string; onChange(v: string): void; devices: DeviceOption[]; required?: boolean; error?: string }) {
  const { t } = useT();
  return (
    <Field label={t("dev3.import.device")} hint={required ? (devices.length === 0 ? t("dev3.import.deviceNone") : t("dev3.import.deviceRequired")) : t("dev3.import.deviceHint")} error={error}>
      <DevSelect value={value} onChange={(e) => onChange(e.currentTarget.value)} data-testid={required ? "dev3-import-device" : undefined}>
        <option value="">{required ? t("dev3.import.devicePick") : t("dev3.import.anyDevice")}</option>
        {devices.map((d) => (
          <option key={d.id} value={d.id}>
            {d.code} {d.label}
          </option>
        ))}
      </DevSelect>
    </Field>
  );
}

function WeighbridgeImport({ devices }: { devices: DeviceOption[] }) {
  const { t } = useT();
  const say = useDevError();
  const invalidate = useDevInvalidate();
  const [unit, setUnit] = useState<"" | "kg" | "t">("");
  const [deviceId, setDeviceId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [tried, setTried] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const run = useMutation(trpc.devices.import.weighbridge.mutationOptions());
  const submit = async () => {
    setTried(true);
    setProblem(null);
    setOutcome(null);
    const picked = unit;
    if (picked === "" || deviceId === "") return;
    const read = await readCsv(file);
    if ("problem" in read) return setProblem(t(`dev3.import.${read.problem}`));
    run.mutate(
      { csv: read.csv, unit: picked, deviceId },
      {
        onSuccess: async (res) => {
          setOutcome(res);
          await invalidate();
        },
      },
    );
  };
  return (
    <Block id="dev3-import-wb" title={t("dev3.import.weighbridge.title")} hint={t("dev3.import.weighbridge.hint")}>
      <form
        data-testid="dev3-import-wb"
        className="flex max-w-xl flex-col gap-4 rounded-card border border-border bg-card p-4 sm:p-5"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Field label={t("dev3.import.unit")} hint={t("dev3.import.unitHint")} error={tried && unit === "" ? t("dev3.import.unitNeeded") : undefined}>
          <DevSelect value={unit} onChange={(e) => setUnit(e.currentTarget.value as "" | "kg" | "t")} data-testid="dev3-import-unit">
            <option value="">{t("dev3.import.unitPick")}</option>
            <option value="kg">{t("dev3.import.unitKg")}</option>
            <option value="t">{t("dev3.import.unitT")}</option>
          </DevSelect>
        </Field>
        <DevicePick value={deviceId} onChange={setDeviceId} devices={devices} required error={tried && deviceId === "" ? t("dev3.import.deviceNeeded") : undefined} />
        <FilePick file={file} onFile={setFile} testId="dev3-import-wb-file" />
        <Can do="device.manage">
          <Button type="submit" loading={run.isPending} className="self-start" data-testid="dev3-import-wb-run">
            {t("dev3.import.run")}
          </Button>
        </Can>
        {problem ? <p role="alert" className="m-0 rounded-card bg-tone-red-tint px-4 py-3 text-[14px] text-tone-red-ink">{problem}</p> : null}
        {run.error ? <p role="alert" className="m-0 rounded-card bg-tone-red-tint px-4 py-3 text-[14px] text-tone-red-ink">{say(run.error)}</p> : null}
      </form>
      {outcome ? <Result outcome={outcome} lab={false} /> : null}
    </Block>
  );
}

function LabImport({ devices }: { devices: DeviceOption[] }) {
  const { t } = useT();
  const invalidate = useDevInvalidate();
  const [kind, setKind] = useState<"dimension" | "mechanical">("dimension");
  const [deviceId, setDeviceId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const run = useMutation(trpc.devices.import.lab.mutationOptions());
  const submit = async () => {
    setProblem(null);
    setOutcome(null);
    const read = await readCsv(file);
    if ("problem" in read) return setProblem(t(`dev3.import.${read.problem}`));
    run.mutate(
      { csv: read.csv, kind, deviceId: deviceId || undefined },
      {
        onSuccess: async (res) => {
          setOutcome(res);
          await invalidate();
        },
      },
    );
  };
  return (
    <Block id="dev3-import-lab" title={t("dev3.import.lab.title")} hint={t("dev3.import.lab.hint")}>
      <form
        data-testid="dev3-import-lab"
        className="flex max-w-xl flex-col gap-4 rounded-card border border-border bg-card p-4 sm:p-5"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Field label={t("dev3.import.lab.kind")}>
          <DevSelect value={kind} onChange={(e) => setKind(e.currentTarget.value as "dimension" | "mechanical")}>
            <option value="dimension">{t("dev3.import.lab.dimension")}</option>
            <option value="mechanical">{t("dev3.import.lab.mechanical")}</option>
          </DevSelect>
        </Field>
        <DevicePick value={deviceId} onChange={setDeviceId} devices={devices} />
        <FilePick file={file} onFile={setFile} testId="dev3-import-lab-file" />
        <Can do={["device.manage", "qa.check"]}>
          <Button type="submit" loading={run.isPending} className="self-start" data-testid="dev3-import-lab-run">
            {t("dev3.import.run")}
          </Button>
        </Can>
        {problem ? <p role="alert" className="m-0 rounded-card bg-tone-red-tint px-4 py-3 text-[14px] text-tone-red-ink">{problem}</p> : null}
        <DevErrorNote error={run.error} />
      </form>
      {outcome ? <Result outcome={outcome} lab /> : null}
    </Block>
  );
}

function FilePick({ file, onFile, testId }: { file: File | null; onFile(f: File | null): void; testId: string }) {
  const { t } = useT();
  return (
    <Field label={t("dev3.import.file")} hint={t("dev3.import.fileHint")}>
      <input
        type="file"
        accept=".csv,text/csv,text/plain"
        data-testid={testId}
        aria-label={t("dev3.import.file")}
        className="block w-full text-[15px]"
        onChange={(e) => onFile(e.currentTarget.files?.[0] ?? null)}
      />
      {file ? <span className="sr-only">{file.name}</span> : null}
    </Field>
  );
}

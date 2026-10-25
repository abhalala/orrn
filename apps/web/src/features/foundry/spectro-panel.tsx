import { SPECTRO_ELEMENTS, spectroCheck, type SpectroElementKey, type SpectroLimit } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { Field, NumberInput, TextInput } from "@orrn/ui/components/field";
import { Sheet } from "@orrn/ui/components/sheet";
import type { AppRouter } from "@orrn/server/routers/index";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import { useRef, useState } from "react";

import { FieldTextArea } from "@/features/catalog/field-text-area";
import { Can } from "@/shared/components/can";
import { INLINE_ERROR_META } from "@/shared/lib/query-errors";
import { trpc } from "@/shared/utils/trpc";

import { ELEMENT_LABEL, limitText, ppmPct, readingTone, spectroInput, spectroRows, verdictTone } from "./model";
import { ErrorLine, Note, FieldSelect } from "./ui";

type CastData = inferRouterOutputs<AppRouter>["foundry"]["casts"]["get"];
export type SpectroResult = CastData["melts"][number]["spectro"][number];

const FILE_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf", "text/csv", "text/plain"];
/** Raw bytes of a file the server accepts (1 MB of base64 is about 750 kB). */
export const MAX_FILE_BYTES = 740_000;

function useRefresh() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: trpc.foundry.casts.pathKey() });
    void queryClient.invalidateQueries({ queryKey: trpc.foundry.melts.pathKey() });
    void queryClient.invalidateQueries({ queryKey: trpc.foundry.spectroInbox.pathKey() });
  };
}

/** A result as a table of the nine elements against the alloy's limits. */
export function SpectroTable({ result, limits }: { result: Pick<SpectroResult, "values" | "verdict">; limits: readonly SpectroLimit[] }) {
  const { t } = useT();
  const judged = spectroRows(result.values, limits);
  const words = { max: t("foundry.spectro.max"), min: t("foundry.spectro.min"), to: t("foundry.spectro.to") };
  if (!judged) return <p className="m-0 text-[13px] text-muted-foreground">{t("foundry.spectro.noTable")}</p>;
  return (
    <table className="w-full border-collapse text-left text-[14px]" data-testid="spectro-table">
      <caption className="sr-only">{t("foundry.spectro.title")}</caption>
      <thead>
        <tr className="border-b border-border text-muted-foreground">
          <th scope="col" className="py-1.5 pr-3 font-medium">{t("foundry.spectro.element")}</th>
          <th scope="col" className="py-1.5 pr-3 text-right font-medium">%</th>
          <th scope="col" className="py-1.5 pr-3 font-medium">{t("foundry.spectro.limit")}</th>
          <th scope="col" className="py-1.5 font-medium">{t("foundry.spectro.reading")}</th>
        </tr>
      </thead>
      <tbody>
        {judged.rows.map((r) => (
          <tr key={r.element} className="border-b border-border last:border-0" data-element={r.element}>
            <th scope="row" className="py-1.5 pr-3 font-mono font-semibold">{ELEMENT_LABEL[r.element]}</th>
            <td className="py-1.5 pr-3 text-right font-mono tabular-nums">
              {ppmPct(r.ppm)}
              {r.source === "balance" ? <span className="ml-1 font-sans text-[12px] text-muted-foreground">{t("foundry.spectro.alBalance")}</span> : null}
            </td>
            <td className="py-1.5 pr-3 font-mono text-[13px] tabular-nums text-muted-foreground">{limitText(r.limit, words)}</td>
            <td className="py-1.5">
              {r.reading === "missing" ? <span className="text-muted-foreground">-</span> : r.reading === "no_limit" ? <span className="text-[13px] text-muted-foreground">{t("foundry.spectro.noLimit")}</span> : <Chip tone={readingTone(r.reading)}>{t(`foundry.spectro.reading${r.reading === "pass" ? "Pass" : "Fail"}`)}</Chip>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** One stored result: where it came from, its verdict, the table, and void (draft melts only). */
export function ResultCard({ result, limits, canVoid }: { result: SpectroResult; limits: readonly SpectroLimit[]; canVoid: boolean }) {
  const { t } = useT();
  const [voiding, setVoiding] = useState(false);
  const voided = result.voidedAt != null;
  return (
    <li className={`flex min-w-0 flex-col gap-2 rounded-card border border-border p-3 ${voided ? "opacity-60" : ""}`} data-testid="spectro-result" data-verdict={result.verdict ?? ""} data-void={voided ? "true" : undefined}>
      <div className="flex flex-wrap items-center gap-2">
        {result.verdict ? <Chip tone={verdictTone(result.verdict)} truncate={false}>{t(`foundry.spectro.verdict.${result.verdict}`)}</Chip> : null}
        <Chip tone="neutral" truncate={false}>{t(`foundry.spectro.source.${result.source}`)}</Chip>
        {voided ? <Chip tone="red" truncate={false}>{t("foundry.spectro.void")}</Chip> : null}
        {result.fileName ? <span className="break-all font-mono text-[13px] text-muted-foreground">{result.fileName}</span> : null}
        {canVoid && !voided ? (
          <Button type="button" variant="ghost" size="sm" className="ml-auto" onClick={() => setVoiding(true)} data-testid="spectro-void">
            {t("foundry.spectro.voidButton")}
          </Button>
        ) : null}
      </div>
      {result.entryReason ? <p className="m-0 text-[13px] text-muted-foreground break-words">{t("foundry.spectro.typedBecause", { reason: result.entryReason })}</p> : null}
      {voided && result.voidReason ? <p className="m-0 text-[13px] text-muted-foreground break-words">{result.voidReason}</p> : null}
      {Object.keys(result.values ?? {}).length > 0 ? <SpectroTable result={result} limits={limits} /> : null}
      <VoidSheet id={result.id} open={voiding} onClose={() => setVoiding(false)} />
    </li>
  );
}

function VoidSheet({ id, open, onClose }: { id: string; open: boolean; onClose(): void }) {
  const { t } = useT();
  const refresh = useRefresh();
  const [reason, setReason] = useState("");
  const [tried, setTried] = useState(false);
  const mut = useMutation(
    trpc.foundry.spectro.void.mutationOptions({
      onSuccess: () => {
        refresh();
        done();
      },
    }),
  );
  const done = () => {
    setReason("");
    setTried(false);
    mut.reset();
    onClose();
  };
  return (
    <Sheet
      open={open}
      onOpenChange={(o) => (o ? undefined : done())}
      title={t("foundry.spectro.voidTitle")}
      footer={
        <>
          <Button variant="secondary" size="lg" onClick={done}>{t("common.cancel")}</Button>
          <Button size="lg" variant="danger" loading={mut.isPending} data-testid="spectro-void-confirm" onClick={() => { setTried(true); if (reason.trim()) mut.mutate({ id, reason: reason.trim() }); }}>
            {t("foundry.spectro.voidConfirm")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 pt-1">
        <Field label={t("foundry.spectro.voidReason")} error={tried && !reason.trim() ? t("foundry.spectro.reasonRequired") : undefined}>
          <FieldTextArea value={reason} maxLength={500} onChange={(e) => setReason(e.currentTarget.value)} data-testid="spectro-void-reason" />
        </Field>
        <ErrorLine error={mut.error} />
      </div>
    </Sheet>
  );
}

/**
 * The spectro step (FP-FD-10, 11, 12): results of the melt against the alloy's limits, and the three
 * ways in: a file the spectrometer computer sent (inbox), a file or photo picked here, or the numbers
 * typed with the reason. Needs the saved draft (`meltId`).
 */
export function SpectroPanel({
  meltId,
  results,
  limits,
  alloyCode,
  draft,
}: {
  meltId: string | null;
  results: readonly SpectroResult[];
  limits: readonly SpectroLimit[];
  alloyCode: string;
  /** Results can be voided and typed in only on a draft. */
  draft: boolean;
}) {
  const { t } = useT();
  const refresh = useRefresh();
  const [inbox, setInbox] = useState(false);
  const [typing, setTyping] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileError, setFileError] = useState<"size" | "type" | null>(null);
  const [added, setAdded] = useState(false);
  const attachFile = useMutation(
    trpc.foundry.spectro.attach.mutationOptions({
      onSuccess: () => {
        setAdded(true);
        refresh();
      },
    }),
  );
  const pick = async (file: File | undefined) => {
    if (!file || !meltId) return;
    setFileError(null);
    if (!FILE_TYPES.includes(file.type)) return setFileError("type");
    if (file.size > MAX_FILE_BYTES) return setFileError("size");
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
    attachFile.mutate({ meltId, fileName: file.name.slice(0, 120), mime: file.type as never, base64, values: {} });
  };
  const live = results.filter((r) => !r.voidedAt);
  return (
    <div className="flex flex-col gap-4" data-testid="spectro-panel">
      <p className="m-0 text-[14px] text-muted-foreground">{t("foundry.spectro.hint", { alloy: alloyCode })}</p>
      {!meltId ? <Note tone="amber">{t("foundry.spectro.saveFirst")}</Note> : null}
      <Can do="melt.enter">
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" disabled={!meltId} onClick={() => setInbox(true)} data-testid="spectro-from-inbox">
            {t("foundry.spectro.fromInbox")}
          </Button>
          <Button type="button" variant="secondary" disabled={!meltId} loading={attachFile.isPending} onClick={() => fileRef.current?.click()} data-testid="spectro-attach-file">
            {t("foundry.spectro.attachFile")}
          </Button>
          {draft ? (
            <Button type="button" variant="secondary" disabled={!meltId} onClick={() => setTyping(true)} data-testid="spectro-type">
              {t("foundry.spectro.type")}
            </Button>
          ) : null}
          <input ref={fileRef} type="file" accept={FILE_TYPES.join(",")} hidden aria-hidden="true" tabIndex={-1} data-testid="spectro-file-input" onChange={(e) => { void pick(e.currentTarget.files?.[0]); e.currentTarget.value = ""; }} />
        </div>
      </Can>
      {fileError ? <Note tone="red">{t(fileError === "size" ? "foundry.spectro.fileTooBig" : "foundry.spectro.fileType")}</Note> : null}
      <ErrorLine error={attachFile.error} />
      {results.length === 0 ? (
        <p className="m-0 text-[15px] font-medium" data-testid="spectro-none">{t("foundry.spectro.noneYet")}</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-3 p-0" aria-label={t("foundry.spectro.title")}>
          {[...results].reverse().map((r) => (
            <ResultCard key={r.id} result={r} limits={limits} canVoid={draft} />
          ))}
        </ul>
      )}
      {live.length === 0 && results.length > 0 ? <Note tone="amber">{t("foundry.spectro.allVoid")}</Note> : null}
      {meltId ? <InboxSheet meltId={meltId} open={inbox} onClose={() => setInbox(false)} onAdded={() => setAdded(true)} /> : null}
      {meltId ? <TypeSheet meltId={meltId} limits={limits} open={typing} onClose={() => setTyping(false)} onAdded={() => setAdded(true)} /> : null}
      {/* The new result card is the confirmation; a toast would sit over the Lock button. */}
      <p role="status" className="sr-only">{added ? t("foundry.spectro.attached") : ""}</p>
    </div>
  );
}

function InboxSheet({ meltId, open, onClose, onAdded }: { meltId: string; open: boolean; onClose(): void; onAdded(): void }) {
  const { t } = useT();
  const refresh = useRefresh();
  const files = useQuery({ ...trpc.foundry.spectroInbox.list.queryOptions({ status: ["pending_review"] }), enabled: open, meta: INLINE_ERROR_META });
  const [fileId, setFileId] = useState("");
  const attach = useMutation(
    trpc.foundry.spectroInbox.attach.mutationOptions({
      onSuccess: () => {
        onAdded();
        refresh();
        done();
      },
    }),
  );
  const done = () => {
    setFileId("");
    attach.reset();
    onClose();
  };
  const usable = (files.data ?? []).filter((f) => !f.simulated);
  return (
    <Sheet
      open={open}
      onOpenChange={(o) => (o ? undefined : done())}
      title={t("foundry.spectro.inboxTitle")}
      footer={
        <>
          <Button variant="secondary" size="lg" onClick={done}>{t("common.cancel")}</Button>
          <Button size="lg" disabled={!fileId} loading={attach.isPending} data-testid="spectro-inbox-confirm" onClick={() => attach.mutate({ id: fileId, meltId })}>
            {t("foundry.inbox.attachSheet.confirm")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 pt-1">
        {files.isSuccess && usable.length === 0 ? <Note>{t("foundry.spectro.inboxEmpty")}</Note> : null}
        <Field label={t("foundry.spectro.inboxFile")}>
          <FieldSelect value={fileId} onChange={(e) => setFileId(e.currentTarget.value)} data-testid="spectro-inbox-pick">
            <option value="">{t("foundry.spectro.inboxPick")}</option>
            {usable.map((f) => (
              <option key={f.id} value={f.id}>
                {f.fileName}
                {f.sampleRef ? ` · ${f.sampleRef}` : ""}
              </option>
            ))}
          </FieldSelect>
        </Field>
        <ErrorLine error={attach.error} />
      </div>
    </Sheet>
  );
}

function TypeSheet({ meltId, limits, open, onClose, onAdded }: { meltId: string; limits: readonly SpectroLimit[]; open: boolean; onClose(): void; onAdded(): void }) {
  const { t } = useT();
  const refresh = useRefresh();
  const [texts, setTexts] = useState<Partial<Record<SpectroElementKey, string>>>({});
  const [reason, setReason] = useState("");
  const [tried, setTried] = useState(false);
  const requestId = useRef(crypto.randomUUID());
  const enter = useMutation(
    trpc.foundry.spectro.enter.mutationOptions({
      onSuccess: () => {
        onAdded();
        refresh();
        done();
        requestId.current = crypto.randomUUID();
      },
    }),
  );
  const done = () => {
    setTexts({});
    setReason("");
    setTried(false);
    enter.reset();
    onClose();
  };
  const parsed = spectroInput(texts);
  const preview = (() => {
    if (!parsed.ok) return null;
    try {
      return spectroCheck(parsed.valuesPpm, limits).verdict;
    } catch {
      return null;
    }
  })();
  return (
    <Sheet
      open={open}
      onOpenChange={(o) => (o ? undefined : done())}
      title={t("foundry.spectro.typeTitle")}
      footer={
        <>
          <Button variant="secondary" size="lg" onClick={done}>{t("common.cancel")}</Button>
          <Button
            size="lg"
            loading={enter.isPending}
            data-testid="spectro-type-confirm"
            onClick={() => {
              setTried(true);
              if (!parsed.ok || !reason.trim()) return;
              enter.mutate({ meltId, valuesPpm: parsed.valuesPpm, entryReason: reason.trim(), clientRequestId: requestId.current });
            }}
          >
            {t("foundry.spectro.typeConfirm")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 pt-1">
        <p className="m-0 text-[14px] text-muted-foreground">{t("foundry.spectro.typeHint")}</p>
        <div className="grid grid-cols-3 gap-3">
          {SPECTRO_ELEMENTS.map((el) => (
            <Field key={el} label={`${ELEMENT_LABEL[el]} %`} error={tried && !parsed.ok && parsed.reason === "invalid" && parsed.element === el ? t("foundry.spectro.badNumber") : undefined}>
              <NumberInput value={texts[el] ?? ""} onValueChange={(v) => setTexts((s) => ({ ...s, [el]: v }))} data-testid={`spectro-el-${el}`} />
            </Field>
          ))}
        </div>
        {tried && !parsed.ok && parsed.reason === "none" ? <Note tone="red">{t("foundry.spectro.enterOne")}</Note> : null}
        {tried && !parsed.ok && parsed.reason === "over" ? <Note tone="red">{t("foundry.spectro.overMillion")}</Note> : null}
        {preview ? (
          <p className="m-0 flex items-center gap-2 text-[14px]" data-testid="spectro-preview">
            {t("foundry.spectro.previewIs")} <Chip tone={verdictTone(preview)}>{t(`foundry.spectro.verdict.${preview}`)}</Chip>
          </p>
        ) : null}
        <Field label={t("foundry.spectro.typeReason")} hint={t("foundry.spectro.typeReasonHint")} error={tried && !reason.trim() ? t("foundry.spectro.reasonRequired") : undefined}>
          <TextInput value={reason} maxLength={500} onChange={(e) => setReason(e.currentTarget.value)} data-testid="spectro-type-reason" />
        </Field>
        <ErrorLine error={enter.error} />
      </div>
    </Sheet>
  );
}

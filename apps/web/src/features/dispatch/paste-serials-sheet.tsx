import { splitPastedSerials } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { Field } from "@orrn/ui/components/field";
import { TextArea } from "@orrn/ui/components/input";
import { Sheet } from "@orrn/ui/components/sheet";
import type { StatusTone } from "@orrn/domain";
import { useMemo, useState, type FormEvent } from "react";

import { blockMessage, renderScanMessage, scanErrorKey, type AddBundlesReport } from "@/features/scan/scan-outcome";
import { trpcClient } from "@/shared/utils/trpc";

import { addInChunks, type ChunkedAddResult } from "./paste";

type Props = {
  open: boolean;
  onOpenChange(open: boolean): void;
  dispatchId: string;
  /** Called after each run with what went in, so the screen refreshes and pops the new rows. */
  onAdded(report: AddBundlesReport): void;
};

type Phase = { kind: "edit" } | { kind: "sending"; done: number; total: number } | { kind: "report"; result: ChunkedAddResult; total: number };

/**
 * Paste serials from a sheet, a WhatsApp message or a scanner dump. Split
 * with `splitPastedSerials`, sent 100 at a time, then the server's report
 * per serial: added, already in this dispatch, not found, not available
 * (with the reason in the reader's language).
 */
export function PasteSerialsSheet({ open, onOpenChange, dispatchId, onAdded }: Props) {
  const { t } = useT();
  const [text, setText] = useState("");
  const [phase, setPhase] = useState<Phase>({ kind: "edit" });
  const [error, setError] = useState<string | undefined>();
  const serials = useMemo(() => splitPastedSerials(text), [text]);

  const reset = () => {
    setText("");
    setError(undefined);
    setPhase({ kind: "edit" });
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (serials.length === 0) {
      setError(t("dispatch.paste.nothingFound"));
      return;
    }
    setError(undefined);
    const total = serials.length;
    const result = await addInChunks(
      serials,
      (chunk) => trpcClient.dispatch.addBundlesBySerial.mutate({ id: dispatchId, serials: chunk }),
      (done) => setPhase({ kind: "sending", done, total }),
    );
    if (result.report.added.length > 0) onAdded(result.report);
    setPhase({ kind: "report", result, total });
  };

  const sending = phase.kind === "sending";
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (sending) return; // a run in flight finishes first
        onOpenChange(next);
        if (!next) reset();
      }}
      title={t("dispatch.paste.title")}
      footer={
        phase.kind === "report" ? (
          <>
            <Button variant="secondary" onClick={reset}>
              {t("dispatch.paste.pasteMore")}
            </Button>
            <Button
              onClick={() => {
                onOpenChange(false);
                reset();
              }}
            >
              {t("common.done")}
            </Button>
          </>
        ) : (
          <>
            <Button variant="secondary" disabled={sending} onClick={() => onOpenChange(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" form="paste-serials-form" loading={sending} disabled={serials.length === 0}>
              {t("dispatch.paste.submit")}
            </Button>
          </>
        )
      }
    >
      {phase.kind === "report" ? (
        <PasteReport result={phase.result} total={phase.total} />
      ) : (
        <form id="paste-serials-form" onSubmit={(e) => void submit(e)} className="flex flex-col gap-3 pt-1" noValidate>
          <Field id="paste-serials" label={t("dispatch.paste.label")} hint={t("dispatch.paste.hint")} error={error}>
            <TextArea
              id="paste-serials"
              value={text}
              onChangeText={(v) => {
                setText(v);
                if (error) setError(undefined);
              }}
              rows={8}
              autoFocus
              spellCheck={false}
              autoCapitalize="characters"
              autoComplete="off"
              readOnly={sending}
              className="font-mono text-[15px] leading-6"
              aria-describedby={["paste-serials-hint", error ? "paste-serials-error" : ""].filter(Boolean).join(" ")}
              aria-invalid={error ? true : undefined}
            />
          </Field>
          <p role="status" aria-live="polite" className="m-0 min-h-6 text-[14px] font-medium text-muted-foreground tabular-nums">
            {phase.kind === "sending"
              ? t("dispatch.paste.adding", { done: phase.done, total: phase.total })
              : serials.length > 0
                ? t("dispatch.paste.found", { count: serials.length })
                : ""}
          </p>
        </form>
      )}
    </Sheet>
  );
}

type LineKind = "added" | "already" | "notFound" | "unavailable";
const TONE: Record<LineKind, StatusTone> = { added: "green", already: "neutral", notFound: "amber", unavailable: "red" };

function PasteReport({ result, total }: { result: ChunkedAddResult; total: number }) {
  const { t } = useT();
  const { report } = result;
  const lines: { kind: LineKind; count: number; text: string; serials: { serial: string; why?: string }[] }[] = [
    { kind: "added" as const, count: report.added.length, text: t("dispatch.paste.added", { count: report.added.length }), serials: report.added.map((serial) => ({ serial })) },
    {
      kind: "already" as const,
      count: report.alreadyInDispatch.length,
      text: t("dispatch.paste.already", { count: report.alreadyInDispatch.length }),
      serials: report.alreadyInDispatch.map((serial) => ({ serial })),
    },
    { kind: "notFound" as const, count: report.notFound.length, text: t("dispatch.paste.notFound", { count: report.notFound.length }), serials: report.notFound.map((serial) => ({ serial })) },
    {
      kind: "unavailable" as const,
      count: report.unavailable.length,
      text: t("dispatch.paste.unavailable", { count: report.unavailable.length }),
      serials: report.unavailable.map((u) => ({ serial: u.serial, why: renderScanMessage(t, blockMessage(u)) })),
    },
  ].filter((l) => l.count > 0);
  const done = total - result.unsent.length;

  return (
    <div className="flex flex-col gap-4 pt-1">
      <div role="status" aria-live="polite" className="flex flex-col gap-1">
        <h3 className="m-0 text-[15px] font-semibold">{t("dispatch.paste.reportTitle")}</h3>
        <p className="m-0 text-[15px] leading-6">{lines.map((l) => l.text).join(". ")}</p>
        {result.error ? (
          <p className="m-0 text-[14px] font-medium text-destructive">
            {t("dispatch.paste.stopped", { done, total })} {t(scanErrorKey(result.error, "dispatch"))}
          </p>
        ) : null}
      </div>
      {lines.map((l) => (
        <section key={l.kind} aria-label={l.text} className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Chip tone={TONE[l.kind]}>{l.text}</Chip>
          </div>
          {l.kind === "added" && l.count > 12 ? null : (
            <ul className="m-0 flex list-none flex-col divide-y divide-border rounded-card border border-border p-0">
              {l.serials.map((s) => (
                <li key={s.serial} className="flex min-h-11 min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-0.5 px-3.5 py-2">
                  <span className="font-mono text-[15px] font-semibold [overflow-wrap:anywhere]">{s.serial}</span>
                  {s.why ? <span className="text-[14px] text-muted-foreground">{s.why}</span> : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}

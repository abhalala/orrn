import { Button } from "@orrn/ui/components/button";
import { UiLink } from "@orrn/ui/components/link";
import { useEffect, useRef } from "react";

import { ingestErrorWords, ACCEPT_FILES, ReputError, type ReputState, type HeaderReply } from "../lib";
import { HeaderStep } from "./header-step";
import { useSay } from "./review-bits";

/**
 * What stands under the read panel while a table is put again from this screen: asking for the file when this tab does not
 * have it, the header step for the tables the rest of the sheet became, and how it ended. The words of a refusal (rows
 * already written) come from the server's code, never its English.
 */
export function ReputArea({
  state,
  fileName,
  onFile,
  onReply,
  onDismiss,
}: {
  state: ReputState;
  fileName: string;
  onFile: (file: File) => void;
  onReply: (reply: HeaderReply) => void;
  onDismiss: () => void;
}) {
  const { t, say } = useSay();
  const input = useRef<HTMLInputElement>(null);
  const done = useRef<HTMLDivElement>(null);
  // The page this replaces is gone: focus goes to the line that says so, so the way back is the next Tab.
  useEffect(() => {
    if (state.phase === "done") done.current?.focus();
  }, [state.phase]);
  if (state.phase === "idle") return null;
  if (state.phase === "needFile") {
    return (
      <div data-testid="reput-area" className="flex flex-col items-start gap-2 rounded-card border border-border bg-card p-4">
        <p role="status" className="m-0 text-[14px] leading-6">{t(state.wrongFile ? "ingest.read.otherFile" : "ingest.read.needFile")}</p>
        <input
          ref={input}
          type="file"
          accept={ACCEPT_FILES}
          tabIndex={-1}
          aria-hidden="true"
          className="hidden"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (file) onFile(file);
          }}
        />
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => input.current?.click()}>{t("ingest.read.chooseAgain")}</Button>
          <Button variant="ghost" onClick={onDismiss}>{t("common.cancel")}</Button>
        </div>
      </div>
    );
  }
  if (state.phase === "running") {
    return <p data-testid="reput-area" role="status" className="m-0 text-[14px] leading-6 text-muted-foreground">{t("ingest.read.reputBusy")}</p>;
  }
  if (state.phase === "asking") return <HeaderStep key={state.view.position} view={state.view} fileName={fileName} onReply={onReply} />;
  if (state.phase === "done") {
    return (
      <div ref={done} tabIndex={-1} data-testid="reput-area" className="flex flex-col items-start gap-3 rounded-card border border-border bg-card p-4 outline-none">
        <p role="status" className="m-0 text-[15px] leading-6 font-semibold">{t("ingest.read.reputDone")}</p>
        <Button asChild variant="primary">
          <UiLink to="/ingest">{t("ingest.title")}</UiLink>
        </Button>
      </div>
    );
  }
  const words =
    state.error instanceof ReputError ? t("ingest.read.reputFailed") : say(ingestErrorWords(state.error, "action").key);
  return (
    <div data-testid="reput-area" className="flex flex-wrap items-center gap-3">
      <p role="alert" className="m-0 text-[14px] leading-6 text-destructive">{words}</p>
      <Button variant="ghost" onClick={onDismiss}>{t("common.cancel")}</Button>
    </div>
  );
}

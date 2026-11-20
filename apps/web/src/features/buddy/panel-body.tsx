import { useT, type Translate } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { UiLink } from "@orrn/ui/components/link";
import { Sheet } from "@orrn/ui/components/sheet";
import { cn } from "@orrn/ui/lib/utils";
import { LoaderCircle, Paperclip, Plus, SendHorizontal } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";

import type { ChatState, Turn, TurnError } from "./chat-model";
import { DraftCard } from "./draft-card";
import type { BuddyDraft } from "./types";

/** The longest message the box takes. */
export const MAX_MESSAGE = 4000;

export type DraftDecisions = {
  pendingFor(id: string): "confirm" | "reject" | null;
  errorFor(id: string): string | null;
  confirm(draft: BuddyDraft): void;
  reject(draft: BuddyDraft): void;
};

export type BuddyPanelBodyProps = {
  open: boolean;
  onOpenChange(open: boolean): void;
  chat: {
    state: ChatState;
    busy: boolean;
    send(message: string): void;
    retry(turnId: string): void;
    newChat(): void;
  };
  /** `buddy.drafts.listMine`: undefined while it loads. */
  drafts: readonly BuddyDraft[] | undefined;
  decisions: DraftDecisions;
  when: (at: string | number | Date) => string;
};

function errorText(t: Translate, error: TurnError): string {
  if (error === "offline") return t("buddy.offline");
  if (error === "rate_limited") return t("buddy.rateLimited");
  if (error === "cut") return t("buddy.cut");
  return t("buddy.failed");
}

/**
 * The open bubble (design §4.5, §12.2): a real dialog on the shared C2 `Sheet` (Radix: focus trap, Escape, the page
 * behind hidden from screen readers, focus back to the launcher on close). A full-screen sheet on phones, a 400 by
 * 600 panel at the bottom right from 768 px. Streamed text is not announced token by token: one polite live region
 * says the finished answer, or what went wrong.
 */
export function BuddyPanelBody({ open, onOpenChange, chat, drafts, decisions, when }: BuddyPanelBodyProps) {
  const { t } = useT();
  const { state } = chat;
  const [text, setText] = useState("");
  const hintId = useId();
  const endRef = useRef<HTMLDivElement>(null);

  const byId = new Map((drafts ?? []).map((d) => [d.id, d]));
  const inTurns = new Set(state.turns.flatMap((turn) => turn.draftIds));
  const waiting = (drafts ?? []).filter((d) => d.status === "pending" && !inTurns.has(d.id));
  const leave = () => onOpenChange(false);

  // Radix hides the page from screen readers and traps focus but does not write `aria-modal`; the shared Sheet takes no
  // extra props, so the panel marks its own dialog. True to what it is: nothing behind can be reached while it is open.
  // A callback ref: the portal mounts the content a render after `open` turns true.
  const markModal = useCallback((el: HTMLDivElement | null) => {
    el?.closest("[role='dialog']")?.setAttribute("aria-modal", "true");
  }, []);

  const lastTurn = state.turns.at(-1);
  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: "end" });
  }, [state.turns.length, lastTurn?.reply, lastTurn?.phase, lastTurn?.draftIds.length]);

  const announced = state.announce ? state.turns.find((turn) => turn.id === state.announce?.turnId) : undefined;
  const announceText =
    state.announce && announced ? (state.announce.kind === "reply" ? announced.reply : errorText(t, state.announce.kind)) : "";

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    const message = text.trim();
    if (!message || chat.busy) return;
    chat.send(message);
    setText("");
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== "Enter" || e.shiftKey) return;
    // A Hindi or Gujarati keyboard composes with Enter: that Enter picks a word, it does not send.
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    e.preventDefault();
    submit();
  };

  const card = (draft: BuddyDraft) => (
    <DraftCard
      key={draft.id}
      draft={draft}
      when={when}
      pending={decisions.pendingFor(draft.id)}
      error={decisions.errorFor(draft.id)}
      onConfirm={decisions.confirm}
      onReject={decisions.reject}
      onLeave={leave}
    />
  );

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t("buddy.title")}
      className={cn(
        // Phones: the whole screen, over the tab bar.
        "max-md:top-0 max-md:h-dvh max-md:max-h-none max-md:rounded-none max-md:border-t-0",
        // From 768 px: a floating panel at the bottom right, about 400 by 600.
        "md:inset-x-auto md:top-auto md:right-6 md:bottom-6 md:left-auto md:h-[min(600px,calc(100dvh-3rem))] md:max-h-none md:w-[400px] md:max-w-[calc(100vw-3rem)] md:rounded-card md:border",
        "lg:inset-y-auto lg:top-auto lg:right-6 lg:bottom-6 lg:h-[min(600px,calc(100dvh-3rem))] lg:w-[400px] lg:rounded-card lg:border",
      )}
      footer={
        <form onSubmit={submit} className="flex w-full min-w-0 items-end gap-2" data-testid="buddy-form">
          <textarea
            value={text}
            onChange={(e) => setText(e.currentTarget.value)}
            onKeyDown={onKeyDown}
            rows={2}
            maxLength={MAX_MESSAGE}
            aria-label={t("buddy.inputLabel")}
            aria-describedby={hintId}
            placeholder={t("buddy.placeholder")}
            data-testid="buddy-input"
            className="min-h-11 min-w-0 flex-1 resize-none rounded-input border border-input bg-card px-3 py-2.5 text-[16px] leading-6 text-foreground placeholder:text-muted-foreground md:text-[15px]"
          />
          <span id={hintId} className="sr-only">
            {t("buddy.sendHint")}
          </span>
          <Button type="submit" disabled={chat.busy || text.trim() === ""} aria-label={t("buddy.send")} title={t("buddy.send")} className="size-11 shrink-0 p-0" data-testid="buddy-send">
            <SendHorizontal aria-hidden="true" className="size-5" strokeWidth={2} />
          </Button>
        </form>
      }
    >
      <div ref={markModal} className="flex min-w-0 flex-col gap-4" data-testid="buddy-panel">
        <div className="flex min-w-0 flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={chat.newChat} data-testid="buddy-new-chat">
            <Plus aria-hidden="true" className="size-4" strokeWidth={2} />
            {t("buddy.newChat")}
          </Button>
          <UiLink
            to="/ingest"
            onClick={leave}
            title={t("buddy.addFileHint")}
            data-testid="buddy-add-file"
            className="inline-flex h-9 items-center gap-2 rounded-full border border-border bg-card px-3.5 text-[13px] font-semibold text-foreground no-underline shadow-sm hover:bg-surface-sunken pointer-coarse:h-11 pointer-coarse:px-4"
          >
            <Paperclip aria-hidden="true" className="size-4" strokeWidth={2} />
            {t("buddy.addFile")}
          </UiLink>
        </div>

        {waiting.length > 0 ? (
          <section aria-labelledby="buddy-waiting" className="flex min-w-0 flex-col gap-2">
            <h3 id="buddy-waiting" className="m-0 text-[13px] font-semibold text-muted-foreground">
              {t("buddy.waiting")}
            </h3>
            {waiting.map(card)}
          </section>
        ) : null}

        {state.turns.length === 0 ? (
          <p className="m-0 text-[15px] leading-6 text-muted-foreground" data-testid="buddy-empty">
            {t("buddy.empty")}
          </p>
        ) : (
          <ol className="m-0 flex list-none flex-col gap-4 p-0" data-testid="buddy-turns">
            {state.turns.map((turn) => (
              <TurnView key={turn.id} turn={turn} byId={byId} card={card} onRetry={() => chat.retry(turn.id)} retryDisabled={chat.busy} />
            ))}
          </ol>
        )}
        <div ref={endRef} />

        <div aria-live="polite" aria-atomic="true" className="sr-only" data-testid="buddy-live">
          {announceText}
        </div>
      </div>
    </Sheet>
  );
}

function TurnView({
  turn,
  byId,
  card,
  onRetry,
  retryDisabled,
}: {
  turn: Turn;
  byId: Map<string, BuddyDraft>;
  card: (draft: BuddyDraft) => ReactNode;
  onRetry(): void;
  retryDisabled: boolean;
}) {
  const { t } = useT();
  const working = turn.phase === "connecting" || turn.phase === "streaming";
  return (
    <li className="flex min-w-0 flex-col gap-2" data-testid="buddy-turn" data-phase={turn.phase}>
      <div className="flex justify-end">
        <p className="m-0 max-w-[85%] rounded-card bg-surface-sunken px-3 py-2 text-[15px] leading-6 break-words whitespace-pre-wrap">
          <span className="sr-only">{t("buddy.you")}: </span>
          {turn.message}
        </p>
      </div>
      <div className="flex min-w-0 flex-col gap-2">
        {turn.tools.length > 0 ? (
          <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
            {turn.tools.map((path, i) => (
              <li
                key={`${path}-${i}`}
                data-testid="buddy-tool"
                className="max-w-full rounded-full border border-border px-2.5 py-0.5 font-mono text-[12px] leading-5 text-muted-foreground [overflow-wrap:anywhere]"
              >
                {t("buddy.tool", { path })}
              </li>
            ))}
          </ul>
        ) : null}
        {turn.reply ? (
          <p className="m-0 text-[15px] leading-6 break-words whitespace-pre-wrap" data-testid="buddy-reply">
            <span className="sr-only">{t("buddy.title")}: </span>
            {turn.reply}
          </p>
        ) : null}
        {working ? (
          <p className="m-0 flex items-center gap-2 text-[13px] text-muted-foreground" data-testid="buddy-working">
            <LoaderCircle aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" strokeWidth={2} />
            {turn.phase === "connecting" ? t("buddy.connecting") : t("buddy.writing")}
          </p>
        ) : null}
        {turn.draftIds.map((id) => {
          const draft = byId.get(id);
          return draft ? (
            card(draft)
          ) : (
            <p key={id} className="m-0 text-[13px] text-muted-foreground" data-testid="buddy-draft-loading">
              {t("buddy.draft.loading")}
            </p>
          );
        })}
        {turn.phase === "failed" && turn.error ? (
          // Offline is one line on the turn, and nothing retries on its own: the person presses Try again.
          <div className="flex min-w-0 flex-wrap items-center gap-2" data-testid="buddy-turn-error" data-error={turn.error}>
            <p
              className="m-0 min-w-0 flex-1 text-[14px] text-destructive break-words"
              data-testid={turn.error === "offline" ? "buddy-offline" : undefined}
            >
              {errorText(t, turn.error)}
            </p>
            <Button size="sm" variant="secondary" onClick={onRetry} disabled={retryDisabled} data-testid="buddy-retry">
              {t("common.retry")}
            </Button>
          </div>
        ) : null}
      </div>
    </li>
  );
}

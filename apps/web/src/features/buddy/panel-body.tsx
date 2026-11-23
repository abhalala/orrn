import { useT, type Translate } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { UiLink } from "@orrn/ui/components/link";
import { Sheet } from "@orrn/ui/components/sheet";
import { breakpoints } from "@orrn/ui/hooks/use-media-query";
import { TOAST_RIGHT_VAR } from "@orrn/ui/hooks/use-toast-lift";
import { cn } from "@orrn/ui/lib/utils";
import { LoaderCircle, Paperclip, Plus, SendHorizontal } from "lucide-react";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";

import type { ChatState, Turn, TurnError } from "./chat-model";
import { DraftCard, type DriveView } from "./draft-card";
import { replyParts } from "./reply-links";
import type { BuddyDraft } from "./types";

/** The longest message the box takes. */
export const MAX_MESSAGE = 4000;

export type DraftDecisions = {
  pendingFor(id: string): "confirm" | "reject" | null;
  errorFor(id: string): string | null;
  confirm(draft: BuddyDraft): void;
  reject(draft: BuddyDraft): void;
  /** The row check this surface drives for a confirmed `import.runDryRun` draft (the bubble only). */
  driveFor?(id: string): DriveView | null;
  stopDrive?(draft: BuddyDraft): void;
};

/** A phone or tablet without a mouse: focusing the box there opens the on-screen keyboard over the sheet (N7). */
export function coarsePointer(): boolean {
  try {
    return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
  } catch {
    return false;
  }
}

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

/** Set on `documentElement` while the panel is docked (from 1024 px): the tenant shell and the Buddy button move left by it. */
export const BUDDY_INSET_VAR = "--orrn-buddy-inset";
/** The docked column's width, and so the page's inset. */
export const DOCK_WIDTH = "400px";

/**
 * Toasts sit bottom right, where the open panel is: while it is open they start left of it (review N9).
 * - Docked: the 400 px column + 24 px gap. At 1024 px that leaves 600 px, room for a 356 px toast.
 * - The floating sheet from 768 px: its width (400 px, narrower below 828 px so a toast still fits beside it)
 *   + 24 px edge + 24 px gap. The Toaster never moves a toast off the left edge (`calc(100vw - 372px)`).
 * Phones (below 768 px): toasts stay where they are (sonner's own full-width toasts below 600 px).
 */
const TOAST_RIGHT_DOCKED = `calc(${DOCK_WIDTH} + 24px)`;
const FLOAT_WIDTH = "min(400px, calc(100vw - 404px))";
const TOAST_RIGHT_FLOATING = `calc(${FLOAT_WIDTH} + 48px)`;

/** Where the panel opens: docked (from 1024 px), the floating modal sheet (768 to 1023 px) or the phone's full screen. */
type Mode = "docked" | "sheet" | "phone";

function modeNow(): Mode {
  try {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return "phone";
    if (window.matchMedia(breakpoints.desktop).matches) return "docked";
    return window.matchMedia(breakpoints.tablet).matches ? "sheet" : "phone";
  } catch {
    return "phone";
  }
}

/**
 * The open bubble (design §4.5, §12.2) on the shared C2 `Sheet`, always a dialog named "Buddy" (review N9, delta S5):
 *
 * - Phones (below 768 px): a full-screen MODAL sheet, as before: focus trap, the page behind hidden from screen
 *   readers, `aria-modal="true"`.
 * - 768 to 1023 px: the same modal dialog as a floating sheet about 400 by 600 at the right edge, over a dimmed page
 *   (there is no room to push the page beside it).
 * - From 1024 px: DOCKED, a NON-MODAL dialog (Radix `modal={false}`) that is a full-height 400 px column at the right
 *   edge (from 768 px the shell has no top bar, so it starts at the top). The page moves left: `--orrn-buddy-inset`
 *   on `documentElement` pads the tenant shell (its main column and every sticky bar inside it) and moves the Buddy
 *   button, so nothing of the page is under the panel. No overlay, no focus trap, the page stays usable and readable
 *   (nothing `aria-hidden` or inert), `aria-modal="false"`. Focus moves in on open, Escape inside it closes it and
 *   focus goes back to the button. The way back in: the panel follows the button in Tab order, and pressing the
 *   button while the panel is open moves focus into it (`focusOpenPanel`). Chosen over a labelled `aside`: a person
 *   who asked for Buddy keeps the dialog name, the open/close announcements, Escape and the N8 focus return, which an
 *   `aside` (a landmark, no Escape, no focus convention) would drop.
 *
 * Which of these it is gets read once, when the panel opens (review N10): turning a tablet or resizing the window
 * while it is open never remounts it between modal and non-modal, which would move focus and scroll.
 *
 * Streamed text is not announced token by token: one polite live region says the finished answer, or what went wrong.
 */
export function BuddyPanelBody({ open, onOpenChange, chat, drafts, decisions, when }: BuddyPanelBodyProps) {
  const { t } = useT();
  const { state } = chat;
  const [text, setText] = useState("");
  const hintId = useId();
  // Read once per mount: a phone keeps its keyboard down until the person taps the box.
  const [focusBox] = useState(() => !coarsePointer());
  // Docked (non-modal) or a modal sheet, read on each opening only (N10). Set during render on the opening render, so
  // the Sheet never mounts once in the old mode.
  const [mode, setMode] = useState<Mode>(() => (open ? modeNow() : "phone"));
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setMode(modeNow());
  }
  const docked = mode === "docked";
  const modal = !docked;
  const endRef = useRef<HTMLDivElement>(null);

  const byId = new Map((drafts ?? []).map((d) => [d.id, d]));
  const inTurns = new Set(state.turns.flatMap((turn) => turn.draftIds));
  const waiting = (drafts ?? []).filter((d) => d.status === "pending" && !inTurns.has(d.id));
  const leave = () => onOpenChange(false);

  // Phones: Radix hides the page from screen readers and traps focus but does not write `aria-modal`, so the panel marks
  // its own dialog, true to what it is. Non-modal, the shared Sheet writes `aria-modal="false"` itself.
  // A callback ref: the portal mounts the content a render after `open` turns true.
  const markModal = useCallback(
    (el: HTMLDivElement | null) => {
      if (modal) el?.closest("[role='dialog']")?.setAttribute("aria-modal", "true");
    },
    [modal],
  );

  // Docked, the page moves left of the panel. From 768 px, toasts move left of it (N9). A layout effect, so the page
  // never paints one frame under the panel.
  useLayoutEffect(() => {
    if (!open || mode === "phone" || typeof document === "undefined") return;
    const style = document.documentElement.style;
    style.setProperty(TOAST_RIGHT_VAR, mode === "docked" ? TOAST_RIGHT_DOCKED : TOAST_RIGHT_FLOATING);
    if (mode === "docked") style.setProperty(BUDDY_INSET_VAR, DOCK_WIDTH);
    return () => {
      style.removeProperty(TOAST_RIGHT_VAR);
      style.removeProperty(BUDDY_INSET_VAR);
    };
  }, [open, mode]);

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
      drive={decisions.driveFor?.(draft.id) ?? null}
      onStopDrive={decisions.stopDrive}
    />
  );

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      modal={modal}
      title={t("buddy.askOrrn")}
      className={cn(
        docked
          ? // From 1024 px: a full-height column at the right edge, the page beside it. The classes do not depend on
            // the width, so a window made narrower while it is open keeps the mode it opened in (N10).
            [
              "inset-x-auto top-0 right-0 bottom-0 left-auto h-dvh max-h-none w-[400px] max-w-full rounded-none border-t-0 border-l",
              "lg:inset-y-0 lg:right-0 lg:left-auto lg:h-dvh lg:w-[400px] lg:max-w-full lg:rounded-none lg:border-t-0 lg:border-l",
            ]
          : [
              // Phones: the whole screen, over the tab bar.
              "max-md:top-0 max-md:h-dvh max-md:max-h-none max-md:rounded-none max-md:border-t-0",
              // 768 to 1023 px (and a sheet opened there, then widened): about 400 by 600 at the right edge, its bottom
              // 16 px above the closed button (which keeps its sticky-bar lift). Narrower below 828 px, so a toast fits
              // beside it (N9).
              "md:inset-x-auto md:top-auto md:right-6 md:bottom-[calc(max(24px,var(--orrn-toast-bottom,0px))+72px)] md:left-auto md:h-[min(600px,calc(100dvh-96px-max(24px,var(--orrn-toast-bottom,0px))))] md:max-h-none md:w-[min(400px,calc(100vw-404px))] md:max-w-[calc(100vw-3rem)] md:rounded-card md:border",
              "lg:inset-y-auto lg:top-auto lg:right-6 lg:bottom-[calc(max(24px,var(--orrn-toast-bottom,0px))+72px)] lg:h-[min(600px,calc(100dvh-96px-max(24px,var(--orrn-toast-bottom,0px))))] lg:w-[min(400px,calc(100vw-404px))] lg:rounded-card lg:border",
            ],
      )}
      footer={
        <form onSubmit={submit} className="flex w-full min-w-0 items-end gap-2" data-testid="buddy-form">
          <textarea
            value={text}
            onChange={(e) => setText(e.currentTarget.value)}
            onKeyDown={onKeyDown}
            rows={2}
            // The box is where the person starts: focus lands here when the panel opens, not on Close. Not on a phone,
            // where that would open the keyboard over the whole sheet; Radix then focuses the dialog itself.
            autoFocus={focusBox}
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
      <div ref={markModal} className="flex min-w-0 flex-col gap-4" data-testid="buddy-panel" data-dock={docked ? "docked" : "sheet"}>
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
              <TurnView key={turn.id} turn={turn} byId={byId} card={card} onRetry={() => chat.retry(turn.id)} retryDisabled={chat.busy} onLeave={leave} />
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
  onLeave,
}: {
  turn: Turn;
  byId: Map<string, BuddyDraft>;
  card: (draft: BuddyDraft) => ReactNode;
  onRetry(): void;
  retryDisabled: boolean;
  onLeave(): void;
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
            {/* A finished answer: the import review links in it become links (S7). While it streams, plain text, so a
                half-written id never becomes a link. */}
            {turn.phase === "done"
              ? replyParts(turn.reply).map((part, i) =>
                  part.kind === "link" ? (
                    <UiLink
                      key={i}
                      to={part.path}
                      onClick={onLeave}
                      data-testid="buddy-reply-link"
                      className="font-semibold text-foreground underline decoration-1 underline-offset-4 [overflow-wrap:anywhere] hover:decoration-2"
                    >
                      {part.text}
                    </UiLink>
                  ) : (
                    <span key={i}>{part.text}</span>
                  ),
                )
              : turn.reply}
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

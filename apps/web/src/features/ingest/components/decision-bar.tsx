import { Button, IconButton } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { Dialog } from "@orrn/ui/components/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@orrn/ui/components/dropdown-menu";
import { Field, TextInput } from "@orrn/ui/components/field";
import { UiLink } from "@orrn/ui/components/link";
import { Sheet } from "@orrn/ui/components/sheet";
import { cn } from "@orrn/ui/lib/utils";
import { Check, MoreHorizontal } from "lucide-react";
import { useState, type ReactNode, type Ref } from "react";

import {
  HOLD_REASONS,
  holdReason,
  type useDiscardFlow,
  type BarActionId,
  type BarButton,
  type CandidateDetail,
  type DecisionBar as DecisionBarModel,
  type afterDecision,
} from "../lib";
import { ActionButton, Muted, useSay } from "./review-bits";
import { ActionError, chipTone, ReasonText } from "./shared";
import type { ReviewActions } from "./use-review-actions";

/**
 * The review page's decision bar (work order 3.3, M7): one white card, the one loud element of the page. A status chip,
 * the effect sentence, the fit, and the state's buttons. Everything it says and every button it shows comes from
 * `decisionBar(...)`; this file only draws it. The same buttons repeat in a sticky bar under 1024 px (S9).
 */

/** The writes a bar button can start, by id. Toggle and link buttons are handled by the bar itself. */
export type BarPress = (id: BarActionId) => void;

/** The name of the write a button starts, to mark it busy. */
const WRITE_NAME: Partial<Record<BarActionId, string>> = {
  approve: "approve",
  approveAsIs: "approve",
  hold: "hold",
  release: "release",
  useLayout: "useLayout",
  rejectLayout: "rejectLayout",
};

export function BarButtons({
  buttons,
  act,
  onPress,
  artifactId,
  editorOpen,
  editorId,
  botWorking,
  hideGoMerge,
  quiet,
  firstRef,
}: {
  buttons: readonly BarButton[];
  act: Pick<ReviewActions, "busy" | "pending">;
  onPress: BarPress;
  artifactId: string;
  editorOpen: boolean;
  editorId: string;
  botWorking: boolean;
  /** The bar already says "Go to merge" in its own line. */
  hideGoMerge?: boolean;
  /** The sticky copy: the same buttons, no ref. */
  quiet?: boolean;
  firstRef?: Ref<HTMLElement>;
}) {
  const { words } = useSay();
  const shown = buttons.filter((b) => !(hideGoMerge && b.id === "goMerge"));
  return (
    <>
      {shown.map((button, index) => {
        const label = words(button.words);
        const primary = button.variant === "primary";
        const className = cn(primary ? "max-md:w-full" : "max-md:flex-1");
        if (button.mode === "link") {
          const to = button.id === "seeFile" ? `/ingest/files/${artifactId}` : "/ingest";
          return (
            <Button key={button.id} asChild variant="secondary" className={className}>
              <UiLink to={to}>{label}</UiLink>
            </Button>
          );
        }
        const pendingName = WRITE_NAME[button.id];
        const working = (pendingName !== undefined && act.pending === pendingName) || (button.id === "mapForMe" && botWorking);
        return (
          <ActionButton
            key={button.id}
            ref={index === 0 && !quiet ? (firstRef as Ref<HTMLButtonElement>) : undefined}
            variant={primary ? "primary" : "secondary"}
            className={className}
            busy={act.busy || (button.id === "mapForMe" && botWorking)}
            working={working}
            onClick={() => onPress(button.id)}
            {...(button.mode === "toggle" ? { "aria-expanded": editorOpen, "aria-controls": editorId } : {})}
          >
            {label}
          </ActionButton>
        );
      })}
    </>
  );
}

export function BarOverflow({ bar, onDiscard, onIgnore, busy }: { bar: Pick<DecisionBarModel, "overflow" | "moreFor">; onDiscard: () => void; onIgnore: () => void; busy: boolean }) {
  const { words } = useSay();
  if (bar.overflow.length === 0) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton variant="secondary" label={words(bar.moreFor)} icon={<MoreHorizontal strokeWidth={2} />} aria-disabled={busy || undefined} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        {bar.overflow.map((item) => (
          <DropdownMenuItem
            key={item.id}
            // Acts on Enter, Space or a click, one at a time: a held key does not repeat it.
            onSelect={() => {
              if (busy) return;
              if (item.id === "discard") onDiscard();
              else onIgnore();
            }}
            className={cn("min-h-11 text-[15px]", item.id === "discard" && "text-destructive focus:text-destructive")}
          >
            {words(item.words)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function DecisionBarCard({
  candidate,
  bar,
  act,
  onPress,
  onDiscard,
  onIgnore,
  onGoToFirstOpen,
  editorOpen,
  editorId,
  botWorking,
  year,
  after,
  barRef,
  afterRef,
  firstButtonRef,
  notices,
}: {
  candidate: Pick<CandidateDetail, "artifactId" | "state" | "reasonCode" | "reasonDetail" | "block">;
  bar: DecisionBarModel;
  act: ReviewActions;
  onPress: BarPress;
  onDiscard: () => void;
  onIgnore: () => void;
  onGoToFirstOpen: () => void;
  editorOpen: boolean;
  editorId: string;
  botWorking: boolean;
  /** The year line, when this import needs one. */
  year: ReactNode;
  after: ReturnType<typeof afterDecision> | null;
  barRef: Ref<HTMLDivElement>;
  afterRef?: Ref<HTMLParagraphElement>;
  firstButtonRef?: Ref<HTMLElement>;
  /** Extra lines for the state: the helper is off, it gave up, it is working. */
  notices?: ReactNode;
}) {
  const { t, words } = useSay();
  const done = candidate.state === "approved" || candidate.state === "merged";
  const hasPrimary = bar.buttons.some((b) => b.variant === "primary");
  return (
    <div
      ref={barRef}
      tabIndex={-1}
      data-testid="decision-bar"
      data-state={candidate.state}
      className="flex flex-col gap-4 rounded-card border border-border bg-card p-5 shadow-sm outline-none"
    >
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between md:gap-6">
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <Chip tone={chipTone(bar.chip.tone)} truncate={false} dot={!done} title={words(bar.chip.words)}>
              {done ? (
                <span className="inline-flex items-center gap-1">
                  <Check aria-hidden="true" className="size-3 shrink-0" strokeWidth={3} />
                  {words(bar.chip.words)}
                </span>
              ) : (
                words(bar.chip.words)
              )}
            </Chip>
            {bar.sentence ? <p className="m-0 min-w-0 text-[17px] leading-6 font-medium break-words">{words(bar.sentence)}</p> : null}
          </div>
          {bar.refused ? <p className="m-0 text-[14px] leading-5 text-tone-red-ink">{words(bar.refused)}</p> : null}
          {bar.notes.map((note) => (
            <Muted key={note.key}>{words(note)}</Muted>
          ))}
          {bar.fit ? <Muted>{words(bar.fit)}</Muted> : null}
          {bar.reason ? <ReasonText code={bar.reason.code} detail={bar.reason.detail} /> : null}
          {candidate.state === "failed" ? (
            candidate.reasonCode ? (
              <ReasonText code={candidate.reasonCode} detail={candidate.reasonDetail} />
            ) : (
              <Muted>{t("ingest.read.failed")}</Muted>
            )
          ) : null}
          {candidate.block.readBy === "model" && candidate.block.modelChecked ? <Muted>{t("ingest.vision.check")}</Muted> : null}
          {bar.blocked ? (
            <p className="m-0 text-[14px] leading-5 font-medium text-tone-amber-ink">
              <a
                href="#review-first-open"
                className="inline-flex min-h-6 items-center underline underline-offset-4"
                onClick={(event) => {
                  event.preventDefault();
                  onGoToFirstOpen();
                }}
              >
                {words(bar.blocked.words)}
              </a>
            </p>
          ) : null}
        </div>
        {bar.buttons.length > 0 || bar.overflow.length > 0 ? (
          <div className="flex min-w-0 flex-wrap items-center gap-3 md:shrink-0 md:justify-end">
            <BarButtons
              buttons={bar.buttons}
              act={act}
              onPress={onPress}
              artifactId={candidate.artifactId}
              editorOpen={editorOpen}
              editorId={editorId}
              botWorking={botWorking}
              hideGoMerge={Boolean(after?.goMerge)}
              firstRef={firstButtonRef}
            />
            <BarOverflow bar={bar} onDiscard={onDiscard} onIgnore={onIgnore} busy={act.busy} />
          </div>
        ) : null}
      </div>
      {notices}
      {year ? <div className="border-t border-border pt-4">{year}</div> : null}
      {after ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3 border-t border-border pt-4">
          <p ref={afterRef} tabIndex={-1} className="m-0 min-w-0 flex-1 text-[15px] font-medium break-words outline-none">
            <AfterText words={after.words} />
          </p>
          <div className="flex flex-wrap gap-3">
            {after.next ? (
              <Button asChild variant={hasPrimary ? "secondary" : "primary"}>
                <UiLink to={`/ingest/review/${after.next.id}`}>{t("ingest.action.nextNeedsYou")}</UiLink>
              </Button>
            ) : null}
            {after.goMerge ? (
              <Button asChild variant="secondary">
                <UiLink to="/ingest">{t("ingest.action.goMerge")}</UiLink>
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
      <ActionError error={act.failed("bar")} onCheckAgain={() => onPress("release")} busy={act.busy} />
    </div>
  );
}

function AfterText({ words }: { words: { key: string; vars?: Record<string, string | number> } }) {
  const { say } = useSay();
  return <>{say(words.key, words.vars)}</>;
}

/** Hold opens a sheet: a few reasons to tap and a text field. The reason is optional (S5). */
export function HoldSheet({
  open,
  onOpenChange,
  act,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  act: Pick<ReviewActions, "hold" | "busy" | "pending" | "failed">;
}) {
  const { t, say } = useSay();
  const [chip, setChip] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const confirm = async () => {
    if (act.busy) return;
    const ok = await act.hold(holdReason(say, chip, typed));
    if (ok) {
      onOpenChange(false);
      setChip(null);
      setTyped("");
    }
  };
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!act.busy) onOpenChange(next);
      }}
      title={t("ingest.hold.title")}
      dismissible={!act.busy}
      footer={
        <>
          <Button variant="secondary" aria-disabled={act.busy || undefined} onClick={() => !act.busy && onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <ActionButton busy={act.busy} working={act.pending === "hold"} onClick={() => void confirm()}>
            {t("ingest.action.hold")}
          </ActionButton>
        </>
      }
    >
      <div className="flex flex-col gap-4 pt-1">
        <div role="group" aria-label={t("ingest.hold.title")} className="flex flex-wrap gap-2">
          {HOLD_REASONS.map((reason) => {
            const on = chip === reason.id;
            return (
              <Button
                key={reason.id}
                variant="secondary"
                aria-pressed={on}
                className={cn(on && "border-foreground bg-surface-sunken")}
                onClick={() => setChip(on ? null : reason.id)}
              >
                {on ? <Check aria-hidden="true" className="size-4" strokeWidth={2.5} /> : null}
                {t(reason.key as never)}
              </Button>
            );
          })}
        </div>
        <Field label={t("common.note")}>
          <TextInput value={typed} maxLength={300} onChange={(event) => setTyped(event.currentTarget.value)} />
        </Field>
        <ActionError error={act.failed("bar")} />
      </div>
    </Sheet>
  );
}

/** Discard asks first: a slip loses a file of rows (M16). The words come from `discardWords`. */
export function DiscardDialog({ flow }: { flow: ReturnType<typeof useDiscardFlow> }) {
  const { words } = useSay();
  return (
    <Dialog
      open={flow.open}
      onOpenChange={(next) => {
        if (!next) flow.cancel();
      }}
      title={words(flow.words.title)}
      description={words(flow.words.body)}
      actions={
        <>
          <Button variant="secondary" aria-disabled={flow.working || undefined} onClick={() => flow.cancel()}>
            {words(flow.words.keep)}
          </Button>
          <ActionButton variant="danger" busy={flow.working} working={flow.working} onClick={() => void flow.confirm()}>
            {words(flow.words.confirm)}
          </ActionButton>
        </>
      }
    >
      <ActionError error={flow.error} />
    </Dialog>
  );
}

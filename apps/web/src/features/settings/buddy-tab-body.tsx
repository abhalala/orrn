import { useT, type Translate } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { Dialog, DialogCloseButton } from "@orrn/ui/components/dialog";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { Copy, KeyRound } from "lucide-react";
import { useState, type ReactNode } from "react";

import { DraftCard } from "@/features/buddy/draft-card";
import type { DraftDecisions } from "@/features/buddy/panel-body";
import type { BuddyDraft } from "@/features/buddy/types";
import { Can } from "@/shared/components/can";

import { Note } from "./ui";

/** `buddy.status` (design §13). */
export type BuddyStatus = {
  available: boolean;
  listed: boolean;
  connected: { grantId: string; createdAt: string; lastUsedAt: string | null; expiresAt: string | null } | null;
};

/** One row of `buddy.calls.list`. */
export type BuddyCall = {
  id: string;
  tool: string;
  path: string | null;
  outcome: string;
  ms: number;
  platform: string | null;
  at: string;
};

type Loadable<T> = { isPending: boolean; isError: boolean; data: T | undefined; refetch(): unknown };

export type BuddyTabBodyProps = {
  status: Loadable<BuddyStatus>;
  calls: Loadable<readonly BuddyCall[]>;
  drafts: Loadable<readonly BuddyDraft[]>;
  decisions: DraftDecisions;
  when: (at: string | number | Date) => string;
  connect(): void;
  connecting: boolean;
  connectError: string | null;
  /** The key from "Connect Hermes", held only until the person says they copied it. */
  token: string | null;
  onTokenDone(): void;
  revoke(grantId: string): void;
  revoking: boolean;
  copy(text: string): Promise<boolean>;
};

const OUTCOME_TONE: Record<string, "green" | "amber" | "red" | "neutral"> = {
  ok: "green",
  truncated: "green",
  needs_confirm: "amber",
  forbidden: "red",
  not_found: "neutral",
  invalid: "red",
  rate_limited: "amber",
  error: "red",
};
const OUTCOMES = ["ok", "needs_confirm", "forbidden", "not_found", "invalid", "rate_limited", "error", "truncated"] as const;
type KnownOutcome = (typeof OUTCOMES)[number];
const isKnownOutcome = (o: string): o is KnownOutcome => (OUTCOMES as readonly string[]).includes(o);

function Card({ children, labelledBy, testId }: { children: ReactNode; labelledBy?: string; testId?: string }) {
  return (
    <section aria-labelledby={labelledBy} data-testid={testId} className="flex min-w-0 flex-col gap-3 rounded-card border border-border bg-card p-4 sm:p-5">
      {children}
    </section>
  );
}

function LoadFailed({ onRetry }: { onRetry(): void }) {
  const { t } = useT();
  return (
    <div className="rounded-card border border-border bg-card">
      <EmptyState
        title={t("buddy.settings.loadFailed")}
        action={
          <Button variant="secondary" onClick={onRetry}>
            {t("common.retry")}
          </Button>
        }
      />
    </div>
  );
}

/**
 * Settings > Buddy (design §7, §13), owner only: connect Hermes (the key is shown once), disconnect it, when it was
 * last used, the last 100 calls and the changes Buddy prepared. A plant that is not in `BUDDY_COMPANIES` is told so
 * and sees nothing else.
 */
export function BuddyTabBody(props: BuddyTabBodyProps) {
  const { t } = useT();
  const { status, calls, drafts, when } = props;
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [copied, setCopied] = useState<"ok" | "failed" | null>(null);

  if (status.isPending) return <Skeleton className="h-40 w-full rounded-card" aria-busy="true" />;
  if (status.isError || !status.data) return <LoadFailed onRetry={() => void status.refetch()} />;
  const s = status.data;

  if (!s.listed) {
    return (
      <div className="flex min-w-0 flex-col gap-4" data-testid="settings-buddy">
        <div className="rounded-card border border-border bg-card p-4 sm:p-5">
          <p className="m-0 text-[15px] leading-6" data-testid="buddy-not-listed">
            {t("buddy.settings.notListed")}
          </p>
        </div>
      </div>
    );
  }

  const connected = s.connected;
  return (
    <div className="flex min-w-0 flex-col gap-5" data-testid="settings-buddy">
      <p className="m-0 max-w-[65ch] text-[15px] leading-6 text-muted-foreground">{t("buddy.settings.intro")}</p>
      {!s.available ? <Note testId="buddy-not-available">{t("buddy.settings.notAvailable")}</Note> : null}

      <Card labelledBy="buddy-connection" testId="buddy-connection">
        <h2 id="buddy-connection" className="m-0 text-[17px] font-semibold">
          {t("buddy.settings.connection")}
        </h2>
        {connected ? (
          <>
            <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[15px] leading-6">
              <li>{t("buddy.settings.connectedOn", { time: when(connected.createdAt) })}</li>
              <li data-testid="buddy-last-used">
                {connected.lastUsedAt ? t("buddy.settings.lastUsed", { time: when(connected.lastUsedAt) }) : t("buddy.settings.neverUsed")}
              </li>
              {connected.expiresAt ? <li>{t("buddy.settings.endsOn", { time: when(connected.expiresAt) })}</li> : null}
            </ul>
            <Can do="buddy.use">
              <div>
                <Button variant="secondary" onClick={() => setConfirmRevoke(true)} data-testid="buddy-revoke">
                  {t("buddy.settings.revoke")}
                </Button>
              </div>
            </Can>
          </>
        ) : props.token ? null : (
          <>
            <p className="m-0 text-[15px] leading-6">{t("buddy.settings.notConnected")}</p>
            {props.connectError ? (
              <p role="alert" className="m-0 text-[14px] text-destructive">
                {props.connectError}
              </p>
            ) : null}
            <Can do="buddy.use">
              <div>
                <Button onClick={props.connect} loading={props.connecting} data-testid="buddy-connect">
                  {t("buddy.settings.connect")}
                </Button>
              </div>
            </Can>
          </>
        )}

        {props.token ? (
          <div className="flex min-w-0 flex-col gap-3 rounded-card bg-surface-sunken p-3.5" data-testid="buddy-key">
            <h3 className="m-0 flex items-center gap-2 text-[15px] font-semibold">
              <KeyRound aria-hidden="true" className="size-4" strokeWidth={2} />
              {t("buddy.settings.keyTitle")}
            </h3>
            <p role="status" className="m-0 rounded-card bg-tone-amber-tint px-3 py-2 text-[14px] leading-5 text-tone-amber-ink" data-testid="buddy-key-once">
              {t("buddy.settings.keyOnce")}
            </p>
            <label className="flex min-w-0 flex-col gap-1.5">
              <span className="text-[13px] font-semibold text-muted-foreground">{t("buddy.settings.keyLabel")}</span>
              <input
                readOnly
                value={props.token}
                onFocus={(e) => e.currentTarget.select()}
                spellCheck={false}
                autoComplete="off"
                data-testid="buddy-key-value"
                className="min-h-11 w-full min-w-0 rounded-input border border-input bg-card px-3 font-mono text-[14px] text-foreground"
              />
            </label>
            {copied ? (
              <p role="status" className={copied === "ok" ? "m-0 text-[14px]" : "m-0 text-[14px] text-destructive"} data-testid="buddy-key-copied">
                {copied === "ok" ? t("buddy.settings.copied") : t("buddy.settings.copyFailed")}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                onClick={() => void props.copy(props.token ?? "").then((ok) => setCopied(ok ? "ok" : "failed"))}
                data-testid="buddy-key-copy"
              >
                <Copy aria-hidden="true" className="size-4" strokeWidth={2} />
                {t("buddy.settings.copy")}
              </Button>
              <Button
                onClick={() => {
                  setCopied(null);
                  props.onTokenDone();
                }}
                data-testid="buddy-key-done"
              >
                {t("buddy.settings.keyDone")}
              </Button>
            </div>
          </div>
        ) : null}
      </Card>

      <Card labelledBy="buddy-drafts" testId="buddy-drafts">
        <h2 id="buddy-drafts" className="m-0 text-[17px] font-semibold">
          {t("buddy.settings.drafts")}
        </h2>
        {drafts.isPending ? (
          <Skeleton className="h-20 w-full rounded-card" aria-busy="true" />
        ) : drafts.isError || !drafts.data ? (
          <LoadFailed onRetry={() => void drafts.refetch()} />
        ) : drafts.data.length === 0 ? (
          <p className="m-0 text-[15px] text-muted-foreground">{t("buddy.settings.draftsEmpty")}</p>
        ) : (
          <div className="flex min-w-0 flex-col gap-3">
            {drafts.data.map((draft) => (
              <DraftCard
                key={draft.id}
                draft={draft}
                when={when}
                pending={props.decisions.pendingFor(draft.id)}
                error={props.decisions.errorFor(draft.id)}
                onConfirm={props.decisions.confirm}
                onReject={props.decisions.reject}
              />
            ))}
          </div>
        )}
      </Card>

      <Card labelledBy="buddy-calls" testId="buddy-calls">
        <h2 id="buddy-calls" className="m-0 text-[17px] font-semibold">
          {t("buddy.settings.calls")}
        </h2>
        {calls.isPending ? (
          <Skeleton className="h-20 w-full rounded-card" aria-busy="true" />
        ) : calls.isError || !calls.data ? (
          <LoadFailed onRetry={() => void calls.refetch()} />
        ) : calls.data.length === 0 ? (
          <p className="m-0 text-[15px] text-muted-foreground">{t("buddy.settings.callsEmpty")}</p>
        ) : (
          <ul className="m-0 flex list-none flex-col divide-y divide-border p-0" data-testid="buddy-call-list">
            {calls.data.map((call) => (
              <li key={call.id} className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 py-2.5" data-testid="buddy-call">
                <span className="min-w-0 flex-1 basis-48 font-mono text-[13px] [overflow-wrap:anywhere]">
                  <span className="sr-only">{t("buddy.settings.callPath")}: </span>
                  {call.path ?? call.tool}
                </span>
                <Chip tone={OUTCOME_TONE[call.outcome] ?? "neutral"} truncate={false}>
                  {isKnownOutcome(call.outcome) ? t(`buddy.settings.outcome.${call.outcome}`) : call.outcome}
                </Chip>
                <span className="w-full text-[13px] text-muted-foreground">
                  {when(call.at)} · {t("buddy.settings.callMs", { ms: call.ms })}
                  {call.platform ? `, ${platformWord(t, call.platform)}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Dialog
        open={confirmRevoke}
        onOpenChange={setConfirmRevoke}
        title={t("buddy.settings.revokeTitle")}
        description={t("buddy.settings.revokeBody")}
        actions={
          <>
            <DialogCloseButton onPress={() => setConfirmRevoke(false)} />
            <Button
              variant="danger"
              loading={props.revoking}
              data-testid="buddy-revoke-confirm"
              onClick={() => {
                if (connected) props.revoke(connected.grantId);
                setConfirmRevoke(false);
              }}
            >
              {t("buddy.settings.revoke")}
            </Button>
          </>
        }
      />
    </div>
  );
}

function platformWord(t: Translate, platform: string): string {
  if (platform === "api_server" || platform === "telegram") return t(`buddy.settings.platform.${platform}`);
  return platform;
}

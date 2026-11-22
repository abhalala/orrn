import { env } from "@orrn/env/web";
import { useT } from "@orrn/i18n";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useRouterState } from "@tanstack/react-router";
import { useCallback, useMemo, useRef, useState } from "react";

import { useCompanyWhen } from "@/features/stock/use-company-when";
import { serverRefusal } from "@/features/shared/server-refusal";
import { useMe } from "@/shared/lib/me";
import { INLINE_ERROR_META } from "@/shared/lib/query-errors";
import { isAuthMeQueryKey } from "@/shared/lib/tenant-cache";
import { queryClient, trpc, trpcClient } from "@/shared/utils/trpc";

import { isConfirmBlocked } from "./draft-card";
import { BuddyPanelBody, type DraftDecisions } from "./panel-body";
import type { BuddyDraft } from "./types";
import { conversationKey, useBuddyChat } from "./use-buddy-chat";
import { useDryRunDrive, type DriveApi } from "./use-dry-run-drive";

/** How often the open panel reads the drafts list again (design §4.4: poll, and refresh after each turn). */
const DRAFTS_POLL_MS = 15_000;

/**
 * The lazy half of the bubble: the chat, the drafts list and the Confirm and Reject calls, wired to the server. Loaded
 * on the first open and kept mounted by `BuddyLauncher`, keyed on plant and person.
 */
export default function BuddyPanel({ open, onOpenChange }: { open: boolean; onOpenChange(open: boolean): void }) {
  const { t } = useT();
  const when = useCompanyWhen();
  const { data: me } = useMe();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const pathRef = useRef(pathname);
  pathRef.current = pathname;
  const screen = useCallback(() => pathRef.current, []);

  const drafts = useQuery({
    ...trpc.buddy.drafts.listMine.queryOptions(),
    enabled: open,
    refetchInterval: open ? DRAFTS_POLL_MS : false,
    meta: INLINE_ERROR_META,
  });
  const refreshDrafts = useCallback(() => void queryClient.invalidateQueries({ queryKey: trpc.buddy.drafts.listMine.queryKey() }), []);

  const chat = useBuddyChat({
    url: `${env.VITE_SERVER_URL}/buddy/chat`,
    storageKey: conversationKey(me?.company?.id ?? "none", me?.user.id ?? "none"),
    screen,
    onDrafts: refreshDrafts,
  });

  const [pending, setPending] = useState<{ id: string; kind: "confirm" | "reject" } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const confirm = useMutation(trpc.buddy.drafts.confirm.mutationOptions());
  const reject = useMutation(trpc.buddy.drafts.reject.mutationOptions());

  // A confirmed row-check draft: the bubble runs `ingest.dryRun.step` under this session, then reports (decision 8).
  const driveApi = useMemo<DriveApi>(
    () => ({
      read: async (candidateId) => {
        const c = await trpcClient.ingest.candidate.get.query({ candidateId });
        return { cursor: c.dryCursor, running: c.state === "processing", counts: c.counts };
      },
      step: (candidateId, expectCursor) => trpcClient.ingest.dryRun.step.mutate({ candidateId, expectCursor }),
      report: (draftId, outcome) => trpcClient.buddy.drafts.report.mutate({ draftId, outcome }),
      refresh: () => void queryClient.invalidateQueries({ predicate: (q) => !isAuthMeQueryKey(q.queryKey) }),
    }),
    [],
  );
  const drive = useDryRunDrive(drafts.data, driveApi);

  const decisions = useMemo<DraftDecisions>(() => {
    const clearError = (id: string) =>
      setErrors((prev) => {
        if (!(id in prev)) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      });
    const decide = (draft: BuddyDraft, kind: "confirm" | "reject") => {
      if (pending) return;
      clearError(draft.id);
      setPending({ id: draft.id, kind });
      const mutation = kind === "confirm" ? confirm : reject;
      // No note from here: the server tells Hermes the draft's real final state with the next turn (decision 7).
      mutation.mutate(
        { draftId: draft.id, via: "bubble" },
        {
          onSuccess: () => {
            if (kind === "confirm") {
              // The confirmed procedure changed the plant: every screen's data may be stale now.
              void queryClient.invalidateQueries({ predicate: (q) => !isAuthMeQueryKey(q.queryKey) });
            } else {
              refreshDrafts();
            }
          },
          onError: (error) => {
            setErrors((prev) => ({ ...prev, [draft.id]: kind !== "confirm" ? t("buddy.draft.rejectFailed") : isConfirmBlocked(error) ? t("buddy.draft.blocked.other") : serverRefusal(t, error) }));
            refreshDrafts();
          },
          onSettled: () => setPending(null),
        },
      );
    };
    return {
      pendingFor: (id) => (pending?.id === id ? pending.kind : null),
      errorFor: (id) => errors[id] ?? null,
      confirm: (draft) => decide(draft, "confirm"),
      reject: (draft) => decide(draft, "reject"),
      driveFor: drive.driveFor,
      stopDrive: drive.stop,
    };
  }, [pending, errors, confirm, reject, refreshDrafts, t, drive.driveFor, drive.stop]);

  return (
    <BuddyPanelBody
      open={open}
      onOpenChange={onOpenChange}
      chat={chat}
      drafts={drafts.data}
      decisions={decisions}
      when={when}
    />
  );
}

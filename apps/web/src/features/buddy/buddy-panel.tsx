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
import { queryClient, trpc } from "@/shared/utils/trpc";

import { draftNote } from "./chat-model";
import { BuddyPanelBody, type DraftDecisions } from "./panel-body";
import type { BuddyDraft } from "./types";
import { conversationKey, useBuddyChat } from "./use-buddy-chat";

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
      mutation.mutate(
        { draftId: draft.id },
        {
          onSuccess: (row) => {
            const status = (row as { status?: string } | undefined)?.status;
            const failed = status === "failed";
            chat.addNote(draftNote(draft, kind === "reject" ? "rejected" : failed ? "failed" : "confirmed"));
            if (kind === "confirm") {
              // The confirmed procedure changed the plant: every screen's data may be stale now.
              void queryClient.invalidateQueries({ predicate: (q) => !isAuthMeQueryKey(q.queryKey) });
            } else {
              refreshDrafts();
            }
          },
          onError: (error) => {
            setErrors((prev) => ({ ...prev, [draft.id]: kind === "confirm" ? serverRefusal(t, error) : t("buddy.draft.rejectFailed") }));
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
    };
  }, [pending, errors, confirm, reject, chat, refreshDrafts, t]);

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

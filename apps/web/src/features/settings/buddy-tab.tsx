import { useT } from "@orrn/i18n";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import type { DraftDecisions } from "@/features/buddy/panel-body";
import type { BuddyDraft } from "@/features/buddy/types";
import { serverRefusal } from "@/features/shared/server-refusal";
import { useCompanyWhen } from "@/features/stock/use-company-when";
import { INLINE_ERROR_META } from "@/shared/lib/query-errors";
import { isAuthMeQueryKey } from "@/shared/lib/tenant-cache";
import { queryClient, trpc } from "@/shared/utils/trpc";

import { BuddyTabBody } from "./buddy-tab-body";

/** Copies text to the clipboard; false when the browser refuses (no permission, an insecure page). */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Settings > Buddy, wired to the `buddy` router (design §13). The body is `buddy-tab-body.tsx`. */
export function BuddyTab() {
  const { t } = useT();
  const when = useCompanyWhen();
  const status = useQuery({ ...trpc.buddy.status.queryOptions(), meta: INLINE_ERROR_META });
  const listed = status.data?.listed === true;
  const calls = useQuery({ ...trpc.buddy.calls.list.queryOptions(), enabled: listed, meta: INLINE_ERROR_META });
  const drafts = useQuery({ ...trpc.buddy.drafts.listMine.queryOptions(), enabled: listed, meta: INLINE_ERROR_META });

  // The key lives here only, never in the query cache: it is gone once the person says they copied it.
  const [token, setToken] = useState<string | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);

  const refreshAccess = () => {
    void queryClient.invalidateQueries({ queryKey: trpc.buddy.status.queryKey() });
    // `auth.me.buddy` turns the floating button on or off.
    void queryClient.invalidateQueries({ queryKey: trpc.auth.me.queryKey() });
  };

  const create = useMutation(
    trpc.buddy.grant.create.mutationOptions({
      onSuccess: (data) => {
        setToken(data.token);
        setConnectError(null);
        refreshAccess();
      },
      onError: () => setConnectError(t("buddy.settings.connectFailed")),
    }),
  );
  const revoke = useMutation(
    trpc.buddy.grant.revoke.mutationOptions({
      onSuccess: () => {
        toast.success(t("buddy.settings.revoked"));
        refreshAccess();
      },
      onError: () => toast.error(t("buddy.settings.revokeFailed")),
    }),
  );

  const [pending, setPending] = useState<{ id: string; kind: "confirm" | "reject" } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const confirm = useMutation(trpc.buddy.drafts.confirm.mutationOptions());
  const reject = useMutation(trpc.buddy.drafts.reject.mutationOptions());

  const decisions = useMemo<DraftDecisions>(() => {
    const decide = (draft: BuddyDraft, kind: "confirm" | "reject") => {
      if (pending) return;
      setErrors((prev) => {
        if (!(draft.id in prev)) return prev;
        const next = { ...prev };
        delete next[draft.id];
        return next;
      });
      setPending({ id: draft.id, kind });
      (kind === "confirm" ? confirm : reject).mutate(
        { draftId: draft.id },
        {
          onSuccess: () => {
            if (kind === "confirm") void queryClient.invalidateQueries({ predicate: (q) => !isAuthMeQueryKey(q.queryKey) });
            else void queryClient.invalidateQueries({ queryKey: trpc.buddy.drafts.listMine.queryKey() });
          },
          onError: (error) => {
            setErrors((prev) => ({ ...prev, [draft.id]: kind === "confirm" ? serverRefusal(t, error) : t("buddy.draft.rejectFailed") }));
            void queryClient.invalidateQueries({ queryKey: trpc.buddy.drafts.listMine.queryKey() });
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
  }, [pending, errors, confirm, reject, t]);

  return (
    <BuddyTabBody
      status={status}
      calls={calls}
      drafts={drafts}
      decisions={decisions}
      when={when}
      connect={() => create.mutate()}
      connecting={create.isPending}
      connectError={connectError}
      token={token}
      onTokenDone={() => {
        setToken(null);
        // The mutation keeps its last answer (the key) until reset.
        create.reset();
      }}
      revoke={(grantId) => revoke.mutate({ grantId })}
      revoking={revoke.isPending}
      copy={copyText}
    />
  );
}

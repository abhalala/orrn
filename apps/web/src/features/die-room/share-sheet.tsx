import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { Dialog } from "@orrn/ui/components/dialog";
import { Field, TextInput } from "@orrn/ui/components/field";
import { SegmentedControl } from "@orrn/ui/components/segmented-control";
import { Sheet } from "@orrn/ui/components/sheet";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Check, Copy, Send } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { requestIdFor } from "@/features/dispatch/request-key";
import { useOnceMutation } from "@/shared/lib/once-mutation";
import { INLINE_ERROR_META } from "@/shared/lib/query-errors";
import { trpc, trpcClient } from "@/shared/utils/trpc";

import { CustomerSearchPicker, type PickedParty } from "./pickers";
import { shortDate } from "./die-room-model";
import {
  canRevokeShare,
  DEFAULT_SHARE_DAYS,
  openedWords,
  sectionLabel,
  SHARE_DAY_CHOICES,
  shareLink,
  shareStatusTone,
  type ShareDays,
  type ShareStatus,
} from "./share-model";
import { useRefreshDieRoom, useRefusal } from "./use-die-room";

const PAGE = 20;

/**
 * Share a section's press drawing (FP-DR-20): pick who it is for and how long it stays open, copy the
 * link (shown once), and revoke links already sent. Opened from the die card and the section page.
 */
export function ShareSheet({ open, onOpenChange, sectionId }: { open: boolean; onOpenChange(open: boolean): void; sectionId: string }) {
  // Mounted only while open: closing forgets the link that was just made.
  return open ? <Body onOpenChange={onOpenChange} sectionId={sectionId} /> : null;
}

function Body({ onOpenChange, sectionId }: { onOpenChange(open: boolean): void; sectionId: string }) {
  const { t } = useT();
  const refresh = useRefreshDieRoom();
  const refusal = useRefusal();
  const section = useQuery({ ...trpc.die.get.queryOptions({ id: sectionId }), meta: INLINE_ERROR_META });
  const [party, setParty] = useState<PickedParty | null>(null);
  const [days, setDays] = useState<ShareDays>(DEFAULT_SHARE_DAYS);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [made, setMade] = useState<{ link: string } | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);

  const data = section.data;
  const owner = data?.ownerCustomerId ? { id: data.ownerCustomerId, name: data.ownerName ?? "" } : null;
  const hasDrawing = Boolean(data?.drawingKey);

  const request = useRef<{ id: string; body: string } | null>(null);
  const create = useOnceMutation({
    ...trpc.die.share.create.mutationOptions(),
    onSuccess: async (res) => {
      request.current = null;
      setMade({ link: shareLink(window.location.origin, res.path) });
      setError(null);
      await refresh();
    },
    onError: (e) => setError(refusal(e)),
  });
  const revoke = useOnceMutation({
    ...trpc.die.share.revoke.mutationOptions(),
    onSuccess: async () => {
      setRevoking(null);
      await refresh();
      toast.success(t("dieRoom.share.revokedToast"));
    },
    onError: (e) => {
      setRevoking(null);
      toast.error(refusal(e));
    },
  });

  const submit = () => {
    setError(null);
    const body = {
      sectionId,
      days,
      ...((owner ?? party)?.id ? { customerId: (owner ?? party)!.id } : {}),
      ...(note.trim() ? { note: note.trim() } : {}),
    };
    // One replay key per request (final fixes 5, M4): the same form sent again after an unsure answer makes no second link.
    request.current = requestIdFor(request.current, body);
    create.mutate({ ...body, clientMutationId: request.current.id });
  };

  const label = data ? sectionLabel(data) : "";
  return (
    <>
      <Sheet
        open
        onOpenChange={onOpenChange}
        title={t("dieRoom.share.title", { section: label })}
        description={t("dieRoom.share.description")}
        footer={
          <>
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              {t("common.close")}
            </Button>
            {made ? null : (
              <Button onClick={submit} loading={create.isPending} disabled={!hasDrawing || !data} data-testid="share-create">
                {t("dieRoom.share.create")}
              </Button>
            )}
          </>
        }
      >
        <div className="flex flex-col gap-5" data-testid="share-sheet">
          {section.isPending ? (
            <Skeleton className="h-24 rounded-card" />
          ) : data && !hasDrawing ? (
            <p role="status" className="m-0 rounded-card border border-border bg-tone-amber-tint p-3 text-[14px] leading-6">
              {t("dieRoom.share.noDrawing")}
            </p>
          ) : made ? (
            <MadeLink link={made.link} onAnother={() => setMade(null)} />
          ) : (
            <form
              className="flex flex-col gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                submit();
              }}
            >
              {owner ? (
                <p className="m-0 text-[14px] leading-6" data-testid="share-owner-note">
                  {t("dieRoom.share.partyOwner", { name: owner.name })}
                </p>
              ) : (
                <CustomerSearchPicker
                  label={t("dieRoom.share.partyLabel")}
                  hint={t("dieRoom.share.partyOptional")}
                  value={party?.id ?? null}
                  valueLabel={party?.name}
                  onChange={setParty}
                  placeholder={t("dieRoom.share.partyPlaceholder")}
                />
              )}
              <Field label={t("dieRoom.share.daysLabel")}>
                <SegmentedControl<string>
                  label={t("dieRoom.share.daysLabel")}
                  value={String(days)}
                  onChange={(v) => setDays(Number(v) as ShareDays)}
                  options={SHARE_DAY_CHOICES.map((n) => ({ value: String(n), label: n === 1 ? t("dieRoom.share.dayOne") : t("dieRoom.share.dayMany", { n }) }))}
                />
              </Field>
              <Field label={t("dieRoom.share.noteLabel")} hint={t("dieRoom.share.noteHint")}>
                <TextInput value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} />
              </Field>
              {error ? (
                <p role="alert" className="m-0 text-[14px] leading-5 font-medium text-destructive">
                  {error}
                </p>
              ) : null}
            </form>
          )}

          <SentLinks sectionId={sectionId} onRevoke={setRevoking} />
        </div>
      </Sheet>

      <Dialog
        open={revoking !== null}
        onOpenChange={(o) => {
          if (!o && !revoke.isPending) setRevoking(null);
        }}
        title={t("dieRoom.share.revokeTitle")}
        description={t("dieRoom.share.revokeBody")}
        actions={
          <>
            <Button variant="secondary" disabled={revoke.isPending} onClick={() => setRevoking(null)}>
              {t("common.cancel")}
            </Button>
            <Button variant="danger" loading={revoke.isPending} onClick={() => revoking && revoke.mutate({ id: revoking })} data-testid="share-revoke-confirm">
              {t("dieRoom.share.revoke")}
            </Button>
          </>
        }
      />
    </>
  );
}

/** The link just made, with Copy (and the system share sheet where the browser has one). */
function MadeLink({ link, onAnother }: { link: string; onAnother(): void }) {
  const { t } = useT();
  const [done, setDone] = useState(false);
  const timer = useRef(0);
  const canSend = typeof navigator !== "undefined" && typeof navigator.share === "function";
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      toast.success(t("dieRoom.share.copied"));
      setDone(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setDone(false), 1600);
    } catch {
      toast.error(t("dieRoom.share.copyFailed"));
    }
  };
  return (
    <section className="flex min-w-0 flex-col gap-3" aria-labelledby="share-ready">
      <p id="share-ready" className="m-0 text-[14px] leading-6 font-medium" role="status">
        {t("dieRoom.share.ready")}
      </p>
      <div className="flex min-w-0 flex-col gap-1.5">
        <p className="m-0 text-[14px] font-semibold leading-5">{t("dieRoom.share.linkLabel")}</p>
        <code
          data-no-truncate=""
          data-testid="share-link"
          className="min-w-0 rounded-input border border-border bg-surface-sunken px-3 py-2.5 font-mono text-[13px] leading-5 text-foreground [overflow-wrap:anywhere]"
        >
          {link}
        </code>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={copy} data-testid="share-copy">
          {done ? <Check aria-hidden="true" strokeWidth={2} /> : <Copy aria-hidden="true" strokeWidth={2} />}
          {done ? t("dieRoom.share.copied") : t("dieRoom.share.copy")}
        </Button>
        {canSend ? (
          <Button
            variant="secondary"
            onClick={() => {
              void navigator.share({ url: link }).catch(() => undefined);
            }}
          >
            <Send aria-hidden="true" strokeWidth={2} />
            {t("dieRoom.share.send")}
          </Button>
        ) : null}
        <Button variant="ghost" onClick={onAnother}>
          {t("dieRoom.share.create")}
        </Button>
      </div>
    </section>
  );
}

/** Links already sent for this section, newest first, with Revoke on the open ones. */
function SentLinks({ sectionId, onRevoke }: { sectionId: string; onRevoke(id: string): void }) {
  const { t } = useT();
  const list = useInfiniteQuery({
    queryKey: [...trpc.die.share.list.queryKey({ sectionId }), "pages"],
    queryFn: ({ pageParam }) => trpcClient.die.share.list.query({ sectionId, limit: PAGE, ...(pageParam ? { cursor: pageParam } : {}) }),
    initialPageParam: "",
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    meta: INLINE_ERROR_META,
  });
  const items = (list.data?.pages ?? []).flatMap((p) => p.items);
  return (
    <section className="flex min-w-0 flex-col gap-2" aria-labelledby="share-list-title">
      <h3 id="share-list-title" className="m-0 text-[15px] leading-6 font-semibold">
        {t("dieRoom.share.listTitle")}
      </h3>
      {list.isPending ? (
        <Skeleton className="h-16 rounded-card" />
      ) : list.isError ? (
        <p role="alert" className="m-0 text-[14px] text-destructive">
          {t("dieRoom.share.listError")}
        </p>
      ) : items.length === 0 ? (
        <p className="m-0 text-[14px] text-muted-foreground" data-testid="share-empty">
          {t("dieRoom.share.listEmpty")}
        </p>
      ) : (
        <ul className="m-0 flex list-none flex-col overflow-hidden rounded-card border border-border bg-card p-0" data-testid="share-list">
          {items.map((item) => {
            const opened = openedWords(item.viewCount);
            return (
              <li key={item.id} data-testid={`share-row-${item.id}`} className="flex min-w-0 flex-col gap-1.5 border-b border-border p-3 last:border-b-0">
                <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                  <Chip tone={shareStatusTone(item.status as ShareStatus)} truncate={false}>
                    {t(statusKey(item.status as ShareStatus))}
                  </Chip>
                  {canRevokeShare(item.status as ShareStatus) ? (
                    <Button variant="secondary" onClick={() => onRevoke(item.id)} data-testid={`share-revoke-${item.id}`}>
                      {t("dieRoom.share.revoke")}
                    </Button>
                  ) : null}
                </div>
                <p className="m-0 text-[14px] leading-5 font-medium break-words">
                  {item.partyName ? t("dieRoom.share.forParty", { name: item.partyName }) : t("dieRoom.share.forNobody")}
                </p>
                <p className="m-0 text-[13px] leading-5 text-muted-foreground">
                  {t("dieRoom.share.expires", { date: shortDate(item.expiresAt) })}
                  {" · "}
                  {opened.key === "opened" ? t("dieRoom.share.opened", { n: opened.n }) : t(`dieRoom.share.${opened.key}`)}
                </p>
                {item.note ? <p className="m-0 text-[13px] leading-5 text-muted-foreground break-words">{item.note}</p> : null}
              </li>
            );
          })}
        </ul>
      )}
      {list.hasNextPage ? (
        <Button variant="secondary" onClick={() => list.fetchNextPage()} loading={list.isFetchingNextPage}>
          {t("dieRoom.share.more")}
        </Button>
      ) : null}
    </section>
  );
}

function statusKey(status: ShareStatus) {
  return status === "active" ? ("dieRoom.share.statusActive" as const) : status === "revoked" ? ("dieRoom.share.statusRevoked" as const) : ("dieRoom.share.statusExpired" as const);
}

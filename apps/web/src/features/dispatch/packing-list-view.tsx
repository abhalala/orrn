import { packingListModel, safeParsePackingListSnapshot } from "@orrn/documents/packing-list/model";
import { readFloorSettings } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Checkbox } from "@orrn/ui/components/checkbox";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { UiLink } from "@orrn/ui/components/link";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { FileDown, FileSpreadsheet, Layers, Pencil, Printer, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Can } from "@/shared/components/can";
import { downloadPackingListPdf, downloadPackingListXlsx, printPackingList } from "@/shared/lib/exports";
import { useMe } from "@/shared/lib/me";
import { trpc } from "@/shared/utils/trpc";

import { EditDetailsSheet, type EditableDispatch } from "./dispatch-menu";
import { dispatchErrorText, failedFirstLoad, isConflict } from "./errors";
import { useCompanyTimeZone } from "./hooks";
import { LegacyBody } from "./packing-list-v1";
import { PlV2Body } from "./packing-list-v2";
import { CombineSheet, RegenerateDialog, RevisionsPanel } from "./packing-list-revisions";
import { regenerateState } from "./pl-regenerate";
import { plViewOf } from "./pl-model";

/**
 * The packing list, the dispatch's final state (FP-PK-13). On `/dispatch/$id` it is the dispatch's
 * current revision (`dispatchId`); `/packing-lists/$id` opens any revision by its own id (`listId`),
 * which is how a combined list or a sent revision is reached. Header, groups with subtotals, the
 * profile summary and the extra columns come from the stored snapshot; PDF, Excel and print are made
 * on click from the same snapshot. Regenerate adds a NEW revision (the sent one is kept), and lists
 * of one customer can be combined.
 */
export function PackingListView({
  dispatchId,
  listId,
  dispatch,
  customerName,
  focusTitle = false,
}: {
  dispatchId?: string;
  listId?: string;
  /** The dispatch row, for "Edit header" (vehicle, transporter, invoice) on the dispatch page. */
  dispatch?: EditableDispatch;
  customerName?: string;
  focusTitle?: boolean;
}) {
  const { t } = useT();
  const titleRef = useRef<HTMLHeadingElement>(null);
  // Just dispatched: the confirm sheet and the Dispatch button are gone, so focus lands on the
  // packing list (the next job) and the page returns to the top, where the hero says Dispatched.
  useEffect(() => {
    if (!focusTitle) return;
    titleRef.current?.focus({ preventScroll: true });
    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: still ? "auto" : "smooth" });
  }, [focusTitle]);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const timeZone = useCompanyTimeZone();
  // FP-PK-13: the optional kg-per-piece column is the plant's setting (off by default).
  const { data: me } = useMe();
  const showKgPerPiece = readFloorSettings(me?.company?.settings).packingList.kgPerPiece;
  const setKgPerPiece = useMutation(
    trpc.company.updateSettings.mutationOptions({
      onSuccess: () => void queryClient.invalidateQueries({ queryKey: trpc.auth.me.queryKey() }),
      onError: () => toast.error(t("packingList.kgPerPieceFailed")),
    }),
  );
  const byDispatch = useQuery({ ...trpc.packingList.byDispatch.queryOptions({ dispatchId: dispatchId ?? "" }), enabled: Boolean(dispatchId) });
  const byId = useQuery({ ...trpc.packingList.get.queryOptions({ id: listId ?? "" }), enabled: Boolean(listId) });
  const pl = listId ? byId : byDispatch;
  const parsed = useMemo(() => (pl.data ? safeParsePackingListSnapshot(pl.data.snapshot) : null), [pl.data]);
  const v2 = useMemo(() => (parsed?.success ? plViewOf(parsed.data) : null), [parsed]);
  const model = useMemo(() => (parsed?.success ? packingListModel(parsed.data, { timeZone }) : null), [parsed, timeZone]);
  const [downloading, setDownloading] = useState<"pdf" | "xlsx" | "print" | null>(null);
  const [dialog, setDialog] = useState<"regenerate" | "combine" | "header" | null>(null);
  const make = useMutation(trpc.packingList.create.mutationOptions());
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: trpc.packingList.pathKey() });
  };

  const download = async (kind: "pdf" | "xlsx" | "print") => {
    if (!pl.data || !parsed?.success) return;
    setDownloading(kind);
    try {
      if (kind === "pdf") await downloadPackingListPdf(parsed.data, pl.data.code, { timeZone, kgPerPiece: showKgPerPiece });
      else if (kind === "xlsx") await downloadPackingListXlsx(parsed.data, pl.data.code, { timeZone, kgPerPiece: showKgPerPiece });
      else await printPackingList(parsed.data, pl.data.code, { timeZone, kgPerPiece: showKgPerPiece });
    } catch (err) {
      console.error("packing list export failed", err);
      toast.error(t("packingList.downloadFailed"));
    } finally {
      setDownloading(null);
    }
  };

  const data = pl.data;
  const revision = data?.revision ?? 1;
  // Only the current, not combined revision can be regenerated or combined (the server checks too).
  const folded = Boolean(data?.combinedIntoId);
  // m-5: an older revision opened by id is not the current one; the next number follows the newest.
  const revisions = useQuery({ ...trpc.packingList.revisions.queryOptions({ id: data?.id ?? "" }), enabled: Boolean(data?.id) });
  const regen = data ? regenerateState({ id: data.id, revision, combinedIntoId: data.combinedIntoId ?? null }, revisions.data) : null;
  const regenButton = data ? (
    <Can do="packingList.regenerate">
      <Button variant="ghost" onClick={() => setDialog("regenerate")} aria-haspopup="dialog" disabled={!regen?.enabled} data-testid="regenerate">
        <RefreshCw aria-hidden="true" strokeWidth={2} />
        {t("packingList.v2.regenerate")}
      </Button>
    </Can>
  ) : null;

  const editHeaderButton = (
    <Button variant="ghost" onClick={() => setDialog("header")} aria-haspopup="dialog" data-testid="edit-header">
      <Pencil aria-hidden="true" strokeWidth={2} />
      {t("packingList.v2.editHeader")}
    </Button>
  );

  let body;
  if (pl.isPending && (dispatchId || listId)) {
    body = (
      <div aria-hidden="true" className="flex flex-col gap-3">
        <Skeleton className="h-[180px] w-full rounded-card" />
        <Skeleton className="h-[240px] w-full rounded-card" />
      </div>
    );
  } else if (failedFirstLoad(pl)) {
    body = (
      <div className="rounded-card border border-border bg-card">
        <EmptyState
          title={dispatchErrorText(t, pl.error)}
          action={
            <Button variant="secondary" onClick={() => void pl.refetch()}>
              {t("common.retry")}
            </Button>
          }
        />
      </div>
    );
  } else if (!data) {
    body = (
      <div className="rounded-card border border-border bg-card">
        <EmptyState
          title={t("packingList.missing")}
          action={
            dispatchId ? (
              <Can do="dispatch.complete">
                <Button
                  loading={make.isPending}
                  onClick={() =>
                    make.mutate(
                      { dispatchId },
                      {
                        onSuccess: () => {
                          toast.success(t("packingList.made"));
                          refresh();
                        },
                        onError: (err) => {
                          // CONFLICT: someone made it a moment ago. Show that one, no error.
                          if (isConflict(err)) refresh();
                          else toast.error(dispatchErrorText(t, err));
                        },
                      },
                    )
                  }
                >
                  {t("packingList.make")}
                </Button>
              </Can>
            ) : undefined
          }
        />
      </div>
    );
  } else if (!model) {
    body = (
      <div className="rounded-card border border-border bg-card">
        <EmptyState title={t("packingList.loadError")} action={regenButton ?? undefined} />
      </div>
    );
  } else {
    body = (
      <>
        {folded ? (
          <FoldedNote code={data.code} combinedIntoId={data.combinedIntoId!} />
        ) : null}
        {v2 ? <PlV2Body view={v2} code={data.code} kgPerPiece={showKgPerPiece} /> : <LegacyBody model={model} code={data.code} kgPerPiece={showKgPerPiece} />}
        <RevisionsPanel listId={data.id} currentId={data.id} />
      </>
    );
  }

  const customerId = parsed?.success ? (parsed.data.dispatch.customer.id ?? undefined) : undefined;
  return (
    <section aria-labelledby="packing-list-title" data-slot="packing-list" className="flex min-w-0 flex-col gap-4">
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <h2 id="packing-list-title" ref={titleRef} tabIndex={-1} className="m-0 font-display text-[22px] font-bold tracking-[-0.025em] focus:outline-none">
          {t("packingList.title")}
          {data && revision > 1 ? <span className="ml-3 text-[15px] font-semibold text-muted-foreground">{t("packingList.v2.revision", { n: revision })}</span> : null}
        </h2>
        {model ? (
          <div className="grid min-w-0 grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
            <Button variant="secondary" className="max-sm:h-14 max-sm:px-3" loading={downloading === "pdf"} disabled={downloading !== null} onClick={() => void download("pdf")}>
              <FileDown aria-hidden="true" strokeWidth={2} />
              {t("packingList.downloadPdf")}
            </Button>
            <Button variant="secondary" className="max-sm:h-14 max-sm:px-3" loading={downloading === "xlsx"} disabled={downloading !== null} onClick={() => void download("xlsx")}>
              <FileSpreadsheet aria-hidden="true" strokeWidth={2} />
              {t("packingList.downloadExcel")}
            </Button>
            <Button variant="secondary" className="max-sm:h-14 max-sm:px-3" loading={downloading === "print"} disabled={downloading !== null} onClick={() => void download("print")}>
              <Printer aria-hidden="true" strokeWidth={2} />
              {t("packingList.print")}
            </Button>
            <div className="col-span-2 flex flex-wrap items-center gap-1 sm:col-auto">
              {regenButton}
              {data && customerId && !folded ? (
                <Can do="packingList.combine">
                  <Button variant="ghost" onClick={() => setDialog("combine")} aria-haspopup="dialog" data-testid="combine">
                    <Layers aria-hidden="true" strokeWidth={2} />
                    {t("packingList.v2.combine")}
                  </Button>
                </Can>
              ) : null}
              {dispatch && dispatchId ? (
                // m-6: the sheet calls dispatch.update; on a completed dispatch the header also needs dispatch.complete.
                <Can do="dispatch.update">
                  {dispatch.status === "completed" ? <Can do="dispatch.complete">{editHeaderButton}</Can> : editHeaderButton}
                </Can>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
      {model ? (
        <Can
          do="settings.update"
          fallback={showKgPerPiece ? <p className="m-0 text-[13px] text-muted-foreground">{t("packingList.kgPerPieceOn")}</p> : null}
        >
          <label className="inline-flex min-h-11 items-center gap-2 self-start text-[14px] font-medium" data-testid="kg-per-piece-toggle">
            <Checkbox
              checked={showKgPerPiece}
              disabled={setKgPerPiece.isPending}
              onCheckedChange={(on) => setKgPerPiece.mutate({ packingList: { kgPerPiece: on === true } })}
            />
            {t("packingList.kgPerPiece")}
          </label>
        </Can>
      ) : null}
      {body}
      {data ? (
        <RegenerateDialog
          open={dialog === "regenerate"}
          onOpenChange={(o) => setDialog(o ? "regenerate" : null)}
          list={{ id: data.id, code: data.code, showBranding: data.showBranding, showOriginalSo: data.showOriginalSo }}
          next={regen?.next ?? revision + 1}
          onDone={(newId) => {
            refresh();
            // A list opened by id moves to the new revision; on the dispatch page the current one shows itself.
            if (listId) void navigate({ to: "/packing-lists/$id", params: { id: newId } });
          }}
        />
      ) : null}
      {data && customerId ? (
        <CombineSheet
          open={dialog === "combine"}
          onOpenChange={(o) => setDialog(o ? "combine" : null)}
          list={{ id: data.id, code: data.code }}
          customerId={customerId}
          customerName={parsed?.success ? parsed.data.dispatch.customer.name : ""}
        />
      ) : null}
      {dispatch && dispatchId ? (
        <EditDetailsSheet
          open={dialog === "header"}
          onOpenChange={(o) => setDialog(o ? "header" : null)}
          dispatch={dispatch}
          customerName={customerName ?? ""}
          onSaved={refresh}
        />
      ) : null}
    </section>
  );
}

/** "Combined into PL/2026-27/9": this list was folded into another (shown at its own address). */
function FoldedNote({ code, combinedIntoId }: { code: string; combinedIntoId: string }) {
  const { t } = useT();
  const into = useQuery(trpc.packingList.get.queryOptions({ id: combinedIntoId }));
  return (
    <p role="status" className="m-0 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-card bg-tone-blue-tint px-4 py-3 text-[14px] font-medium text-tone-blue-ink">
      <span>{t("packingList.v2.combinedInto", { code: into.data?.code ?? "" })}</span>
      <UiLink to={`/packing-lists/${encodeURIComponent(combinedIntoId)}`} className="inline-flex min-h-11 items-center font-semibold underline underline-offset-4">
        {t("packingList.v2.open")}
      </UiLink>
      <span className="sr-only">{code}</span>
    </p>
  );
}

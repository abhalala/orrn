import { formatKg, gToKg } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Checkbox } from "@orrn/ui/components/checkbox";
import { Chip } from "@orrn/ui/components/chip";
import { Dialog } from "@orrn/ui/components/dialog";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { UiLink } from "@orrn/ui/components/link";
import { Sheet } from "@orrn/ui/components/sheet";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useId, useState } from "react";
import { toast } from "sonner";

import { useCompanyWhen } from "@/features/stock/use-company-when";
import { trpc } from "@/shared/utils/trpc";

import { dispatchErrorText } from "./errors";

type Changes = {
  added: string[];
  removed: string[];
  changed: { serial: string; fields: string[] }[];
  unchanged: number;
  weightDeltaG: number;
  same: boolean;
};

const SHOWN = 6;

/** "26J4086, 26J4087 and 3 more": serials shown up to six. */
function serialsText(t: ReturnType<typeof useT>["t"], serials: readonly string[]): string {
  if (serials.length <= SHOWN) return serials.join(", ");
  return `${serials.slice(0, SHOWN).join(", ")} ${t("packingList.v2.andMore", { count: serials.length - SHOWN })}`;
}

/**
 * Every revision of this packing list number, oldest first, newest on top (FP-PK-13): regenerate
 * keeps the sent revision and adds the next, so what went out is never lost. Each shows what changed
 * from the one before: bundles added, removed, and figures that changed.
 */
export function RevisionsPanel({ listId, currentId }: { listId: string; currentId: string }) {
  const { t } = useT();
  const when = useCompanyWhen();
  const rev = useQuery(trpc.packingList.revisions.queryOptions({ id: listId }));
  if (rev.isPending) return <Skeleton className="h-24 w-full rounded-card" />;
  if (rev.isError || !rev.data) return null;
  const revisions = [...rev.data.revisions].reverse();
  // A single revision with nothing to compare: nothing to list.
  if (revisions.length <= 1 && !revisions[0]?.combinedIntoId) return null;
  return (
    <section aria-labelledby="pl-revisions" data-slot="pl-revisions" className="flex min-w-0 flex-col gap-3">
      <h3 id="pl-revisions" className="m-0 text-[17px] font-semibold">
        {t("packingList.v2.revisions")}
      </h3>
      <ol className="m-0 flex list-none flex-col gap-2 p-0">
        {revisions.map((r) => {
          const changes = r.changes as Changes | null;
          const isCurrent = r.id === rev.data.currentId;
          const viewing = r.id === currentId;
          return (
            <li key={r.id} data-testid="pl-revision" data-revision={r.revision} className="flex min-w-0 flex-col gap-1.5 rounded-card border border-border bg-card px-4 py-3">
              <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-mono text-[15px] font-semibold">{t("packingList.v2.revision", { n: r.revision })}</span>
                {isCurrent ? <Chip tone="green">{t("packingList.v2.current")}</Chip> : <Chip tone="neutral">{t("packingList.v2.superseded")}</Chip>}
                {r.combinedIntoId ? <Chip tone="blue">{t("packingList.v2.combinedChip")}</Chip> : null}
                <span className="text-[13px] text-muted-foreground tabular-nums">{when(r.createdAt)}</span>
                <span className="text-[13px] text-muted-foreground tabular-nums">{t("units.bundles", { count: r.bundleCount })}</span>
                {!viewing ? (
                  <UiLink
                    to={`/packing-lists/${encodeURIComponent(r.id)}`}
                    className="ml-auto inline-flex min-h-11 items-center text-[14px] font-semibold text-foreground underline underline-offset-4"
                  >
                    {t("packingList.v2.open")}
                  </UiLink>
                ) : (
                  <span className="ml-auto text-[13px] text-muted-foreground">{t("packingList.v2.viewing")}</span>
                )}
              </div>
              {changes ? (
                changes.same ? (
                  <p className="m-0 text-[14px] text-muted-foreground">{t("packingList.v2.same")}</p>
                ) : (
                  <div className="flex min-w-0 flex-col gap-0.5 text-[14px]" data-slot="pl-diff">
                    <p className="m-0 font-medium">
                      {t("packingList.v2.changes", { n: r.revision - 1 })}
                      {" · "}
                      {[
                        changes.added.length ? t("packingList.v2.added", { count: changes.added.length }) : null,
                        changes.removed.length ? t("packingList.v2.removed", { count: changes.removed.length }) : null,
                        changes.changed.length ? t("packingList.v2.changed", { count: changes.changed.length }) : null,
                      ]
                        .filter(Boolean)
                        .join(", ")}
                    </p>
                    {changes.added.length ? <p className="m-0 font-mono text-[13px] text-muted-foreground break-words">+ {serialsText(t, changes.added)}</p> : null}
                    {changes.removed.length ? <p className="m-0 font-mono text-[13px] text-muted-foreground break-words">- {serialsText(t, changes.removed)}</p> : null}
                    {changes.changed.length ? (
                      <p className="m-0 font-mono text-[13px] text-muted-foreground break-words">
                        {changes.changed
                          .slice(0, SHOWN)
                          .map((c) => `${c.serial} (${c.fields.map((f) => t(`packingList.v2.field.${f}` as never)).join(", ")})`)
                          .join("; ")}
                        {changes.changed.length > SHOWN ? ` ${t("packingList.v2.andMore", { count: changes.changed.length - SHOWN })}` : ""}
                      </p>
                    ) : null}
                    {changes.weightDeltaG !== 0 ? (
                      <p className="m-0 text-[13px] text-muted-foreground tabular-nums">
                        {changes.weightDeltaG > 0 ? "+" : "-"}
                        {formatKg(gToKg(Math.abs(changes.weightDeltaG)))} {t("units.kg")}
                      </p>
                    ) : null}
                  </div>
                )
              ) : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** A labelled switch row for the print choices. */
function Choice({ id, checked, onChange, label, hint }: { id: string; checked: boolean; onChange(v: boolean): void; label: string; hint: string }) {
  return (
    <div className="flex items-start gap-3">
      <Checkbox id={id} checked={checked} onCheckedChange={(v) => onChange(v === true)} className="mt-0.5" />
      <div className="flex min-w-0 flex-col">
        <label htmlFor={id} className="text-[15px] leading-5 font-semibold">
          {label}
        </label>
        <p className="m-0 text-[13px] leading-5 text-muted-foreground">{hint}</p>
      </div>
    </div>
  );
}

/**
 * Regenerate = a NEW revision (FP-PK-13): same PL number, the sent revision kept, the new one built
 * from the bundles as they are now. The two print choices travel with it: branding (logo and tagline;
 * the legal name always prints) and the original order column.
 */
export function RegenerateDialog({
  open,
  onOpenChange,
  list,
  next,
  onDone,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  list: { id: string; code: string; showBranding: boolean; showOriginalSo: boolean };
  next: number;
  onDone(newId: string): void;
}) {
  const { t } = useT();
  const uid = useId();
  const [branding, setBranding] = useState(list.showBranding);
  const [originalSo, setOriginalSo] = useState(list.showOriginalSo);
  const regenerate = useMutation(trpc.packingList.regenerate.mutationOptions());
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !regenerate.isPending && onOpenChange(o)}
      title={t("packingList.v2.regenerateTitle")}
      description={t("packingList.v2.regenerateBody", { n: next, code: list.code })}
      actions={
        <>
          <Button variant="secondary" disabled={regenerate.isPending} onClick={() => onOpenChange(false)}>
            {t("common.back")}
          </Button>
          <Button
            loading={regenerate.isPending}
            data-testid="confirm-regenerate"
            onClick={() =>
              regenerate.mutate(
                { id: list.id, showBranding: branding, showOriginalSo: originalSo },
                {
                  onSuccess: (pl) => {
                    toast.success(t("packingList.v2.regenerated", { n: next }));
                    onOpenChange(false);
                    onDone(pl.id);
                  },
                  onError: (err) => toast.error(dispatchErrorText(t, err)),
                },
              )
            }
          >
            {t("packingList.v2.regenerate")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Choice id={`${uid}-brand`} checked={branding} onChange={setBranding} label={t("packingList.v2.showBranding")} hint={t("packingList.v2.brandingHint")} />
        <Choice id={`${uid}-so`} checked={originalSo} onChange={setOriginalSo} label={t("packingList.v2.showOriginalSo")} hint={t("packingList.v2.originalSoHint")} />
      </div>
    </Dialog>
  );
}

/**
 * Combine packing lists of ONE customer into a new list with a new PL number (the lists folded in
 * keep theirs and point at the new one). Only current lists that were not combined already.
 */
export function CombineSheet({
  open,
  onOpenChange,
  list,
  customerId,
  customerName,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  list: { id: string; code: string };
  customerId: string;
  customerName: string;
}) {
  const { t } = useT();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const lists = useQuery({
    ...trpc.packingList.list.queryOptions({ customerId, combinable: true, limit: 50 }),
    enabled: open,
  });
  const combine = useMutation(trpc.packingList.combine.mutationOptions());
  const others = (lists.data?.items ?? []).filter((l) => l.id !== list.id);
  const ids = [list.id, ...picked];
  const toggle = (id: string, on: boolean) =>
    setPicked((p) => {
      const n = new Set(p);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        if (combine.isPending) return;
        onOpenChange(o);
        if (!o) setPicked(new Set());
      }}
      title={t("packingList.v2.combineTitle")}
      description={t("packingList.v2.combineBody", { customer: customerName })}
      footer={
        <>
          <Button variant="secondary" disabled={combine.isPending} onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button
            loading={combine.isPending}
            disabled={ids.length < 2}
            data-testid="confirm-combine"
            onClick={() =>
              combine.mutate(
                { ids },
                {
                  onSuccess: (pl) => {
                    toast.success(t("packingList.v2.combined", { code: pl.code }));
                    void queryClient.invalidateQueries({ queryKey: trpc.packingList.pathKey() });
                    onOpenChange(false);
                    setPicked(new Set());
                    void navigate({ to: "/packing-lists/$id", params: { id: pl.id } });
                  },
                  onError: (err) => toast.error(dispatchErrorText(t, err)),
                },
              )
            }
          >
            {t("packingList.v2.combineSubmit", { count: ids.length })}
          </Button>
        </>
      }
    >
      {lists.isPending ? (
        <Skeleton className="h-24 w-full rounded-card" />
      ) : others.length === 0 ? (
        <EmptyState className="py-8" title={t("packingList.v2.combineNone")} />
      ) : (
        <ul aria-label={t("packingList.v2.combineTitle")} className="m-0 flex list-none flex-col gap-2 p-0 pt-1">
          <li className="flex min-h-14 items-center gap-3 rounded-card border border-border bg-surface-sunken px-4 py-2.5">
            <span className="font-mono text-[15px] font-semibold">{list.code}</span>
            <span className="text-[13px] text-muted-foreground">{t("packingList.v2.thisList")}</span>
          </li>
          {others.map((l) => (
            <li key={l.id} className="flex min-h-14 items-center gap-3 rounded-card border border-border bg-card px-4 py-2.5">
              <Checkbox
                id={`combine-${l.id}`}
                checked={picked.has(l.id)}
                onCheckedChange={(v) => toggle(l.id, v === true)}
                aria-label={l.code}
              />
              <label htmlFor={`combine-${l.id}`} className="flex min-w-0 flex-1 flex-col">
                <span className="font-mono text-[15px] font-semibold">{l.code}</span>
                <span className="text-[13px] text-muted-foreground tabular-nums">
                  {l.dispatchCode} · {t("units.bundlesKg", { bundles: l.bundleCount, kg: formatKg(gToKg(l.weightG)) })}
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}

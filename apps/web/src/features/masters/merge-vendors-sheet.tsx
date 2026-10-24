import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Checkbox } from "@orrn/ui/components/checkbox";
import { Chip } from "@orrn/ui/components/chip";
import { Combobox, type ComboboxOption } from "@orrn/ui/components/combobox";
import { Dialog } from "@orrn/ui/components/dialog";
import { Field, TextInput } from "@orrn/ui/components/field";
import { Sheet } from "@orrn/ui/components/sheet";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";

import { Can } from "@/shared/components/can";
import { trpc } from "@/shared/utils/trpc";

import { mergeSearchSeed, vendorStatusView, type VendorStatus } from "./masters-model";
import { FormError } from "./masters-ui";
import { useInvalidate } from "./use-masters";

type Keeper = { id: string; name: string };

/** The term after the person stops typing for a moment. */
function useDebounced(value: string, ms = 250) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

/**
 * Merge duplicate vendors into one (masters.publish, `vendor.merge`). Opened from a vendor page the
 * keeper is fixed; from the list the person picks it first (a confirmed vendor only). The duplicate
 * search starts from the keeper's most telling word, picks survive new searches, and a dialog
 * spells out what moves before anything does: it cannot be undone.
 */
export function MergeVendorsSheet({
  open,
  onOpenChange,
  keeper: fixedKeeper,
  onMerged,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  keeper?: Keeper;
  onMerged?(keepId: string): void;
}) {
  const { t } = useT();
  const queryClient = useQueryClient();
  const invalidate = useInvalidate();
  const uid = useId().replace(/:/g, "");
  const keepId = `merge-keep-${uid}`;
  const [keeper, setKeeper] = useState<Keeper | null>(fixedKeeper ?? null);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Map<string, string>>(new Map());
  const [errors, setErrors] = useState<{ keep?: string; pick?: string }>({});
  const [confirming, setConfirming] = useState(false);
  const merge = useMutation(trpc.vendor.merge.mutationOptions());
  const q = useDebounced(query.trim());
  const keeperNames = useRef(new Map<string, string>());

  useEffect(() => {
    if (!open) return;
    setKeeper(fixedKeeper ?? null);
    setQuery(fixedKeeper ? mergeSearchSeed(fixedKeeper.name) : "");
    setPicked(new Map());
    setErrors({});
    setConfirming(false);
    merge.reset();
    // Only when the sheet opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, fixedKeeper?.id]);

  const results = useQuery({
    ...trpc.vendor.list.queryOptions({ q, limit: 30, offset: 0 }),
    enabled: open && q.length > 0,
    placeholderData: (prev) => prev,
  });
  const candidates = (results.data?.items ?? []).filter((v) => v.id !== keeper?.id);

  const toggle = (id: string, name: string) => {
    setPicked((prev) => {
      const next = new Map(prev);
      if (next.has(id)) next.delete(id);
      else next.set(id, name);
      return next;
    });
    setErrors((x) => ({ ...x, pick: undefined }));
  };

  const review = () => {
    const next = {
      keep: keeper ? undefined : t("vendors.mergeSheet.keepRequired"),
      pick: picked.size > 0 ? undefined : t("vendors.mergeSheet.pickOne"),
    };
    setErrors(next);
    if (next.keep) return document.getElementById(keepId)?.focus();
    if (next.pick) return;
    setConfirming(true);
  };

  const run = async () => {
    if (!keeper || merge.isPending) return;
    try {
      const res = await merge.mutateAsync({ keepId: keeper.id, mergeIds: [...picked.keys()] });
      toast.success(t("vendors.mergeSheet.done", { name: keeper.name, count: res.lotsMoved }));
      await invalidate.vendors();
      setConfirming(false);
      onOpenChange(false);
      onMerged?.(keeper.id);
    } catch {
      setConfirming(false);
    }
  };

  const names = [...picked.values()];

  return (
    <>
      <Sheet
        open={open}
        onOpenChange={onOpenChange}
        title={fixedKeeper ? t("vendors.mergeSheet.titleInto", { name: fixedKeeper.name }) : t("vendors.mergeSheet.title")}
        description={t("vendors.mergeSheet.body")}
        footer={
          <>
            <Button variant="secondary" size="lg" onClick={() => onOpenChange(false)}>
              {t("common.cancel")}
            </Button>
            <Can do="masters.publish">
              <Button size="lg" onClick={review} aria-haspopup="dialog" disabled={merge.isPending}>
                {t("vendors.mergeSheet.submit", { count: picked.size })}
              </Button>
            </Can>
          </>
        }
      >
        <div className="flex flex-col gap-5 pt-1">
          {fixedKeeper ? null : (
            <Field label={t("vendors.mergeSheet.keep")} hint={t("vendors.mergeSheet.keepHint")} error={errors.keep} id={keepId}>
              <Combobox<string>
                value={keeper?.id ?? null}
                valueLabel={keeper?.name}
                placeholder={t("vendors.mergeSheet.keepPlaceholder")}
                onChange={(id) => {
                  const name = keeperNames.current.get(id) ?? "";
                  setKeeper({ id, name });
                  setQuery(mergeSearchSeed(name));
                  setPicked((prev) => {
                    const next = new Map(prev);
                    next.delete(id);
                    return next;
                  });
                  setErrors((x) => ({ ...x, keep: undefined }));
                }}
                search={async (text) => {
                  const res = await queryClient.fetchQuery(
                    trpc.vendor.list.queryOptions({ q: text.trim() || undefined, status: "active", limit: 30, offset: 0 }),
                  );
                  return res.items.map((v): ComboboxOption<string> => {
                    keeperNames.current.set(v.id, v.name);
                    return { value: v.id, label: v.name, hint: v.city ?? v.gstin ?? undefined };
                  });
                }}
              />
            </Field>
          )}

          {names.length > 0 ? (
            <div className="flex flex-col gap-2">
              <p aria-live="polite" className="m-0 text-[14px] font-semibold">
                {t("vendors.mergeSheet.picked", { count: names.length })}
              </p>
              <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
                {[...picked.entries()].map(([id, name]) => (
                  <li key={id}>
                    <button
                      type="button"
                      onClick={() => toggle(id, name)}
                      aria-label={t("vendors.page.removeSpelling", { alias: name })}
                      className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-border bg-surface-sunken px-3.5 text-[14px] font-medium transition-colors hover:bg-accent"
                    >
                      <span className="break-words">{name}</span>
                      <X aria-hidden="true" strokeWidth={2} className="size-4 shrink-0" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <Field label={t("vendors.mergeSheet.search")} hint={fixedKeeper || keeper ? t("vendors.mergeSheet.searchHint") : undefined} error={errors.pick}>
            <TextInput type="search" value={query} onChangeText={setQuery} autoComplete="off" enterKeyHint="search" />
          </Field>

          <div aria-busy={results.isFetching || undefined}>
            {q.length === 0 ? (
              <p className="m-0 text-[14px] text-muted-foreground">{t("vendors.mergeSheet.typeToSearch")}</p>
            ) : results.isLoading ? (
              <div className="flex flex-col gap-2">
                <Skeleton className="h-14 w-full rounded-card" />
                <Skeleton className="h-14 w-full rounded-card" />
              </div>
            ) : candidates.length === 0 ? (
              <p className="m-0 text-[14px] text-muted-foreground">{t("vendors.mergeSheet.noMatches", { query: q })}</p>
            ) : (
              <ul className="m-0 flex list-none flex-col divide-y divide-border overflow-hidden rounded-card border border-border p-0">
                {candidates.map((v) => {
                  const view = vendorStatusView(v.status as VendorStatus);
                  const id = `merge-pick-${uid}-${v.id}`;
                  return (
                    <li key={v.id}>
                      <label
                        htmlFor={id}
                        className="flex min-h-14 cursor-pointer items-center gap-3 px-4 py-2.5 transition-colors hover:bg-surface-sunken/60"
                      >
                        <Checkbox id={id} checked={picked.has(v.id)} onCheckedChange={() => toggle(v.id, v.name)} />
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="text-[15px] font-semibold break-words">{v.name}</span>
                          <span className="text-[13px] text-muted-foreground break-words">
                            {[v.city, v.gstin].filter(Boolean).join(", ") || t("vendors.unregistered")}
                          </span>
                        </span>
                        {view.tone ? <Chip tone={view.tone}>{t(view.key)}</Chip> : null}
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <FormError error={merge.error} />
        </div>
      </Sheet>

      <Dialog
        open={confirming}
        onOpenChange={(o) => !merge.isPending && setConfirming(o)}
        title={t("vendors.mergeSheet.confirmTitle", { count: names.length, name: keeper?.name ?? "" })}
        description={t("vendors.mergeSheet.confirmBody", { names: names.join(", "), name: keeper?.name ?? "" })}
        actions={
          <>
            <Button variant="secondary" onClick={() => setConfirming(false)} disabled={merge.isPending}>
              {t("common.cancel")}
            </Button>
            <Button onClick={() => void run()} loading={merge.isPending}>
              {t("vendors.mergeSheet.confirm")}
            </Button>
          </>
        }
      />
    </>
  );
}

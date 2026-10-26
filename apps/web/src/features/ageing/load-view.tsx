import { ageingCapacity, AGEING_LOAD_MAX_ROWS } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Field, NumberInput, TextInput } from "@orrn/ui/components/field";
import { PageHeader } from "@orrn/ui/components/page-header";
import { SegmentedControl } from "@orrn/ui/components/segmented-control";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { cn } from "@orrn/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { PackBar } from "@/features/pack/pack-ui";
import { kgFromG } from "@/features/press/model";
import { Can } from "@/shared/components/can";
import { INLINE_ERROR_META, showsQueryError } from "@/shared/lib/query-errors";
import { useOnceMutation } from "@/shared/lib/once-mutation";
import { trpc } from "@/shared/utils/trpc";

import { useAgeingInvalidate, useActionKey, type AvailableBundle, type AvailableLine } from "./hooks";
import { canLoad, capacityTone, lineFitsRecipe, loadTotals, pickOf, pressRowsOf, type PickState } from "./model";
import type { LoadSearch } from "./search";
import { Panel, RefusalNote, FieldSelect as NativeSelect } from "./ui";

type Source = "press" | "bundles";

/**
 * `/ageing/load` (FP-AG-04): pick a free trolley, then the logged press lines (or whole packed
 * bundles) that go on it. Pieces default to all that is left; kg are the line's, prorated by the
 * server. The capacity check is a warning, not a block. At most 40 lines go in one request (D1
 * binds 100 parameters per statement; the server chunks the inserts); a longer pick is told so.
 */
export function LoadScreen({ search }: { search: LoadSearch }) {
  const { t } = useT();
  const navigate = useNavigate();
  const invalidate = useAgeingInvalidate();
  const key = useActionKey();
  const trolleys = useQuery({ ...trpc.ageing.trolleys.list.queryOptions({}), meta: INLINE_ERROR_META });
  const recipes = useQuery({ ...trpc.ageing.recipes.list.queryOptions({}), meta: INLINE_ERROR_META });
  const [trolleyId, setTrolleyId] = useState<string | null>(search.trolley ?? null);
  const [source, setSource] = useState<Source>("press");
  const [recipeId, setRecipeId] = useState("");
  const [picks, setPicks] = useState<PickState>({});
  const [bundleIds, setBundleIds] = useState<Record<string, true>>({});
  const [bundleSearch, setBundleSearch] = useState("");
  const [tried, setTried] = useState(false);

  const free = useMemo(
    () => (trolleys.data?.items ?? []).filter((r) => r.status === "active" && (r.openBatchId === null || r.openBatchStatus === "loading")),
    [trolleys.data],
  );
  const trolley = free.find((r) => r.id === trolleyId) ?? null;
  // A trolley asked for on the URL that is not free any more is dropped, so the picker says so.
  useEffect(() => {
    if (trolleys.data && trolleyId && !free.some((r) => r.id === trolleyId)) setTrolleyId(null);
  }, [trolleys.data, free, trolleyId]);
  useEffect(() => {
    if (trolleyId === null && free.length === 1 && !search.trolley) setTrolleyId(free[0]!.id);
  }, [free, trolleyId, search.trolley]);

  const activeRecipes = (recipes.data?.items ?? []).filter((r) => r.status === "active" && r.kind === "full");
  const recipe = activeRecipes.find((r) => r.id === recipeId) ?? null;

  const lines = useQuery({
    ...trpc.ageing.batches.availableLines.queryOptions({ limit: 100, ...(recipeId ? { recipeId } : {}) }),
    meta: INLINE_ERROR_META,
  });
  const debouncedSearch = useDebounced(bundleSearch.trim(), 250);
  const bundles = useQuery({
    ...trpc.ageing.batches.availableBundles.queryOptions({ limit: 100, ...(recipeId ? { recipeId } : {}), ...(debouncedSearch ? { search: debouncedSearch } : {}) }),
    enabled: source === "bundles",
    meta: INLINE_ERROR_META,
  });

  const lineItems = (lines.data?.items ?? []).filter((l) => lineFitsRecipe(l, recipe));
  const pickedBundles = (bundles.data?.items ?? []).filter((b) => bundleIds[b.bundleId]);
  const totals = loadTotals(lineItems, picks, pickedBundles.map((b) => ({ pcs: b.pcs, weightG: b.weightG })));
  const capacity = ageingCapacity(totals.kgG, trolley?.capacityG ?? null);
  const tooMany = totals.lines > AGEING_LOAD_MAX_ROWS;
  const ready = canLoad(totals, trolleyId) && !tooMany;

  const load = useOnceMutation(
    trpc.ageing.batches.load.mutationOptions({
      onSuccess: async (res) => {
        key.reset();
        toast.success(t("ageing.load.loaded", { number: res.number }));
        await invalidate();
        void navigate({ to: "/ageing/batch/$id", params: { id: res.id } });
      },
    }),
  );

  const submit = () => {
    setTried(true);
    if (!ready || load.isPending || !trolleyId) return;
    load.mutate({
      trolleyId,
      ...(trolley?.openBatchId ? { batchId: trolley.openBatchId } : {}),
      rows: pressRowsOf(lineItems, picks),
      bundles: pickedBundles.map((b) => ({ bundleId: b.bundleId })),
      manual: [],
      clientMutationId: key.get(),
    });
  };

  const header = <PageHeader title={t("ageing.load.title")} subtitle={t("ageing.load.subtitle")} back={{ to: "/ageing", label: t("ageing.title") }} />;
  if (showsQueryError(trolleys)) {
    return (
      <>
        {header}
        <div className="rounded-card border border-border bg-card">
          <EmptyState title={t("ageing.loadFailed")} action={<Button variant="secondary" onClick={() => void trolleys.refetch()}>{t("common.retry")}</Button>} />
        </div>
      </>
    );
  }

  return (
    <Can
      do="ageing.load"
      fallback={
        <>
          {header}
          <div className="rounded-card border border-border bg-card" data-testid="load-no-access">
            <EmptyState title={t("ageing.noAccess")} body={t("ageing.noAccessLoad")} />
          </div>
        </>
      }
    >
      {header}
      <form
        noValidate
        data-testid="load-form"
        className="flex min-w-0 flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <TrolleyPicker loading={trolleys.isPending} trolleys={free} value={trolleyId} onChange={setTrolleyId} error={tried && !trolleyId ? t("ageing.load.pickTrolley") : undefined} />

        <div className="flex flex-wrap items-end gap-3">
          <SegmentedControl<Source>
            label={t("ageing.load.source")}
            value={source}
            onChange={setSource}
            options={[
              { value: "press", label: t("ageing.source.press") },
              { value: "bundles", label: t("ageing.load.bundles") },
            ]}
          />
          {activeRecipes.length > 0 ? (
            <Field label={t("ageing.load.recipeFilter")} className="min-w-[200px]">
              <NativeSelect value={recipeId} onChange={(e) => setRecipeId(e.currentTarget.value)} data-testid="load-recipe">
                <option value="">{t("ageing.load.anyRecipe")}</option>
                {activeRecipes.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.alloy} {r.temper}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          ) : null}
        </div>

        {source === "press" ? (
          <PressLines query={lines} items={lineItems} picks={picks} onPicks={setPicks} />
        ) : (
          <Bundles query={bundles} search={bundleSearch} onSearch={setBundleSearch} picked={bundleIds} onPicked={setBundleIds} />
        )}

        {tooMany ? (
          <p role="alert" className="m-0 text-[14px] font-medium text-destructive" data-testid="load-too-many">
            {t("ageing.refusal.tooManyRows", { n: AGEING_LOAD_MAX_ROWS })}
          </p>
        ) : null}
        {tried && totals.lines === 0 ? (
          <p role="alert" className="m-0 text-[14px] font-medium text-destructive">
            {t("ageing.refusal.noRows")}
          </p>
        ) : null}

        <PackBar
          notice={load.error ? <RefusalNote error={load.error} /> : undefined}
          summary={
            <p className="m-0 flex flex-wrap items-center gap-x-3 gap-y-1 text-[14px]" data-testid="load-summary">
              <span className="font-semibold tabular-nums">{t("ageing.load.summary", { lines: totals.lines, pcs: totals.pcs, kg: kgFromG(totals.kgG) })}</span>
              {trolley && totals.lines > 0 && capacity !== "ok" ? (
                <Chip tone={capacityTone(capacity)} truncate={false} data-testid="load-capacity">
                  {t(`ageing.capacity.${capacity}`)}
                </Chip>
              ) : null}
            </p>
          }
        >
          <Button type="submit" size="lg" loading={load.isPending} disabled={!ready && tried} data-testid="load-submit">
            {t("ageing.load.submit")}
          </Button>
        </PackBar>
      </form>
    </Can>
  );
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

function TrolleyPicker({
  loading,
  trolleys,
  value,
  onChange,
  error,
}: {
  loading: boolean;
  trolleys: readonly { id: string; code: string; capacityG: number | null; openBatchNumber: string | null }[];
  value: string | null;
  onChange(id: string): void;
  error?: string;
}) {
  const { t } = useT();
  if (loading) return <Skeleton className="h-16 rounded-input" />;
  if (trolleys.length === 0) {
    return (
      <Panel data-testid="no-free-trolley">
        <EmptyState title={t("ageing.load.noFreeTrolley")} body={t("ageing.load.noFreeTrolleyBody")} />
      </Panel>
    );
  }
  return (
    <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0" data-slot="trolley-picker" aria-describedby={error ? "trolley-error" : undefined}>
      <legend className="mb-1.5 p-0 text-[14px] leading-5 font-semibold">{t("ageing.field.trolley")}</legend>
      <div className="flex flex-wrap gap-2">
        {trolleys.map((r) => {
          const checked = r.id === value;
          return (
            <label
              key={r.id}
              className={cn(
                "relative flex min-h-12 min-w-[112px] cursor-pointer flex-col justify-center rounded-input border px-4 py-2 transition-colors duration-[var(--dur-fast)]",
                "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring has-[:focus-visible]:outline-solid",
                checked ? "border-primary bg-primary/5" : "border-input bg-card hover:border-foreground/60",
              )}
            >
              <input type="radio" name="trolley" value={r.id} checked={checked} onChange={() => onChange(r.id)} className="sr-only" aria-label={r.code} />
              <span className="font-mono text-[17px] font-semibold">{r.code}</span>
              <span className="text-[12px] text-muted-foreground">
                {r.openBatchNumber ? t("ageing.load.addTo", { number: r.openBatchNumber }) : r.capacityG ? t("ageing.floor.capacity", { kg: kgFromG(r.capacityG) }) : t("ageing.floor.free")}
              </span>
            </label>
          );
        })}
      </div>
      {error ? (
        <p id="trolley-error" role="alert" className="m-0 text-[13px] font-medium text-destructive">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}

function PressLines({
  query,
  items,
  picks,
  onPicks,
}: {
  query: { isPending: boolean; isError: boolean; data: unknown; refetch(): unknown };
  items: readonly AvailableLine[];
  picks: PickState;
  onPicks(next: PickState): void;
}) {
  const { t } = useT();
  if (showsQueryError(query)) {
    return (
      <Panel>
        <EmptyState title={t("ageing.loadFailed")} action={<Button variant="secondary" onClick={() => void query.refetch()}>{t("common.retry")}</Button>} />
      </Panel>
    );
  }
  if (query.isPending) return <Skeleton className="h-40 rounded-card" aria-busy="true" />;
  if (items.length === 0) {
    return (
      <Panel data-testid="no-lines">
        <EmptyState title={t("ageing.empty.noLines")} />
      </Panel>
    );
  }
  return (
    <ul className="m-0 flex list-none flex-col gap-2 p-0" aria-label={t("ageing.load.linesLabel")} data-testid="press-lines">
      {items.map((line) => {
        const checked = picks[line.pressRunLineId] !== undefined;
        const pick = pickOf(picks[line.pressRunLineId], line);
        const name = `${line.pressRunNumber} ${line.sectionLabel}`;
        return (
          <li key={line.pressRunLineId} data-line={line.pressRunNumber} className={cn("rounded-card border bg-card p-3 sm:p-4", checked ? "border-primary" : "border-border")}>
            <div className="flex flex-wrap items-start gap-3">
              <label className="flex min-h-11 min-w-0 flex-1 basis-[220px] cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  checked={checked}
                  aria-label={name}
                  onChange={(e) => {
                    const next = { ...picks };
                    if (e.currentTarget.checked) next[line.pressRunLineId] = String(line.pcsLeft);
                    else delete next[line.pressRunLineId];
                    onPicks(next);
                  }}
                  className="mt-1 size-5 shrink-0 accent-[var(--color-primary)]"
                />
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="flex flex-wrap items-baseline gap-x-2 text-[15px] font-semibold">
                    <span className="font-mono">{line.pressRunNumber}</span>
                    <span className="break-words">{line.sectionLabel}</span>
                    {line.dieInstanceCode ? <span className="font-mono text-muted-foreground">{line.dieInstanceCode}</span> : null}
                  </span>
                  <span className="text-[13px] leading-5 text-muted-foreground">
                    {[
                      t("ageing.load.lineLength", { mm: line.lengthMm }),
                      t("ageing.load.lineLeft", { pcs: line.pcsLeft, kg: kgFromG(line.kgLeftG) }),
                      line.castCode ? t("ageing.load.lineCast", { cast: line.castCode }) : null,
                      [line.alloy, line.temper].filter(Boolean).join(" "),
                      line.salesOrderNumber ? `${line.salesOrderNumber}${line.customerName ? ` · ${line.customerName}` : ""}` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
              </label>
              {checked ? (
                <div className="w-[132px] shrink-0">
                  <NumberInput
                    decimal={false}
                    value={picks[line.pressRunLineId] ?? ""}
                    onValueChange={(v) => onPicks({ ...picks, [line.pressRunLineId]: v })}
                    suffix={t("units.pcs")}
                    aria-label={t("ageing.load.piecesOf", { name })}
                    aria-invalid={pick.error ? true : undefined}
                    className="h-12"
                    data-testid="line-pcs"
                  />
                </div>
              ) : null}
            </div>
            {pick.error ? (
              <p role="alert" className="mt-2 mb-0 text-[13px] font-medium text-destructive">
                {pick.error === "over" ? t("ageing.refusal.overLine", { n: line.pcsLeft }) : t("ageing.load.piecesInvalid")}
              </p>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function Bundles({
  query,
  search,
  onSearch,
  picked,
  onPicked,
}: {
  query: { isPending: boolean; isError: boolean; data: { items: AvailableBundle[] } | undefined; refetch(): unknown };
  search: string;
  onSearch(v: string): void;
  picked: Record<string, true>;
  onPicked(next: Record<string, true>): void;
}) {
  const { t } = useT();
  const items = query.data?.items ?? [];
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <Field label={t("ageing.load.bundleSearch")} hint={t("ageing.load.bundlesHint")} className="sm:max-w-[360px]">
        <TextInput value={search} onChange={(e) => onSearch(e.currentTarget.value)} maxLength={40} autoComplete="off" className="font-mono" data-testid="bundle-search" />
      </Field>
      {showsQueryError(query) ? (
        <Panel>
          <EmptyState title={t("ageing.loadFailed")} action={<Button variant="secondary" onClick={() => void query.refetch()}>{t("common.retry")}</Button>} />
        </Panel>
      ) : query.isPending ? (
        <Skeleton className="h-32 rounded-card" aria-busy="true" />
      ) : items.length === 0 ? (
        <Panel>
          <EmptyState title={t("ageing.load.noBundles")} />
        </Panel>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0" data-testid="bundle-lines">
          {items.map((b) => {
            const checked = Boolean(picked[b.bundleId]);
            return (
              <li key={b.bundleId} className={cn("rounded-card border bg-card p-3", checked ? "border-primary" : "border-border")}>
                <label className="flex min-h-11 cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    checked={checked}
                    aria-label={b.serial}
                    onChange={(e) => {
                      const next = { ...picked };
                      if (e.currentTarget.checked) next[b.bundleId] = true;
                      else delete next[b.bundleId];
                      onPicked(next);
                    }}
                    className="mt-1 size-5 shrink-0 accent-[var(--color-primary)]"
                  />
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="font-mono text-[15px] font-semibold">{b.serial}</span>
                    <span className="text-[13px] leading-5 text-muted-foreground">
                      {[b.sectionLabel, t("ageing.load.lineLength", { mm: b.lengthMm }), `${b.pcs} ${t("units.pcs")} · ${kgFromG(b.weightG)} ${t("units.kg")}`, b.castCode, [b.alloy, b.temper].filter(Boolean).join(" ")].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

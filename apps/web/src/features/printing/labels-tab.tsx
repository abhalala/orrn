import type { AppRouter } from "@orrn/server/routers/index";
import { useT } from "@orrn/i18n";
import { Button, IconButton } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@orrn/ui/components/dropdown-menu";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Field, TextInput } from "@orrn/ui/components/field";
import { UiLink } from "@orrn/ui/components/link";
import { Skeleton } from "@orrn/ui/components/skeleton";
import type { inferRouterOutputs } from "@trpc/server";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Copy, Download, MoreHorizontal, Pencil, Plus, Printer, Send } from "lucide-react";
import { useId, useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { ListSearch } from "@/features/catalog/list-search";
import { useCompanyWhen } from "@/features/stock/use-company-when";
import { Can } from "@/shared/components/can";
import { bundleDetailPath } from "@/shared/lib/paths";
import { trpc } from "@/shared/utils/trpc";

import { LabelPreview } from "./label-artwork";
import { designState, filterDesigns, labelSize, SEARCH_THRESHOLD, uniqueDesignName } from "./label-library";
import { previewIssues, type LabelValues } from "./label-metrics";
import { reprintTarget } from "./model";
import { NewLabelDialog } from "./new-label-dialog";
import { useLabelSample } from "./use-label-sample";

type Design = inferRouterOutputs<AppRouter>["spool"]["labelDocuments"]["list"][number];

/** Preview well height in px, less its padding: every label fits inside it at its own aspect. */
const PREVIEW_PX = 152;

/**
 * Labels: the label design library (live previews filled with the newest real bundle, publish and
 * send state, the printers that use each design) and, as a quick action, the reprint entry.
 * Editing, duplicating, sending and new designs need `spool.push_templates`; everyone else sees the
 * same library read-only.
 */
export function LabelsTab() {
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <ReprintEntry />
      <DesignLibrary />
    </div>
  );
}

function ReprintEntry() {
  const { t } = useT();
  const navigate = useNavigate();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | undefined>();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const serial = reprintTarget(value);
    if (!serial) {
      setError(t("printing.reprint.required"));
      return;
    }
    setError(undefined);
    void navigate({ to: bundleDetailPath({ serial }) as never });
  };

  return (
    <section aria-labelledby="reprint-title" className="rounded-card border border-border bg-card px-4 py-4 sm:px-5">
      <form onSubmit={submit} noValidate className="flex min-w-0 flex-col gap-3 md:flex-row md:items-start md:justify-between md:gap-6">
        <div className="flex min-w-0 flex-col gap-0.5 md:flex-1 md:pt-6">
          <h2 id="reprint-title" className="m-0 flex items-center gap-2 text-[15px] font-semibold leading-6">
            <Printer aria-hidden="true" className="size-[18px] shrink-0 text-muted-foreground" strokeWidth={2} />
            {t("printing.reprint.title")}
          </h2>
          <p className="m-0 text-[13px] leading-5 text-muted-foreground">{t("printing.reprint.body")}</p>
        </div>
        <div className="flex min-w-0 items-start gap-2 md:shrink-0">
          <Field label={t("printing.reprint.field")} error={error} className="min-w-0 flex-1 md:w-52 md:flex-none">
            <TextInput
              value={value}
              onChangeText={(next) => {
                setValue(next);
                if (error) setError(undefined);
              }}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              enterKeyHint="go"
              className="font-mono"
              data-testid="reprint-serial"
            />
          </Field>
          <Button type="submit" variant="secondary" className="mt-[26px] shrink-0">
            {t("printing.reprint.open")}
          </Button>
        </div>
      </form>
    </section>
  );
}

function DesignLibrary() {
  const { t } = useT();
  const designs = useQuery(trpc.spool.labelDocuments.list.queryOptions());
  const profiles = useQuery(trpc.spool.listProfiles.queryOptions());
  const { values, serial } = useLabelSample();
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);

  const rows = designs.data ?? [];
  const names = useMemo(() => rows.map((design) => design.name), [rows]);
  const shown = useMemo(() => filterDesigns(rows, query), [rows, query]);
  const printersByDesign = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const profile of profiles.data ?? []) map.set(profile.templateId, [...(map.get(profile.templateId) ?? []), profile.name]);
    return map;
  }, [profiles.data]);

  return (
    <section aria-labelledby="label-designs" className="@container flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 id="label-designs" className="m-0 flex flex-wrap items-baseline gap-x-2.5 text-[20px] font-semibold leading-tight tracking-[-0.01em]">
            {t("printing.designs.title")}
            {designs.data && designs.data.length > 0 ? (
              <span className="text-[14px] font-medium tabular-nums text-muted-foreground">{t("printing.library.count", { count: designs.data.length })}</span>
            ) : null}
          </h2>
          <p className="m-0 text-[14px] leading-5 text-muted-foreground">
            {t("printing.library.intro")} {serial ? t("printing.library.sampleBundle", { serial }) : t("printing.library.sampleExample")}
          </p>
        </div>
        <Can do="spool.push_templates">
          <Button onPress={() => setCreating(true)} data-testid="new-label">
            <Plus aria-hidden="true" strokeWidth={2.25} />
            {t("printing.library.newLabel")}
          </Button>
        </Can>
      </div>

      {rows.length > SEARCH_THRESHOLD ? (
        <ListSearch
          label={t("printing.library.searchLabel")}
          placeholder={t("printing.library.searchPlaceholder")}
          value={query}
          onSearch={setQuery}
          delayMs={120}
          className="sm:max-w-sm"
        />
      ) : null}

      {designs.isPending ? (
        <ul aria-busy="true" aria-label={t("printing.designs.title")} className="m-0 grid list-none grid-cols-1 gap-4 p-0 @xl:grid-cols-2 @5xl:grid-cols-3">
          {[0, 1, 2].map((key) => (
            <li key={key} className="flex flex-col overflow-hidden rounded-card border border-border bg-card">
              <Skeleton className="h-44 w-full rounded-none" />
              <div className="flex flex-col gap-2.5 p-4">
                <Skeleton className="h-5 w-2/3" />
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="h-6 w-1/2 rounded-full" />
                <Skeleton className="mt-2 h-11 w-full rounded-full" />
              </div>
            </li>
          ))}
        </ul>
      ) : designs.isError ? (
        <div className="rounded-card border border-border bg-card">
          <EmptyState
            title={t("printing.loadFailed")}
            action={
              <Button variant="secondary" onPress={() => void designs.refetch()}>
                {t("common.retry")}
              </Button>
            }
          />
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-card border border-dashed border-input bg-card">
          <Can do="spool.push_templates" fallback={<EmptyState title={t("printing.library.emptyTitle")} body={t("printing.library.emptyReadOnly")} />}>
            <EmptyState
              title={t("printing.library.emptyTitle")}
              body={t("printing.library.emptyBody")}
              action={
                <Button onPress={() => setCreating(true)}>
                  <Plus aria-hidden="true" strokeWidth={2.25} />
                  {t("printing.library.newLabel")}
                </Button>
              }
            />
          </Can>
        </div>
      ) : shown.length === 0 ? (
        <div className="rounded-card border border-border bg-card">
          <EmptyState
            title={t("printing.library.noMatch", { query: query.trim() })}
            action={
              <Button variant="secondary" onPress={() => setQuery("")}>
                {t("printing.library.clearSearch")}
              </Button>
            }
          />
        </div>
      ) : (
        <ul className="m-0 grid list-none grid-cols-1 gap-4 p-0 @xl:grid-cols-2 @5xl:grid-cols-3">
          {shown.map((design) => (
            <DesignCard key={design.id} design={design} values={values} printers={profiles.data ? (printersByDesign.get(design.id) ?? []) : null} takenNames={names} />
          ))}
        </ul>
      )}

      {creating ? <NewLabelDialog open onOpenChange={setCreating} takenNames={names} values={values} /> : null}
    </section>
  );
}

function DesignCard({
  design,
  values,
  printers,
  takenNames,
}: {
  design: Design;
  values: LabelValues;
  /** Names of the label printers using it; null while profiles are unknown. */
  printers: string[] | null;
  takenNames: readonly string[];
}) {
  const { t } = useT();
  const when = useCompanyWhen();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const titleId = useId();
  const { document, draftChanges, send } = useMemo(() => designState(design), [design]);
  const warnings = useMemo(() => previewIssues(document, values), [document, values]);
  const { widthMm, heightMm } = document.page;

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: trpc.spool.labelDocuments.list.queryKey() }),
      queryClient.invalidateQueries({ queryKey: trpc.spool.listTemplates.queryKey() }),
    ]);
  const push = useMutation(
    trpc.spool.pushTemplate.mutationOptions({
      onSuccess: () => {
        toast.success(t("printing.library.sentToast", { name: design.name }));
        void refresh();
      },
      onError: () => toast.error(t("printing.designs.pushFailed")),
    }),
  );
  const clone = useMutation(
    trpc.spool.labelDocuments.clone.mutationOptions({
      onSuccess: async (copy) => {
        await refresh();
        void navigate({ to: "/printing/templates/$templateId", params: { templateId: copy.id } });
      },
      onError: () => toast.error(t("printing.library.duplicateFailed")),
    }),
  );

  const download = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(document, null, 2)], { type: "application/json" }));
    const link = window.document.createElement("a");
    link.href = url;
    link.download = `${design.name.trim().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "") || "label"}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <li className="min-w-0" data-testid="label-design">
      <article aria-labelledby={titleId} className="flex h-full flex-col overflow-hidden rounded-card border border-border bg-card shadow-sm">
        <div className="flex h-44 flex-col items-center justify-center gap-2 border-b border-border bg-surface-sunken p-3">
          <div
            className="min-w-0"
            style={{ width: `min(100%, ${((document.elements.length > 0 ? PREVIEW_PX : PREVIEW_PX - 28) * widthMm) / heightMm}px)` }}
          >
            <LabelPreview document={document} values={values} title={t("printing.library.preview", { name: design.name })} />
          </div>
          {document.elements.length === 0 ? (
            <p className="m-0 text-[13px] leading-5 text-muted-foreground">{t("printing.library.emptyDesign")}</p>
          ) : null}
        </div>

        <div className="flex flex-1 flex-col gap-3 p-4">
          <div className="flex min-w-0 flex-col gap-0.5">
            <h3 id={titleId} className="m-0 text-base font-semibold leading-snug tracking-[-0.01em] break-words">
              {design.name}
            </h3>
            <p className="m-0 font-mono text-[13px] tabular-nums leading-5 text-muted-foreground">{labelSize(document)}</p>
          </div>

          <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0" data-testid="label-design-status">
            <li className="min-w-0">
              <Chip tone={draftChanges ? "neutral" : "green"}>{t("printing.library.published", { version: design.version })}</Chip>
            </li>
            {draftChanges ? (
              <li className="min-w-0">
                <Chip tone="amber">{t("printing.library.draftChanges")}</Chip>
              </li>
            ) : null}
            <li className="min-w-0">
              {send === "never" ? (
                <Chip tone="amber">{t("printing.library.notSent")}</Chip>
              ) : send === "outdated" ? (
                <Chip tone="amber">{t("printing.library.outdated")}</Chip>
              ) : (
                <Chip tone="neutral">{t("printing.designs.sent", { time: when(design.spoolPushedAt!) })}</Chip>
              )}
            </li>
            {warnings.length > 0 ? (
              <li className="min-w-0">
                <Chip tone="amber" title={warnings.map((issue) => issue.message).join("\n")}>
                  {t("printing.library.warnings", { count: warnings.length })}
                </Chip>
                <span className="sr-only"> {t("printing.library.warningsHint")}</span>
              </li>
            ) : null}
          </ul>

          {printers ? (
            <p className="m-0 flex min-w-0 items-start gap-1.5 text-[13px] leading-5 text-muted-foreground">
              <Printer aria-hidden="true" className="mt-0.5 size-4 shrink-0" strokeWidth={2} />
              <span className="min-w-0 break-words">{printers.length > 0 ? t("printing.library.usedBy", { names: printers.join(", ") }) : t("printing.library.unused")}</span>
            </p>
          ) : null}

          <Can do="spool.push_templates">
            <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
              <Button asChild variant="secondary">
                <UiLink to={`/printing/templates/${design.id}`} aria-describedby={titleId}>
                  <Pencil aria-hidden="true" strokeWidth={2} />
                  {t("printing.library.edit")}
                </UiLink>
              </Button>
              <Button
                variant="secondary"
                aria-label={t("printing.library.sendLong")}
                aria-describedby={titleId}
                title={t("printing.library.sendLong")}
                loading={push.isPending}
                onPress={() => push.mutate({ templateId: design.id })}
              >
                {push.isPending ? null : <Send aria-hidden="true" strokeWidth={2} />}
                {t("printing.library.send")}
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <IconButton className="ml-auto" label={t("printing.library.more", { name: design.name })} icon={<MoreHorizontal strokeWidth={2} />} />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-52">
                  <DropdownMenuItem
                    className="min-h-11 text-[15px]"
                    disabled={clone.isPending}
                    onSelect={() => clone.mutate({ templateId: design.id, name: uniqueDesignName(t("printing.library.copyName", { name: design.name }), takenNames) })}
                  >
                    <Copy aria-hidden="true" strokeWidth={2} />
                    {t("printing.library.duplicate")}
                  </DropdownMenuItem>
                  <DropdownMenuItem className="min-h-11 text-[15px]" onSelect={download}>
                    <Download aria-hidden="true" strokeWidth={2} />
                    {t("printing.library.download")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </Can>
        </div>
      </article>
    </li>
  );
}

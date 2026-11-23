import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Field, NumberInput } from "@orrn/ui/components/field";
import { UiLink } from "@orrn/ui/components/link";
import { PageHeader } from "@orrn/ui/components/page-header";
import { ResponsiveList, type ResponsiveListColumn } from "@orrn/ui/components/responsive-list";
import { Sheet } from "@orrn/ui/components/sheet";
import type { AppRouter } from "@orrn/server/routers/index";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import type { inferRouterOutputs } from "@trpc/server";
import { useState } from "react";
import { toast } from "sonner";

import { FieldTextArea } from "@/features/catalog/field-text-area";
import { Can } from "@/shared/components/can";
import { useFmt } from "@/shared/lib/fmt";
import { kgGrouped1, massUnit } from "@/shared/lib/fmt-text";
import { INLINE_ERROR_META, showsQueryError } from "@/shared/lib/query-errors";
import { trpc } from "@/shared/utils/trpc";

import { defaultRecipeDraft, HOMOG_STATUSES, homogTone, listVerdictTone, newBatchIssue, recipeInput, type RecipeDraft } from "./homog-model";
import { ErrorLine, FieldSelect, LoadFailed } from "./ui";

type Row = inferRouterOutputs<AppRouter>["foundry"]["homog"]["list"]["items"][number];

/** `/foundry/homog`: homogenizing batches, newest first, with a status filter and the "new batch" sheet. */
export function HomogListScreen() {
  const { t } = useT();
  const fmt = useFmt();
  const [status, setStatus] = useState("");
  const [open, setOpen] = useState(false);
  const query = useQuery({
    ...trpc.foundry.homog.list.queryOptions({ limit: 100, ...(status ? { status: status as (typeof HOMOG_STATUSES)[number] } : {}) }),
    meta: INLINE_ERROR_META,
  });
  const header = (
    <PageHeader
      title={t("fdy2.homog.title")}
      subtitle={t("fdy2.homog.subtitle")}
      back={{ to: "/casts", label: t("foundry.casts.title") }}
      actions={
        <Can do="foundry.homog">
          <Button onClick={() => setOpen(true)} data-testid="homog-new">{t("fdy2.homog.new")}</Button>
        </Can>
      }
    />
  );
  if (showsQueryError(query)) return <>{header}<LoadFailed title={t("fdy2.homog.loadFailed")} onRetry={() => void query.refetch()} /></>;
  const columns: ResponsiveListColumn<Row>[] = [
    { key: "number", header: t("fdy2.homog.col.number"), cell: (b) => <span className="font-mono text-[16px] font-bold whitespace-nowrap">{b.number}</span> },
    { key: "furnace", header: t("fdy2.homog.col.furnace"), cell: (b) => <span className="font-mono">{b.furnaceCode}</span> },
    { key: "alloy", header: t("fdy2.homog.col.alloy"), cell: (b) => <span className="font-mono">{b.alloy}</span> },
    { key: "status", header: t("fdy2.homog.col.status"), phoneWide: true, cell: (b) => <Chip tone={homogTone(b.status)}>{t(`fdy2.homog.status.${b.status}`)}</Chip> },
    {
      key: "pcs",
      header: t("fdy2.homog.col.pieces"),
      align: "end",
      cell: (b) => <span className="tabular-nums">{b.pcs} / {kgGrouped1(fmt, b.kgG)} {massUnit(fmt)}</span>,
    },
    {
      key: "soak",
      header: t("fdy2.homog.col.soak"),
      cell: (b) =>
        b.soakOk === null ? (
          <span className="text-muted-foreground">-</span>
        ) : (
          <Chip tone={listVerdictTone(b.soakOk)}>{b.soakOk ? t("fdy2.homog.verdict.ok") : t("fdy2.homog.verdict.short")}</Chip>
        ),
    },
  ];
  return (
    <>
      {header}
      <div className="max-w-xs">
        <FieldSelect aria-label={t("fdy2.homog.filterLabel")} value={status} onChange={(e) => setStatus(e.currentTarget.value)} data-testid="homog-filter">
          <option value="">{t("fdy2.homog.filterAll")}</option>
          {HOMOG_STATUSES.map((s) => (
            <option key={s} value={s}>{t(`fdy2.homog.status.${s}`)}</option>
          ))}
        </FieldSelect>
      </div>
      <ResponsiveList
        rows={query.data?.items ?? []}
        columns={columns}
        rowKey={(b) => b.id}
        rowHref={(b) => `/foundry/homog/${b.id}`}
        loading={query.isLoading}
        label={t("fdy2.homog.title")}
        empty={<EmptyState title={t("fdy2.homog.empty")} description={t("fdy2.homog.emptyBody")} />}
      />
      <NewBatchSheet open={open} onClose={() => setOpen(false)} />
    </>
  );
}

function NewBatchSheet({ open, onClose }: { open: boolean; onClose(): void }) {
  const { t } = useT();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const furnaces = useQuery({ ...trpc.foundry.furnaces.list.queryOptions(), meta: INLINE_ERROR_META, enabled: open });
  const alloys = useQuery({ ...trpc.foundry.alloys.list.queryOptions(), meta: INLINE_ERROR_META, enabled: open });
  const homogFurnaces = (furnaces.data?.items ?? []).filter((f) => f.kind === "homogenizing" && f.status === "active");
  const activeAlloys = (alloys.data?.items ?? []).filter((a) => a.status === "active");
  const [furnaceId, setFurnaceId] = useState("");
  const [alloyId, setAlloyId] = useState("");
  const [recipe, setRecipe] = useState<RecipeDraft>(defaultRecipeDraft);
  const [note, setNote] = useState("");
  const [tried, setTried] = useState(false);
  const create = useMutation(
    trpc.foundry.homog.create.mutationOptions({
      onSuccess: (r) => {
        toast.success(t("fdy2.homog.form.created", { number: r.number }));
        void queryClient.invalidateQueries({ queryKey: trpc.foundry.homog.pathKey() });
        close();
        void navigate({ to: `/foundry/homog/${r.id}` });
      },
    }),
  );
  const close = () => {
    setTried(false);
    setFurnaceId("");
    setAlloyId("");
    setRecipe(defaultRecipeDraft());
    setNote("");
    create.reset();
    onClose();
  };
  const issue = newBatchIssue({ furnaceId, alloyId, recipe });
  const show = (k: string) => (tried && issue === k ? t(`fdy2.homog.form.err.${k}` as "fdy2.homog.form.err.temp") : undefined);
  const noFurnace = furnaces.data !== undefined && homogFurnaces.length === 0;
  return (
    <Sheet
      open={open}
      onOpenChange={(o) => (o ? undefined : close())}
      title={t("fdy2.homog.form.title")}
      footer={
        <>
          <Button variant="secondary" size="lg" onClick={close}>{t("common.cancel")}</Button>
          <Button
            size="lg"
            loading={create.isPending}
            disabled={noFurnace}
            data-testid="homog-create"
            onClick={() => {
              setTried(true);
              const r = recipeInput(recipe);
              if (issue || !r.ok) return;
              create.mutate({ furnaceId, alloyId, targetTempX10: r.targetTempX10, toleranceX10: r.toleranceX10, soakMin: r.soakMin, ...(note.trim() ? { note: note.trim() } : {}) });
            }}
          >
            {t("fdy2.homog.form.create")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 pt-1">
        {noFurnace ? (
          <div className="rounded-card border border-dashed border-border" data-testid="homog-no-furnace">
            <EmptyState
              title={t("fdy2.homog.noFurnace")}
              description={t("fdy2.homog.noFurnaceBody")}
              action={<Button asChild variant="secondary"><UiLink to="/masters/furnaces">{t("fdy2.homog.goFurnaces")}</UiLink></Button>}
            />
          </div>
        ) : (
          <>
            <Field label={t("fdy2.homog.form.furnace")} error={show("furnace")}>
              <FieldSelect value={furnaceId} onChange={(e) => setFurnaceId(e.currentTarget.value)} data-testid="homog-furnace">
                <option value="">{t("fdy2.homog.form.furnacePick")}</option>
                {homogFurnaces.map((f) => (
                  <option key={f.id} value={f.id}>{f.code} {f.name}</option>
                ))}
              </FieldSelect>
            </Field>
            <Field label={t("fdy2.homog.form.alloy")} error={show("alloy")}>
              <FieldSelect value={alloyId} onChange={(e) => setAlloyId(e.currentTarget.value)} data-testid="homog-alloy">
                <option value="">{t("fdy2.homog.form.alloyPick")}</option>
                {activeAlloys.map((a) => (
                  <option key={a.id} value={a.id}>{a.code}</option>
                ))}
              </FieldSelect>
            </Field>
            <Field label={t("fdy2.homog.form.temp")} error={show("temp")}>
              <NumberInput value={recipe.tempC} onValueChange={(v) => setRecipe({ ...recipe, tempC: v })} data-testid="homog-temp" />
            </Field>
            <Field label={t("fdy2.homog.form.tolerance")} error={show("band")}>
              <NumberInput value={recipe.toleranceC} onValueChange={(v) => setRecipe({ ...recipe, toleranceC: v })} data-testid="homog-band" />
            </Field>
            <Field label={t("fdy2.homog.form.soak")} hint={t("fdy2.homog.form.soakHint")} error={show("soak")}>
              <NumberInput value={recipe.soakMin} onValueChange={(v) => setRecipe({ ...recipe, soakMin: v })} data-testid="homog-soak" />
            </Field>
            <Field label={t("fdy2.homog.form.note")} hint={t("common.optional")}>
              <FieldTextArea value={note} maxLength={300} onChange={(e) => setNote(e.currentTarget.value)} />
            </Field>
          </>
        )}
        <ErrorLine error={create.error} />
      </div>
    </Sheet>
  );
}

import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Dialog } from "@orrn/ui/components/dialog";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { FormActions } from "@orrn/ui/components/form-actions";
import { HowToButton } from "@orrn/ui/components/how-to-button";
import { PageHeader } from "@orrn/ui/components/page-header";
import { Sheet } from "@orrn/ui/components/sheet";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { StatusBlock } from "@orrn/ui/components/status-block";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Boxes, Pencil, Trash2 } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";

import { OverflowMenu } from "@/features/catalog/overflow-menu";
import { dieCode, measurementText } from "@/features/dies/die-display";
import { DieForm } from "@/features/dies/die-form";
import { GEOMETRY_FIELDS, kgText, type StoredDie } from "@/features/dies/die-model";
import { Can } from "@/shared/components/can";
import { useLengthUnit } from "@/shared/lib/length";
import { can, useMe } from "@/shared/lib/me";
import { isNotFound } from "@/shared/lib/session-errors";
import { trpc } from "@/shared/utils/trpc";

export const Route = createFileRoute("/_tenant/dies/$id")({
  component: DieRoute,
});

function DieRoute() {
  const { id } = Route.useParams();
  return id === "new" ? <NewDie /> : <DieDetail id={id} />;
}

function NewDie() {
  const { t } = useT();
  const navigate = useNavigate();
  const { unit } = useLengthUnit();
  const formId = useId();
  const [pending, setPending] = useState(false);

  return (
    <>
      <PageHeader
        back={{ to: "/dies", label: t("nav.dies") }}
        title={t("dies.form.titleNew")}
        actions={<HowToButton slug="edit-die" />}
      />
      <div className="flex w-full max-w-[720px] flex-col gap-5 rounded-card border border-border bg-card p-4 sm:p-6">
        <DieForm
          formId={formId}
          unit={unit}
          onPendingChange={setPending}
          onSaved={(newId) => navigate({ to: "/dies/$id", params: { id: newId }, replace: true })}
        />
        <FormActions className="max-sm:bottom-[calc(var(--shell-tabbar-offset)+12px)]">
          <Button variant="secondary" asChild>
            <Link to="/dies">{t("common.cancel")}</Link>
          </Button>
          <Button type="submit" form={formId} loading={pending}>
            {t("dies.form.submit")}
          </Button>
        </FormActions>
      </div>
    </>
  );
}

function DieDetail({ id }: { id: string }) {
  const { t } = useT();
  const { data: me } = useMe();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { unit } = useLengthUnit();
  const formId = useId();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [pending, setPending] = useState(false);

  const query = useQuery({ ...trpc.die.get.queryOptions({ id }), retry: false });

  const remove = useMutation({
    ...trpc.die.delete.mutationOptions(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: trpc.die.list.queryKey() });
      toast.success(t("dies.detail.deleted"));
      navigate({ to: "/dies" });
    },
    onError: (error) => {
      toast.error(error.data?.code === "FORBIDDEN" ? t("errors.forbidden") : t("errors.generic"));
    },
  });

  const back = { to: "/dies", label: t("nav.dies") };

  if (query.isPending) {
    return (
      <div aria-busy="true" className="flex flex-col gap-5">
        <span className="sr-only">{t("common.loading")}</span>
        <Skeleton className="h-11 w-24 rounded-full" />
        <Skeleton className="h-10 w-2/3 max-w-[420px]" />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Skeleton className="h-[184px] rounded-[22px]" />
          <Skeleton className="h-[184px] rounded-card" />
        </div>
      </div>
    );
  }

  // Only a first load that failed is an error page: a failed background refetch (focus, retry)
  // keeps data and sets isError, and must not throw good numbers away (T19 21:09Z gotcha).
  if (query.isError && query.data === undefined) {
    const missing = isNotFound(query.error);
    return (
      <>
        <PageHeader back={back} title={t("nav.dies")} />
        <EmptyState
          title={missing ? t("dies.detail.notFound") : t("dies.detail.loadFailed")}
          action={
            missing ? (
              <Button asChild variant="secondary">
                <Link to="/dies">{t("dies.detail.backToList")}</Link>
              </Button>
            ) : (
              <Button variant="secondary" onClick={() => query.refetch()}>
                {t("common.retry")}
              </Button>
            )
          }
        />
      </>
    );
  }

  const die = query.data as StoredDie & { id: string };
  const code = dieCode(die);
  const units = { mm: t("units.mm"), inch: t("units.inch") };
  const measurements = GEOMETRY_FIELDS.map((field) => {
    const column = ({ width: "widthMm", thickness: "thicknessMm", oblique: "obliqueMm", leg: "legMm" } as const)[field];
    const legacy = field === "width" || field === "thickness" ? die.dimensions?.[column] : undefined;
    const mm = die[column] ?? (typeof legacy === "number" ? legacy : null);
    return { field, mm };
  }).filter((m): m is { field: (typeof GEOMETRY_FIELDS)[number]; mm: number } => m.mm !== null);

  return (
    <>
      <PageHeader
        back={back}
        title={code}
        subtitle={die.name ?? undefined}
        actions={
          <>
            <HowToButton slug="edit-die" />
            <OverflowMenu
              items={
                can(me, "die.delete")
                  ? [
                      {
                        key: "delete",
                        label: t("dies.detail.delete"),
                        icon: <Trash2 aria-hidden="true" strokeWidth={2} />,
                        onSelect: () => setDeleting(true),
                        danger: true,
                      },
                    ]
                  : []
              }
            />
            <Can do="die.update">
              <Button onClick={() => setEditing(true)}>
                <Pencil aria-hidden="true" strokeWidth={2} />
                {t("dies.detail.edit")}
              </Button>
            </Can>
          </>
        }
      />

      <div className="grid grid-cols-1 items-stretch gap-4 lg:grid-cols-2">
        <StatusBlock
          tone={die.status === "active" ? "green" : "neutral"}
          title={t("dies.detail.band")}
          meta={t(`status.die.${die.status}`)}
          value={t("dies.detail.bandValue", { min: kgText(die.weightMinG), max: kgText(die.weightMaxG) })}
          mono={false}
          unit={t("units.kgPer12ft")}
          className="animate-rise"
        />

        <section
          aria-labelledby={`${formId}-measure`}
          className="flex min-w-0 flex-col gap-4 rounded-card border border-border bg-card p-5"
        >
          <h2 id={`${formId}-measure`} className="m-0 text-[17px] leading-6 font-semibold tracking-[-0.01em]">
            {t("dies.detail.measurements")}
          </h2>
          {measurements.length > 0 ? (
            <dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-3">
              {measurements.map((m) => (
                <div key={m.field} className="flex min-w-0 flex-col gap-0.5">
                  <dt className="text-[13px] font-medium text-muted-foreground">{t(`dies.form.${m.field}`)}</dt>
                  <dd data-no-truncate="" className="m-0 font-mono text-[17px] font-semibold tabular-nums">
                    {measurementText(m.mm, unit, units)}
                  </dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="m-0 text-[15px] text-muted-foreground">{t("dies.detail.noMeasurements")}</p>
          )}
          {die.notes ? (
            <div className="flex min-w-0 flex-col gap-0.5 border-t border-border pt-3">
              <span className="text-[13px] font-medium text-muted-foreground">{t("dies.form.notes")}</span>
              <p className="m-0 text-[15px] leading-6 break-words whitespace-pre-line">{die.notes}</p>
            </div>
          ) : null}
          <div className="mt-auto pt-1">
            <Button variant="secondary" asChild>
              <Link to="/stock/$dieId" params={{ dieId: die.id }}>
                <Boxes aria-hidden="true" strokeWidth={2} />
                {t("dies.detail.seeStock")}
              </Link>
            </Button>
          </div>
        </section>
      </div>

      <Sheet
        open={editing}
        onOpenChange={setEditing}
        title={t("dies.detail.editTitle", { code })}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" form={formId} loading={pending}>
              {t("dies.form.submit")}
            </Button>
          </>
        }
      >
        {editing ? (
          <DieForm formId={formId} unit={unit} die={die} onPendingChange={setPending} onSaved={() => setEditing(false)} />
        ) : null}
      </Sheet>

      <Dialog
        open={deleting}
        onOpenChange={setDeleting}
        title={t("dies.detail.deleteTitle", { code })}
        description={t("dies.detail.deleteBody")}
        actions={
          <>
            <Button variant="secondary" onClick={() => setDeleting(false)}>
              {t("common.cancel")}
            </Button>
            <Button variant="danger" loading={remove.isPending} onClick={() => remove.mutate({ id: die.id })}>
              {t("dies.detail.delete")}
            </Button>
          </>
        }
      />
    </>
  );
}

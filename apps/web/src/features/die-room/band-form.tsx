import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Field, NumberInput, TextInput } from "@orrn/ui/components/field";
import { FormActions } from "@orrn/ui/components/form-actions";
import { PageHeader } from "@orrn/ui/components/page-header";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useId, useState } from "react";
import { toast } from "sonner";

import { dieCode } from "@/features/dies/die-display";
import { Can } from "@/shared/components/can";
import { INLINE_ERROR_META, showsQueryError } from "@/shared/lib/query-errors";
import { trpc } from "@/shared/utils/trpc";

import {
  bandTitle,
  conflictExisting,
  parseKgToMilli,
  parseWallTenths,
  refusalText,
  wallMmText,
} from "./die-room-model";

/** `/dies/$id/bands/new`: another commercial band under a section. The duplicate guard answers in the server's words. */
export function NewBandPage({ id }: { id: string }) {
  const { t } = useT();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const formId = useId();
  const [wall, setWall] = useState("");
  const [minKg, setMinKg] = useState("");
  const [maxKg, setMaxKg] = useState("");
  const [label, setLabel] = useState("");
  const [errors, setErrors] = useState<{ wall?: string; min?: string; max?: string }>({});
  const [refusal, setRefusal] = useState<string | null>(null);
  const [existing, setExisting] = useState<ReturnType<typeof conflictExisting>>(null);

  const section = useQuery({ ...trpc.die.get.queryOptions({ id }), retry: false, meta: INLINE_ERROR_META });
  const back = { to: `/dies/${id}`, label: t("dieRoom.band.backToSection") };

  const create = useMutation({
    ...trpc.die.bands.create.mutationOptions(),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: trpc.die.pathKey() }),
        queryClient.invalidateQueries({ queryKey: trpc.dieInstance.pathKey() }),
      ]);
      toast.success(t("dieRoom.band.saved"));
      navigate({ to: "/dies/$id", params: { id } });
    },
    onError: (error) => {
      const hit = conflictExisting(error);
      setExisting(hit);
      setRefusal(hit ? null : refusalText(error, { forbidden: t("errors.forbidden"), generic: t("errors.generic") }));
    },
  });

  if (section.isPending) {
    return (
      <div aria-busy="true" className="flex flex-col gap-4">
        <span className="sr-only">{t("common.loading")}</span>
        <Skeleton className="h-10 w-2/3 max-w-[420px]" />
        <Skeleton className="h-[260px] rounded-card" />
      </div>
    );
  }
  if (showsQueryError(section) || !section.data) {
    return (
      <>
        <PageHeader back={{ to: "/dies", label: t("nav.dies") }} title={t("dieRoom.band.title")} />
        <EmptyState
          title={t("dies.detail.notFound")}
          action={
            <Button asChild variant="secondary">
              <Link to="/dies">{t("dies.detail.backToList")}</Link>
            </Button>
          }
        />
      </>
    );
  }

  const code = dieCode(section.data);
  const hasWall = section.data.wallTenthMmEffective > 0;
  const defaultWall = hasWall ? wallMmText(section.data.wallTenthMmEffective) : "";

  const submit = () => {
    const wallTenth = wall.trim() === "" ? (hasWall ? section.data!.wallTenthMmEffective : null) : parseWallTenths(wall);
    const minG = parseKgToMilli(minKg);
    const maxG = parseKgToMilli(maxKg);
    const found: typeof errors = {};
    if (wallTenth === null) found.wall = t("dieRoom.band.wallInvalid");
    if (minG === null) found.min = t("dieRoom.band.kgInvalid");
    if (maxG === null) found.max = t("dieRoom.band.kgInvalid");
    if (minG !== null && maxG !== null && minG > maxG) found.max = t("dies.form.rangeOrder");
    setErrors(found);
    setRefusal(null);
    setExisting(null);
    if (Object.keys(found).length > 0 || wallTenth === null || minG === null || maxG === null) return;
    create.mutate({
      sectionId: id,
      wallTenthMm: wallTenth,
      weightMinG: minG,
      weightMaxG: maxG,
      ...(label.trim() ? { label: label.trim() } : {}),
    });
  };

  return (
    <Can
      do="die.update"
      fallback={
        <>
          <PageHeader back={back} title={t("dieRoom.band.title")} />
          <EmptyState
            title={t("dieRoom.band.cantAdd")}
            action={
              <Button asChild variant="secondary">
                <Link to="/dies/$id" params={{ id }}>
                  {t("dieRoom.band.backToSection")}
                </Link>
              </Button>
            }
          />
        </>
      }
    >
      <PageHeader back={back} title={t("dieRoom.band.title")} subtitle={code} />
      <form
        id={formId}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="flex w-full max-w-[720px] flex-col gap-5 rounded-card border border-border bg-card p-4 sm:p-6"
      >
        <p className="m-0 text-[14px] leading-6 text-muted-foreground">{t("dieRoom.band.intro")}</p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label={t("dieRoom.bands.wall")} hint={hasWall ? t("dieRoom.band.wallHint", { wall: defaultWall }) : t("dieRoom.band.wallNone")} error={errors.wall}>
            <NumberInput value={wall} onValueChange={setWall} suffix={t("units.mm")} placeholder={defaultWall} />
          </Field>
          <Field label={t("dieRoom.band.min")} hint={t("units.kgPer12ft")} error={errors.min}>
            <NumberInput value={minKg} onValueChange={setMinKg} suffix={t("units.kg")} />
          </Field>
          <Field label={t("dieRoom.band.max")} hint={t("units.kgPer12ft")} error={errors.max}>
            <NumberInput value={maxKg} onValueChange={setMaxKg} suffix={t("units.kg")} />
          </Field>
        </div>
        <Field label={t("dieRoom.bands.label")} hint={t("common.optional")}>
          <TextInput value={label} onChangeText={setLabel} maxLength={40} autoComplete="off" />
        </Field>

        {existing ? (
          <p role="alert" className="m-0 rounded-card border border-border bg-tone-red-tint px-4 py-3 text-[15px] leading-6 text-tone-red-ink">
            <Link to="/dies/$id" params={{ id }} className="font-semibold text-tone-red-ink">
              {t("dieRoom.errors.exists", {
                code: `${existing.sectionCode} · ${bandTitle(existing, t("units.mm"))}`,
              })}
            </Link>
            <br />
            {t("dieRoom.band.useExisting")}
          </p>
        ) : null}
        {refusal ? (
          <p role="alert" className="m-0 text-[14px] leading-5 font-medium text-destructive">
            {refusal}
          </p>
        ) : null}

        <FormActions className="max-sm:bottom-[calc(var(--shell-tabbar-offset)+12px)]">
          <Button variant="secondary" asChild>
            <Link to="/dies/$id" params={{ id }}>
              {t("common.cancel")}
            </Link>
          </Button>
          <Button type="submit" form={formId} loading={create.isPending}>
            {t("dieRoom.band.save")}
          </Button>
        </FormActions>
      </form>
    </Can>
  );
}

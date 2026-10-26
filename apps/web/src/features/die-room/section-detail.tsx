import { useT } from "@orrn/i18n";
import { Badge } from "@orrn/ui/components/badge";
import { Button } from "@orrn/ui/components/button";
import { Card, CardTitle } from "@orrn/ui/components/card";
import { Dialog } from "@orrn/ui/components/dialog";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Field, NumberInput, TextInput } from "@orrn/ui/components/field";
import { HowToButton } from "@orrn/ui/components/how-to-button";
import { PageHeader } from "@orrn/ui/components/page-header";
import { Select } from "@orrn/ui/components/select";
import { Sheet } from "@orrn/ui/components/sheet";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Boxes, Pencil, Plus, Share2, Trash2 } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";

import { OverflowMenu } from "@/features/catalog/overflow-menu";
import { dieCode, measurementText } from "@/features/dies/die-display";
import { DieForm } from "@/features/dies/die-form";
import { GEOMETRY_FIELDS, type StoredDie } from "@/features/dies/die-model";
import { Can } from "@/shared/components/can";
import { useLengthUnit } from "@/shared/lib/length";
import { can, useMe } from "@/shared/lib/me";
import { isNotFound } from "@/shared/lib/session-errors";
import { INLINE_ERROR_META, showsQueryError } from "@/shared/lib/query-errors";
import { trpc } from "@/shared/utils/trpc";

import { ConfirmDialog } from "./confirm-dialog";
import { useNewCopyOnTrial } from "./use-die-room";
import { BandPositionChip, PercentChip, StatusChip } from "./drift-chips";
import { ShareSheet } from "./share-sheet";
import {
  bandTitle,
  formatBand,
  kgPerMetreText,
  milliKgText,
  parseRank,
  refusalText,
  shortDate,
  type BandPosition,
  type CopyStatus,
  type DriftTone,
} from "./die-room-model";

type BandView = {
  id: string | null;
  wallTenthMm: number;
  weightMinG: number;
  weightMaxG: number;
  label: string | null;
  active: boolean;
  primary: boolean;
  copyIds: string[];
  liftedOut: { dieInstanceId: string; code: string; toBand: string; toWeightMinG: number; toWeightMaxG: number; at: string | null }[];
};

type CopyView = {
  id: string;
  code: string;
  status: CopyStatus;
  tierRank: number | null;
  rackNo: string | null;
  ownerName: string | null;
  currentMilli: number | null;
  pctTenth: number | null;
  tone: DriftTone;
  position: BandPosition | null;
  kgPerMetre: number | null;
};

/** `/dies/$id`: the section (existing die page) with its bands, copies and the copy to run first. */
export function SectionDetail({ id }: { id: string }) {
  const { t } = useT();
  const { data: me } = useMe();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { unit } = useLengthUnit();
  const formId = useId();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [adding, setAdding] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [pending, setPending] = useState(false);
  const [retiring, setRetiring] = useState<BandView | null>(null);

  const query = useQuery({ ...trpc.die.get.queryOptions({ id }), retry: false, meta: INLINE_ERROR_META });
  const hasCopies = (query.data?.copies.length ?? 0) > 0;
  const suggestion = useQuery({
    ...trpc.dieInstance.suggestFirst.queryOptions({ sectionId: id }),
    enabled: hasCopies,
    meta: INLINE_ERROR_META,
  });

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

  const retireBand = useMutation({
    ...trpc.die.bands.retire.mutationOptions(),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: trpc.die.pathKey() }),
        queryClient.invalidateQueries({ queryKey: trpc.dieInstance.pathKey() }),
      ]);
      setRetiring(null);
      toast.success(t("dieRoom.bands.retiredToast"));
    },
    onError: (e) => {
      setRetiring(null);
      toast.error(refusalText(e, t));
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

  if (showsQueryError(query)) {
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

  const die = query.data as unknown as StoredDie & {
    id: string;
    profileKind: "hollow" | "solid" | "semi" | null;
    alloy: string | null;
    temper: string | null;
    cavityCount: number | null;
    ownerName: string | null;
    primaryKgPerMetre: { min: number; max: number };
    bands: BandView[];
    copies: CopyView[];
  };
  const code = dieCode(die);
  const units = { mm: t("units.mm"), inch: t("units.inch") };
  const measurements = GEOMETRY_FIELDS.map((field) => {
    const column = ({ width: "widthMm", thickness: "thicknessMm", leg: "legMm" } as const)[field];
    const legacy = field === "width" || field === "thickness" ? die.dimensions?.[column] : undefined;
    const mm = die[column] ?? (typeof legacy === "number" ? legacy : null);
    return { field, mm };
  }).filter((m): m is { field: (typeof GEOMETRY_FIELDS)[number]; mm: number } => m.mm !== null);
  const copyById = new Map(die.copies.map((c) => [c.id, c]));
  const facts = [
    die.profileKind ? t(`dieRoom.card.${die.profileKind}`) : null,
    [die.alloy, die.temper].filter(Boolean).join(" ") || null,
    die.cavityCount ? t("dieRoom.section.cavityCount", { count: die.cavityCount }) : null,
  ].filter(Boolean);
  const pick = suggestion.data;

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
            <Can do={["die.card", "masters.publish"]}>
              <Button variant="secondary" onClick={() => setSharing(true)} data-testid="section-share">
                <Share2 aria-hidden="true" strokeWidth={2} />
                {t("dieRoom.share.button")}
              </Button>
            </Can>
            <Can do="die.update">
              <Button variant="secondary" asChild>
                <Link to="/dies/$id/bands/new" params={{ id: die.id }}>
                  <Plus aria-hidden="true" strokeWidth={2} />
                  {t("dieRoom.bands.add")}
                </Link>
              </Button>
              <Button variant="secondary" onClick={() => setEditing(true)}>
                <Pencil aria-hidden="true" strokeWidth={2} />
                {t("dies.detail.edit")}
              </Button>
            </Can>
            <Can do={["die.card", "masters.publish"]}>
              <Button onClick={() => setAdding(true)}>
                <Plus aria-hidden="true" strokeWidth={2} />
                {t("dieRoom.copies.add")}
              </Button>
            </Can>
          </>
        }
      />

      <p className="m-0 flex flex-wrap items-center gap-x-3 gap-y-1 text-[15px] leading-6 text-muted-foreground">
        {facts.map((f, i) => (
          <span key={i}>{f}</span>
        ))}
        <span>
          {die.ownerName ? (
            <>
              {t("dieRoom.card.ownerLabel")} <span className="font-semibold text-foreground">{die.ownerName}</span>
            </>
          ) : (
            t("dieRoom.board.plantOwned")
          )}
        </span>
      </p>

      {pick ? (
        <p
          role="status"
          className="m-0 rounded-card border border-border bg-tone-green-tint px-4 py-3 text-[15px] leading-6 font-semibold text-tone-green-ink"
        >
          {t("dieRoom.section.useFirst", { code: pick.code, kg: milliKgText(pick.kgPer12ftMilli) })}
        </p>
      ) : null}

      <section aria-labelledby={`${formId}-bands`} className="flex min-w-0 flex-col gap-3">
        <h2 id={`${formId}-bands`} className="m-0 text-[17px] leading-6 font-semibold tracking-[-0.01em]">
          {t("dieRoom.section.bandsAndCopies")}
        </h2>
        {die.copies.length === 0 ? (
          <Card>
            <EmptyState
              title={t("dieRoom.copies.empty")}
              body={t("dieRoom.section.emptyCopiesBody")}
              action={
                <Can do={["die.card", "masters.publish"]}>
                  <Button onClick={() => setAdding(true)}>{t("dieRoom.copies.add")}</Button>
                </Can>
              }
            />
          </Card>
        ) : null}
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {die.bands.map((band) => (
            <Card key={band.id ?? "primary"} className="min-w-0" data-testid={`band-${band.id ?? "primary"}`}>
              <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <CardTitle>
                    <span className="font-mono tabular-nums">
                      {bandTitle(band, t("units.mm"), t("units.kgPer12ft"))}
                    </span>
                  </CardTitle>
                  {band.label ? <p className="m-0 text-[13px] text-muted-foreground">{band.label}</p> : null}
                </div>
                {band.primary ? <Badge tone="info">{t("dieRoom.bands.primary")}</Badge> : null}
                {!band.active ? <Badge tone="neutral">{t("dieRoom.bands.retired")}</Badge> : null}
              </div>
              {band.copyIds.length === 0 && band.liftedOut.length === 0 ? (
                <p className="m-0 text-[14px] text-muted-foreground">{t("dieRoom.bands.noCopies")}</p>
              ) : null}
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {band.copyIds.map((copyId) => {
                  const c = copyById.get(copyId);
                  return c ? (
                    <li key={c.id}>
                      <CopyRow copy={c} />
                    </li>
                  ) : null;
                })}
                {band.liftedOut.map((l) => (
                  <li key={l.dieInstanceId} className="text-[14px] leading-6 text-muted-foreground">
                    {t("dieRoom.bands.liftedTo", { code: l.code, band: formatBand(l.toWeightMinG, l.toWeightMaxG, t("units.kgPer12ft")), date: shortDate(l.at) })}
                  </li>
                ))}
              </ul>
              {!band.primary && band.active && band.id ? (
                <Can do="die.update">
                  <div>
                    <Button variant="ghost" className="px-3" onClick={() => setRetiring(band)}>
                      {t("dieRoom.bands.retire")}
                    </Button>
                  </div>
                </Can>
              ) : null}
            </Card>
          ))}
        </div>
      </section>

      <div className="grid grid-cols-1 items-stretch gap-4">
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
          <p className="m-0 font-mono text-[13px] text-muted-foreground tabular-nums">
            {kgPerMetreText(die.primaryKgPerMetre.min)}–{kgPerMetreText(die.primaryKgPerMetre.max)} {t("units.kgPerMetre")}
          </p>
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

      <ConfirmDialog
        open={retiring !== null}
        title={t("dieRoom.bands.retireTitle")}
        body={retiring ? `${bandTitle(retiring, t("units.mm"), t("units.kgPer12ft"))}. ${t("dieRoom.bands.retireBody")}` : ""}
        confirmLabel={t("dieRoom.bands.retire")}
        loading={retireBand.isPending}
        onConfirm={() => retiring?.id && retireBand.mutate({ id: retiring.id })}
        onClose={() => setRetiring(null)}
      />

      <AddCopySheet open={adding} onOpenChange={setAdding} sectionId={die.id} sectionCode={die.sectionCode} bands={die.bands} />

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
      <ShareSheet open={sharing} onOpenChange={setSharing} sectionId={die.id} />
    </>
  );
}

function CopyRow({ copy }: { copy: CopyView }) {
  const { t } = useT();
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-card border border-border bg-surface-sunken p-3" data-testid={`copy-${copy.code}`}>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Link
          to="/dies/copies/$copyId"
          params={{ copyId: copy.id }}
          className="inline-flex min-h-11 items-center font-mono text-[15px] font-semibold tabular-nums text-foreground no-underline"
        >
          {copy.code}
        </Link>
        <StatusChip status={copy.status} />
        <span className="text-[13px] text-muted-foreground">
          {copy.tierRank == null ? t("dieRoom.copies.untiered") : t("dieRoom.copies.tier", { rank: copy.tierRank })}
        </span>
        {copy.ownerName ? <span className="text-[13px] text-muted-foreground">{copy.ownerName}</span> : null}
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {copy.currentMilli == null ? (
          <span className="text-[14px] text-muted-foreground">{t("dieRoom.card.noReading")}</span>
        ) : (
          <>
            <span data-no-truncate="" className="font-mono text-[14px] tabular-nums">
              {milliKgText(copy.currentMilli)} {t("units.kgPer12ft")}
            </span>
            <span className="font-mono text-[13px] tabular-nums text-muted-foreground">
              {kgPerMetreText(copy.kgPerMetre)} {t("units.kgPerMetre")}
            </span>
            <PercentChip tone={copy.tone} pctTenth={copy.pctTenth} position={copy.position} />
            <BandPositionChip position={copy.position} />
          </>
        )}
      </div>
    </div>
  );
}

function AddCopySheet({
  open,
  onOpenChange,
  sectionId,
  sectionCode,
  bands,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  sectionId: string;
  sectionCode: string;
  bands: BandView[];
}) {
  const { t } = useT();
  const queryClient = useQueryClient();
  const [tier, setTier] = useState("");
  const [bandId, setBandId] = useState("primary");
  const [rack, setRack] = useState("");
  const [makerDie, setMakerDie] = useState("");
  const [makerProject, setMakerProject] = useState("");
  const [error, setError] = useState<string | null>(null);
  const formId = useId();
  const startsOnTrial = useNewCopyOnTrial();

  const create = useMutation({
    ...trpc.dieInstance.create.mutationOptions(),
    onSuccess: async (r) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: trpc.die.pathKey() }),
        queryClient.invalidateQueries({ queryKey: trpc.dieInstance.pathKey() }),
      ]);
      toast.success(t(r.status === "on_trial" ? "dieRoom.section.copyAddedTrial" : "dieRoom.section.copyAdded", { code: r.code }));
      setTier("");
      setRack("");
      setMakerDie("");
      setMakerProject("");
      setBandId("primary");
      setError(null);
      onOpenChange(false);
    },
    onError: (e) => setError(refusalText(e, t)),
  });

  const submit = () => {
    const rank = tier.trim() === "" ? undefined : parseRank(tier);
    if (rank === null) {
      setError(t("dieRoom.tier.rankInvalid"));
      return;
    }
    setError(null);
    create.mutate({
      sectionId,
      ...(rank !== undefined ? { tierRank: rank } : {}),
      ...(bandId !== "primary" ? { bandId } : {}),
      ...(rack.trim() ? { rackNo: rack.trim() } : {}),
      ...(makerDie.trim() ? { makerDieNo: makerDie.trim() } : {}),
      ...(makerProject.trim() ? { makerProjectNo: makerProject.trim() } : {}),
    });
  };

  const options = bands
    .filter((b) => b.active)
    .map((b) => ({
      value: b.id ?? "primary",
      label: bandTitle(b, t("units.mm"), t("units.kgPer12ft")),
    }));

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t("dieRoom.section.addCopyTitle", { code: sectionCode })}
      description={t("dieRoom.section.addCopyBody")}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button onClick={submit} loading={create.isPending}>
            {t("dieRoom.copies.add")}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Field label={t("dieRoom.section.tierOptional")}>
          <NumberInput value={tier} onValueChange={setTier} decimal={false} />
        </Field>
        {options.length > 1 ? (
          <Field label={t("dieRoom.copies.band")}>
            <Select value={bandId} onValueChange={setBandId} options={options} />
          </Field>
        ) : null}
        <Field label={t("dieRoom.copies.rack")}>
          <TextInput value={rack} onChangeText={setRack} maxLength={20} autoComplete="off" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("dieRoom.card.makerDieNo")}>
            <TextInput value={makerDie} onChangeText={setMakerDie} maxLength={60} autoComplete="off" />
          </Field>
          <Field label={t("dieRoom.card.makerProjectNo")}>
            <TextInput value={makerProject} onChangeText={setMakerProject} maxLength={60} autoComplete="off" />
          </Field>
        </div>
        {startsOnTrial ? (
          <p className="m-0 text-[13px] leading-5 text-muted-foreground" data-testid="starts-on-trial">
            {t("dieRoom.section.startsOnTrial")}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="m-0 text-[14px] leading-5 font-medium text-destructive">
            {error}
          </p>
        ) : null}
      </form>
    </Sheet>
  );
}

import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Field, NumberInput, TextInput } from "@orrn/ui/components/field";
import { PageHeader } from "@orrn/ui/components/page-header";
import { ResponsiveList, type ResponsiveListColumn } from "@orrn/ui/components/responsive-list";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { MasterNote, MastersLoadError, RowEdit } from "@/features/masters/masters-ui";
import { kgFromG } from "@/features/press/model";
import { Can } from "@/shared/components/can";
import { can, useMe } from "@/shared/lib/me";
import { trpc } from "@/shared/utils/trpc";

import { useAgeingInvalidate, useDuration, type Oven, type Recipe, type Trolley } from "./hooks";
import { kgFromText, kgToText, wholeFromText, x10FromText, x10Text } from "./model";
import { FormSheet, FieldSelect as NativeSelect } from "./ui";

type Status = "draft" | "active" | "out_of_service";

function useMasterAccess() {
  const { data: me } = useMe();
  return { draft: can(me, "masters.draft") || can(me, "masters.publish"), publish: can(me, "masters.publish") };
}

function StatusChip({ status }: { status: string }) {
  const { t } = useT();
  const tone = status === "active" ? "green" : status === "out_of_service" ? "red" : "neutral";
  const label = status === "archived" ? t("ageing.recipeStatus.archived") : t(`ageing.masterStatus.${status as Status}`);
  return (
    <Chip tone={tone} truncate={false}>
      {label}
    </Chip>
  );
}

function StatusField({ value, onChange, publish, extra }: { value: string; onChange(v: string): void; publish: boolean; extra?: { value: string; label: string }[] }) {
  const { t } = useT();
  return (
    <Field label={t("ageing.masters.status")} hint={publish ? undefined : t("ageing.masters.draftOnly")}>
      <NativeSelect value={value} onChange={(e) => onChange(e.currentTarget.value)} disabled={!publish && value === "draft" ? false : !publish} data-testid="master-status">
        <option value="draft">{t("ageing.masterStatus.draft")}</option>
        <option value="active" disabled={!publish}>
          {t("ageing.masterStatus.active")}
        </option>
        {extra?.map((o) => (
          <option key={o.value} value={o.value} disabled={!publish}>
            {o.label}
          </option>
        ))}
      </NativeSelect>
    </Field>
  );
}

function Shell({ title, subtitle, add, children }: { title: string; subtitle: string; add: React.ReactNode; children: React.ReactNode }) {
  const { t } = useT();
  const access = useMasterAccess();
  return (
    <>
      <PageHeader back={{ to: "/masters", label: t("masters.backToMasters") }} title={title} subtitle={subtitle} actions={add} />
      {!access.draft ? <MasterNote body={t("masters.readOnly")} /> : null}
      {children}
    </>
  );
}

// ---------------------------------------------------------------------------
// Ovens
// ---------------------------------------------------------------------------

export function OvensPage() {
  const { t } = useT();
  const access = useMasterAccess();
  const list = useQuery(trpc.ageing.ovens.list.queryOptions({ includeInactive: true }));
  const [sheet, setSheet] = useState<{ open: boolean; row?: Oven }>({ open: false });
  const columns: ResponsiveListColumn<Oven>[] = [
    {
      key: "code",
      header: t("ageing.field.code"),
      cell: (r) => (
        <RowEdit editable={access.draft} label={r.code} mono onEdit={() => setSheet({ open: true, row: r })}>
          {r.code}
        </RowEdit>
      ),
    },
    { key: "name", header: t("ageing.field.name"), cell: (r) => r.name ?? "-" },
    { key: "cap", header: t("ageing.field.capacityKg"), align: "end", cell: (r) => <span className="font-mono tabular-nums">{r.capacityG ? kgFromG(r.capacityG) : "-"}</span> },
    { key: "max", header: t("ageing.field.maxTemp"), align: "end", hideOnPhone: true, cell: (r) => <span className="font-mono tabular-nums">{r.maxTempX10 ? x10Text(r.maxTempX10) : "-"}</span> },
    { key: "use", header: t("ageing.masters.inUse"), hideOnPhone: true, cell: (r) => r.busyBatchNumber ?? "-" },
    { key: "status", header: t("ageing.masters.status"), phoneWide: true, cell: (r) => <StatusChip status={r.status} /> },
  ];
  return (
    <Shell
      title={t("ageing.masters.ovens")}
      subtitle={t("ageing.masters.ovensHint")}
      add={
        <Can do={["masters.draft", "masters.publish"]}>
          <Button onClick={() => setSheet({ open: true })} aria-haspopup="dialog" data-testid="add-oven">
            <Plus aria-hidden="true" strokeWidth={2} />
            {t("ageing.action.addOven")}
          </Button>
        </Can>
      }
    >
      {list.isError && !list.data ? (
        <MastersLoadError onRetry={() => void list.refetch()} />
      ) : (
        <ResponsiveList rows={list.data?.items ?? []} columns={columns} rowKey={(r) => r.id} loading={list.isLoading} label={t("ageing.masters.ovens")} empty={<EmptyState title={t("ageing.masters.noOvens")} />} />
      )}
      <OvenSheet open={sheet.open} onOpenChange={(open) => setSheet((s) => ({ ...s, open }))} row={sheet.row} />
    </Shell>
  );
}

function OvenSheet({ open, onOpenChange, row }: { open: boolean; onOpenChange(o: boolean): void; row?: Oven }) {
  const { t } = useT();
  const access = useMasterAccess();
  const invalidate = useAgeingInvalidate();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [cap, setCap] = useState("");
  const [max, setMax] = useState("");
  const [unit, setUnit] = useState("m3");
  const [status, setStatus] = useState<string>("draft");
  const [note, setNote] = useState("");
  const [tried, setTried] = useState(false);
  useEffect(() => {
    if (!open) return;
    setCode(row?.code ?? "");
    setName(row?.name ?? "");
    setCap(kgToText(row?.capacityG));
    setMax(row?.maxTempX10 ? String(row.maxTempX10 / 10) : "");
    setUnit(row?.meterUnit ?? "m3");
    setStatus(row?.status ?? "draft");
    setNote(row?.note ?? "");
    setTried(false);
  }, [open, row?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = useMutation(
    trpc.ageing.ovens.save.mutationOptions({
      onSuccess: async () => {
        toast.success(t("masters.saved", { name: code.trim() }));
        await invalidate();
        onOpenChange(false);
      },
    }),
  );
  const capG = cap.trim() ? kgFromText(cap) : null;
  const maxX10 = max.trim() ? x10FromText(max) : null;
  const bad = (cap.trim() !== "" && capG === null) || (max.trim() !== "" && maxX10 === null);
  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      title={row ? t("ageing.masters.editOven", { code: row.code }) : t("ageing.action.addOven")}
      busy={save.isPending}
      error={save.error}
      submitLabel={t("ageing.masters.save")}
      testId="oven-form"
      onSubmit={() => {
        setTried(true);
        if (!code.trim() || bad) return;
        save.mutate({
          ...(row ? { id: row.id } : {}),
          code: code.trim(),
          name: name.trim() || null,
          capacityG: capG,
          maxTempX10: maxX10,
          meterUnit: unit.trim() || "m3",
          status: status as Status,
          note: note.trim() || null,
        });
      }}
    >
      <Field label={t("ageing.field.code")} hint={t("ageing.masters.codeHint")} error={tried && !code.trim() ? t("ageing.masters.codeRequired") : undefined}>
        <TextInput value={code} maxLength={16} autoComplete="off" className="font-mono" onChange={(e) => setCode(e.currentTarget.value)} data-testid="master-code" />
      </Field>
      <Field label={t("ageing.field.name")} hint={t("common.optional")}>
        <TextInput value={name} maxLength={60} onChange={(e) => setName(e.currentTarget.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("ageing.field.capacityKg")} error={tried && cap.trim() && capG === null ? t("ageing.masters.numberInvalid") : undefined}>
          <NumberInput value={cap} onValueChange={setCap} suffix={t("units.kg")} data-testid="master-capacity" />
        </Field>
        <Field label={t("ageing.field.maxTemp")} error={tried && max.trim() && maxX10 === null ? t("ageing.masters.numberInvalid") : undefined}>
          <NumberInput value={max} onValueChange={setMax} suffix="°C" />
        </Field>
      </div>
      <Field label={t("ageing.field.meterUnit")}>
        <TextInput value={unit} maxLength={8} onChange={(e) => setUnit(e.currentTarget.value)} />
      </Field>
      <StatusField value={status} onChange={setStatus} publish={access.publish} extra={[{ value: "out_of_service", label: t("ageing.masterStatus.out_of_service") }]} />
      <Field label={t("ageing.hold.note")} hint={t("common.optional")}>
        <TextInput value={note} maxLength={500} onChange={(e) => setNote(e.currentTarget.value)} />
      </Field>
    </FormSheet>
  );
}

// ---------------------------------------------------------------------------
// Trolleys
// ---------------------------------------------------------------------------

export function TrolleysPage() {
  const { t } = useT();
  const access = useMasterAccess();
  const list = useQuery(trpc.ageing.trolleys.list.queryOptions({ includeInactive: true }));
  const [sheet, setSheet] = useState<{ open: boolean; row?: Trolley }>({ open: false });
  const columns: ResponsiveListColumn<Trolley>[] = [
    {
      key: "code",
      header: t("ageing.field.code"),
      cell: (r) => (
        <RowEdit editable={access.draft} label={r.code} mono onEdit={() => setSheet({ open: true, row: r })}>
          {r.code}
        </RowEdit>
      ),
    },
    { key: "cap", header: t("ageing.field.capacityKg"), align: "end", cell: (r) => <span className="font-mono tabular-nums">{r.capacityG ? kgFromG(r.capacityG) : "-"}</span> },
    { key: "use", header: t("ageing.masters.inUse"), hideOnPhone: true, cell: (r) => (r.openBatchNumber ? <span className="font-mono">{r.openBatchNumber}</span> : "-") },
    { key: "status", header: t("ageing.masters.status"), phoneWide: true, cell: (r) => <StatusChip status={r.status} /> },
  ];
  return (
    <Shell
      title={t("ageing.masters.trolleys")}
      subtitle={t("ageing.masters.trolleysHint")}
      add={
        <Can do={["masters.draft", "masters.publish"]}>
          <Button onClick={() => setSheet({ open: true })} aria-haspopup="dialog" data-testid="add-trolley">
            <Plus aria-hidden="true" strokeWidth={2} />
            {t("ageing.action.addTrolley")}
          </Button>
        </Can>
      }
    >
      {list.isError && !list.data ? (
        <MastersLoadError onRetry={() => void list.refetch()} />
      ) : (
        <ResponsiveList rows={list.data?.items ?? []} columns={columns} rowKey={(r) => r.id} loading={list.isLoading} label={t("ageing.masters.trolleys")} empty={<EmptyState title={t("ageing.masters.noTrolleys")} />} />
      )}
      <TrolleySheet open={sheet.open} onOpenChange={(open) => setSheet((s) => ({ ...s, open }))} row={sheet.row} />
    </Shell>
  );
}

function TrolleySheet({ open, onOpenChange, row }: { open: boolean; onOpenChange(o: boolean): void; row?: Trolley }) {
  const { t } = useT();
  const access = useMasterAccess();
  const invalidate = useAgeingInvalidate();
  const [code, setCode] = useState("");
  const [cap, setCap] = useState("");
  const [status, setStatus] = useState<string>("draft");
  const [note, setNote] = useState("");
  const [tried, setTried] = useState(false);
  useEffect(() => {
    if (!open) return;
    setCode(row?.code ?? "");
    setCap(kgToText(row?.capacityG));
    setStatus(row?.status ?? "draft");
    setNote(row?.note ?? "");
    setTried(false);
  }, [open, row?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = useMutation(
    trpc.ageing.trolleys.save.mutationOptions({
      onSuccess: async () => {
        toast.success(t("masters.saved", { name: code.trim() }));
        await invalidate();
        onOpenChange(false);
      },
    }),
  );
  const capG = cap.trim() ? kgFromText(cap) : null;
  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      title={row ? t("ageing.masters.editTrolley", { code: row.code }) : t("ageing.action.addTrolley")}
      description={t("ageing.masters.trolleyCodeHint")}
      busy={save.isPending}
      error={save.error}
      submitLabel={t("ageing.masters.save")}
      testId="trolley-form"
      onSubmit={() => {
        setTried(true);
        if (!code.trim() || (cap.trim() && capG === null)) return;
        save.mutate({ ...(row ? { id: row.id } : {}), code: code.trim(), capacityG: capG, status: status as Status, note: note.trim() || null });
      }}
    >
      <Field label={t("ageing.field.code")} error={tried && !code.trim() ? t("ageing.masters.codeRequired") : undefined}>
        <TextInput value={code} maxLength={16} autoComplete="off" className="font-mono" onChange={(e) => setCode(e.currentTarget.value)} data-testid="master-code" />
      </Field>
      <Field label={t("ageing.field.capacityKg")} error={tried && cap.trim() && capG === null ? t("ageing.masters.numberInvalid") : undefined}>
        <NumberInput value={cap} onValueChange={setCap} suffix={t("units.kg")} data-testid="master-capacity" />
      </Field>
      <StatusField value={status} onChange={setStatus} publish={access.publish} extra={[{ value: "out_of_service", label: t("ageing.masterStatus.out_of_service") }]} />
      <Field label={t("ageing.hold.note")} hint={t("common.optional")}>
        <TextInput value={note} maxLength={500} onChange={(e) => setNote(e.currentTarget.value)} />
      </Field>
    </FormSheet>
  );
}

// ---------------------------------------------------------------------------
// Recipes
// ---------------------------------------------------------------------------

export function RecipesPage() {
  const { t } = useT();
  const access = useMasterAccess();
  const duration = useDuration();
  const invalidate = useAgeingInvalidate();
  const list = useQuery(trpc.ageing.recipes.list.queryOptions({ includeInactive: true }));
  const suggest = useQuery({ ...trpc.ageing.recipes.suggest.queryOptions(), enabled: access.draft });
  const save = useMutation(trpc.ageing.recipes.save.mutationOptions());
  const [sheet, setSheet] = useState<{ open: boolean; row?: Recipe; copy?: boolean }>({ open: false });
  const [seeding, setSeeding] = useState(false);
  const items = list.data?.items ?? [];

  const fillSuggested = async () => {
    setSeeding(true);
    try {
      let made = 0;
      for (const s of suggest.data?.items ?? []) {
        if (items.some((r) => r.alloy === s.alloy && r.temper === s.temper && r.kind === s.kind)) continue;
        await save.mutateAsync({
          alloy: s.alloy,
          temper: s.temper,
          kind: s.kind,
          targetTempX10: s.targetTempX10,
          toleranceX10: s.toleranceX10,
          soakMin: s.soakMin,
          maxSoakMin: s.maxSoakMin,
          hardnessMethod: s.hardnessMethod,
          hardnessMinX10: s.hardnessMinX10,
          hardnessMaxX10: s.hardnessMaxX10,
          sampleCount: s.sampleCount,
          status: "draft",
        });
        made += 1;
      }
      toast.success(made > 0 ? t("masters.seeded", { count: made }) : t("masters.seededNone"));
      await invalidate();
    } catch {
      toast.error(t("ageing.masters.suggestFailed"));
    } finally {
      setSeeding(false);
    }
  };

  const columns: ResponsiveListColumn<Recipe>[] = [
    {
      key: "recipe",
      header: t("ageing.field.recipe"),
      cell: (r) => (
        <RowEdit editable={access.draft} label={`${r.alloy} ${r.temper}`} onEdit={() => setSheet({ open: true, row: r })}>
          {r.alloy} {r.temper}
        </RowEdit>
      ),
    },
    { key: "kind", header: t("ageing.field.kind"), cell: (r) => t(`ageing.recipeKind.${r.kind}`) },
    { key: "temp", header: t("ageing.field.target"), align: "end", cell: (r) => <span className="font-mono tabular-nums whitespace-nowrap">{x10Text(r.targetTempX10)} ± {x10Text(r.toleranceX10)}</span> },
    { key: "soak", header: t("ageing.field.soakMin"), align: "end", hideOnPhone: true, cell: (r) => <span className="font-mono tabular-nums">{duration(r.soakMin)}</span> },
    { key: "hard", header: t("ageing.field.hardnessMin"), align: "end", hideOnPhone: true, cell: (r) => <span className="font-mono tabular-nums whitespace-nowrap">{x10Text(r.hardnessMinX10)} {t(`ageing.method.${r.hardnessMethod}`)}</span> },
    { key: "samples", header: t("ageing.field.samples"), align: "end", hideOnPhone: true, cell: (r) => <span className="font-mono tabular-nums">{r.sampleCount}</span> },
    { key: "status", header: t("ageing.masters.status"), phoneWide: true, cell: (r) => <StatusChip status={r.status} /> },
  ];
  return (
    <Shell
      title={t("ageing.masters.recipes")}
      subtitle={t("ageing.masters.recipesHint")}
      add={
        <Can do={["masters.draft", "masters.publish"]}>
          <Button onClick={() => setSheet({ open: true })} aria-haspopup="dialog" data-testid="add-recipe">
            <Plus aria-hidden="true" strokeWidth={2} />
            {t("ageing.masters.addRecipe")}
          </Button>
        </Can>
      }
    >
      <MasterNote body={t("ageing.masters.oneActive")} />
      {list.isError && !list.data ? (
        <MastersLoadError onRetry={() => void list.refetch()} />
      ) : (
        <ResponsiveList
          rows={items}
          columns={columns}
          rowKey={(r) => r.id}
          loading={list.isLoading}
          label={t("ageing.masters.recipes")}
          empty={
            <EmptyState
              title={t("ageing.masters.noRecipes")}
              action={
                <Can do={["masters.draft", "masters.publish"]}>
                  <Button variant="secondary" loading={seeding} onClick={() => void fillSuggested()} data-testid="fill-suggested">
                    {t("ageing.action.suggest")}
                  </Button>
                </Can>
              }
            />
          }
        />
      )}
      <RecipeSheet open={sheet.open} onOpenChange={(open) => setSheet((s) => ({ ...s, open }))} row={sheet.row} copy={sheet.copy} onCopy={(r) => setSheet({ open: true, row: r, copy: true })} />
    </Shell>
  );
}

function RecipeSheet({ open, onOpenChange, row, copy, onCopy }: { open: boolean; onOpenChange(o: boolean): void; row?: Recipe; copy?: boolean; onCopy(r: Recipe): void }) {
  const { t } = useT();
  const access = useMasterAccess();
  const invalidate = useAgeingInvalidate();
  const [f, setF] = useState({ alloy: "", temper: "", kind: "full", target: "", tol: "10", soak: "", maxSoak: "", method: "webster", hMin: "", hMax: "", samples: "3", status: "draft", note: "" });
  const [tried, setTried] = useState(false);
  const locked = Boolean(row && row.status === "active" && !copy);
  useEffect(() => {
    if (!open) return;
    setF({
      alloy: row?.alloy ?? "",
      temper: row?.temper ?? "",
      kind: row?.kind ?? "full",
      target: row ? String(row.targetTempX10 / 10) : "",
      tol: row ? String(row.toleranceX10 / 10) : "10",
      soak: row ? String(row.soakMin) : "",
      maxSoak: row?.maxSoakMin ? String(row.maxSoakMin) : "",
      method: row?.hardnessMethod ?? "webster",
      hMin: row ? String(row.hardnessMinX10 / 10) : "",
      hMax: row?.hardnessMaxX10 ? String(row.hardnessMaxX10 / 10) : "",
      samples: row ? String(row.sampleCount) : "3",
      status: copy ? "draft" : (row?.status ?? "draft"),
      note: row?.note ?? "",
    });
    setTried(false);
  }, [open, row?.id, copy]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (patch: Partial<typeof f>) => setF((p) => ({ ...p, ...patch }));
  const save = useMutation(
    trpc.ageing.recipes.save.mutationOptions({
      onSuccess: async () => {
        toast.success(t("masters.saved", { name: `${f.alloy} ${f.temper}` }));
        await invalidate();
        onOpenChange(false);
      },
    }),
  );
  const target = x10FromText(f.target);
  const tol = x10FromText(f.tol);
  const soak = wholeFromText(f.soak);
  const maxSoak = f.maxSoak.trim() ? wholeFromText(f.maxSoak) : null;
  const hMin = x10FromText(f.hMin);
  const hMax = f.hMax.trim() ? x10FromText(f.hMax) : null;
  const samples = wholeFromText(f.samples);
  const ok = f.alloy.trim() && f.temper.trim() && target !== null && tol !== null && tol > 0 && soak !== null && soak > 0 && hMin !== null && samples !== null && samples > 0 && (!f.maxSoak.trim() || maxSoak !== null) && (!f.hMax.trim() || hMax !== null);
  const err = (bad: boolean) => (tried && bad ? t("ageing.masters.numberInvalid") : undefined);
  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      title={row && !copy ? t("ageing.masters.editRecipe", { name: `${row.alloy} ${row.temper}` }) : t("ageing.masters.addRecipe")}
      description={locked ? t("ageing.masters.activeLocked") : t("ageing.masters.activeRule")}
      busy={save.isPending}
      error={save.error}
      submitLabel={t("ageing.masters.save")}
      submitDisabled={locked && f.status === "active"}
      testId="recipe-form"
      onSubmit={() => {
        setTried(true);
        if (!ok) return;
        save.mutate({
          ...(row && !copy ? { id: row.id } : {}),
          alloy: f.alloy.trim(),
          temper: f.temper.trim(),
          kind: f.kind as "full" | "top_up",
          targetTempX10: target!,
          toleranceX10: tol!,
          soakMin: soak!,
          maxSoakMin: maxSoak,
          hardnessMethod: f.method as "webster" | "hb",
          hardnessMinX10: hMin!,
          hardnessMaxX10: hMax,
          sampleCount: samples!,
          status: f.status as "draft" | "active" | "archived",
          note: f.note.trim() || null,
        });
      }}
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("ageing.field.alloy")} error={tried && !f.alloy.trim() ? t("ageing.masters.codeRequired") : undefined}>
          <TextInput value={f.alloy} maxLength={16} disabled={locked} onChange={(e) => set({ alloy: e.currentTarget.value })} data-testid="recipe-alloy" />
        </Field>
        <Field label={t("ageing.field.temper")} error={tried && !f.temper.trim() ? t("ageing.masters.codeRequired") : undefined}>
          <TextInput value={f.temper} maxLength={8} disabled={locked} onChange={(e) => set({ temper: e.currentTarget.value })} data-testid="recipe-temper" />
        </Field>
      </div>
      <Field label={t("ageing.field.kind")}>
        <NativeSelect value={f.kind} disabled={locked} onChange={(e) => set({ kind: e.currentTarget.value })} data-testid="recipe-kind">
          <option value="full">{t("ageing.recipeKind.full")}</option>
          <option value="top_up">{t("ageing.recipeKind.top_up")}</option>
        </NativeSelect>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("ageing.field.target")} error={err(target === null)}>
          <NumberInput value={f.target} disabled={locked} onValueChange={(v) => set({ target: v })} suffix="°C" data-testid="recipe-target" />
        </Field>
        <Field label={t("ageing.field.tolerance")} error={err(tol === null || tol <= 0)}>
          <NumberInput value={f.tol} disabled={locked} onValueChange={(v) => set({ tol: v })} suffix="°C" />
        </Field>
        <Field label={t("ageing.field.soakMin")} error={err(soak === null || soak <= 0)}>
          <NumberInput decimal={false} value={f.soak} disabled={locked} onValueChange={(v) => set({ soak: v })} suffix={t("units.min")} data-testid="recipe-soak" />
        </Field>
        <Field label={t("ageing.field.maxSoakMin")} hint={t("common.optional")} error={err(Boolean(f.maxSoak.trim()) && maxSoak === null)}>
          <NumberInput decimal={false} value={f.maxSoak} disabled={locked} onValueChange={(v) => set({ maxSoak: v })} suffix={t("units.min")} />
        </Field>
      </div>
      <Field label={t("ageing.field.method")}>
        <NativeSelect value={f.method} disabled={locked} onChange={(e) => set({ method: e.currentTarget.value })}>
          <option value="webster">{t("ageing.method.webster")}</option>
          <option value="hb">{t("ageing.method.hb")}</option>
        </NativeSelect>
      </Field>
      <div className="grid grid-cols-3 gap-3">
        <Field label={t("ageing.field.hardnessMin")} error={err(hMin === null)}>
          <NumberInput value={f.hMin} disabled={locked} onValueChange={(v) => set({ hMin: v })} data-testid="recipe-hmin" />
        </Field>
        <Field label={t("ageing.field.hardnessMax")} hint={t("common.optional")} error={err(Boolean(f.hMax.trim()) && hMax === null)}>
          <NumberInput value={f.hMax} disabled={locked} onValueChange={(v) => set({ hMax: v })} />
        </Field>
        <Field label={t("ageing.field.samples")} error={err(samples === null || samples < 1)}>
          <NumberInput decimal={false} value={f.samples} disabled={locked} onValueChange={(v) => set({ samples: v })} />
        </Field>
      </div>
      <Field label={t("ageing.masters.status")} hint={access.publish ? t("ageing.masters.activeRule") : t("ageing.masters.draftOnly")}>
        <NativeSelect value={f.status} onChange={(e) => set({ status: e.currentTarget.value })} disabled={!access.publish && f.status === "draft" ? false : !access.publish} data-testid="master-status">
          <option value="draft">{t("ageing.recipeStatus.draft")}</option>
          <option value="active" disabled={!access.publish}>
            {t("ageing.recipeStatus.active")}
          </option>
          <option value="archived" disabled={!access.publish}>
            {t("ageing.recipeStatus.archived")}
          </option>
        </NativeSelect>
      </Field>
      <Field label={t("ageing.hold.note")} hint={t("common.optional")}>
        <TextInput value={f.note} maxLength={500} onChange={(e) => set({ note: e.currentTarget.value })} />
      </Field>
      {locked && row ? (
        <Button variant="secondary" onClick={() => onCopy(row)} data-testid="recipe-copy">
          {t("ageing.masters.copyAsDraft")}
        </Button>
      ) : null}
    </FormSheet>
  );
}

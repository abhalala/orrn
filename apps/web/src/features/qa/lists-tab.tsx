import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Field, NumberInput, TextInput } from "@orrn/ui/components/field";
import { ResponsiveList, type ResponsiveListColumn } from "@orrn/ui/components/responsive-list";
import { SegmentedControl } from "@orrn/ui/components/segmented-control";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Plus, X } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Can } from "@/shared/components/can";
import { INLINE_ERROR_META, showsQueryError } from "@/shared/lib/query-errors";
import { trpc } from "@/shared/utils/trpc";

import { useQaInvalidate, type QaPlanRow, type QaStationRow, type QaSubstituteRow, type QaTemper } from "./hooks";
import { dimensionsFromDrafts, draftsFromPlan, emptyDimension, optional, tenthsFrom, tenthsText, wholeFrom, type DimensionDraft } from "./model";
import { QA_LISTS, QA_STAGE_LIST, type QaList } from "./search";
import { Block, QaFormSheet, QaRefusalNote, QaSelect } from "./ui";

type Editing<T> = T | "new" | null;

const ACTIVE_OPTIONS = (t: ReturnType<typeof useT>["t"]): { value: "on" | "off"; label: string }[] => [
  { value: "on", label: t("qa.stations.reactivate") },
  { value: "off", label: t("qa.stations.retire") },
];

/**
 * Rows 35, 28, 36, 37: the temper master, the quality plan per section, inspection points and the allowed
 * alloy substitutes. Reading is open to the plant; every write needs `qa.masters`.
 */
export function ListsTab({ list, onList }: { list: QaList; onList(list: QaList): void }) {
  const { t } = useT();
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <SegmentedControl
        label={t("qa.tabs.lists")}
        value={list}
        options={QA_LISTS.map((l) => ({ value: l, label: t(`qa.lists.${l}`) }))}
        onChange={onList}
      />
      {list === "tempers" ? <TempersList /> : null}
      {list === "plans" ? <PlansList /> : null}
      {list === "stations" ? <StationsList /> : null}
      {list === "substitutes" ? <SubstitutesList /> : null}
    </div>
  );
}

function LoadFailed({ retry }: { retry(): void }) {
  const { t } = useT();
  return <EmptyState title={t("qa.loadFailed")} action={<Button variant="secondary" onClick={retry}>{t("common.retry")}</Button>} />;
}

// ---------------------------------------------------------------------------
// Tempers (row 35)
// ---------------------------------------------------------------------------

function TempersList() {
  const { t } = useT();
  const q = useQuery({ ...trpc.qa.tempers.list.queryOptions({ includeInactive: true }), meta: INLINE_ERROR_META });
  const [editing, setEditing] = useState<Editing<QaTemper>>(null);

  const columns: ResponsiveListColumn<QaTemper>[] = [
    {
      key: "code",
      header: t("qa.tempers.code"),
      cell: (r) => (
        <span className="flex flex-col gap-0.5">
          <span className="font-mono font-semibold whitespace-nowrap">{r.code}</span>
          {r.alloy ? <span className="text-[14px] text-muted-foreground">{r.alloy}</span> : null}
        </span>
      ),
    },
    { key: "name", header: t("qa.tempers.name"), hideOnPhone: true, cell: (r) => r.name ?? "-" },
    {
      key: "limits",
      header: t("qa.plans.limits"),
      phoneWide: true,
      cell: (r) => {
        const parts = [
          r.hardnessMinX10 !== null ? `${tenthsText(r.hardnessMinX10)} ${t(`qa.tempers.methods.${r.hardnessMethod}`)}` : null,
          r.tensileMinMpa !== null ? `${r.tensileMinMpa} MPa` : null,
          r.yieldMinMpa !== null ? `${r.yieldMinMpa} MPa` : null,
          r.elongationMinX10 !== null ? `${tenthsText(r.elongationMinX10)} %` : null,
        ].filter((p): p is string => p !== null);
        return <span className="font-mono text-[14px] tabular-nums">{parts.length ? parts.join(" / ") : "-"}</span>;
      },
    },
    {
      key: "recipes",
      header: t("qa.tempers.recipes"),
      cell: (r) => (r.recipes.length ? r.recipes.map((x) => `${x.alloy} ${x.temper}`).join(", ") : <span className="text-muted-foreground">{t("qa.tempers.noRecipe")}</span>),
    },
    {
      key: "act",
      header: t("qa.tempers.edit"),
      headerHidden: true,
      cell: (r) => (
        <span className="flex items-center gap-2">
          {r.active ? null : <span className="text-[14px] text-muted-foreground">{t("qa.stations.reactivate")}</span>}
          <Can do="qa.masters">
            <Button variant="secondary" onClick={() => setEditing(r)} data-testid={`qa-temper-edit-${r.code}`}>
              {t("qa.tempers.edit")}
            </Button>
          </Can>
        </span>
      ),
    },
  ];

  return (
    <Block
      id="qa-list-tempers"
      title={t("qa.lists.tempers")}
      actions={
        <Can do="qa.masters">
          <Button onClick={() => setEditing("new")} aria-haspopup="dialog" data-testid="qa-add-temper">
            {t("qa.tempers.add")}
          </Button>
        </Can>
      }
    >
      {showsQueryError(q) ? (
        <LoadFailed retry={() => void q.refetch()} />
      ) : (
        <div data-testid="qa-list-tempers">
          <ResponsiveList rows={q.data?.items ?? []} columns={columns} rowKey={(r) => r.id} loading={q.isLoading} label={t("qa.lists.tempers")} empty={<EmptyState title={t("qa.tempers.empty")} />} />
        </div>
      )}
      <TemperSheet editing={editing} onClose={() => setEditing(null)} />
    </Block>
  );
}

type TemperDraft = { code: string; alloy: string; name: string; method: "webster" | "hb"; hardness: string; tensile: string; yield: string; elongation: string; active: boolean };
const emptyTemper = (): TemperDraft => ({ code: "", alloy: "", name: "", method: "webster", hardness: "", tensile: "", yield: "", elongation: "", active: true });

function TemperSheet({ editing, onClose }: { editing: Editing<QaTemper>; onClose(): void }) {
  const { t } = useT();
  const invalidate = useQaInvalidate();
  const [d, setD] = useState<TemperDraft>(emptyTemper);
  const [tried, setTried] = useState(false);
  const row = editing === "new" ? null : editing;
  const open = editing !== null;
  useEffect(() => {
    if (editing === null) return;
    setTried(false);
    setD(
      editing === "new"
        ? emptyTemper()
        : {
            code: editing.code,
            alloy: editing.alloy,
            name: editing.name ?? "",
            method: editing.hardnessMethod,
            hardness: tenthsText(editing.hardnessMinX10),
            tensile: editing.tensileMinMpa === null ? "" : String(editing.tensileMinMpa),
            yield: editing.yieldMinMpa === null ? "" : String(editing.yieldMinMpa),
            elongation: tenthsText(editing.elongationMinX10),
            active: editing.active,
          },
    );
  }, [editing]);
  const save = useMutation(
    trpc.qa.tempers.save.mutationOptions({
      onSuccess: async () => {
        toast.success(t("qa.saved"));
        await invalidate();
        onClose();
      },
    }),
  );
  const set = <K extends keyof TemperDraft>(key: K, v: TemperDraft[K]) => setD((s) => ({ ...s, [key]: v }));
  const hardness = optional(d.hardness, tenthsFrom);
  const tensile = optional(d.tensile, wholeFrom);
  const yieldMin = optional(d.yield, wholeFrom);
  const elongation = optional(d.elongation, tenthsFrom);
  const bad = t("qa.sheet.dims.bad");
  return (
    <QaFormSheet
      open={open}
      onOpenChange={(o) => (o ? undefined : onClose())}
      title={row ? t("qa.tempers.editTitle", { code: row.code }) : t("qa.tempers.add")}
      busy={save.isPending}
      error={save.error}
      submitLabel={row ? t("qa.tempers.edit") : t("qa.tempers.add")}
      testId="qa-temper-form"
      onSubmit={() => {
        setTried(true);
        if (!d.code.trim() || hardness.bad || tensile.bad || yieldMin.bad || elongation.bad) return;
        save.mutate({
          ...(row ? { id: row.id } : {}),
          code: d.code.trim(),
          alloy: d.alloy.trim(),
          name: d.name.trim() || null,
          hardnessMethod: d.method,
          hardnessMinX10: hardness.value,
          tensileMinMpa: tensile.value,
          yieldMinMpa: yieldMin.value,
          elongationMinX10: elongation.value,
          active: d.active,
        });
      }}
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("qa.tempers.code")} error={tried && !d.code.trim() ? t("qa.required") : undefined}>
          <TextInput value={d.code} maxLength={8} autoComplete="off" className="font-mono" onChange={(e) => set("code", e.currentTarget.value)} data-testid="qa-temper-code" />
        </Field>
        <Field label={t("qa.tempers.alloy")} hint={t("qa.tempers.alloyHint")}>
          <TextInput value={d.alloy} maxLength={16} autoComplete="off" className="font-mono" onChange={(e) => set("alloy", e.currentTarget.value)} data-testid="qa-temper-alloy" />
        </Field>
      </div>
      <Field label={t("qa.tempers.name")}>
        <TextInput value={d.name} maxLength={60} onChange={(e) => set("name", e.currentTarget.value)} />
      </Field>
      <Field label={t("qa.tempers.method")}>
        <QaSelect value={d.method} onChange={(e) => set("method", e.currentTarget.value === "hb" ? "hb" : "webster")}>
          <option value="webster">{t("qa.tempers.methods.webster")}</option>
          <option value="hb">{t("qa.tempers.methods.hb")}</option>
        </QaSelect>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("qa.tempers.hardnessMin")} hint={t("common.optional")} error={tried && hardness.bad ? bad : undefined}>
          <NumberInput value={d.hardness} onValueChange={(v) => set("hardness", v)} data-testid="qa-temper-hardness" />
        </Field>
        <Field label={t("qa.tempers.tensileMin")} hint={t("common.optional")} error={tried && tensile.bad ? bad : undefined}>
          <NumberInput decimal={false} value={d.tensile} onValueChange={(v) => set("tensile", v)} data-testid="qa-temper-tensile" />
        </Field>
        <Field label={t("qa.tempers.yieldMin")} hint={t("common.optional")} error={tried && yieldMin.bad ? bad : undefined}>
          <NumberInput decimal={false} value={d.yield} onValueChange={(v) => set("yield", v)} data-testid="qa-temper-yield" />
        </Field>
        <Field label={t("qa.tempers.elongationMin")} hint={t("common.optional")} error={tried && elongation.bad ? bad : undefined}>
          <NumberInput value={d.elongation} onValueChange={(v) => set("elongation", v)} data-testid="qa-temper-elongation" />
        </Field>
      </div>
      {row ? (
        <SegmentedControl value={d.active ? "on" : "off"} options={ACTIVE_OPTIONS(t)} onChange={(v) => set("active", v === "on")} />
      ) : null}
    </QaFormSheet>
  );
}

// ---------------------------------------------------------------------------
// Plans (row 28)
// ---------------------------------------------------------------------------

function PlansList() {
  const { t } = useT();
  const q = useQuery({ ...trpc.qa.plans.list.queryOptions({ limit: 500 }), meta: INLINE_ERROR_META });
  const [editing, setEditing] = useState<Editing<QaPlanRow>>(null);

  const columns: ResponsiveListColumn<QaPlanRow>[] = [
    { key: "section", header: t("qa.plans.section"), cell: (r) => <span className="font-mono font-semibold whitespace-nowrap">{r.sectionCode}</span> },
    { key: "copy", header: t("qa.plans.copy"), cell: (r) => r.copyCode ?? t("qa.plans.allCopies") },
    { key: "temper", header: t("qa.plans.temper"), cell: (r) => r.temperCode ?? "-" },
    {
      key: "every",
      header: t("qa.plans.limits"),
      phoneWide: true,
      cell: (r) => {
        const parts = [r.everyBundles !== null ? `${r.everyBundles} ${t("qa.plans.everyBundles")}` : null, r.everyMinutes !== null ? `${r.everyMinutes} ${t("qa.plans.everyMinutes")}` : null].filter((p): p is string => p !== null);
        return <span className="text-[14px]">{parts.length ? parts.join(", ") : "-"}</span>;
      },
    },
    { key: "dims", header: t("qa.plans.dimensions"), align: "end", hideOnPhone: true, cell: (r) => <span className="font-mono tabular-nums">{r.dimensions.length}</span> },
    {
      key: "act",
      header: t("qa.plans.edit"),
      headerHidden: true,
      cell: (r) => (
        <Can do="qa.masters">
          <Button variant="secondary" onClick={() => setEditing(r)} data-testid={`qa-plan-edit-${r.sectionCode}`}>
            {t("qa.plans.edit")}
          </Button>
        </Can>
      ),
    },
  ];

  return (
    <Block
      id="qa-list-plans"
      title={t("qa.lists.plans")}
      actions={
        <Can do="qa.masters">
          <Button onClick={() => setEditing("new")} aria-haspopup="dialog" data-testid="qa-add-plan">
            {t("qa.plans.add")}
          </Button>
        </Can>
      }
    >
      {showsQueryError(q) ? (
        <LoadFailed retry={() => void q.refetch()} />
      ) : (
        <div data-testid="qa-list-plans">
          <ResponsiveList rows={q.data?.items ?? []} columns={columns} rowKey={(r) => r.id} loading={q.isLoading} label={t("qa.lists.plans")} empty={<EmptyState title={t("qa.plans.empty")} />} />
        </div>
      )}
      <PlanSheet editing={editing} onClose={() => setEditing(null)} />
    </Block>
  );
}

type PlanDraft = {
  billetMin: string;
  billetMax: string;
  exitMin: string;
  exitMax: string;
  ramMin: string;
  ramMax: string;
  ageingTemp: string;
  ageingSoak: string;
  everyBundles: string;
  everyMinutes: string;
  temperId: string;
  dims: DimensionDraft[];
};
const emptyPlan = (): PlanDraft => ({ billetMin: "", billetMax: "", exitMin: "", exitMax: "", ramMin: "", ramMax: "", ageingTemp: "", ageingSoak: "", everyBundles: "", everyMinutes: "", temperId: "", dims: [] });

function PlanSheet({ editing, onClose }: { editing: Editing<QaPlanRow>; onClose(): void }) {
  const { t } = useT();
  const invalidate = useQaInvalidate();
  const [d, setD] = useState<PlanDraft>(emptyPlan);
  const [search, setSearch] = useState("");
  const [dieId, setDieId] = useState("");
  const [tried, setTried] = useState(false);
  const row = editing === "new" ? null : editing;
  const open = editing !== null;
  const tempers = useQuery({ ...trpc.qa.tempers.list.queryOptions({ includeInactive: false }), meta: INLINE_ERROR_META, enabled: open });
  const term = search.trim();
  const found = useQuery({
    ...trpc.die.list.queryOptions({ search: term, sort: "code", limit: 20 }),
    meta: INLINE_ERROR_META,
    enabled: open && !row && term.length > 0,
  });
  const matches = found.data?.items ?? [];
  const exact = matches.filter((m) => m.sectionCode.toLowerCase() === term.toLowerCase());
  const chosen = matches.find((m) => m.id === dieId) ?? (exact.length === 1 ? exact[0] : matches.length === 1 ? matches[0] : undefined);
  useEffect(() => {
    if (editing === null) return;
    setTried(false);
    setSearch("");
    setDieId("");
    setD(
      editing === "new"
        ? emptyPlan()
        : {
            billetMin: tenthsText(editing.billetTempMinX10),
            billetMax: tenthsText(editing.billetTempMaxX10),
            exitMin: tenthsText(editing.exitTempMinX10),
            exitMax: tenthsText(editing.exitTempMaxX10),
            ramMin: tenthsText(editing.ramSpeedMinX10),
            ramMax: tenthsText(editing.ramSpeedMaxX10),
            ageingTemp: tenthsText(editing.ageingTempX10),
            ageingSoak: editing.ageingSoakMin === null ? "" : String(editing.ageingSoakMin),
            everyBundles: editing.everyBundles === null ? "" : String(editing.everyBundles),
            everyMinutes: editing.everyMinutes === null ? "" : String(editing.everyMinutes),
            temperId: editing.temperId ?? "",
            dims: draftsFromPlan(editing.dimensions),
          },
    );
  }, [editing]);
  const save = useMutation(
    trpc.qa.plans.save.mutationOptions({
      onSuccess: async () => {
        toast.success(t("qa.saved"));
        await invalidate();
        onClose();
      },
    }),
  );
  const set = <K extends keyof PlanDraft>(key: K, v: PlanDraft[K]) => setD((s) => ({ ...s, [key]: v }));
  const billetMin = optional(d.billetMin, tenthsFrom);
  const billetMax = optional(d.billetMax, tenthsFrom);
  const exitMin = optional(d.exitMin, tenthsFrom);
  const exitMax = optional(d.exitMax, tenthsFrom);
  const ramMin = optional(d.ramMin, tenthsFrom);
  const ramMax = optional(d.ramMax, tenthsFrom);
  const ageingTemp = optional(d.ageingTemp, tenthsFrom);
  const ageingSoak = optional(d.ageingSoak, wholeFrom);
  const everyBundles = optional(d.everyBundles, wholeFrom);
  const everyMinutes = optional(d.everyMinutes, wholeFrom);
  const dims = dimensionsFromDrafts(d.dims, false);
  const targetDieId = row ? row.dieId : (chosen?.id ?? "");
  const bad = t("qa.sheet.dims.bad");
  const numbersBad = [billetMin, billetMax, exitMin, exitMax, ramMin, ramMax, ageingTemp, ageingSoak, everyBundles, everyMinutes].some((x) => x.bad);
  const noSection = !row && !chosen;
  const pair = (label: string, lo: string, hi: string, kLo: keyof PlanDraft, kHi: keyof PlanDraft, rLo: { bad: boolean }, rHi: { bad: boolean }, id: string) => (
    <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
      <legend className="mb-2 text-[15px] font-semibold">{label}</legend>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("qa.plans.min")} error={tried && rLo.bad ? bad : undefined}>
          <NumberInput value={lo} onValueChange={(v) => set(kLo, v as never)} data-testid={`qa-plan-${id}-min`} />
        </Field>
        <Field label={t("qa.plans.max")} error={tried && rHi.bad ? bad : undefined}>
          <NumberInput value={hi} onValueChange={(v) => set(kHi, v as never)} data-testid={`qa-plan-${id}-max`} />
        </Field>
      </div>
    </fieldset>
  );
  return (
    <QaFormSheet
      open={open}
      onOpenChange={(o) => (o ? undefined : onClose())}
      title={row ? t("qa.plans.editTitle", { section: row.sectionCode }) : t("qa.plans.add")}
      busy={save.isPending}
      error={save.error}
      submitLabel={row ? t("qa.plans.edit") : t("qa.plans.add")}
      testId="qa-plan-form"
      onSubmit={() => {
        setTried(true);
        if (noSection || numbersBad || dims === null) return;
        save.mutate({
          dieId: targetDieId,
          dieInstanceId: row ? row.dieInstanceId : null,
          temperId: d.temperId || null,
          billetTempMinX10: billetMin.value,
          billetTempMaxX10: billetMax.value,
          exitTempMinX10: exitMin.value,
          exitTempMaxX10: exitMax.value,
          ramSpeedMinX10: ramMin.value,
          ramSpeedMaxX10: ramMax.value,
          ageingTempX10: ageingTemp.value,
          ageingSoakMin: ageingSoak.value,
          everyBundles: everyBundles.value,
          everyMinutes: everyMinutes.value,
          dimensions: dims.map((x) => ({ name: x.name, nominalUm: x.nominalUm, minusUm: x.minusUm, plusUm: x.plusUm })),
          note: row?.note ?? null,
        });
      }}
    >
      {row ? null : (
        <>
          <Field
            label={t("qa.plans.section")}
            hint={t("qa.plans.sectionHint")}
            error={tried && noSection ? t("qa.plans.sectionNotFound") : term && found.isSuccess && matches.length === 0 ? t("qa.plans.sectionNotFound") : undefined}
          >
            <TextInput value={search} maxLength={40} autoComplete="off" className="font-mono" onChange={(e) => setSearch(e.currentTarget.value)} data-testid="qa-plan-section" />
          </Field>
          {matches.length > 1 ? (
            <Field label={t("qa.plans.section")}>
              <QaSelect value={chosen?.id ?? ""} onChange={(e) => setDieId(e.currentTarget.value)} data-testid="qa-plan-section-pick">
                {/* Review N2: no exact match yet shows a blank pick, never the first die as if chosen. */}
                {chosen ? null : <option value="">{t("qa.plans.sectionPick")}</option>}
                {matches.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.series} {m.sectionCode}
                  </option>
                ))}
              </QaSelect>
            </Field>
          ) : null}
        </>
      )}
      <Field label={t("qa.plans.temper")} hint={t("common.optional")}>
        <QaSelect value={d.temperId} onChange={(e) => set("temperId", e.currentTarget.value)} data-testid="qa-plan-temper">
          <option value="">{t("qa.sheet.none")}</option>
          {(tempers.data?.items ?? []).map((tp) => (
            <option key={tp.id} value={tp.id}>
              {tp.alloy ? `${tp.alloy} ${tp.code}` : tp.code}
            </option>
          ))}
        </QaSelect>
      </Field>
      {pair(t("qa.plans.billetTemp"), d.billetMin, d.billetMax, "billetMin", "billetMax", billetMin, billetMax, "billet")}
      {pair(t("qa.plans.exitTemp"), d.exitMin, d.exitMax, "exitMin", "exitMax", exitMin, exitMax, "exit")}
      {pair(t("qa.plans.ramSpeed"), d.ramMin, d.ramMax, "ramMin", "ramMax", ramMin, ramMax, "ram")}
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("qa.plans.ageingTemp")} hint={t("common.optional")} error={tried && ageingTemp.bad ? bad : undefined}>
          <NumberInput value={d.ageingTemp} onValueChange={(v) => set("ageingTemp", v)} data-testid="qa-plan-ageing-temp" />
        </Field>
        <Field label={t("qa.plans.ageingSoak")} hint={t("common.optional")} error={tried && ageingSoak.bad ? bad : undefined}>
          <NumberInput decimal={false} value={d.ageingSoak} onValueChange={(v) => set("ageingSoak", v)} data-testid="qa-plan-ageing-soak" />
        </Field>
        <Field label={t("qa.plans.everyBundles")} hint={t("common.optional")} error={tried && everyBundles.bad ? bad : undefined}>
          <NumberInput decimal={false} value={d.everyBundles} onValueChange={(v) => set("everyBundles", v)} data-testid="qa-plan-every-bundles" />
        </Field>
        <Field label={t("qa.plans.everyMinutes")} hint={t("common.optional")} error={tried && everyMinutes.bad ? bad : undefined}>
          <NumberInput decimal={false} value={d.everyMinutes} onValueChange={(v) => set("everyMinutes", v)} data-testid="qa-plan-every-minutes" />
        </Field>
      </div>
      <PlanDimensions rows={d.dims} onChange={(rows) => set("dims", rows)} bad={tried && dims === null} />
    </QaFormSheet>
  );
}

function PlanDimensions({ rows, onChange, bad }: { rows: DimensionDraft[]; onChange(rows: DimensionDraft[]): void; bad: boolean }) {
  const { t } = useT();
  const set = (i: number, key: keyof DimensionDraft, v: string) => onChange(rows.map((r, j) => (j === i ? { ...r, [key]: v } : r)));
  return (
    <fieldset className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0" data-testid="qa-plan-dims">
      <legend className="mb-2 text-[15px] font-semibold">{t("qa.plans.dimensions")}</legend>
      {rows.map((r, i) => (
        <div key={i} className="grid grid-cols-3 gap-2 rounded-card border border-border p-3 sm:grid-cols-[1.4fr_repeat(3,1fr)_auto]" data-dim-row={i}>
          <Field label={t("qa.sheet.dims.name")} className="col-span-3 sm:col-span-1">
            <TextInput value={r.name} maxLength={40} onChange={(e) => set(i, "name", e.currentTarget.value)} />
          </Field>
          <Field label={t("qa.sheet.dims.nominal")}>
            <NumberInput value={r.nominal} onValueChange={(v) => set(i, "nominal", v)} />
          </Field>
          <Field label={t("qa.sheet.dims.minus")}>
            <NumberInput value={r.minus} onValueChange={(v) => set(i, "minus", v)} />
          </Field>
          <Field label={t("qa.sheet.dims.plus")}>
            <NumberInput value={r.plus} onValueChange={(v) => set(i, "plus", v)} />
          </Field>
          <div className="flex items-end">
            <Button variant="ghost" aria-label={t("qa.sheet.dims.remove")} onClick={() => onChange(rows.filter((_, j) => j !== i))}>
              <X aria-hidden="true" />
            </Button>
          </div>
        </div>
      ))}
      {bad ? (
        <p role="alert" className="m-0 text-[14px] font-medium text-tone-red-ink">
          {t("qa.sheet.dims.bad")}
        </p>
      ) : null}
      <div>
        <Button variant="secondary" onClick={() => onChange([...rows, emptyDimension()])} disabled={rows.length >= 20}>
          <Plus aria-hidden="true" />
          {t("qa.sheet.dims.add")}
        </Button>
      </div>
    </fieldset>
  );
}

// ---------------------------------------------------------------------------
// Inspection points (row 36)
// ---------------------------------------------------------------------------

function StationsList() {
  const { t } = useT();
  const q = useQuery({ ...trpc.qa.stations.list.queryOptions({ includeInactive: true }), meta: INLINE_ERROR_META });
  const [editing, setEditing] = useState<Editing<QaStationRow>>(null);

  const columns: ResponsiveListColumn<QaStationRow>[] = [
    { key: "code", header: t("qa.stations.code"), cell: (r) => <span className="font-mono font-semibold whitespace-nowrap">{r.code}</span> },
    { key: "name", header: t("qa.stations.name"), phoneWide: true, cell: (r) => <span className="break-words">{r.name}</span> },
    { key: "stage", header: t("qa.stations.stage"), cell: (r) => t(`qa.stage.${r.stage}`) },
    {
      key: "act",
      header: t("qa.stations.edit"),
      headerHidden: true,
      cell: (r) => (
        <span className="flex items-center gap-2">
          {r.active ? null : <span className="text-[14px] text-muted-foreground">{t("qa.stations.reactivate")}</span>}
          <Can do="qa.masters">
            <Button variant="secondary" onClick={() => setEditing(r)} data-testid={`qa-station-edit-${r.code}`}>
              {t("qa.stations.edit")}
            </Button>
          </Can>
        </span>
      ),
    },
  ];

  return (
    <Block
      id="qa-list-stations"
      title={t("qa.lists.stations")}
      actions={
        <Can do="qa.masters">
          <Button onClick={() => setEditing("new")} aria-haspopup="dialog" data-testid="qa-add-station">
            {t("qa.stations.add")}
          </Button>
        </Can>
      }
    >
      {showsQueryError(q) ? (
        <LoadFailed retry={() => void q.refetch()} />
      ) : (
        <div data-testid="qa-list-stations">
          <ResponsiveList rows={q.data?.items ?? []} columns={columns} rowKey={(r) => r.id} loading={q.isLoading} label={t("qa.lists.stations")} empty={<EmptyState title={t("qa.stations.empty")} />} />
        </div>
      )}
      <StationSheet editing={editing} onClose={() => setEditing(null)} />
    </Block>
  );
}

function StationSheet({ editing, onClose }: { editing: Editing<QaStationRow>; onClose(): void }) {
  const { t } = useT();
  const invalidate = useQaInvalidate();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [stage, setStage] = useState<(typeof QA_STAGE_LIST)[number]>("press");
  const [active, setActive] = useState(true);
  const [tried, setTried] = useState(false);
  const row = editing === "new" ? null : editing;
  useEffect(() => {
    if (editing === null) return;
    setTried(false);
    setCode(editing === "new" ? "" : editing.code);
    setName(editing === "new" ? "" : editing.name);
    setStage(editing === "new" ? "press" : (QA_STAGE_LIST.find((s) => s === editing.stage) ?? "press"));
    setActive(editing === "new" ? true : editing.active);
  }, [editing]);
  const save = useMutation(
    trpc.qa.stations.save.mutationOptions({
      onSuccess: async () => {
        toast.success(t("qa.saved"));
        await invalidate();
        onClose();
      },
    }),
  );
  return (
    <QaFormSheet
      open={editing !== null}
      onOpenChange={(o) => (o ? undefined : onClose())}
      title={row ? t("qa.stations.editTitle", { code: row.code }) : t("qa.stations.add")}
      busy={save.isPending}
      error={save.error}
      submitLabel={row ? t("qa.stations.edit") : t("qa.stations.add")}
      testId="qa-station-form"
      onSubmit={() => {
        setTried(true);
        if (!code.trim() || !name.trim()) return;
        save.mutate({ ...(row ? { id: row.id } : {}), code: code.trim(), name: name.trim(), stage, active });
      }}
    >
      <Field label={t("qa.stations.code")} error={tried && !code.trim() ? t("qa.required") : undefined}>
        <TextInput value={code} maxLength={16} autoComplete="off" className="font-mono" onChange={(e) => setCode(e.currentTarget.value)} data-testid="qa-station-code" />
      </Field>
      <Field label={t("qa.stations.name")} error={tried && !name.trim() ? t("qa.required") : undefined}>
        <TextInput value={name} maxLength={60} onChange={(e) => setName(e.currentTarget.value)} data-testid="qa-station-name" />
      </Field>
      <Field label={t("qa.stations.stage")}>
        <QaSelect value={stage} onChange={(e) => setStage(QA_STAGE_LIST.find((s) => s === e.currentTarget.value) ?? "press")} data-testid="qa-station-stage">
          {QA_STAGE_LIST.map((s) => (
            <option key={s} value={s}>
              {t(`qa.stage.${s}`)}
            </option>
          ))}
        </QaSelect>
      </Field>
      {row ? <SegmentedControl value={active ? "on" : "off"} options={ACTIVE_OPTIONS(t)} onChange={(v) => setActive(v === "on")} /> : null}
    </QaFormSheet>
  );
}

// ---------------------------------------------------------------------------
// Alloy substitutes (row 37)
// ---------------------------------------------------------------------------

function SubstitutesList() {
  const { t } = useT();
  const invalidate = useQaInvalidate();
  const q = useQuery({ ...trpc.qa.substitutes.list.queryOptions(), meta: INLINE_ERROR_META });
  const [adding, setAdding] = useState(false);
  const [removeError, setRemoveError] = useState<unknown>(null);
  const remove = useMutation(
    trpc.qa.substitutes.remove.mutationOptions({
      onSuccess: async () => {
        setRemoveError(null);
        toast.success(t("qa.substitutes.removed"));
        await invalidate();
      },
      onError: (e) => setRemoveError(e),
    }),
  );

  const columns: ResponsiveListColumn<QaSubstituteRow>[] = [
    { key: "alloy", header: t("qa.substitutes.alloy"), cell: (r) => <span className="font-mono font-semibold whitespace-nowrap">{r.alloy}</span> },
    { key: "substitute", header: t("qa.substitutes.substitute"), cell: (r) => <span className="font-mono whitespace-nowrap">{r.substitute}</span> },
    { key: "party", header: t("qa.substitutes.customer"), phoneWide: true, cell: (r) => r.customerName ?? t("qa.substitutes.everyParty") },
    { key: "note", header: t("qa.substitutes.note"), hideOnPhone: true, cell: (r) => <span className="break-words">{r.note ?? "-"}</span> },
    {
      key: "act",
      header: t("qa.substitutes.remove"),
      headerHidden: true,
      cell: (r) => (
        <Can do="qa.masters">
          <Button variant="secondary" disabled={remove.isPending} onClick={() => remove.mutate({ id: r.id })} data-testid={`qa-substitute-remove-${r.alloy}-${r.substitute}`}>
            {t("qa.substitutes.remove")}
          </Button>
        </Can>
      ),
    },
  ];

  return (
    <Block
      id="qa-list-substitutes"
      title={t("qa.lists.substitutes")}
      actions={
        <Can do="qa.masters">
          <Button onClick={() => setAdding(true)} aria-haspopup="dialog" data-testid="qa-add-substitute">
            {t("qa.substitutes.add")}
          </Button>
        </Can>
      }
    >
      {showsQueryError(q) ? (
        <LoadFailed retry={() => void q.refetch()} />
      ) : (
        <div data-testid="qa-list-substitutes">
          <ResponsiveList rows={q.data?.items ?? []} columns={columns} rowKey={(r) => r.id} loading={q.isLoading} label={t("qa.lists.substitutes")} empty={<EmptyState title={t("qa.substitutes.empty")} />} />
        </div>
      )}
      {removeError ? <QaRefusalNote error={removeError} /> : null}
      <SubstituteSheet open={adding} onClose={() => setAdding(false)} />
    </Block>
  );
}

function SubstituteSheet({ open, onClose }: { open: boolean; onClose(): void }) {
  const { t } = useT();
  const invalidate = useQaInvalidate();
  const [alloy, setAlloy] = useState("");
  const [substitute, setSubstitute] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [note, setNote] = useState("");
  const [tried, setTried] = useState(false);
  const customers = useQuery({ ...trpc.customer.list.queryOptions({ limit: 100, offset: 0 }), meta: INLINE_ERROR_META, enabled: open });
  useEffect(() => {
    if (!open) return;
    setAlloy("");
    setSubstitute("");
    setCustomerId("");
    setNote("");
    setTried(false);
  }, [open]);
  const save = useMutation(
    trpc.qa.substitutes.save.mutationOptions({
      onSuccess: async () => {
        toast.success(t("qa.saved"));
        await invalidate();
        onClose();
      },
    }),
  );
  return (
    <QaFormSheet
      open={open}
      onOpenChange={(o) => (o ? undefined : onClose())}
      title={t("qa.substitutes.add")}
      busy={save.isPending}
      error={save.error}
      submitLabel={t("qa.substitutes.add")}
      testId="qa-substitute-form"
      onSubmit={() => {
        setTried(true);
        if (!alloy.trim() || !substitute.trim()) return;
        save.mutate({ alloy: alloy.trim().toUpperCase(), substitute: substitute.trim().toUpperCase(), customerId: customerId || null, note: note.trim() || null });
      }}
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("qa.substitutes.alloy")} error={tried && !alloy.trim() ? t("qa.required") : undefined}>
          <TextInput value={alloy} maxLength={16} autoComplete="off" className="font-mono uppercase" onChange={(e) => setAlloy(e.currentTarget.value)} data-testid="qa-substitute-alloy" />
        </Field>
        <Field label={t("qa.substitutes.substitute")} error={tried && !substitute.trim() ? t("qa.required") : undefined}>
          <TextInput value={substitute} maxLength={16} autoComplete="off" className="font-mono uppercase" onChange={(e) => setSubstitute(e.currentTarget.value)} data-testid="qa-substitute-substitute" />
        </Field>
      </div>
      <Field label={t("qa.substitutes.customer")} hint={t("common.optional")}>
        <QaSelect value={customerId} onChange={(e) => setCustomerId(e.currentTarget.value)} data-testid="qa-substitute-party">
          <option value="">{t("qa.substitutes.everyParty")}</option>
          {(customers.data?.items ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </QaSelect>
      </Field>
      <Field label={t("qa.substitutes.note")}>
        <TextInput value={note} maxLength={200} onChange={(e) => setNote(e.currentTarget.value)} data-testid="qa-substitute-note" />
      </Field>
    </QaFormSheet>
  );
}

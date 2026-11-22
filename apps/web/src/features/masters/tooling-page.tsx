import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Field, NumberInput } from "@orrn/ui/components/field";
import { NativeSelect } from "@orrn/ui/components/native-select";
import { PageHeader } from "@orrn/ui/components/page-header";
import { ResponsiveList, type ResponsiveListColumn } from "@orrn/ui/components/responsive-list";
import { SegmentedControl } from "@orrn/ui/components/segmented-control";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Can } from "@/shared/components/can";
import { useFmt } from "@/shared/lib/fmt";
import { kgGrouped1, massUnit } from "@/shared/lib/fmt-text";
import { trpc } from "@/shared/utils/trpc";

import { minStockFromText, TOOLING_TYPES, toolingStatusTone, type ToolingStatus, type ToolingType } from "./adm-model";
import { ToolingSheet } from "./adm-tooling-sheet";
import { AdmFormError, useAdmError } from "./adm-ui";
import { useAdmAccess, useAdmInvalidate, type MakerCostRow, type ToolingRow } from "./adm-use";
import { MasterNote, MasterSection, MastersLoadError, RowEdit } from "./masters-ui";

type Filter = "live" | "retired" | "all";

/**
 * Tooling (route /masters/tooling): bolsters, backers, die rings, containers and liners, one row per
 * piece. Shows which types are below their minimum, lets the die room set those minimums, and (for
 * people who see money) what each die maker's copies cost per kg pushed.
 */
export function ToolingPage() {
  const { t } = useT();
  const access = useAdmAccess();
  const list = useQuery(trpc.toolRoom.tooling.list.queryOptions({ includeRetired: true }));
  const shortfalls = useQuery(trpc.toolRoom.shortfalls.queryOptions());
  const [filter, setFilter] = useState<Filter>("live");
  const [type, setType] = useState<"all" | ToolingType>("all");
  const [sheet, setSheet] = useState<{ open: boolean; row?: ToolingRow }>({ open: false });

  const rows = list.data ?? [];
  const shown = rows
    .filter((r) => (filter === "all" ? true : filter === "retired" ? r.status === "retired" : r.status !== "retired"))
    .filter((r) => type === "all" || r.type === type);

  const columns: ResponsiveListColumn<ToolingRow>[] = [
    {
      key: "code",
      header: t("adm.masters.tooling.columns.code"),
      cell: (r) => (
        <RowEdit editable={access.canTooling || access.canInspect} label={r.code} mono onEdit={() => setSheet({ open: true, row: r })}>
          {r.code}
        </RowEdit>
      ),
    },
    { key: "type", header: t("adm.masters.tooling.columns.type"), cell: (r) => t(`adm.tooling.${r.type as ToolingType}`) },
    { key: "size", header: t("adm.masters.tooling.columns.size"), cell: (r) => (r.size ? <span className="break-words">{r.size}</span> : <span className="text-muted-foreground">-</span>) },
    { key: "location", header: t("adm.masters.tooling.columns.location"), hideOnPhone: true, cell: (r) => (r.location ? <span className="break-words">{r.location}</span> : <span className="text-muted-foreground">-</span>) },
    { key: "maker", header: t("adm.masters.tooling.columns.maker"), hideOnPhone: true, cell: (r) => (r.makerName ? <span className="break-words">{r.makerName}</span> : <span className="text-muted-foreground">-</span>) },
    {
      key: "status",
      header: t("adm.masters.tooling.columns.status"),
      phoneWide: true,
      cell: (r) => {
        const tone = toolingStatusTone(r.status as ToolingStatus);
        const word = t(`adm.toolingStatus.${r.status as ToolingStatus}`);
        return tone ? <Chip tone={tone}>{word}</Chip> : <span className="text-[14px] text-muted-foreground">{word}</span>;
      },
    },
  ];

  return (
    <>
      <PageHeader
        back={{ to: "/masters", label: t("masters.backToMasters") }}
        title={t("adm.masters.tooling.title")}
        subtitle={t("adm.masters.tooling.subtitle")}
        actions={
          <Can do={["die.card", "masters.publish"]}>
            <Button onClick={() => setSheet({ open: true })} aria-haspopup="dialog">
              <Plus aria-hidden="true" strokeWidth={2} />
              {t("adm.masters.tooling.add")}
            </Button>
          </Can>
        }
      />
      {(shortfalls.data ?? []).length > 0 ? (
        <MasterNote
          tone="attention"
          body={t("adm.masters.tooling.shortfall", {
            list: (shortfalls.data ?? []).map((s) => t("adm.masters.tooling.shortfallItem", { type: t(`adm.tooling.${s.type as ToolingType}`), held: s.held, min: s.min })).join(", "),
          })}
        />
      ) : null}
      {list.isError && !list.data ? (
        <MastersLoadError onRetry={() => void list.refetch()} />
      ) : (
        <div className="flex min-w-0 flex-col gap-4">
          {rows.length > 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <SegmentedControl<Filter>
                label={t("masters.show")}
                value={filter}
                onChange={setFilter}
                options={[
                  { value: "live", label: t("masters.showInUse") },
                  { value: "retired", label: t("masters.showRetired") },
                  { value: "all", label: t("masters.showAll") },
                ]}
              />
              <NativeSelect density="compact" aria-label={t("adm.masters.tooling.typeFilter")} value={type} onChange={(e) => setType(e.currentTarget.value as typeof type)} className="sm:max-w-[220px]">
                <option value="all">{t("adm.masters.tooling.allTypes")}</option>
                {TOOLING_TYPES.map((k) => (
                  <option key={k} value={k}>
                    {t(`adm.tooling.${k}`)}
                  </option>
                ))}
              </NativeSelect>
            </div>
          ) : null}
          <ResponsiveList
            rows={shown}
            columns={columns}
            rowKey={(r) => r.id}
            loading={list.isLoading}
            label={t("adm.masters.tooling.title")}
            empty={<EmptyState title={rows.length > 0 ? t("adm.masters.tooling.noneShown") : t("adm.masters.tooling.empty")} body={rows.length === 0 ? t("adm.masters.tooling.emptyBody") : undefined} />}
          />
        </div>
      )}
      {access.canTooling ? <MinStockSection /> : null}
      {access.canCost ? <MakerCostSection /> : null}
      <ToolingSheet open={sheet.open} onOpenChange={(o) => setSheet((s) => ({ ...s, open: o }))} row={sheet.row} />
    </>
  );
}

/** The fewest pieces of each type the plant wants; below it, Today and this page say so. */
function MinStockSection() {
  const { t } = useT();
  const message = useAdmError();
  const invalidate = useAdmInvalidate();
  const query = useQuery(trpc.toolRoom.minStock.get.queryOptions());
  const set = useMutation(trpc.toolRoom.minStock.set.mutationOptions());
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [bad, setBad] = useState(false);

  useEffect(() => {
    if (!query.data) return;
    setTexts(Object.fromEntries(TOOLING_TYPES.map((k) => [k, query.data.min[k] ? String(query.data.min[k]) : ""])));
    setBad(false);
  }, [query.data]);

  const save = async () => {
    if (set.isPending) return;
    const min = minStockFromText(texts);
    if (!min) return setBad(true);
    setBad(false);
    try {
      await set.mutateAsync({ min });
      toast.success(t("adm.masters.tooling.minSaved"));
      await invalidate.tooling();
    } catch (e) {
      toast.error(message(e));
    }
  };

  return (
    <MasterSection id="tooling-min" title={t("adm.masters.tooling.minTitle")} hint={t("adm.masters.tooling.minHint")}>
      <div className="grid grid-cols-1 gap-4 rounded-card border border-border bg-card p-4 sm:grid-cols-2 lg:grid-cols-3">
        {TOOLING_TYPES.map((k) => (
          <Field key={k} label={t(`adm.tooling.${k}`)} hint={t("adm.masters.tooling.held", { count: query.data?.held[k] ?? 0 })}>
            <NumberInput value={texts[k] ?? ""} decimal={false} onValueChange={(v) => setTexts((x) => ({ ...x, [k]: v }))} />
          </Field>
        ))}
        {bad ? <p role="alert" className="m-0 text-[14px] text-tone-red-ink sm:col-span-2 lg:col-span-3">{t("adm.masters.tooling.minInvalid")}</p> : null}
        <AdmFormError error={set.error} />
        <div className="sm:col-span-2 lg:col-span-3">
          <Button onClick={() => void save()} loading={set.isPending}>
            {t("adm.masters.tooling.minSave")}
          </Button>
        </div>
      </div>
    </MasterSection>
  );
}

/** What each die maker's copies cost per kg pushed (money: shown only to those who may see it). */
function MakerCostSection() {
  const { t } = useT();
  const fmt = useFmt();
  const query = useQuery(trpc.toolRoom.cost.byMaker.queryOptions());
  if (query.isError || (query.data ?? []).length === 0) return null;
  const columns: ResponsiveListColumn<MakerCostRow>[] = [
    { key: "maker", header: t("adm.masters.tooling.cost.maker"), cell: (r) => <span className="font-semibold break-words">{r.makerName ?? t("adm.masters.tooling.cost.noMaker")}</span> },
    { key: "copies", header: t("adm.masters.tooling.cost.copies"), align: "end", cell: (r) => <span className="font-mono tabular-nums">{r.copies}</span> },
    { key: "made", header: t("adm.masters.tooling.cost.made", { massUnit: massUnit(fmt) }), align: "end", cell: (r) => <span className="font-mono tabular-nums">{kgGrouped1(fmt, r.producedG)}</span> },
    {
      key: "perKg",
      header: t("adm.masters.tooling.cost.perKg", { massUnit: massUnit(fmt) }),
      align: "end",
      cell: (r) => {
        // The unit layer's rate field: paise per kg shown in the plant's mass unit (as the die room's table).
        return r.costPerKgPaise != null ? <span className="font-mono tabular-nums">{fmt.q("order.rate", r.costPerKgPaise)}</span> : <span className="text-muted-foreground">-</span>;
      },
    },
  ];
  return (
    <MasterSection id="tooling-cost" title={t("adm.masters.tooling.cost.title")} hint={t("adm.masters.tooling.cost.hint")}>
      <ResponsiveList rows={query.data ?? []} columns={columns} rowKey={(r) => r.makerId ?? "none"} loading={query.isLoading} label={t("adm.masters.tooling.cost.title")} empty={null} />
    </MasterSection>
  );
}

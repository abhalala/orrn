import { useT } from "@orrn/i18n";
import { Button, IconButton } from "@orrn/ui/components/button";
import { Field, TextInput } from "@orrn/ui/components/field";
import { NativeSelect } from "@orrn/ui/components/native-select";
import { X } from "lucide-react";
import { useState } from "react";
import {
  canonicalUnit,
  INGEST_TARGETS,
  TARGETS,
  unitsFor,
  type DateFormat,
  type IngestTarget,
  type Recipe,
  type RecipeField,
  type UnitKind,
} from "@orrn/ingest";

import { TARGET_KEY, useIngestActions, type CandidateDetail } from "../lib";
import { Panel, translateKey } from "./shared";

export type MappingRow = {
  id: number;
  field: string;
  column: number | null;
  unit: string | null;
  dateFormat: DateFormat;
};

const NUMERIC = new Set(["length", "mass", "linear_mass", "price_per_mass", "count", "dimension"]);

export function addMapping(rows: readonly MappingRow[], target: IngestTarget): MappingRow[] {
  const used = new Set(rows.map((row) => row.field));
  const definition = TARGETS[target].fields.find((field) => !used.has(field.name)) ?? TARGETS[target].fields[0];
  if (!definition) return [...rows];
  return [
    ...rows,
    {
      id: Math.max(0, ...rows.map((row) => row.id)) + 1,
      field: definition.name,
      column: null,
      unit: NUMERIC.has(definition.kind) ? canonicalUnit(definition.kind as UnitKind) : null,
      dateFormat: "dmy",
    },
  ];
}

export function updateMapping(rows: readonly MappingRow[], id: number, patch: Partial<Omit<MappingRow, "id">>): MappingRow[] {
  return rows.map((row) => (row.id === id ? { ...row, ...patch } : row));
}

export function buildRecipe(candidate: CandidateDetail, target: IngestTarget, rows: readonly MappingRow[]): Recipe {
  const previous = candidate.recipe as Recipe | null;
  const fields: RecipeField[] = rows.flatMap((row) => {
    if (row.column === null) return [];
    const definition = TARGETS[target].fields.find((field) => field.name === row.field);
    if (!definition) return [];
    const old = previous?.fields.find((field) => field.field === row.field);
    let steps = old?.steps ?? [{ op: "trim" } as RecipeField["steps"][number]];
    if (NUMERIC.has(definition.kind)) {
      const kind = definition.kind as UnitKind;
      const unit = row.unit ?? canonicalUnit(kind);
      steps = [...steps.filter((step) => step.op !== "number"), { op: "number", kind, unit }];
    }
    if (definition.kind === "date") {
      steps = [...steps.filter((step) => step.op !== "date"), { op: "date", format: row.dateFormat }];
    }
    if (definition.resolver && !steps.some((step) => step.op === "lookup")) {
      steps = [...steps, { op: "lookup", resolver: definition.resolver }];
    }
    return [{
      field: row.field,
      source: { kind: "columns", cols: [{ col: row.column, header: candidate.block.headers[row.column] ?? "" }] },
      steps,
    }];
  });
  return {
    schemaVersion: 1,
    target,
    headerRow: candidate.block.headerRow,
    headerRows: candidate.block.headerRows,
    match: { headerKey: candidate.block.headerKey, headers: candidate.block.headers },
    fields,
    filters: previous?.filters ?? [],
    keys: previous?.keys ?? TARGETS[target].keys,
    onExisting: previous?.onExisting ?? "ask",
    unclear: previous?.unclear ?? [],
  };
}

function initialRows(candidate: CandidateDetail, target: IngestTarget): MappingRow[] {
  const recipe = candidate.recipe as Recipe | null;
  if (recipe && recipe.target === target) {
    return recipe.fields.flatMap((field, index) => {
      const source = field.source.kind === "columns" ? field.source.cols[0] : null;
      const definition = TARGETS[target].fields.find((item) => item.name === field.field);
      return [{
        id: index + 1,
        field: field.field,
        column: source?.col ?? null,
        unit: field.steps.find((step) => step.op === "number")?.unit ?? null,
        dateFormat: field.steps.find((step) => step.op === "date")?.format ?? "dmy",
      }];
    });
  }
  return TARGETS[target].fields.filter((field) => field.required).map((field, index) => ({
    id: index + 1,
    field: field.name,
    column: null,
    unit: NUMERIC.has(field.kind) ? canonicalUnit(field.kind as UnitKind) : null,
    dateFormat: "dmy",
  }));
}

export function MappingEditor({ candidate, onSaved }: { candidate: CandidateDetail; onSaved?: () => void }) {
  const { t } = useT();
  const actions = useIngestActions();
  const [target, setTarget] = useState<IngestTarget>(candidate.target ?? "customers");
  const [rows, setRows] = useState<MappingRow[]>(() => initialRows(candidate, candidate.target ?? "customers"));
  const [name, setName] = useState(candidate.holeName ?? candidate.sheetName ?? candidate.fileName);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  const changeTarget = (next: IngestTarget) => {
    setTarget(next);
    setRows(initialRows(candidate, next));
  };
  const save = async () => {
    if (!name.trim()) {
      setFailed(true);
      return;
    }
    setPending(true);
    setFailed(false);
    try {
      await actions.saveShape(candidate.id, buildRecipe(candidate, target, rows), name.trim(), candidate.serverSeq);
      onSaved?.();
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  };

  return (
    <Panel title={t("ingest.shape.manual")}>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label={t("ingest.shape.saveAs")} required>
          <TextInput autoFocus value={name} onChange={(event) => setName(event.currentTarget.value)} />
        </Field>
        <Field label={t("ingest.shape.field")}>
          <NativeSelect value={target} onChange={(event) => changeTarget(event.currentTarget.value as IngestTarget)} aria-label={t("ingest.shape.field")}>
            {INGEST_TARGETS.map((item) => <option key={item} value={item}>{translateKey(t, TARGET_KEY(item))}</option>)}
          </NativeSelect>
        </Field>
      </div>
      <div className="flex flex-col gap-4">
        {rows.map((row) => {
          const definition = TARGETS[target].fields.find((field) => field.name === row.field);
          const numeric = definition && NUMERIC.has(definition.kind);
          return (
            <fieldset key={row.id} className="m-0 grid min-w-0 gap-3 rounded-card border border-border p-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
              <legend className="sr-only">{t("ingest.shape.field")} {row.id}</legend>
              <Field label={t("ingest.shape.field")}>
                <NativeSelect
                  value={row.field}
                  aria-label={`${t("ingest.shape.field")} ${row.id}`}
                  onChange={(event) => {
                    const next = TARGETS[target].fields.find((field) => field.name === event.currentTarget.value);
                    setRows(updateMapping(rows, row.id, {
                      field: event.currentTarget.value,
                      unit: next && NUMERIC.has(next.kind) ? canonicalUnit(next.kind as UnitKind) : null,
                    }));
                  }}
                >
                  {TARGETS[target].fields.map((field) => <option key={field.name} value={field.name}>{field.name}</option>)}
                </NativeSelect>
              </Field>
              <Field label={t("ingest.shape.column")}>
                <NativeSelect
                  value={row.column ?? ""}
                  aria-label={`${t("ingest.shape.column")} ${row.id}`}
                  onChange={(event) => setRows(updateMapping(rows, row.id, { column: event.currentTarget.value === "" ? null : Number(event.currentTarget.value) }))}
                >
                  <option value="">{t("ingest.shape.notUsed")}</option>
                  {candidate.block.headers.map((header, index) => <option key={`${index}:${header}`} value={index}>{header}</option>)}
                </NativeSelect>
              </Field>
              {numeric ? (
                <Field label={t("ingest.shape.unit")}>
                  <NativeSelect
                    value={row.unit ?? ""}
                    aria-label={`${t("ingest.shape.unit")} ${row.id}`}
                    onChange={(event) => setRows(updateMapping(rows, row.id, { unit: event.currentTarget.value }))}
                  >
                    {unitsFor(definition.kind as UnitKind).map((unit) => <option key={unit} value={unit}>{unit}</option>)}
                  </NativeSelect>
                </Field>
              ) : definition?.kind === "date" ? (
                <Field label={t("ingest.q.date_format_ambiguous", { sample: "" })}>
                  <NativeSelect
                    value={row.dateFormat}
                    aria-label={`${t("ingest.q.date_format_ambiguous", { sample: "" })} ${row.id}`}
                    onChange={(event) => setRows(updateMapping(rows, row.id, { dateFormat: event.currentTarget.value as DateFormat }))}
                  >
                    <option value="dmy">dd/mm/yyyy</option>
                    <option value="mdy">mm/dd/yyyy</option>
                    <option value="ymd">yyyy/mm/dd</option>
                  </NativeSelect>
                </Field>
              ) : <span aria-hidden="true" className="hidden md:block" />}
              <IconButton
                label={`${t("common.remove")}: ${row.field}`}
                icon={<X aria-hidden="true" />}
                onClick={() => setRows(rows.filter((item) => item.id !== row.id))}
              />
            </fieldset>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => setRows(addMapping(rows, target))}>{t("common.add")}</Button>
        <Button loading={pending} onClick={() => void save()}>{t("common.save")}</Button>
      </div>
      {failed ? <p role="alert" className="m-0 text-[14px] text-destructive">{t("ingest.read.failed")}</p> : null}
    </Panel>
  );
}

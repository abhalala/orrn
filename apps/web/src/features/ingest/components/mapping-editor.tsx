import { useT } from "@orrn/i18n";
import { Button, IconButton } from "@orrn/ui/components/button";
import { Field, TextInput } from "@orrn/ui/components/field";
import { NativeSelect } from "@orrn/ui/components/native-select";
import { X } from "lucide-react";
import { useMemo, useState } from "react";
import { INGEST_TARGETS, type DateFormat, type IngestTarget, type Recipe } from "@orrn/ingest";

import {
  addMapping,
  buildRecipe,
  changeColumn,
  changeField,
  checkRecipe,
  initialMappings,
  mappingProblems,
  targetFields,
  TARGET_KEY,
  updateMapping,
  useIngestActions,
  type CandidateDetail,
  type MappingRow,
} from "../lib";
import { ActionError, Panel, translateKey } from "./shared";

export type { MappingRow };

/** The mapping logic lives in `lib/recipe-builder`; these are kept so the screen's own tests keep their names. */
export { addMapping, updateMapping };

const blockOf = (candidate: CandidateDetail) => ({
  headers: candidate.block.headers,
  headerKey: candidate.block.headerKey,
  headerRow: candidate.block.headerRow,
  headerRows: candidate.block.headerRows,
});

export function MappingEditor({ candidate, onSaved }: { candidate: CandidateDetail; onSaved?: () => void }) {
  const { t } = useT();
  const actions = useIngestActions();
  const block = blockOf(candidate);
  const previous = candidate.recipe as Recipe | null;
  const [target, setTarget] = useState<IngestTarget>(candidate.target ?? "customers");
  const [rows, setRows] = useState<MappingRow[]>(() => initialMappings(block, candidate.target ?? "customers", previous));
  const [name, setName] = useState(candidate.holeName ?? candidate.sheetName ?? candidate.fileName);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState<unknown>(null);
  const [checked, setChecked] = useState(false);
  const fields = useMemo(() => targetFields(target), [target]);
  const problems = mappingProblems(target, rows);
  const fieldWords = (names: readonly string[]) =>
    names.map((n) => translateKey(t, fields.find((f) => f.name === n)?.labelKey ?? n)).join(", ");

  const changeTarget = (next: IngestTarget) => {
    setTarget(next);
    setRows(initialMappings(block, next, previous));
    setChecked(false);
  };
  const save = async () => {
    setChecked(true);
    if (!name.trim() || problems.missingRequired.length > 0 || problems.duplicateFields.length > 0) return;
    const recipe = buildRecipe(block, target, rows, previous);
    if (checkRecipe(recipe, block).length > 0) return;
    setPending(true);
    setFailed(null);
    try {
      await actions.saveShape(candidate.id, recipe, name.trim(), candidate.serverSeq);
      onSaved?.();
    } catch (error) {
      setFailed(error);
    } finally {
      setPending(false);
    }
  };

  return (
    <Panel title={t("ingest.shape.manual")}>
      <div className="grid gap-3 md:grid-cols-2">
        <Field
          label={t("ingest.shape.saveAs")}
          required
          error={checked && !name.trim() ? t("ingest.shape.nameRequired") : undefined}
        >
          <TextInput autoFocus value={name} onChange={(event) => setName(event.currentTarget.value)} />
        </Field>
        <Field label={t("ingest.shape.target")}>
          <NativeSelect value={target} onChange={(event) => changeTarget(event.currentTarget.value as IngestTarget)} aria-label={t("ingest.shape.target")}>
            {INGEST_TARGETS.map((item) => <option key={item} value={item}>{translateKey(t, TARGET_KEY(item))}</option>)}
          </NativeSelect>
        </Field>
      </div>
      <div className="flex flex-col gap-4">
        {rows.map((row) => {
          const meta = fields.find((f) => f.name === row.field);
          const fieldLabel = translateKey(t, meta?.labelKey ?? row.field);
          return (
            <fieldset key={row.id} className="m-0 grid min-w-0 gap-3 rounded-card border border-border p-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
              <legend className="sr-only">{fieldLabel}</legend>
              <Field label={t("ingest.shape.field")}>
                <NativeSelect
                  value={row.field}
                  aria-label={`${t("ingest.shape.field")} ${row.id}`}
                  onChange={(event) => setRows(changeField(rows, row.id, event.currentTarget.value, target, block))}
                >
                  {fields.map((field) => <option key={field.name} value={field.name}>{translateKey(t, field.labelKey)}</option>)}
                </NativeSelect>
              </Field>
              <Field label={t("ingest.shape.column")}>
                <NativeSelect
                  value={row.column ?? ""}
                  aria-label={`${t("ingest.shape.column")} ${row.id}`}
                  onChange={(event) =>
                    setRows(changeColumn(rows, row.id, event.currentTarget.value === "" ? null : Number(event.currentTarget.value), target, block))
                  }
                >
                  <option value="">{t("ingest.shape.notUsed")}</option>
                  {candidate.block.headers.map((header, index) => <option key={`${index}:${header}`} value={index}>{header}</option>)}
                </NativeSelect>
              </Field>
              {meta?.unitKind ? (
                <Field label={t("ingest.shape.unit")}>
                  <NativeSelect
                    value={row.unit ?? ""}
                    aria-label={`${t("ingest.shape.unit")} ${row.id}`}
                    onChange={(event) => setRows(updateMapping(rows, row.id, { unit: event.currentTarget.value === "" ? null : event.currentTarget.value }))}
                  >
                    <option value="">{t("ingest.shape.unitAsk")}</option>
                    {meta.units.map((unit) => <option key={unit} value={unit}>{unit}</option>)}
                  </NativeSelect>
                </Field>
              ) : meta?.isDate ? (
                <Field label={t("ingest.shape.dateOrder")}>
                  <NativeSelect
                    value={row.dateFormat}
                    aria-label={`${t("ingest.shape.dateOrder")} ${row.id}`}
                    onChange={(event) => setRows(updateMapping(rows, row.id, { dateFormat: event.currentTarget.value as DateFormat }))}
                  >
                    <option value="dmy">dd/mm/yyyy</option>
                    <option value="mdy">mm/dd/yyyy</option>
                    <option value="ymd">yyyy/mm/dd</option>
                  </NativeSelect>
                </Field>
              ) : <span aria-hidden="true" className="hidden md:block" />}
              <IconButton
                label={`${t("common.remove")}: ${fieldLabel}`}
                icon={<X aria-hidden="true" />}
                onClick={() => setRows(rows.filter((item) => item.id !== row.id))}
              />
            </fieldset>
          );
        })}
      </div>
      {checked && problems.missingRequired.length > 0 ? (
        <p role="alert" className="m-0 text-[14px] text-destructive">{t("ingest.shape.missingRequired", { fields: fieldWords(problems.missingRequired) })}</p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => setRows(addMapping(rows, target))}>{t("common.add")}</Button>
        <Button loading={pending} onClick={() => void save()}>{t("common.save")}</Button>
      </div>
      <ActionError error={failed} />
    </Panel>
  );
}

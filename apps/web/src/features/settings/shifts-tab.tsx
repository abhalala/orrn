import { SUGGESTED_SHIFTS, type Shift } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@orrn/ui/components/card";
import { Chip } from "@orrn/ui/components/chip";
import { Field, TextInput } from "@orrn/ui/components/field";
import { FormActions } from "@orrn/ui/components/form-actions";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Can } from "@/shared/components/can";
import { errorCode } from "@/features/admin/error-code";
import { trpc } from "@/shared/utils/trpc";

import {
  draftFromShifts,
  MAX_SHIFTS,
  minuteToTime,
  newShiftDraft,
  shiftDraftErrors,
  shiftsDirty,
  shiftsPayload,
  type ShiftDraft,
} from "./model";
import { Note, TabState, usePlantSettings, type PlantSettings } from "./ui";

/**
 * Shifts (FP-PF-05): one to four named shifts that cover the 24 hours. Shift 1 starts the
 * production day. Everyone sees them; owners and admins (`settings.update`) edit. The server is the
 * judge: a refused save shows the server's own words (a gap, an overlap, a shift a press run cites).
 */
export function ShiftsTab() {
  const settings = usePlantSettings();
  return (
    <TabState query={settings}>{settings.data ? <ShiftsPanel settings={settings.data} /> : null}</TabState>
  );
}

function ShiftsPanel({ settings }: { settings: PlantSettings }) {
  const { t } = useT();
  const first = [...settings.shifts].sort((a, b) => a.seq - b.seq)[0];
  const signature = JSON.stringify(settings.shifts);
  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="settings-shifts">
      <p className="m-0 text-[15px] leading-6 text-muted-foreground">
        {first
          ? t("settings.shifts.startsDay", { name: first.name, time: minuteToTime(first.startMin) })
          : t("settings.shifts.intro")}
      </p>
      <Can do="settings.update" fallback={<ShiftsReadOnly shifts={settings.shifts} nowName={settings.productionDay.shift?.name ?? null} />}>
        {/* Keyed by the saved list, so a save (or another admin's) resets the form to what is stored. */}
        <ShiftsForm key={signature} saved={settings.shifts} />
      </Can>
    </div>
  );
}

function ShiftsReadOnly({ shifts, nowName }: { shifts: readonly Shift[]; nowName: string | null }) {
  const { t } = useT();
  const sorted = [...shifts].sort((a, b) => a.seq - b.seq);
  return (
    <>
      {sorted.length === 0 ? <Note>{t("plantSettings.shifts.none")}</Note> : null}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {sorted.map((s) => (
          <Card key={s.id} data-testid="shift-card">
            <CardHeader>
              <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                <CardTitle className="break-words">{s.name}</CardTitle>
                {nowName === s.name ? <Chip tone="green">{t("settings.shifts.nowIn", { name: s.name })}</Chip> : null}
              </div>
              <CardDescription>{t("settings.shifts.position", { seq: s.seq })}</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="m-0 font-mono text-[20px] font-semibold tabular-nums">
                {minuteToTime(s.startMin)}-{minuteToTime(s.endMin)}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
      <Note testId="shifts-read-only">{t("settings.shifts.readOnly")}</Note>
      <Note>{t("settings.shifts.applies")}</Note>
    </>
  );
}

function ShiftsForm({ saved }: { saved: readonly Shift[] }) {
  const { t } = useT();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<ShiftDraft[]>(() => draftFromShifts(saved));
  const [refused, setRefused] = useState<string | null>(null);

  const save = useMutation(
    trpc.company.updateSettings.mutationOptions({
      onSuccess: () => {
        setRefused(null);
        toast.success(t("settings.shifts.saved"));
        void queryClient.invalidateQueries({ queryKey: trpc.company.getSettings.queryKey() });
        void queryClient.invalidateQueries({ queryKey: trpc.dashboard.today.queryKey() });
        void queryClient.invalidateQueries({ queryKey: trpc.auth.me.queryKey() });
      },
      onError: (error) => {
        // BAD_REQUEST carries the rule that was broken, in the server's words.
        setRefused(errorCode(error) === "BAD_REQUEST" ? error.message : t("settings.shifts.saveFailed"));
      },
    }),
  );

  const dirty = shiftsDirty(draft, saved);
  const errors = shiftDraftErrors(draft);
  const edit = (key: string, patch: Partial<ShiftDraft>) => {
    setRefused(null);
    setDraft((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  };

  return (
    <form
      noValidate
      className="flex min-w-0 flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!dirty || save.isPending) return;
        setRefused(null);
        save.mutate({ shifts: shiftsPayload(draft) });
      }}
    >
      {draft.length === 0 ? (
        <div className="flex min-w-0 flex-col items-start gap-3 rounded-card border border-border bg-card p-5">
          <p className="m-0 text-[15px] leading-6">{t("plantSettings.shifts.none")}</p>
          <Button
            type="button"
            variant="secondary"
            onClick={() =>
              setDraft(SUGGESTED_SHIFTS.map((s) => newShiftDraft({ name: s.name, start: minuteToTime(s.startMin), end: minuteToTime(s.endMin) })))
            }
          >
            {t("plantSettings.shifts.suggest")}
          </Button>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {draft.map((row, i) => (
          <Card key={row.key} data-testid="shift-row">
            <CardHeader>
              <div className="flex min-w-0 items-center justify-between gap-2">
                <CardTitle>{t("settings.shifts.position", { seq: i + 1 })}</CardTitle>
                {draft.length > 1 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={t("settings.shifts.remove", { name: row.name.trim() || String(i + 1) })}
                    onClick={() => {
                      setRefused(null);
                      setDraft((rows) => rows.filter((r) => r.key !== row.key));
                    }}
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                ) : null}
              </div>
            </CardHeader>
            <CardContent>
              <Field label={t("plantSettings.shifts.name")}>
                <TextInput
                  value={row.name}
                  maxLength={40}
                  autoComplete="off"
                  data-testid={`shift-name-${i}`}
                  onChange={(e) => edit(row.key, { name: e.currentTarget.value })}
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label={t("plantSettings.shifts.start")}>
                  <TextInput
                    type="time"
                    value={row.start}
                    data-testid={`shift-start-${i}`}
                    onChange={(e) => edit(row.key, { start: e.currentTarget.value })}
                  />
                </Field>
                <Field label={t("plantSettings.shifts.end")}>
                  <TextInput
                    type="time"
                    value={row.end}
                    data-testid={`shift-end-${i}`}
                    onChange={(e) => edit(row.key, { end: e.currentTarget.value })}
                  />
                </Field>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {draft.length > 0 && draft.length < MAX_SHIFTS ? (
        <div>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setRefused(null);
              setDraft((rows) => [...rows, newShiftDraft({ start: "00:00", end: "00:00" })]);
            }}
          >
            <Plus aria-hidden="true" />
            {t("plantSettings.shifts.add")}
          </Button>
        </div>
      ) : null}

      {refused ? (
        <div role="alert" data-testid="shifts-refused" className="flex flex-col gap-1 rounded-card border border-border bg-surface-sunken p-4">
          <p className="m-0 text-[13px] font-semibold text-muted-foreground">{t("settings.shifts.notSaved")}</p>
          <p className="m-0 text-[15px] leading-6 break-words">{refused}</p>
        </div>
      ) : dirty && errors.length > 0 ? (
        <p className="m-0 text-[15px] leading-6" role="status" data-testid="shifts-hint">
          {t(`plantSettings.shifts.errors.${errors[0]!}`)}
        </p>
      ) : draft.length > 0 ? (
        <Note role="status">{t("settings.shifts.covered")}</Note>
      ) : null}
      <Note>{t("settings.shifts.applies")}</Note>

      <FormActions sticky={false}>
        {dirty ? (
          <Button type="button" variant="ghost" onClick={() => { setDraft(draftFromShifts(saved)); setRefused(null); }}>
            {t("settings.shifts.undo")}
          </Button>
        ) : null}
        <Button type="submit" disabled={!dirty || draft.length === 0} loading={save.isPending} data-testid="shifts-save">
          {t("settings.shifts.save")}
        </Button>
      </FormActions>
    </form>
  );
}

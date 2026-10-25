import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@orrn/ui/components/card";
import { Field, TextInput, useFieldControl } from "@orrn/ui/components/field";
import { FormActions } from "@orrn/ui/components/form-actions";
import { NativeSelect, type NativeSelectProps } from "@orrn/ui/components/native-select";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { castPeriodText } from "@/features/foundry/model";
import { Can } from "@/shared/components/can";
import { trpc } from "@/shared/utils/trpc";

import { castBookMonths, castBookStart } from "./model";
import { Note, type PlantSettings } from "./ui";

/** A select tied to its surrounding `Field` (label, hint), like `TextInput`. */
function FieldSelect(props: NativeSelectProps) {
  const a11y = useFieldControl({ id: props.id, "aria-describedby": props["aria-describedby"], "aria-invalid": props["aria-invalid"] });
  return <NativeSelect {...props} {...a11y} />;
}

/** The cast code of the month's first cast: the month letter (A for January) and the number. Kept here so the lazy settings chunk does not import the domain's serial module (route budget). */
const castCode = (period: string, start: number) => `${"ABCDEFGHIJKL"[Number(period.slice(5, 7)) - 1] ?? ""}${start}`;

/** "Mar 2027" for a `YYYY-MM` period. */
const monthText = (period: string) => castPeriodText(Number(period.slice(0, 4)), Number(period.slice(5, 7)));

/**
 * Settings → Standards, cast numbers (FP-FD-02): where the plant's paper cast book continues. The first
 * cast of the chosen month takes the number written here and the numbers count on from it; every other
 * month starts at 1. Managers and admins (`masters.publish`) set it, before that month's first cast (the
 * server refuses a month that has one). Audited by the server.
 */
export function CastBookCard({ settings }: { settings: PlantSettings }) {
  const { t } = useT();
  const queryClient = useQueryClient();
  const saved = settings.castSeriesStart;
  const months = castBookMonths(settings.productionDay.day, saved?.period);
  const [month, setMonth] = useState(saved?.period ?? months[0] ?? "");
  const [start, setStart] = useState(saved ? String(saved.start) : "");
  const number = castBookStart(start);
  const done = (key: "settings.castBook.saved" | "settings.castBook.cleared") => () => {
    toast.success(t(key));
    void queryClient.invalidateQueries({ queryKey: trpc.company.getSettings.queryKey() });
    void queryClient.invalidateQueries({ queryKey: trpc.audit.list.queryKey() });
  };
  const failed = () => toast.error(t("settings.castBook.saveFailed"));
  const save = useMutation(trpc.foundry.casts.setSeriesStart.mutationOptions({ onSuccess: done("settings.castBook.saved"), onError: failed }));
  const clear = useMutation(
    trpc.foundry.casts.setSeriesStart.mutationOptions({
      onSuccess: () => {
        setStart("");
        done("settings.castBook.cleared")();
      },
      onError: failed,
    }),
  );
  const dirty = number !== null && month !== "" && (saved?.period !== month || saved?.start !== number);
  return (
    <Card data-testid="settings-cast-book">
      <CardHeader>
        <CardTitle>{t("settings.castBook.title")}</CardTitle>
        <CardDescription>{t("settings.castBook.intro")}</CardDescription>
      </CardHeader>
      <CardContent className="flex min-w-0 flex-col gap-3">
        <p className="m-0 text-[14px] text-muted-foreground" data-testid="cast-book-current">
          {saved
            ? t("settings.castBook.current", { month: monthText(saved.period), number: castCode(saved.period, saved.start) })
            : t("settings.castBook.none")}
        </p>
        <Can do="masters.publish" fallback={<Note testId="cast-book-read-only">{t("settings.castBook.readOnly")}</Note>}>
          <form
            noValidate
            className="flex min-w-0 flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (dirty && number !== null && !save.isPending) save.mutate({ start: { period: month, start: number } });
            }}
          >
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <Field label={t("settings.castBook.month")}>
                <FieldSelect value={month} onChange={(e) => setMonth(e.currentTarget.value)} data-testid="cast-book-month">
                  {months.map((m) => (
                    <option key={m} value={m}>
                      {monthText(m)}
                    </option>
                  ))}
                </FieldSelect>
              </Field>
              <Field
                label={t("settings.castBook.start")}
                hint={t("settings.castBook.startHint")}
                error={start.trim() !== "" && number === null ? t("settings.castBook.invalid") : undefined}
              >
                <TextInput value={start} inputMode="numeric" maxLength={5} autoComplete="off" className="font-mono" data-testid="cast-book-start" onChange={(e) => setStart(e.currentTarget.value)} />
              </Field>
            </div>
            <FormActions sticky={false}>
              <Button type="submit" disabled={!dirty} loading={save.isPending} data-testid="cast-book-save">
                {t("settings.castBook.save")}
              </Button>
              {saved ? (
                <Button type="button" variant="secondary" loading={clear.isPending} onClick={() => clear.mutate({ start: null })} data-testid="cast-book-clear">
                  {t("settings.castBook.clear")}
                </Button>
              ) : null}
            </FormActions>
          </form>
        </Can>
      </CardContent>
    </Card>
  );
}

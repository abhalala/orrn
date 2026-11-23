import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Field, NumberInput } from "@orrn/ui/components/field";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Note, SwitchRow } from "@/features/settings/ui";
import { Can } from "@/shared/components/can";
import { useFmt } from "@/shared/lib/fmt";
import { dayText } from "@/shared/lib/fmt-text";
import { INLINE_ERROR_META, showsQueryError } from "@/shared/lib/query-errors";
import { trpc } from "@/shared/utils/trpc";

import { useQaInvalidate } from "./hooks";
import { optional, wholeFrom } from "./model";
import { Block, QaRefusalNote } from "./ui";

/**
 * Quality switches (rows 24, 22, 39), held by `qa.masters`: pack waits for the first piece (default off),
 * melt waits for incoming inspection (on for new plants, off for plants that had lots before), and the
 * in-process check every N bundles or N minutes (blank is off). Turning a gate on starts today.
 */
export function SettingsTab() {
  const { t } = useT();
  const fmt = useFmt();
  const invalidate = useQaInvalidate();
  const q = useQuery({ ...trpc.qa.settings.get.queryOptions(), meta: INLINE_ERROR_META });
  const [bundles, setBundles] = useState("");
  const [minutes, setMinutes] = useState("");
  useEffect(() => {
    if (!q.data) return;
    setBundles(q.data.inProcessEveryBundles ? String(q.data.inProcessEveryBundles) : "");
    setMinutes(q.data.inProcessEveryMinutes ? String(q.data.inProcessEveryMinutes) : "");
  }, [q.data?.inProcessEveryBundles, q.data?.inProcessEveryMinutes]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = useMutation(
    trpc.qa.settings.update.mutationOptions({
      onSuccess: async () => {
        toast.success(t("qa.saved"));
        await invalidate();
      },
    }),
  );
  if (showsQueryError(q)) {
    return <EmptyState title={t("qa.loadFailed")} action={<Button variant="secondary" onClick={() => void q.refetch()}>{t("common.retry")}</Button>} />;
  }
  if (!q.data) return null;
  const s = q.data;
  const b = optional(bundles, wholeFrom);
  const m = optional(minutes, wholeFrom);
  const readOnly = (label: string, on: boolean) => (
    <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-card border border-border bg-card px-4 py-3">
      <span className="min-w-0 text-[15px] font-semibold break-words">{label}</span>
      <span className="text-[14px] text-muted-foreground">{on ? t("settings.modules.on") : t("settings.modules.off")}</span>
    </div>
  );
  return (
    <Block id="qa-settings" title={t("qa.settings.title")}>
      <div className="flex min-w-0 flex-col gap-1.5">
        <Can do="qa.masters" fallback={readOnly(t("qa.settings.firstPiece"), s.firstPieceBlocksPack)}>
          <SwitchRow
            testId="qa-switch-first-piece"
            label={t("qa.settings.firstPiece")}
            hint={t("qa.settings.firstPieceHint")}
            on={s.firstPieceBlocksPack}
            pending={save.isPending}
            onToggle={() => save.mutate({ firstPieceBlocksPack: !s.firstPieceBlocksPack })}
          />
        </Can>
        {s.firstPieceBlocksPack && s.firstPieceSince ? <Note>{t("qa.settings.since", { date: dayText(fmt, s.firstPieceSince) })}</Note> : null}
      </div>
      <div className="flex min-w-0 flex-col gap-1.5">
        <Can do="qa.masters" fallback={readOnly(t("qa.settings.lotInspection"), s.requireLotInspection)}>
          <SwitchRow
            testId="qa-switch-lot-inspection"
            label={t("qa.settings.lotInspection")}
            hint={t("qa.settings.lotInspectionHint")}
            on={s.requireLotInspection}
            pending={save.isPending}
            onToggle={() => save.mutate({ requireLotInspection: !s.requireLotInspection })}
          />
        </Can>
        {s.requireLotInspection && s.lotInspectionSince ? <Note>{t("qa.settings.since", { date: dayText(fmt, s.lotInspectionSince) })}</Note> : null}
      </div>
      <Can do="qa.masters">
        <form
          className="flex flex-wrap items-end gap-3 rounded-card border border-border bg-card p-4 sm:p-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (b.bad || m.bad || (b.value !== null && b.value < 1) || (m.value !== null && m.value < 1)) return;
            save.mutate({ inProcessEveryBundles: b.value, inProcessEveryMinutes: m.value });
          }}
        >
          <div className="w-56">
            <Field label={t("qa.settings.everyBundles")} hint={t("qa.settings.blankOff")}>
              <NumberInput decimal={false} value={bundles} onValueChange={setBundles} data-testid="qa-every-bundles" />
            </Field>
          </div>
          <div className="w-56">
            <Field label={t("qa.settings.everyMinutes")} hint={t("qa.settings.blankOff")}>
              <NumberInput decimal={false} value={minutes} onValueChange={setMinutes} data-testid="qa-every-minutes" />
            </Field>
          </div>
          <Button type="submit" loading={save.isPending} data-testid="qa-settings-save">
            {t("qa.settings.save")}
          </Button>
        </form>
      </Can>
      <QaRefusalNote error={save.error} />
    </Block>
  );
}

import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { Field, TextInput } from "@orrn/ui/components/field";
import { useEffect, useRef, useState } from "react";

import { useIngestActions, type PeriodGuess } from "../lib";
import { ActionError, Panel } from "./shared";

export function PeriodPanel({
  artifactId,
  period,
  confirmed,
}: {
  artifactId: string;
  period: PeriodGuess | null;
  confirmed: { fy: string | null; asOf: string | null } | null;
}) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const current = confirmed ?? period;
  const close = () => {
    setOpen(false);
    confirmRef.current?.focus();
  };
  return (
    <Panel
      title={t("ingest.period.confirm")}
      actions={
        !open ? (
          <Button ref={confirmRef} size="sm" variant="secondary" onClick={() => setOpen(true)}>
            {t("ingest.period.confirm")}
          </Button>
        ) : null
      }
    >
      <div className="flex flex-wrap gap-2">
        <Chip tone={current?.fy ? "blue" : "amber"}>
          {current?.fy ? t("ingest.period.chip", { fy: current.fy }) : t("ingest.period.unsure")}
        </Chip>
        {current?.asOf ? <span className="text-[14px] text-muted-foreground">{current.asOf}</span> : null}
      </div>
      {open ? (
        <PeriodConfirm
          artifactId={artifactId}
          initialFy={current?.fy ?? ""}
          initialAsOf={current?.asOf ?? ""}
          onClose={close}
        />
      ) : null}
    </Panel>
  );
}

export function PeriodConfirm({
  artifactId,
  initialFy,
  initialAsOf,
  onClose,
}: {
  artifactId: string;
  initialFy: string;
  initialAsOf: string;
  onClose?: () => void;
}) {
  const { t } = useT();
  const actions = useIngestActions();
  const [fy, setFy] = useState(initialFy);
  const [asOf, setAsOf] = useState(initialAsOf);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const [saveError, setSaveError] = useState<unknown>(null);
  const fyRef = useRef<HTMLInputElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    fyRef.current?.focus();
  }, []);

  const save = async () => {
    if (!fy || !asOf) {
      setError(true);
      return;
    }
    setPending(true);
    setError(false);
    setSaveError(null);
    try {
      await actions.confirmPeriod(artifactId, fy, asOf);
      closeRef.current?.();
    } catch (e) {
      setSaveError(e);
    } finally {
      setPending(false);
    }
  };

  return (
    <form
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <Field label={t("ingest.period.fy")} required error={error && !fy ? t("common.required") : undefined}>
        <TextInput ref={fyRef} value={fy} onChange={(event) => setFy(event.currentTarget.value)} />
      </Field>
      <Field label={t("ingest.period.asOf")} required error={error && !asOf ? t("common.required") : undefined}>
        <TextInput type="date" value={asOf} onChange={(event) => setAsOf(event.currentTarget.value)} />
      </Field>
      <div className="sm:col-span-2"><ActionError error={saveError} /></div>
      <div className="flex flex-wrap gap-2 sm:col-span-2">
        <Button type="submit" size="sm" loading={pending}>{t("common.save")}</Button>
        {onClose ? <Button type="button" size="sm" variant="ghost" onClick={onClose}>{t("common.cancel")}</Button> : null}
      </div>
    </form>
  );
}

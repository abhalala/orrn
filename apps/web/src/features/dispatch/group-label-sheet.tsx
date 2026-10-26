import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Field, TextInput } from "@orrn/ui/components/field";
import { Sheet } from "@orrn/ui/components/sheet";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { scanErrorKey } from "@/features/scan/scan-outcome";
import { trpcClient } from "@/shared/utils/trpc";

import type { ItemGroup } from "./group-items";

/** Same rule as the server (`setItemGroupLabel`): trimmed, uppercase, at most 32 characters. */
const MAX_LABEL = 32;
/** Requests in flight at once when a label is written to every bundle of a group. */
const PARALLEL = 4;

type Props = {
  group: ItemGroup | null;
  dispatchId: string;
  onOpenChange(open: boolean): void;
  onSaved(): void;
};

/**
 * Packing group label for a whole group: written to each of its bundles
 * (the server stores it per bundle), a few at a time. A partial failure says
 * how many were saved and asks to save again.
 */
export function GroupLabelSheet({ group, dispatchId, onOpenChange, onSaved }: Props) {
  const { t } = useT();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState<"save" | "clear" | null>(null);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    if (group) {
      setValue(group.labelled ? group.label : "");
      setError(undefined);
    }
  }, [group]);

  const write = async (label: string | null, kind: "save" | "clear") => {
    if (!group) return;
    setBusy(kind);
    setError(undefined);
    const bundles = group.bundles;
    let done = 0;
    let failure: unknown = null;
    for (let i = 0; i < bundles.length; i += PARALLEL) {
      const slice = bundles.slice(i, i + PARALLEL);
      const results = await Promise.allSettled(
        slice.map((b) => trpcClient.dispatch.setItemGroupLabel.mutate({ id: dispatchId, bundleId: b.bundleId, groupLabel: label })),
      );
      for (const r of results) {
        if (r.status === "fulfilled") done += 1;
        else failure ??= r.reason;
      }
    }
    setBusy(null);
    onSaved();
    if (failure) {
      setError(
        done > 0 ? t("dispatch.build.labelPartial", { done, total: bundles.length }) : t(scanErrorKey(failure, "dispatch")),
      );
      return;
    }
    toast.success(label ? t("dispatch.build.labelSaved") : t("dispatch.build.labelCleared"));
    onOpenChange(false);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const label = value.trim().toUpperCase();
    if (!label) {
      setError(t("errors.required"));
      return;
    }
    void write(label, "save");
  };

  const title = group ? t("dispatch.build.labelFor", { group: group.labelled ? group.dieLabel : group.label }) : "";
  return (
    <Sheet
      open={group !== null}
      onOpenChange={(next) => {
        if (busy) return;
        onOpenChange(next);
      }}
      title={title}
      footer={
        <>
          {group?.labelled ? (
            <Button variant="secondary" loading={busy === "clear"} disabled={busy !== null} onClick={() => void write(null, "clear")}>
              {t("dispatch.build.clearLabel")}
            </Button>
          ) : (
            <Button variant="secondary" disabled={busy !== null} onClick={() => onOpenChange(false)}>
              {t("common.cancel")}
            </Button>
          )}
          <Button type="submit" form="group-label-form" loading={busy === "save"} disabled={busy !== null}>
            {t("dispatch.build.saveLabel")}
          </Button>
        </>
      }
    >
      <form id="group-label-form" onSubmit={submit} className="flex flex-col gap-3 pt-1" noValidate>
        <Field label={t("dispatch.build.groupLabel")} hint={t("dispatch.build.labelHint")} error={error}>
          <TextInput
            value={value}
            onChangeText={(v) => setValue(v.toUpperCase())}
            maxLength={MAX_LABEL}
            autoFocus
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            className="font-mono sm:max-w-[200px]"
          />
        </Field>
      </form>
    </Sheet>
  );
}

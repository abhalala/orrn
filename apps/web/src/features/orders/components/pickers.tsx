import { useT } from "@orrn/i18n";
import { Combobox, type ComboboxOption } from "@orrn/ui/components/combobox";
import { Field } from "@orrn/ui/components/field";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useRef } from "react";

import { trpc, trpcClient } from "@/shared/utils/trpc";

import { milliText } from "../format";
import { dieTitle } from "../view";

export type Picked = { id: string; label: string };

/** Customer field: server-side search, the picked name kept for the label. */
export function CustomerField({
  value,
  onChange,
  error,
}: {
  value: Picked | null;
  onChange(next: Picked): void;
  error?: string;
}) {
  const { t } = useT();
  const seen = useRef(new Map<string, string>());
  return (
    <Field label={t("orders.customer")} error={error}>
      <Combobox<string>
        value={value?.id ?? null}
        valueLabel={value?.label}
        onChange={(id) => onChange({ id, label: seen.current.get(id) ?? "" })}
        search={async (q) => {
          const res = await trpcClient.customer.list.query({ search: q, limit: 20 });
          return res.items.map((c) => {
            seen.current.set(c.id, c.name);
            return { value: c.id, label: c.name, hint: c.phone ?? undefined } satisfies ComboboxOption<string>;
          });
        }}
        placeholder={t("orders.form.customerSearch")}
      />
    </Field>
  );
}

/** Die (section) field: search by code, series or name. */
export function DieField({
  value,
  onChange,
  error,
}: {
  value: Picked | null;
  onChange(next: Picked): void;
  error?: string;
}) {
  const { t } = useT();
  const seen = useRef(new Map<string, string>());
  return (
    <Field label={t("orders.line.die")} error={error}>
      <Combobox<string>
        value={value?.id ?? null}
        valueLabel={value?.label}
        onChange={(id) => onChange({ id, label: seen.current.get(id) ?? "" })}
        search={async (q) => {
          const res = await trpcClient.die.list.query({ search: q, limit: 20 });
          return res.items.map((d) => {
            const label = dieTitle({ sectionCode: d.sectionCode, name: d.name, series: d.series });
            seen.current.set(d.id, label);
            return { value: d.id, label } satisfies ComboboxOption<string>;
          });
        }}
        placeholder={t("orders.form.dieSearch")}
      />
    </Field>
  );
}

export type CopyChoice = {
  /** "any" = the die room picks; "copy:<id>" pins a copy; "tier:<n>" asks for that tier or better. */
  value: string;
  label: string;
};

/** The copies of a die as choices: the die room picks, a pinned copy, or "tier N or better". */
export function useCopyChoices(sectionId: string | null): { choices: CopyChoice[]; loading: boolean } {
  const { t } = useT();
  const copies = useQuery({
    ...trpc.dieInstance.list.queryOptions({ sectionId: sectionId ?? "", limit: 200 }),
    enabled: sectionId != null,
  });
  const choices = useMemo(() => {
    const out: CopyChoice[] = [{ value: "any", label: t("orders.line.anyCopy") }];
    const live = (copies.data?.items ?? []).filter((c) => c.status !== "retired");
    for (const c of live) {
      const milli = c.latestKgPer12ftMilli;
      out.push({
        value: `copy:${c.id}`,
        label: [
          t("orders.line.copyCode", { code: c.code }),
          c.tierRank != null ? t("orders.line.tierShort", { rank: c.tierRank }) : null,
          milli != null ? `${milliText(milli)} ${t("units.kgPer12ft")}` : null,
        ]
          .filter(Boolean)
          .join(" · "),
      });
    }
    // "Tier 1 or better" is always offered: a die with no copies yet still needs a tier to be confirmed.
    const ranks = [...new Set([1, ...live.map((c) => c.tierRank).filter((r): r is number => r != null)])].sort((a, b) => a - b);
    for (const rank of ranks) out.push({ value: `tier:${rank}`, label: t("orders.line.tierOrBetter", { rank }) });
    return out;
  }, [copies.data, t]);
  return { choices, loading: copies.isPending && sectionId != null };
}

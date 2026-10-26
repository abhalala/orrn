/**
 * Searchable pickers for the die room (copies and customers). Both ask the server: the first page
 * shows when nothing is typed ("Showing 20 of 340, type to find"), typing queries the server, so a
 * plant with hundreds of copies or customers never loses one behind a fixed-size list.
 */
import { useT } from "@orrn/i18n";
import { Combobox, type ComboboxOption } from "@orrn/ui/components/combobox";
import { Field } from "@orrn/ui/components/field";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useRef } from "react";

import { INLINE_ERROR_META } from "@/shared/lib/query-errors";
import { trpc, trpcClient } from "@/shared/utils/trpc";

import { copyCodeQuery, type CopyStatus } from "./die-room-model";

const PAGE = 10;

export type PickedCopy = {
  id: string;
  code: string;
  sectionId: string;
  status: CopyStatus;
};

type CopyListItem = PickedCopy & { sectionSeries?: string | null };

/** Copy field: type a code the way the floor writes it ("13090-2" or "13090/2"). */
export function CopyPicker({
  label,
  value,
  valueLabel,
  onChange,
  statuses,
  sectionId,
  placeholder,
}: {
  label: string;
  value: string | null;
  valueLabel?: string;
  onChange(copy: PickedCopy): void;
  /** Only copies in these states (the issue form takes copies on the rack and copies on trial). */
  statuses?: CopyStatus[];
  /** Only copies of this die (a late entry for a queued run names a copy of the run's die). */
  sectionId?: string;
  placeholder: string;
}) {
  const { t } = useT();
  const seen = useRef(new Map<string, PickedCopy>());
  const first = useQuery({
    ...trpc.dieInstance.list.queryOptions({ ...(statuses ? { statuses } : {}), ...(sectionId ? { sectionId } : {}), limit: PAGE }),
    meta: INLINE_ERROR_META,
  });
  const toOption = (c: CopyListItem): ComboboxOption<string> => {
    seen.current.set(c.id, { id: c.id, code: c.code, sectionId: c.sectionId, status: c.status });
    return {
      value: c.id,
      label: c.code,
      hint: c.status === "available" ? undefined : t(`dieRoom.status.${c.status}`),
    };
  };
  const recent = useMemo(
    () => (first.data?.items ?? []).map((c) => toOption(c as unknown as CopyListItem)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [first.data],
  );
  const total = first.data?.total ?? 0;
  const shown = first.data?.items.length ?? 0;

  return (
    <Field label={label} hint={total > shown ? t("common.showingOf", { shown, total }) : undefined}>
      <Combobox<string>
        value={value}
        valueLabel={valueLabel}
        onChange={(id) => {
          const picked = seen.current.get(id);
          if (picked) onChange(picked);
        }}
        search={async (q) => {
          const res = await trpcClient.dieInstance.list.query({
            ...(statuses ? { statuses } : {}),
            ...(sectionId ? { sectionId } : {}),
            search: copyCodeQuery(q),
            limit: PAGE,
          });
          return res.items.map((c) => toOption(c as unknown as CopyListItem));
        }}
        recent={recent}
        recentLabel={t("dieRoom.copies.title")}
        placeholder={placeholder}
      />
    </Field>
  );
}

export type PickedParty = { id: string; name: string };

/** Customer field. With `plantOption` the first entry is the plant itself (id `plant`). */
export function CustomerSearchPicker({
  label,
  value,
  valueLabel,
  onChange,
  placeholder,
  plantOption,
  hint,
}: {
  label: string;
  value: string | null;
  valueLabel?: string;
  onChange(party: PickedParty): void;
  placeholder: string;
  plantOption?: string;
  hint?: string;
}) {
  const { t } = useT();
  const names = useRef(new Map<string, string>());
  const first = useQuery({ ...trpc.customer.list.queryOptions({ limit: PAGE }), meta: INLINE_ERROR_META });
  const recent = useMemo(() => {
    const out: ComboboxOption<string>[] = plantOption ? [{ value: "plant", label: plantOption }] : [];
    if (plantOption) names.current.set("plant", plantOption);
    for (const c of first.data?.items ?? []) {
      names.current.set(c.id, c.name);
      out.push({ value: c.id, label: c.name, hint: c.phone ?? undefined });
    }
    return out;
  }, [first.data, plantOption]);
  const total = first.data?.total ?? 0;
  const shown = first.data?.items.length ?? 0;
  const counted = total > shown ? t("common.showingOf", { shown, total }) : undefined;

  return (
    <Field label={label} hint={[hint, counted].filter(Boolean).join(" ") || undefined}>
      <Combobox<string>
        value={value}
        valueLabel={valueLabel}
        onChange={(id) => onChange({ id, name: names.current.get(id) ?? "" })}
        search={async (q) => {
          const res = await trpcClient.customer.list.query({ search: q, limit: PAGE });
          return res.items.map((c) => {
            names.current.set(c.id, c.name);
            return { value: c.id, label: c.name, hint: c.phone ?? undefined };
          });
        }}
        recent={recent}
        recentLabel={t("customers.title")}
        placeholder={placeholder}
      />
    </Field>
  );
}

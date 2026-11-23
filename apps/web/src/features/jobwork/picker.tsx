import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Field, TextInput } from "@orrn/ui/components/field";
import { ScanField } from "@orrn/ui/components/scan-field";
import { useQuery } from "@tanstack/react-query";
import { Plus, X } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { useFmt } from "@/shared/lib/fmt";
import { kgWithUnit } from "@/shared/lib/fmt-text";
import { INLINE_ERROR_META } from "@/shared/lib/query-errors";
import { trpc } from "@/shared/utils/trpc";

import { addPick, knownWeightG, MAX_BUNDLES, parseCodes, type BundlePick } from "./model";
import { Panel } from "./ui";

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

/**
 * The bundles that go on a step: scan or type a serial (Enter adds it), paste a list, or pick from the yard stock.
 * A scanned or typed number is sent as a code and the server finds the bundle; a picked one is sent by id. Nothing is
 * checked here beyond "once only": whether a bundle may leave (on a dispatch, already out) is the server's answer.
 */
export function BundlePicker({ picks, onChange, error }: { picks: readonly BundlePick[]; onChange(picks: BundlePick[]): void; error?: string }) {
  const { t } = useT();
  const fmt = useFmt();
  const [paste, setPaste] = useState("");
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const q = useDebounced(search.trim(), 250);
  const stock = useQuery({ ...trpc.bundle.listBundles.queryOptions({ search: q || undefined, status: "available", limit: 20 }), enabled: open, meta: INLINE_ERROR_META });

  const add = (pick: Omit<BundlePick, "key">) => {
    const r = addPick(picks, pick);
    onChange(r.picks);
    if (r.repeat) toast.warning(t("jw.pick.repeat", { serial: pick.label }));
    return r.repeat;
  };
  const addPasted = () => {
    const { codes, repeats } = parseCodes(paste);
    let next: readonly BundlePick[] = picks;
    for (const code of codes) next = addPick(next, { code, label: code }).picks;
    onChange([...next]);
    setPaste("");
    if (repeats > 0) toast.warning(t("jw.pick.repeats", { count: repeats }));
  };
  const known = knownWeightG(picks);

  return (
    <div className="flex min-w-0 flex-col gap-3" data-testid="bundle-picker">
      <Field label={t("jw.pick.scan")} hint={t("jw.pick.scanHint")} error={error}>
        <ScanField placeholder={t("jw.pick.scanPlaceholder")} onScan={(code) => void add({ code, label: code })} />
      </Field>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="secondary" onClick={() => setOpen((o) => !o)} aria-expanded={open} data-testid="pick-from-stock">
          {open ? t("jw.pick.hideStock") : t("jw.pick.fromStock")}
        </Button>
      </div>
      {open ? (
        <Panel className="flex flex-col gap-3" data-testid="pick-stock-panel">
          <Field label={t("jw.pick.search")}>
            <TextInput value={search} onChange={(e) => setSearch(e.currentTarget.value)} placeholder={t("jw.pick.searchPlaceholder")} />
          </Field>
          {stock.isError ? <p className="m-0 text-[14px] text-muted-foreground">{t("jw.pick.stockFailed")}</p> : null}
          {stock.data && stock.data.items.length === 0 ? <p className="m-0 text-[14px] text-muted-foreground">{t("jw.pick.noStock")}</p> : null}
          <ul className="m-0 flex list-none flex-col divide-y divide-border p-0">
            {(stock.data?.items ?? []).map((b) => {
              const on = picks.some((p) => p.bundleId === b.id);
              return (
                <li key={b.id} className="flex min-w-0 items-center justify-between gap-3 py-2">
                  <div className="flex min-w-0 flex-col">
                    <span className="font-mono text-[15px] font-semibold">{b.serial}</span>
                    <span className="text-[13px] break-words text-muted-foreground">
                      {[b.dieSectionCode, fmt.q("bundle.length", b.lengthMm), t("jw.pick.pcs", { count: b.quantity }), kgWithUnit(fmt, b.weightG), b.locationCode].filter(Boolean).join(" · ")}
                    </span>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={on || picks.length >= MAX_BUNDLES}
                    onClick={() => add({ bundleId: b.id, code: b.serial, label: b.serial, weightG: b.weightG })}
                    data-testid={`pick-${b.serial}`}
                  >
                    <Plus aria-hidden="true" className="size-4" />
                    {on ? t("jw.pick.added") : t("jw.pick.add")}
                  </Button>
                </li>
              );
            })}
          </ul>
        </Panel>
      ) : null}
      <Field label={t("jw.pick.paste")} hint={t("jw.pick.pasteHint")}>
        <div className="flex min-w-0 items-end gap-2">
          <textarea
            value={paste}
            onChange={(e) => setPaste(e.currentTarget.value)}
            rows={2}
            aria-label={t("jw.pick.paste")}
            className="min-h-11 min-w-0 flex-1 resize-y rounded-input border border-input bg-card px-3 py-2.5 font-mono text-[15px] leading-6 text-foreground placeholder:text-muted-foreground"
            data-testid="pick-paste"
          />
          <Button type="button" variant="secondary" disabled={paste.trim() === ""} onClick={addPasted}>
            {t("jw.pick.add")}
          </Button>
        </div>
      </Field>
      {picks.length > 0 ? (
        <div className="flex min-w-0 flex-col gap-2" data-testid="picked-list">
          <p className="m-0 text-[14px] font-semibold">
            {t("jw.pick.count", { count: picks.length })}
            {known > 0 ? ` · ${kgWithUnit(fmt, known)}` : ""}
          </p>
          <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
            {picks.map((p) => (
              <li key={p.key} className="inline-flex min-h-9 items-center gap-1 rounded-full border border-border bg-card py-1 pr-1 pl-3 font-mono text-[14px]">
                {p.label}
                <button type="button" aria-label={t("jw.pick.remove", { serial: p.label })} className="inline-flex size-7 items-center justify-center rounded-full text-muted-foreground hover:text-foreground" onClick={() => onChange(picks.filter((x) => x.key !== p.key))}>
                  <X aria-hidden="true" className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

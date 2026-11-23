import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { useMutation, useQuery } from "@tanstack/react-query";
import { FileText, Printer } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { serverRefusal } from "@/features/shared/server-refusal";
import { Can } from "@/shared/components/can";
import { useFmt } from "@/shared/lib/fmt";
import { INLINE_ERROR_META } from "@/shared/lib/query-errors";
import { trpc, trpcClient } from "@/shared/utils/trpc";

import { readSnapshot, type ProformaSnapshot } from "./docs-model";
import { usePrintProforma } from "./proforma-print";
import { useInvalidateDocs } from "./use-docs";

export type ProformaSource = { source: "order" | "quote"; id: string };

/**
 * "Make proforma": numbers and freezes a proforma of the source (`pricing.proforma.create`), then prints it from the
 * snapshot the server returned. Every press is a new number, so the button is busy until the print has opened.
 */
export function MakeProformaButton({ source, variant = "secondary" }: { source: ProformaSource; variant?: "secondary" | "ghost" }) {
  const { t } = useT();
  const print = usePrintProforma();
  const invalidate = useInvalidateDocs();
  const make = useMutation({
    mutationFn: () => trpcClient.pricing.proforma.create.mutate(source),
    onSuccess: async (res) => {
      toast.success(t("price.proforma.made", { number: res.number }));
      await invalidate.proforma();
      const snap = readSnapshot(res.snapshot);
      if (snap) await print(snap).catch(() => toast.error(t("price.proforma.printFailed")));
    },
    onError: (error) => toast.error(serverRefusal(t, error)),
  });
  return (
    <Can do="quote.manage">
      <Button variant={variant} loading={make.isPending} onClick={() => make.mutate()} data-make-proforma="">
        <FileText aria-hidden="true" strokeWidth={2} />
        {t("price.proforma.make")}
      </Button>
    </Can>
  );
}

/** The proformas already made from this source, newest first, each one printable again from its frozen snapshot. */
export function ProformaList({ source }: { source: ProformaSource }) {
  const { t } = useT();
  const fmt = useFmt();
  const print = usePrintProforma();
  const [busy, setBusy] = useState<string | null>(null);
  const list = useQuery({ ...trpc.pricing.proforma.list.queryOptions(source), meta: INLINE_ERROR_META });
  const reprint = async (id: string) => {
    setBusy(id);
    try {
      const row = await trpcClient.pricing.proforma.get.query({ id });
      const snap = readSnapshot(row.snapshot);
      if (!snap) throw new Error("snapshot unreadable");
      await print(snap);
    } catch {
      toast.error(t("price.proforma.printFailed"));
    } finally {
      setBusy(null);
    }
  };
  const items = list.data ?? [];
  return (
    <section className="flex min-w-0 flex-col gap-2" aria-label={t("price.proforma.previous")} data-proforma-list="">
      <h2 className="m-0 text-[15px] font-semibold">{t("price.proforma.previous")}</h2>
      {list.isPending ? null : list.isError ? (
        <p role="alert" className="m-0 text-[14px] text-destructive">
          {t("price.proforma.loadFailed")}
        </p>
      ) : items.length === 0 ? (
        <p className="m-0 text-[14px] text-muted-foreground">{t("price.proforma.none")}</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {items.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-card border border-border bg-card px-3 py-2">
              <span className="flex min-w-0 flex-col">
                <span className="font-mono text-[14px] font-semibold">{p.number}</span>
                <span className="text-[13px] text-muted-foreground">{fmt.date(new Date(p.createdAt as unknown as string | number | Date).getTime())}</span>
              </span>
              <Button variant="secondary" loading={busy === p.id} onClick={() => void reprint(p.id)} aria-label={t("price.proforma.reprintOf", { number: p.number })}>
                <Printer aria-hidden="true" strokeWidth={2} />
                {t("price.proforma.reprint")}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export type { ProformaSnapshot };

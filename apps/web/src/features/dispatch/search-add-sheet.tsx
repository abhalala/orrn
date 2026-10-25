import { formatKg, normalizeSerial } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { Field, TextInput } from "@orrn/ui/components/field";
import { Sheet } from "@orrn/ui/components/sheet";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { sendOnce } from "./request-key";
import { addOutcome, renderScanMessage, resultOutcome, scanErrorKey, type AddBundlesReport } from "@/features/scan/scan-outcome";
import { can, useMe } from "@/shared/lib/me";
import { trpc, trpcClient } from "@/shared/utils/trpc";

type Props = {
  open: boolean;
  onOpenChange(open: boolean): void;
  dispatchId: string;
  /** Serials already on this dispatch (shown as added, not offered again). */
  inDispatch: ReadonlySet<string>;
  onAdded(report: AddBundlesReport): void;
};

/** Find in-stock bundles by part of a serial or PO and add them one by one; the sheet stays open. */
export function SearchAddSheet({ open, onOpenChange, dispatchId, inDispatch, onAdded }: Props) {
  const { t } = useT();
  const [text, setText] = useState("");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setQuery(text.trim()), 250);
    return () => clearTimeout(timer);
  }, [text]);

  const results = useQuery({
    ...trpc.bundle.listBundles.queryOptions({ status: "available", search: query, limit: 20 }),
    enabled: open && query.length >= 2,
    placeholderData: keepPreviousData,
  });

  const add = async (serial: string) => {
    setBusy(serial);
    try {
      const report = (await sendOnce((clientRequestId) => trpcClient.dispatch.scan.mutate({ id: dispatchId, serials: [serial], clientRequestId }))) as AddBundlesReport;
      const outcome = report.results?.[0] ? resultOutcome(report.results[0]) : addOutcome(report, normalizeSerial(serial));
      if (outcome.kind === "added") {
        setMessage(t("dispatch.build.added", { serial }));
        onAdded(report);
      } else if (outcome.kind === "already") {
        setMessage(`${t("scan.continuous.already")}: ${serial}`);
      } else if (outcome.kind === "rejected") {
        const why = renderScanMessage(t, outcome.message);
        setMessage(`${serial}: ${why}`);
        toast.error(why, {
          description: serial,
          // The office may put a bundle that is not on any order on the load anyway (D12).
          ...(outcome.code === "unassigned" && canAddAnyway
            ? { action: { label: t("scan.continuous.addAnyway"), onClick: () => void addAnyway(outcome.serial) } }
            : {}),
        });
      } else {
        setMessage(`${serial}: ${t("scan.notFound")}`);
      }
    } catch (error) {
      toast.error(t(scanErrorKey(error, "dispatch")));
    } finally {
      setBusy(null);
    }
  };

  const { data: me } = useMe();
  const canAddAnyway = can(me, "order.manage");
  const addAnyway = async (bundleSerial: string) => {
    try {
      const r = (await sendOnce((clientRequestId) =>
        trpcClient.dispatch.addBundlesBySerial.mutate({ id: dispatchId, serials: [bundleSerial], allowUnassigned: true, clientRequestId }),
      )) as AddBundlesReport;
      if (r.added.length > 0) {
        setMessage(t("scan.continuous.addedNoOrder", { serial: bundleSerial }));
        onAdded(r);
      }
    } catch (error) {
      toast.error(t(scanErrorKey(error, "dispatch")));
    }
  };

  // However it closes (Done, Escape, outside): the next open starts with an empty search,
  // no old results and no old "Added" line.
  const changeOpen = (next: boolean) => {
    onOpenChange(next);
    if (!next) {
      setText("");
      setQuery("");
      setMessage("");
    }
  };

  const items = results.data?.items ?? [];
  return (
    <Sheet
      open={open}
      onOpenChange={changeOpen}
      title={t("dispatch.build.searchTitle")}
      footer={<Button onClick={() => changeOpen(false)}>{t("common.done")}</Button>}
    >
      <div className="flex flex-col gap-4 pt-1">
        <Field label={t("dispatch.build.searchLabel")} hint={t("dispatch.build.searchHint")}>
          <TextInput
            type="search"
            value={text}
            onChangeText={setText}
            autoFocus
            autoComplete="off"
            spellCheck={false}
            className="font-mono"
          />
        </Field>
        <p role="status" aria-live="polite" className="m-0 min-h-5 text-[14px] font-medium">
          {message}
        </p>
        {query.length < 2 ? (
          <p className="m-0 text-[14px] text-muted-foreground">{t("dispatch.build.searchStart")}</p>
        ) : results.isPending ? (
          <div className="flex flex-col gap-2" aria-hidden="true">
            <Skeleton className="h-14 w-full rounded-card" />
            <Skeleton className="h-14 w-full rounded-card" />
          </div>
        ) : items.length === 0 ? (
          <p className="m-0 text-[14px] text-muted-foreground">{t("dispatch.build.searchEmpty", { query })}</p>
        ) : (
          <ul
            aria-label={t("dispatch.build.searchTitle")}
            className="m-0 flex list-none flex-col divide-y divide-border rounded-card border border-border p-0"
          >
            {items.map((b) => {
              const added = inDispatch.has(b.serial);
              return (
                <li key={b.id} className="flex min-h-16 min-w-0 items-center gap-3 px-3.5 py-2">
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="font-mono text-[15px] font-semibold [overflow-wrap:anywhere]">{b.serial}</span>
                    <span className="text-[13px] text-muted-foreground break-words">
                      {b.dieSectionCode} {b.dieSeries}
                      <span className="font-mono">
                        {" "}
                        {formatKg(b.weightG / 1000)} {t("units.kg")}
                      </span>
                    </span>
                  </div>
                  {added ? (
                    <Chip tone="green">{t("dispatch.build.inDispatch")}</Chip>
                  ) : (
                    <Button
                      variant="secondary"
                      className="shrink-0 px-4"
                      loading={busy === b.serial}
                      onClick={() => void add(b.serial)}
                    >
                      <Plus aria-hidden="true" strokeWidth={2} />
                      {t("dispatch.build.add")}
                      <span className="sr-only"> {b.serial}</span>
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Sheet>
  );
}

import { formatKg, formatLength, gToKg, type LengthUnit } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Field, NumberInput } from "@orrn/ui/components/field";
import { PageHeader } from "@orrn/ui/components/page-header";
import { SegmentedControl } from "@orrn/ui/components/segmented-control";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { cn } from "@orrn/ui/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Printer } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { lengthUnitOf } from "./pack-ui";
import { kg12Text } from "./line-preview";
import {
  SHEET_GRID,
  isSheetSize,
  paginateLabels,
  standardLine,
  stickerPartyNo,
  type SheetSize,
  type StickerLabel,
} from "./label-sheet-model";
import { useMe } from "@/shared/lib/me";
import { isNotFound } from "@/shared/lib/session-errors";
import { trpc } from "@/shared/utils/trpc";

const SIZE_KEY = "orrn.labelSheetSize";

function readSize(): SheetSize {
  try {
    const n = Number(window.localStorage.getItem(SIZE_KEY));
    return isSheetSize(n) ? n : 10;
  } catch {
    return 10;
  }
}

/** QR images for the stickers, made in the browser (`qrcode` loads when this page opens, not before). */
function useQrImages(labels: readonly StickerLabel[]): Map<string, string> {
  const [images, setImages] = useState<Map<string, string>>(new Map());
  const key = labels.map((l) => l.qr).join("\n");
  useEffect(() => {
    let live = true;
    void (async () => {
      const QRCode = await import("qrcode");
      const entries = await Promise.all(
        [...new Set(labels.map((l) => l.qr).filter(Boolean))].map(
          async (text) => [text, await QRCode.toDataURL(text, { margin: 0, width: 240, errorCorrectionLevel: "M" })] as const,
        ),
      );
      if (live) setImages(new Map(entries));
    })().catch(() => {
      // A sticker without its picture still carries the serial in large type.
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return images;
}

const PRINT_CSS = `
@media print {
  @page { size: A4; margin: 0; }
  html[data-label-print] [data-slot="side-nav"],
  html[data-label-print] [data-slot="tab-bar"],
  html[data-label-print] [data-shell-chrome],
  html[data-label-print] [data-slot="app-shell"] > a,
  html[data-label-print] .label-no-print { display: none !important; }
  html[data-label-print] [data-slot="app-shell"],
  html[data-label-print] [data-slot="app-shell"] > div { display: block !important; min-height: 0 !important; }
  html[data-label-print] main > div { max-width: none !important; padding: 0 !important; }
  html[data-label-print] body { background: #fff !important; }
  html[data-label-print] .label-page { width: 210mm !important; height: 297mm !important; margin: 0 !important; border: 0 !important; border-radius: 0 !important; box-shadow: none !important; break-after: page; }
}
`;

/**
 * The label sheet for a packing session (or one bundle of it): stickers on A4 for the browser to
 * print, for plants with no label printer connected. Same figures as the printer label.
 */
export function LabelSheet({ groupId, only }: { groupId: string; only?: string }) {
  const { t } = useT();
  const { data: me } = useMe();
  const unit: LengthUnit = lengthUnitOf(me?.company?.settings);
  const sheet = useQuery(trpc.bundle.labelSheet.queryOptions({ groupId }));
  const queryClient = useQueryClient();
  // Final explore round 1 (I3): once the stickers are printed, "Sticker needs reprint" clears. Nothing here
  // is worth an error; the flag only stays a little longer.
  const printed = useMutation({
    ...trpc.bundle.labelsPrinted.mutationOptions(),
    onSettled: () => void queryClient.invalidateQueries(),
  });
  const [size, setSizeState] = useState<SheetSize>(readSize);
  const [skip, setSkip] = useState("0");
  const labels = useMemo(
    () => ((sheet.data?.labels ?? []) as StickerLabel[]).filter((l) => (only ? l.serial === only : true)),
    [sheet.data, only],
  );
  const qr = useQrImages(labels);
  const skipN = Math.max(0, Math.min(Number.parseInt(skip, 10) || 0, size - 1));
  const pages = useMemo(() => paginateLabels(labels, size, skipN), [labels, size, skipN]);

  const setSize = (next: SheetSize) => {
    setSizeState(next);
    try {
      window.localStorage.setItem(SIZE_KEY, String(next));
    } catch {
      // The choice holds for this visit.
    }
  };

  // Printing hides the app chrome (same technique as the other printed pages).
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-label-print", "");
    return () => {
      root.removeAttribute("data-label-print");
    };
  }, []);

  const missing = sheet.isError && !sheet.data;
  return (
    <>
      <style>{PRINT_CSS}</style>
      <div className="label-no-print flex flex-col gap-5">
        <PageHeader
          title={t("labelSheet.title")}
          subtitle={t("labelSheet.subtitle")}
          back={{ to: `/pack/${groupId}`, label: t("pack.title") }}
          actions={
            <Button
              onClick={() => {
                window.print();
                if (labels.length > 0) printed.mutate({ bundleIds: labels.slice(0, 200).map((l) => l.bundleId) });
              }}
              disabled={labels.length === 0}
              data-testid="print-sheet"
            >
              <Printer aria-hidden="true" strokeWidth={2} />
              {t("labelSheet.print")}
            </Button>
          }
        />
        <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
          <div className="flex flex-col gap-1.5">
            <span aria-hidden="true" className="text-[14px] font-semibold leading-5">
              {t("labelSheet.perPage")}
            </span>
            <SegmentedControl
              label={t("labelSheet.perPage")}
              value={String(size) as "10" | "21"}
              onChange={(v) => setSize(Number(v) as SheetSize)}
              options={[
                { value: "10", label: t("labelSheet.size10") },
                { value: "21", label: t("labelSheet.size21") },
              ]}
            />
          </div>
          <Field label={t("labelSheet.skip")} hint={t("labelSheet.skipHint")} className="w-44">
            <NumberInput value={skip} onValueChange={setSkip} decimal={false} />
          </Field>
        </div>
        <p className="m-0 text-[13px] leading-5 text-muted-foreground">{t("labelSheet.tip")}</p>
      </div>

      {sheet.isPending ? (
        <Skeleton className="h-[480px] w-full rounded-card" />
      ) : missing ? (
        <div className="label-no-print rounded-card border border-border bg-card">
          <EmptyState title={isNotFound(sheet.error) ? t("pack.detail.notFound") : t("pack.detail.loadFailed")} />
        </div>
      ) : labels.length === 0 ? (
        <div className="label-no-print rounded-card border border-border bg-card">
          <EmptyState title={t("labelSheet.none")} />
        </div>
      ) : (
        <div data-testid="label-sheet" className="flex flex-col gap-5">
          {pages.map((page, p) => (
            <section
              key={p}
              aria-label={t("labelSheet.page", { n: p + 1, total: pages.length })}
              data-slot="label-page"
              className="label-page mx-auto w-full max-w-[210mm] overflow-hidden rounded-card border border-border bg-white text-black shadow-sm"
              style={{ aspectRatio: "210 / 297", containerType: "inline-size" }}
            >
              <div
                className="grid h-full w-full gap-[1.4cqw] p-[3.8cqw]"
                style={{
                  gridTemplateColumns: `repeat(${SHEET_GRID[size].cols}, minmax(0, 1fr))`,
                  gridTemplateRows: `repeat(${SHEET_GRID[size].rows}, minmax(0, 1fr))`,
                }}
              >
                {page.map((l, i) =>
                  l ? (
                    <Sticker key={l.bundleId} label={l} company={sheet.data?.company.name ?? ""} unit={unit} qr={qr.get(l.qr)} dense={size === 21} />
                  ) : (
                    <div key={`empty-${i}`} aria-hidden="true" className="rounded-[0.6cqw] border border-dashed border-black/15" />
                  ),
                )}
              </div>
            </section>
          ))}
        </div>
      )}
    </>
  );
}

/**
 * Sticker sizes per density, in container units of the A4 page (100cqw = 210 mm). The QR has its own
 * column, sized to fit the sticker's height, so text never runs under it (review C-1): 10-up cells are
 * about 45 × 25cqw inside, 21-up about 30 × 18cqw.
 */
const STICKER = {
  10: { pad: "p-[1.6cqw]", gap: "gap-x-[1.6cqw]", qr: "size-[16cqw]", head: "text-[2cqw]", serial: "text-[2.9cqw]", body: "text-[2.1cqw]", small: "text-[1.7cqw]" },
  21: { pad: "p-[1.1cqw]", gap: "gap-x-[1.1cqw]", qr: "size-[10cqw]", head: "text-[1.45cqw]", serial: "text-[1.95cqw]", body: "text-[1.5cqw]", small: "text-[1.25cqw]" },
} as const;

function Sticker({
  label: l,
  company,
  unit,
  qr,
  dense,
}: {
  label: StickerLabel;
  company: string;
  unit: LengthUnit;
  qr: string | undefined;
  dense: boolean;
}) {
  const { t } = useT();
  const party = stickerPartyNo(l);
  const std = standardLine(l);
  const k12 = kg12Text(l.kgPer12ftMilli);
  const z = STICKER[dense ? 21 : 10];
  const extra = [l.cast ? t("labelSheet.cast", { cast: l.cast }) : null, l.salesOrder, std].filter(Boolean).join(" · ");
  return (
    <div
      data-slot="sticker"
      data-serial={l.serial}
      className={cn("grid min-h-0 min-w-0 grid-cols-[auto_minmax(0,1fr)] items-start overflow-hidden rounded-[0.6cqw] border border-black/40", z.pad, z.gap)}
    >
      {qr ? (
        <img src={qr} alt="" data-slot="sticker-qr" data-qr={l.qr} className={cn("block shrink-0", z.qr)} />
      ) : (
        <div aria-hidden="true" data-slot="sticker-qr" className={cn("shrink-0 border border-black/20", z.qr)} />
      )}
      <div className="flex min-h-0 min-w-0 flex-col gap-[0.3cqw] overflow-hidden leading-tight">
        {l.showLogo && company ? (
          <span data-slot="sticker-company" className={cn("min-w-0 truncate font-bold tracking-tight", z.head)}>
            {company}
          </span>
        ) : null}
        <span className={cn("min-w-0 truncate font-semibold", z.head)}>
          {l.sectionCode} {l.series}
        </span>
        <span data-slot="sticker-serial" className={cn("min-w-0 font-mono font-bold leading-none break-all", z.serial)}>
          {l.serial}
        </span>
        {party ? (
          <span className={cn("min-w-0 truncate font-mono font-semibold", z.small)}>{t("labelSheet.party", { number: party })}</span>
        ) : null}
        <span data-slot="sticker-weight" className={cn("min-w-0 font-mono font-bold tabular-nums", z.body)}>
          {formatKg(gToKg(l.weightG))} {t("units.kg")}
        </span>
        <span className={cn("min-w-0 font-mono tabular-nums [overflow-wrap:anywhere]", z.small)}>
          {l.pieces} {t("units.pcs")} · {formatLength(l.lengthMm, unit)}
          {k12 ? ` · ${k12} ${t("units.kgPer12ft")}` : ""}
        </span>
        {extra ? <span className={cn("min-w-0 truncate", z.small)}>{extra}</span> : null}
      </div>
    </div>
  );
}

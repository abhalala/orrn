import type { LengthUnit } from "@orrn/domain";
import { bpPercent1, formatLength as formatLengthMm } from "@orrn/domain";
import { useT, type MessageKey } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Card, CardHeader, CardTitle } from "@orrn/ui/components/card";
import { Field, NumberInput, TextInput } from "@orrn/ui/components/field";
import { SegmentedControl } from "@orrn/ui/components/segmented-control";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Boxes, Copy, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";

import { trpc, trpcClient } from "@/shared/utils/trpc";

import { blockLines, rowHasQty, totalsView, type BlockProblems, type DieBlock, type Totals } from "../die-blocks";
import { kgFieldText, milliText, orderKgText, pcsText } from "../format";
import { useDebounced } from "../hooks";
import { cutLengthMm, quoteArgs, sameQuoteArgs, type Finish, type LineDraft, type QuoteArgs, type WeightBasis } from "../line-model";
import { QUICK_FEET } from "../view";
import { FieldSelect } from "./controls";
import { DieField, useCopyChoices } from "./pickers";
import { StockSheet } from "./stock-sheet";

type Quote = {
  pcs: number;
  kgG: number;
  impliedG: number;
  basisMilli: number;
  copyMilli: number | null;
  copyCode: string | null;
  locked: boolean;
  weightBasis: string;
  alloy?: string | null;
  temper?: string | null;
};

/** What one row's quote is doing: asked for exactly what is typed now, on its way, or failed. */
export type RowQuote = {
  data: Quote | undefined;
  quoting: boolean;
  failed: boolean;
  /** The row's share of the order's kg in basis points (the server's), once every row is quoted. */
  shareBp: number | null;
};

export type OrderQuotes = { rows: Map<string, RowQuote>; blocks: Map<string, Totals>; order: Totals };

type QuoteManyResult = {
  rows: { key: string; block: string; quote: Quote | null; error: string | null; shareBp: number | null }[];
  blocks: { block: string; lines: number; pcs: number; kgG: number; failed: number }[];
  order: { lines: number; pcs: number; kgG: number; failed: number };
};

/**
 * Every row's quote in one `orders.quoteMany` call, asked once typing pauses (review I-5, r1 I-1):
 * a quote is shown only for exactly what is typed now. The server's pieces and kg are what the
 * form shows, and the block and order totals and each row's share are the server's too.
 */
export function useOrderQuotes(blocks: readonly DieBlock[], unit: LengthUnit): OrderQuotes {
  const wanted = blocks.flatMap((b) => blockLines(b).map((l) => ({ key: l.key, block: b.key, args: quoteArgs(l, unit) })));
  const json = JSON.stringify(wanted);
  const debounced = useDebounced(json, 300);
  const asked = useMemo(() => JSON.parse(debounced) as { key: string; block: string; args: QuoteArgs | null }[], [debounced]);
  const rows = useMemo(() => asked.flatMap((a) => (a.args ? [{ key: a.key, block: a.block, ...a.args }] : [])), [asked]);
  const q = useQuery({
    queryKey: ["orders.quoteMany", rows],
    // A read sent as POST: a long order's rows do not fit in a GET URL.
    queryFn: () => trpcClient.orders.quoteMany.mutate({ rows }) as Promise<QuoteManyResult>,
    enabled: rows.length > 0,
    retry: false,
    placeholderData: keepPreviousData,
  });
  const fresh = q.data != null && !q.isPlaceholderData;
  const settled = debounced === json && (rows.length === 0 || fresh);
  const byKey = new Map((fresh ? q.data!.rows : []).map((r) => [r.key, r]));
  const out = new Map<string, RowQuote>();
  for (const w of wanted) {
    const i = asked.findIndex((a) => a.key === w.key);
    const current = w.args != null && i >= 0 && asked[i]!.args != null && sameQuoteArgs(w.args, asked[i]!.args!);
    const r = current ? byKey.get(w.key) : undefined;
    const data = r?.quote ?? undefined;
    const failed = Boolean(r && r.error != null) || Boolean(current && q.isError);
    out.set(w.key, { data, quoting: w.args != null && !data && !failed, failed, shareBp: settled && data ? (r?.shareBp ?? null) : null });
  }
  const shown = rows.length > 0 ? q.data : undefined;
  return {
    rows: out,
    blocks: new Map(blocks.map((b) => [b.key, totalsView(shown?.blocks.find((x) => x.block === b.key), !settled)])),
    order: totalsView(shown?.order, !settled),
  };
}

/**
 * A die on the new-order form (FP-OP-02): the die and its copy once, then the cut lengths listed
 * under it. Pieces or kg is typed (one side); the other side comes from `orders.quote`. Enter in
 * pieces or kg adds the next length under this die with focus in its length cell; Shift+Enter adds
 * another die. The ready-stock prompt (`orders.matchStock`) sits under each length.
 */
export function DieBlockCard({
  block,
  index,
  count,
  unit,
  customerId,
  dieBands,
  showRates,
  problems,
  quotes,
  totals,
  focusKey,
  onFocused,
  onDie,
  onCopy,
  onShared,
  onRow,
  onAddRow,
  onAddBlock,
  onDuplicate,
  onRemoveRow,
  onRemoveBlock,
}: {
  block: DieBlock;
  index: number;
  count: number;
  unit: LengthUnit;
  customerId: string | null;
  dieBands: boolean;
  showRates: boolean;
  problems: BlockProblems | undefined;
  quotes: Map<string, RowQuote>;
  totals: Totals;
  focusKey: string | null;
  onFocused(): void;
  onDie(die: DieBlock["die"]): void;
  onCopy(copy: string): void;
  onShared(patch: Partial<Pick<LineDraft, "alloy" | "temper" | "finish" | "weightBasis" | "rate">>): void;
  onRow(key: string, patch: Partial<LineDraft>): void;
  onAddRow(afterKey: string): void;
  onAddBlock(): void;
  onDuplicate(key: string): void;
  onRemoveRow(key: string): void;
  onRemoveBlock(): void;
}) {
  const { t } = useT();
  const { choices } = useCopyChoices(block.die?.id ?? null);
  const first = block.rows[0]!;
  const shown = problems != null;
  // The die's alloy / temper defaults come with its quotes: keep the last ones for this die.
  const known = useRef<{ dieId: string; alloy: string | null; temper: string | null } | null>(null);
  for (const row of block.rows) {
    const q = quotes.get(row.key)?.data;
    if (q && block.die) known.current = { dieId: block.die.id, alloy: q.alloy ?? null, temper: q.temper ?? null };
  }
  const defaults = known.current && block.die && known.current.dieId === block.die.id ? known.current : null;
  const lines = blockLines(block);
  const firstQuoted = block.rows.find((r) => quotes.get(r.key)?.data)?.key;

  return (
    <Card data-die-block={index + 1}>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle>{t("orders.form.block.title", { n: index + 1 })}</CardTitle>
        {count > 1 ? (
          <Button variant="ghost" onClick={onRemoveBlock} aria-label={t("orders.form.block.remove", { n: index + 1 })}>
            <Trash2 aria-hidden="true" strokeWidth={2} />
            {t("common.remove")}
          </Button>
        ) : null}
      </CardHeader>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <DieField value={block.die} onChange={(die) => onDie(die)} error={shown && problems.die ? t("orders.form.errors.die") : undefined} />
        <Field label={t("orders.line.copy")}>
          <FieldSelect value={block.copy} onChange={(e) => onCopy(e.target.value)} disabled={!block.die}>
            {choices.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </FieldSelect>
        </Field>
      </div>

      <ol className="m-0 mt-3 flex list-none flex-col gap-3 p-0" aria-label={t("orders.form.block.lengths")}>
        {block.rows.map((row, i) => (
          <LengthRow
            key={row.key}
            row={row}
            line={lines[i]!}
            ordinal={i + 1}
            only={block.rows.length === 1}
            unit={unit}
            customerId={customerId}
            quote={quotes.get(row.key)}
            showBasis={row.key === firstQuoted}
            problems={shown ? problems.rows[row.key] : undefined}
            share={(() => {
              const bp = quotes.get(row.key)?.shareBp;
              return bp != null && bp > 0 ? bpPercent1(bp) : null;
            })()}
            focus={focusKey === row.key}
            onFocused={onFocused}
            onChange={(patch) => onRow(row.key, patch)}
            onEnter={(shift) => {
              if (!rowHasQty(row)) return;
              if (shift) onAddBlock();
              else onAddRow(row.key);
            }}
            onDuplicate={() => onDuplicate(row.key)}
            onRemove={() => onRemoveRow(row.key)}
          />
        ))}
      </ol>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <Button variant="secondary" data-add-length="" onClick={() => onAddRow(block.rows[block.rows.length - 1]!.key)}>
          {t("orders.form.block.addLength")}
        </Button>
        {totals.lines > 0 ? (
          <p data-block-total="" className="m-0 font-mono text-[14px] font-semibold tabular-nums" aria-live="polite">
            {t("orders.form.block.subtotal", { lines: totals.lines, pcs: pcsText(totals.pcs), kg: orderKgText(totals.kgG) })}
            {totals.pending ? ` ${t("orders.form.quoting")}` : ""}
          </p>
        ) : null}
      </div>
      <p className="m-0 mt-1 text-[13px] leading-5 text-muted-foreground">{t("orders.form.block.enterHint")}</p>

      <details className="mt-3 rounded-card border border-border px-3 py-2">
        <summary className="cursor-pointer text-[14px] font-medium">{t("orders.form.block.more")}</summary>
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label={t("orders.line.alloy")}>
            <TextInput value={first.alloy ?? defaults?.alloy ?? ""} onChangeText={(alloy) => onShared({ alloy })} autoComplete="off" />
          </Field>
          <Field label={t("orders.line.temper")}>
            <TextInput value={first.temper ?? defaults?.temper ?? ""} onChangeText={(temper) => onShared({ temper })} autoComplete="off" />
          </Field>
          <Field label={t("orders.line.finish")}>
            <FieldSelect value={first.finish} onChange={(e) => onShared({ finish: e.target.value as Finish })}>
              <option value="none">{t("orders.finish.none")}</option>
              <option value="anodise">{t("orders.finish.anodise")}</option>
              <option value="pvd">{t("orders.finish.pvd")}</option>
            </FieldSelect>
          </Field>
          {showRates ? (
            <Field label={t("orders.line.rate")}>
              <NumberInput value={first.rate} onValueChange={(rate) => onShared({ rate })} aria-label={t("orders.line.rate")} />
            </Field>
          ) : null}
        </div>
        {dieBands ? (
          <div className="mt-3">
            <SegmentedControl<WeightBasis>
              label={t("orders.form.weightBasis")}
              value={first.weightBasis}
              onChange={(weightBasis) => onShared({ weightBasis })}
              options={[
                { value: "copy_current", label: t("orders.form.basisCurrent") },
                { value: "band_start", label: t("orders.form.basisBandStart") },
              ]}
            />
          </div>
        ) : null}
      </details>
    </Card>
  );
}

function LengthRow({
  row,
  line,
  ordinal,
  only,
  unit,
  customerId,
  quote,
  showBasis,
  problems,
  share,
  focus,
  onFocused,
  onChange,
  onEnter,
  onDuplicate,
  onRemove,
}: {
  row: LineDraft;
  /** The row with the block's die and copy, as it is quoted and saved. */
  line: LineDraft;
  ordinal: number;
  only: boolean;
  unit: LengthUnit;
  customerId: string | null;
  quote: RowQuote | undefined;
  showBasis: boolean;
  problems: { length?: MessageKey; qty?: MessageKey } | undefined;
  share: string | null;
  focus: boolean;
  onFocused(): void;
  onChange(patch: Partial<LineDraft>): void;
  onEnter(shift: boolean): void;
  onDuplicate(): void;
  onRemove(): void;
}) {
  const { t } = useT();
  const [stockOpen, setStockOpen] = useState(false);
  const lengthRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (focus) {
      lengthRef.current?.focus();
      onFocused();
    }
  }, [focus, onFocused]);
  const mm = cutLengthMm(line, unit);
  const q = quote?.data;
  const quoting = quote?.quoting ?? false;

  const stock = useQuery({
    ...trpc.orders.matchStock.queryOptions({
      sectionId: line.die?.id ?? "",
      ...(mm != null ? { cutLengthMm: mm } : {}),
      ...(customerId ? { customerId } : {}),
    }),
    enabled: line.die != null,
    staleTime: 15_000,
  });

  const pcsValue = row.basis === "pcs" ? row.pcsText : q && row.basis === "kg" ? String(q.pcs) : "";
  const kgValue = row.basis === "kg" ? row.kgText : q && row.basis === "pcs" ? kgFieldText(q.kgG) : "";
  const bestPcs = q?.pcs ?? null;
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    onEnter(e.shiftKey);
  };

  return (
    <li data-length-row={ordinal} className="flex min-w-0 flex-col gap-3 rounded-card border border-border bg-surface-sunken/40 p-3" aria-busy={quoting || undefined}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="m-0 text-[14px] font-semibold">{t("orders.form.block.lengthN", { n: ordinal })}</p>
        <div className="flex flex-wrap gap-1">
          <Button variant="ghost" onClick={onDuplicate} aria-label={t("orders.form.block.copyLength", { n: ordinal })}>
            <Copy aria-hidden="true" strokeWidth={2} />
            {t("orders.form.block.copy")}
          </Button>
          {!only ? (
            <Button variant="ghost" onClick={onRemove} aria-label={t("orders.form.block.removeLength", { n: ordinal })}>
              <Trash2 aria-hidden="true" strokeWidth={2} />
              {t("common.remove")}
            </Button>
          ) : null}
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Field
          label={t("orders.line.cutLength")}
          error={problems?.length ? t(problems.length) : undefined}
          hint={unit === "inch" ? t("orders.form.lengthHintInch") : t("orders.form.lengthHintMm")}
        >
          {unit === "inch" ? (
            <div className="flex min-w-0 flex-wrap gap-2">
              <div className="min-w-[7rem] flex-1">
                <NumberInput
                  ref={lengthRef}
                  value={row.feet}
                  onValueChange={(feet) => onChange({ feet })}
                  suffix={t("units.ft")}
                  decimal={false}
                  aria-label={t("orders.form.feet")}
                />
              </div>
              <div className="min-w-[7rem] flex-1">
                <NumberInput value={row.inches} onValueChange={(inches) => onChange({ inches })} suffix={t("units.inch")} aria-label={t("orders.form.inches")} />
              </div>
            </div>
          ) : (
            <NumberInput ref={lengthRef} value={row.mm} onValueChange={(v) => onChange({ mm: v })} suffix={t("units.mm")} decimal={false} aria-label={t("orders.line.cutLength")} />
          )}
        </Field>
        {unit === "inch" ? (
          <div role="group" aria-label={t("orders.form.quickLengths")} className="flex flex-wrap items-end gap-2">
            {QUICK_FEET.map((ft) => {
              const on = row.feet === String(ft) && row.inches.trim() === "";
              return (
                <Button
                  key={ft}
                  variant="secondary"
                  aria-pressed={on}
                  className={on ? "ring-2 ring-foreground" : undefined}
                  onClick={() => onChange({ feet: String(ft), inches: "" })}
                >
                  {ft} {t("units.ft")}
                </Button>
              );
            })}
          </div>
        ) : null}

        <Field label={t("orders.line.pcs")} error={problems?.qty ? t(problems.qty) : undefined}>
          <NumberInput
            value={pcsValue}
            onValueChange={(text) => onChange({ pcsText: text, basis: text.trim() === "" ? (row.basis === "pcs" ? null : row.basis) : "pcs" })}
            onKeyDown={onKey}
            suffix={t("units.pcs")}
            decimal={false}
            aria-label={t("orders.line.pcs")}
          />
        </Field>
        <Field label={t("orders.line.kg")}>
          <NumberInput
            value={kgValue}
            onValueChange={(text) => onChange({ kgText: text, basis: text.trim() === "" ? (row.basis === "kg" ? null : row.basis) : "kg" })}
            onKeyDown={onKey}
            suffix={t("units.kg")}
            aria-label={t("orders.line.kg")}
          />
        </Field>
      </div>

      <div className="flex min-w-0 flex-col gap-2">
        {quoting ? (
          <p role="status" data-quote-pending="" className="m-0 text-[14px] leading-5 text-muted-foreground">
            {t("orders.form.quoting")}
          </p>
        ) : q ? (
          <div className="flex min-w-0 flex-col gap-2" data-quote="">
            {showBasis ? (
              <p className="m-0 text-[14px] leading-5 text-muted-foreground">
                {q.locked
                  ? t("orders.form.basisLocked", { milli: milliText(q.basisMilli) })
                  : q.weightBasis === "copy_current"
                    ? t("orders.form.basisUsingCopy", { milli: milliText(q.basisMilli), copy: q.copyCode ?? "" })
                    : t("orders.form.basisUsingBand", { milli: milliText(q.basisMilli) })}
                {!q.locked && q.weightBasis === "band_start" && q.copyMilli == null ? ` ${t("orders.form.noReading")}` : ""}
              </p>
            ) : null}
            {row.basis === "kg" ? (
              <>
                <p className="m-0 text-[14px] leading-5">{t("orders.form.impliedLine", { pcs: pcsText(q.pcs), implied: orderKgText(q.impliedG), kg: orderKgText(q.kgG) })}</p>
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" disabled={bestPcs == null || bestPcs <= 1} onClick={() => bestPcs != null && onChange({ basis: "pcs", pcsText: String(bestPcs - 1) })}>
                    {t("orders.form.minusPiece")}
                  </Button>
                  <Button variant="secondary" onClick={() => bestPcs != null && onChange({ basis: "pcs", pcsText: String(bestPcs + 1) })}>
                    {t("orders.form.plusPiece")}
                  </Button>
                </div>
              </>
            ) : (
              <p className="m-0 text-[14px] leading-5">{t("orders.form.quoteLine", { pcs: pcsText(q.pcs), kg: orderKgText(q.kgG) })}</p>
            )}
            {share ? (
              <p data-share="" className="m-0 text-[13px] leading-5 text-muted-foreground">
                {t("orders.form.block.share", { pct: share })}
              </p>
            ) : null}
          </div>
        ) : quote?.failed ? (
          <p role="alert" className="m-0 text-[14px] leading-5 text-destructive">
            {t("orders.form.quoteFailed")}
          </p>
        ) : null}

        {line.die ? (
          <div className="flex min-w-0 flex-col items-start gap-2 rounded-card border border-border bg-surface-sunken px-3 py-3">
            <p className="m-0 text-[14px] leading-5" data-stock-prompt="">
              {stock.data && stock.data.readyBundles > 0
                ? t("orders.stock.prompt", { count: stock.data.readyBundles, kg: orderKgText(stock.data.readyG) })
                : t("orders.stock.promptNone")}
            </p>
            <Button variant="secondary" onClick={() => setStockOpen(true)}>
              <Boxes aria-hidden="true" strokeWidth={2} />
              {t("orders.stock.open")}
            </Button>
          </div>
        ) : null}
      </div>
      <StockSheet
        open={stockOpen}
        onOpenChange={setStockOpen}
        items={stock.data?.items}
        loading={stock.isPending && line.die != null}
        failed={stock.isError}
        formatLength={(v) => formatLengthMm(v, unit)}
      />
    </li>
  );
}

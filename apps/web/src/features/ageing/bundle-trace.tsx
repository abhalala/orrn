import { useT } from "@orrn/i18n";
import { Chip } from "@orrn/ui/components/chip";
import { UiLink } from "@orrn/ui/components/link";
import { useQuery } from "@tanstack/react-query";

import { useCompanyWhen } from "@/features/stock/use-company-when";
import { can, useMe } from "@/shared/lib/me";
import { INLINE_ERROR_META } from "@/shared/lib/query-errors";
import { trpc } from "@/shared/utils/trpc";

import { mapSentence } from "@/features/shared/server-refusal";
import type { Translate } from "@orrn/i18n";

import "./hooks";
import { x10Text } from "./model";

const TONE = { aged: "green", in_ageing: "amber", held: "red", not_aged: "neutral" } as const;

/**
 * The bundle page's ageing line (FP-AG-13): "Aged" with the batch, trolley, oven, recipe, times and
 * hardness it passed, linking to the batch for people who may read ageing. A bundle that never met
 * a trolley says "Not aged" and nothing else. Read from `ageing.bundleTrace` (any member).
 */
export function BundleAgeing({ bundleId }: { bundleId: string }) {
  const { t } = useT();
  const when = useCompanyWhen();
  const { data: me } = useMe();
  const trace = useQuery({ ...trpc.ageing.bundleTrace.queryOptions({ bundleId }), staleTime: 30_000, meta: INLINE_ERROR_META });
  const d = trace.data;
  if (!d) return null;
  const mayOpen = can(me, "ageing.view");
  const facts: [string, string][] = [];
  if (d.trolleyCode) facts.push([t("ageing.field.trolley"), d.trolleyCode]);
  if (d.ovenCode) facts.push([t("ageing.field.oven"), d.ovenCode]);
  if (d.recipeLabel) facts.push([t("ageing.field.recipe"), d.recipeLabel]);
  if (d.inAt) facts.push([t("ageing.field.inAt"), when(d.inAt)]);
  if (d.outAt) facts.push([t("ageing.field.outAt"), when(d.outAt)]);
  if (d.releasedAt) facts.push([t("ageing.trace.released"), when(d.releasedAt)]);
  if (d.hardnessReadingX10 !== null) facts.push([t("ageing.field.hardness"), `${x10Text(d.hardnessReadingX10)} ${d.hardnessMethod ? t(`ageing.method.${d.hardnessMethod}`) : ""}`]);
  if (d.castCode) facts.push([t("ageing.field.cast"), d.castCode]);
  return (
    <section aria-labelledby="bundle-ageing" data-testid="bundle-ageing" data-state={d.state} className="flex min-w-0 flex-col gap-3 rounded-card border border-border bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="bundle-ageing" className="m-0 text-[17px] font-semibold">
          {t("ageing.trace.title")}
        </h2>
        <Chip tone={TONE[d.state]} truncate={false} data-testid="aged-badge">
          {t(`ageing.bundleState.${d.state}`)}
        </Chip>
      </div>
      {d.batchNumber ? (
        <p className="m-0 text-[15px]">
          {mayOpen && d.batchId ? (
            <UiLink to={`/ageing/batch/${d.batchId}`} className="font-mono font-semibold" data-testid="aged-batch-link">
              {d.batchNumber}
            </UiLink>
          ) : (
            <span className="font-mono font-semibold">{d.batchNumber}</span>
          )}{" "}
          {d.pressRunNumber && d.pressRunId ? <span className="text-muted-foreground">· {d.pressRunNumber}</span> : null}
        </p>
      ) : (
        <p className="m-0 text-[14px] text-muted-foreground">{t("ageing.trace.none")}</p>
      )}
      {facts.length > 0 ? (
        <dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-3 md:grid-cols-4">
          {facts.map(([label, value]) => (
            <div key={label} className="flex min-w-0 flex-col gap-0.5">
              <dt className="text-[13px] font-medium text-muted-foreground">{label}</dt>
              <dd className="m-0 text-[15px] font-semibold break-words">{value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </section>
  );
}

/**
 * What voiding a bundle packed from a trolley line does (Q60-A): while the line's batch is open the pieces go
 * back to the line; once the batch is closed they are written off as loose aged stock and nothing goes back.
 * Says nothing for a bundle that never came off a trolley line (or the reader cannot see the batch).
 */
export function BundleVoidNote({ bundleId, enabled }: { bundleId: string; enabled: boolean }) {
  const { t } = useT();
  const trace = useQuery({ ...trpc.ageing.bundleTrace.queryOptions({ bundleId }), enabled, staleTime: 15_000, meta: INLINE_ERROR_META });
  const batchId = trace.data?.batchId ?? null;
  const batch = useQuery({ ...trpc.ageing.batches.get.queryOptions({ id: batchId ?? "" }), enabled: enabled && batchId !== null, staleTime: 15_000, meta: INLINE_ERROR_META });
  const rowId = trace.data?.ageingRowId ?? null;
  const row = batch.data?.rows.find((r) => r.id === rowId);
  // A whole-bundle row is the bundle itself: nothing is drawn from it and nothing goes back.
  if (!batch.data || !row || row.source === "bundle") return null;
  const closed = batch.data.status === "closed";
  if (!closed && batch.data.status !== "released" && batch.data.status !== "held") return null;
  return (
    <p data-testid="void-ageing-note" data-outcome={closed ? "write_off" : "returns"} className="m-0 rounded-card bg-tone-amber-tint px-3.5 py-3 text-[14px] leading-5 font-medium text-tone-amber-ink">
      {closed ? t("ageing.trace.voidWritesOff", { batch: batch.data.number }) : t("ageing.trace.voidReturns", { batch: batch.data.number })}
    </p>
  );
}

/** An ageing refusal of a restore (the line is no longer released, fewer pieces left) said in the person's language, or null for anything else. */
export function ageingRefusalText(t: Translate, error: unknown): string | null {
  const message = error && typeof error === "object" ? (error as { message?: unknown }).message : null;
  if (typeof message !== "string") return null;
  const hit = mapSentence(message, t);
  return hit && String(hit.key).startsWith("ageing.refusal.") ? t(hit.key, hit.vars) : null;
}

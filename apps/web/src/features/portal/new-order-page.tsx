import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Card, CardHeader, CardTitle } from "@orrn/ui/components/card";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Field, NumberInput, TextInput } from "@orrn/ui/components/field";
import { FormActions } from "@orrn/ui/components/form-actions";
import { NativeSelect } from "@orrn/ui/components/native-select";
import { PageHeader } from "@orrn/ui/components/page-header";
import { SegmentedControl } from "@orrn/ui/components/segmented-control";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { useRef, useState } from "react";

import { FieldTextArea } from "@/features/catalog/field-text-area";
import { RouterLink } from "@/shared/components/router-link";
import { trpc, trpcClient } from "@/shared/utils/trpc";

import { usePortalMe } from "./hooks";
import {
  newPortalLine,
  PORTAL_MAX_LINES,
  portalOrderErrorKey,
  portalLineProblems,
  portalOrderBody,
  requestIdFor,
  sectionTitle,
  type PortalLineDraft,
} from "./model";
import { PortalError, PortalSkeleton } from "./ui";

let lineSeq = 0;
const lineKey = () => `line-${(lineSeq += 1)}`;

/**
 * `/portal/orders/new`: a booking. Each line names a die the plant opened for the party, a cut
 * length and pieces OR kg. The plant picks the die copy and sets the rate; the office confirms.
 */
export function PortalNewOrderPage() {
  const { t } = useT();
  const queryClient = useQueryClient();
  const me = usePortalMe();
  const sections = useQuery({ ...trpc.portal.sections.visible.queryOptions(), retry: false });
  const unit = me.data?.lengthUnit ?? "mm";

  const [po, setPo] = useState("");
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<PortalLineDraft[]>(() => [newPortalLine(lineKey())]);
  const [tried, setTried] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A retry after an unsure answer sends the same request id; an edited form gets a new one.
  const sent = useRef<{ id: string; body: string } | null>(null);

  const create = useMutation({
    mutationFn: (input: Parameters<typeof trpcClient.portal.orders.create.mutate>[0]) => trpcClient.portal.orders.create.mutate(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: trpc.portal.orders.list.queryKey() });
      await queryClient.invalidateQueries({ queryKey: trpc.portal.today.queryKey() });
    },
    onError: (e) => setError(t(portalOrderErrorKey(e))),
  });

  const back = { to: "/portal/orders", label: t("portal.orders.title") };

  if (create.isSuccess) {
    return (
      <>
        <PageHeader title={t("portal.orders.new")} back={back} />
        <div role="status" data-testid="portal-booked" className="flex flex-col gap-4 rounded-card border border-border bg-card p-5">
          <h2 className="m-0 font-display text-[24px] font-bold tracking-[-0.03em]">{t("portal.orders.confirmation")}</h2>
          <p className="m-0 text-[15px] leading-6">
            {t("portal.orders.placed", { number: create.data.number })}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button asChild>
              <RouterLink to={`/portal/orders/${create.data.id}`}>{t("portal.orders.viewOrder")}</RouterLink>
            </Button>
            <Button asChild variant="secondary">
              <RouterLink to="/portal">{t("portal.nav.today")}</RouterLink>
            </Button>
          </div>
        </div>
      </>
    );
  }

  if (sections.isError) {
    return (
      <>
        <PageHeader title={t("portal.orders.new")} back={back} />
        <PortalError error={sections.error} onRetry={() => void sections.refetch()} />
      </>
    );
  }
  if (!sections.data || !me.data) {
    return (
      <>
        <PageHeader title={t("portal.orders.new")} back={back} />
        <PortalSkeleton />
      </>
    );
  }
  if (sections.data.length === 0) {
    return (
      <>
        <PageHeader title={t("portal.orders.new")} back={back} />
        <div className="rounded-card border border-border bg-card">
          <EmptyState title={t("portal.dies.empty")} />
        </div>
      </>
    );
  }

  const patch = (key: string, p: Partial<PortalLineDraft>) => setLines((cur) => cur.map((l) => (l.key === key ? { ...l, ...p } : l)));
  const problems = Object.fromEntries(lines.map((l) => [l.key, portalLineProblems(l, unit)]));

  function submit() {
    setTried(true);
    setError(null);
    const body = portalOrderBody({ po, note, lines }, unit);
    if (!body) return;
    sent.current = requestIdFor(sent.current, body, () => crypto.randomUUID());
    create.mutate({ ...body, clientRequestId: sent.current.id });
  }

  return (
    <>
      <PageHeader title={t("portal.orders.new")} subtitle={t("portal.orders.newSubtitle")} back={back} />
      <section className="flex min-w-0 flex-col gap-3 rounded-card border border-border bg-card p-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label={t("portal.orders.poNumber")} hint={t("portal.orders.poHint")}>
            <TextInput value={po} onChangeText={setPo} autoComplete="off" maxLength={100} />
          </Field>
          <Field label={t("portal.orders.note")}>
            <FieldTextArea value={note} onChangeText={setNote} rows={2} maxLength={1000} />
          </Field>
        </div>
      </section>

      {lines.map((line, i) => {
        const p = tried ? problems[line.key]! : {};
        return (
          <Card key={line.key} data-line={i + 1}>
            <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
              <CardTitle>{t("portal.orders.lineNo", { n: i + 1 })}</CardTitle>
              {lines.length > 1 ? (
                <Button variant="ghost" onClick={() => setLines((cur) => cur.filter((l) => l.key !== line.key))} aria-label={`${t("portal.orders.removeLine")} ${i + 1}`}>
                  <Trash2 aria-hidden="true" strokeWidth={2} />
                  {t("portal.orders.removeLine")}
                </Button>
              ) : null}
            </CardHeader>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <Field id={`portal-die-${line.key}`} label={t("portal.orders.section")} error={p.section ? t(p.section) : undefined}>
                <NativeSelect id={`portal-die-${line.key}`} value={line.sectionId} onChange={(e) => patch(line.key, { sectionId: e.target.value })}>
                  <option value="">{t("portal.orders.pickSection")}</option>
                  {sections.data.map((s) => (
                    <option key={s.id} value={s.id}>
                      {sectionTitle(s)}
                      {s.name ? ` · ${s.name}` : ""}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label={t("portal.orders.cutLength")} error={p.length ? t(p.length) : undefined} hint={unit === "inch" ? t("portal.orders.lengthHintInch") : t("portal.orders.lengthHintMm")}>
                {unit === "inch" ? (
                  <div className="flex min-w-0 flex-wrap gap-2">
                    <div className="min-w-[7rem] flex-1">
                      <NumberInput value={line.feet} onValueChange={(feet) => patch(line.key, { feet })} suffix={t("units.ft")} decimal={false} aria-label={t("portal.orders.feet")} />
                    </div>
                    <div className="min-w-[7rem] flex-1">
                      <NumberInput value={line.inches} onValueChange={(inches) => patch(line.key, { inches })} suffix={t("units.inch")} aria-label={t("portal.orders.inches")} />
                    </div>
                  </div>
                ) : (
                  <NumberInput value={line.mm} onValueChange={(mm) => patch(line.key, { mm })} suffix={t("units.mm")} decimal={false} aria-label={t("portal.orders.cutLength")} />
                )}
              </Field>
              <div className="flex min-w-0 flex-col gap-2 md:col-span-2">
                <SegmentedControl<"pcs" | "kg">
                  label={t("portal.orders.piecesOrKg")}
                  value={line.basis}
                  onChange={(basis) => patch(line.key, { basis, qty: "" })}
                  options={[
                    { value: "pcs", label: t("portal.orders.pieces") },
                    { value: "kg", label: t("portal.orders.kg") },
                  ]}
                />
                <Field label={line.basis === "pcs" ? t("portal.orders.pieces") : t("portal.orders.kg")} error={p.qty ? t(p.qty) : undefined}>
                  <NumberInput
                    value={line.qty}
                    onValueChange={(qty) => patch(line.key, { qty })}
                    suffix={line.basis === "pcs" ? t("units.pcs") : t("units.kg")}
                    decimal={line.basis === "kg"}
                    aria-label={line.basis === "pcs" ? t("portal.orders.pieces") : t("portal.orders.kg")}
                  />
                </Field>
              </div>
              <div className="md:col-span-2">
                <Field label={t("portal.orders.lineNote")}>
                  <TextInput value={line.note} onChangeText={(v) => patch(line.key, { note: v })} maxLength={500} autoComplete="off" />
                </Field>
              </div>
            </div>
          </Card>
        );
      })}

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" disabled={lines.length >= PORTAL_MAX_LINES} onClick={() => setLines((cur) => [...cur, newPortalLine(lineKey())])}>
          <Plus aria-hidden="true" strokeWidth={2} />
          {t("portal.orders.addLine")}
        </Button>
        {lines.length >= PORTAL_MAX_LINES ? <span className="text-[13px] text-muted-foreground">{t("portal.orders.maxLines", { count: PORTAL_MAX_LINES })}</span> : null}
      </div>

      <p className="m-0 text-[13px] leading-5 text-muted-foreground">{t("portal.orders.noRate")}</p>

      {error ? (
        <div role="alert" className="rounded-card border border-destructive/40 px-3 py-3 text-[14px] font-medium text-destructive">
          {error}
        </div>
      ) : null}

      <FormActions sticky={false}>
        <Button onClick={submit} loading={create.isPending} disabled={create.isPending}>
          {t("portal.orders.submit")}
        </Button>
      </FormActions>
    </>
  );
}

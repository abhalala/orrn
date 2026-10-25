import { SPECTRO_ELEMENTS, type SpectroLimit } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Field, NumberInput, TextInput } from "@orrn/ui/components/field";
import { PageHeader } from "@orrn/ui/components/page-header";
import { ResponsiveList, type ResponsiveListColumn } from "@orrn/ui/components/responsive-list";
import { Sheet } from "@orrn/ui/components/sheet";
import type { AppRouter } from "@orrn/server/routers/index";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import { useState } from "react";
import { toast } from "sonner";

import { FieldTextArea } from "@/features/catalog/field-text-area";
import { kgFromG } from "@/features/press/model";
import { Can } from "@/shared/components/can";
import { INLINE_ERROR_META, showsQueryError } from "@/shared/lib/query-errors";
import { trpc } from "@/shared/utils/trpc";

import { ELEMENT_LABEL, furnaceInput, limitDraft, limitRows, limitText, type LimitDraft } from "./model";
import { ErrorLine, LoadFailed, Note } from "./ui";

type Furnace = inferRouterOutputs<AppRouter>["foundry"]["furnaces"]["list"]["items"][number];
type AlloyRow = inferRouterOutputs<AppRouter>["foundry"]["alloys"]["list"]["items"][number];

const STATUS_TONE = { active: "green", retired: "neutral" } as const;

// --- Furnaces ----------------------------------------------------------------------------------------------------

/** `/masters/furnaces` (FP-FD-01): code, name, capacity and billet diameter. Capacity is a limit the lock enforces. */
export function FurnacesPage() {
  const { t } = useT();
  const queryClient = useQueryClient();
  const query = useQuery({ ...trpc.foundry.furnaces.list.queryOptions(), meta: INLINE_ERROR_META });
  const [editing, setEditing] = useState<Furnace | "new" | null>(null);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: trpc.foundry.furnaces.pathKey() });
  const seed = useMutation(trpc.foundry.furnaces.seedDefaults.mutationOptions({ onSuccess: () => { toast.success(t("foundry.masters.seeded")); refresh(); } }));
  const header = (
    <PageHeader
      title={t("foundry.masters.furnaces")}
      subtitle={t("foundry.masters.furnacesSubtitle")}
      back={{ to: "/masters", label: t("nav.masters") }}
      actions={
        <Can do="masters.publish">
          <Button onClick={() => setEditing("new")} data-testid="add-furnace">{t("foundry.masters.addFurnace")}</Button>
        </Can>
      }
    />
  );
  if (showsQueryError(query)) return <>{header}<LoadFailed title={t("foundry.masters.loadFailed")} onRetry={() => void query.refetch()} /></>;
  const columns: ResponsiveListColumn<Furnace>[] = [
    { key: "code", header: t("foundry.masters.code"), cell: (f) => <span className="font-mono text-[16px] font-bold">{f.code}</span> },
    { key: "name", header: t("foundry.masters.name"), cell: (f) => f.name },
    { key: "cap", header: t("foundry.masters.capacity"), align: "end", cell: (f) => <span className="tabular-nums">{kgFromG(f.capacityG)} {t("units.kg")}</span> },
    { key: "dia", header: t("foundry.masters.billetDia"), align: "end", cell: (f) => <span className="tabular-nums">{f.billetDiaMm ? `${f.billetDiaMm} ${t("units.mm")}` : "-"}</span> },
    { key: "status", header: t("foundry.masters.status"), phoneWide: true, cell: (f) => <Chip tone={STATUS_TONE[f.status]}>{t(`foundry.masters.state.${f.status}`)}</Chip> },
    {
      key: "edit",
      header: t("foundry.masters.edit"),
      headerHidden: true,
      cell: (f) => (
        <Can do="masters.publish">
          <Button size="sm" variant="secondary" onClick={() => setEditing(f)} data-testid="edit-furnace">{t("foundry.masters.edit")}</Button>
        </Can>
      ),
    },
  ];
  return (
    <>
      {header}
      <ResponsiveList
        rows={query.data?.items ?? []}
        columns={columns}
        rowKey={(f) => f.id}
        loading={query.isLoading}
        label={t("foundry.masters.furnaces")}
        empty={
          <EmptyState
            title={t("foundry.masters.noFurnace")}
            description={t("foundry.masters.noFurnaceBody")}
            action={
              <Can do="masters.publish">
                <Button variant="secondary" loading={seed.isPending} onClick={() => seed.mutate()} data-testid="seed-furnace">{t("foundry.masters.seedFurnace")}</Button>
              </Can>
            }
          />
        }
      />
      <ErrorLine error={seed.error} />
      <FurnaceSheet editing={editing} onClose={() => setEditing(null)} onSaved={refresh} />
    </>
  );
}

function FurnaceSheet({ editing, onClose, onSaved }: { editing: Furnace | "new" | null; onClose(): void; onSaved(): void }) {
  const { t } = useT();
  const row = editing && editing !== "new" ? editing : null;
  const [form, setForm] = useState({ code: "", name: "", capacityKg: "", billetDiaMm: "" });
  const [seeded, setSeeded] = useState<string | null>(null);
  const key = editing === null ? null : row ? row.id : "new";
  if (seeded !== key) {
    setSeeded(key);
    setForm(row ? { code: row.code, name: row.name, capacityKg: String(row.capacityG / 1000), billetDiaMm: row.billetDiaMm ? String(row.billetDiaMm) : "" } : { code: "", name: "", capacityKg: "6000", billetDiaMm: "127" });
  }
  const [tried, setTried] = useState(false);
  const create = useMutation(trpc.foundry.furnaces.create.mutationOptions({ onSuccess: () => finish() }));
  const update = useMutation(trpc.foundry.furnaces.update.mutationOptions({ onSuccess: () => finish() }));
  const finish = () => {
    toast.success(t("foundry.masters.saved"));
    onSaved();
    close();
  };
  const close = () => {
    setTried(false);
    create.reset();
    update.reset();
    onClose();
  };
  const parsed = furnaceInput(form);
  const err = tried && !parsed.ok ? parsed.field : null;
  return (
    <Sheet
      open={editing !== null}
      onOpenChange={(o) => (o ? undefined : close())}
      title={row ? t("foundry.masters.editFurnace", { code: row.code }) : t("foundry.masters.addFurnace")}
      footer={
        <>
          <Button variant="secondary" size="lg" onClick={close}>{t("common.cancel")}</Button>
          <Button
            size="lg"
            loading={create.isPending || update.isPending}
            data-testid="furnace-save"
            onClick={() => {
              setTried(true);
              if (!parsed.ok) return;
              if (row) update.mutate({ id: row.id, name: parsed.name, capacityG: parsed.capacityG, billetDiaMm: parsed.billetDiaMm });
              else create.mutate({ code: parsed.code, name: parsed.name, capacityG: parsed.capacityG, billetDiaMm: parsed.billetDiaMm });
            }}
          >
            {t("common.save")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 pt-1">
        {!row ? (
          <Field label={t("foundry.masters.code")} error={err === "code" ? t("foundry.masters.codeInvalid") : undefined}>
            <TextInput value={form.code} maxLength={12} autoCapitalize="characters" onChange={(e) => setForm({ ...form, code: e.currentTarget.value })} data-testid="furnace-code" />
          </Field>
        ) : null}
        <Field label={t("foundry.masters.name")} error={err === "name" ? t("foundry.masters.nameRequired") : undefined}>
          <TextInput value={form.name} maxLength={60} onChange={(e) => setForm({ ...form, name: e.currentTarget.value })} data-testid="furnace-name" />
        </Field>
        <Field label={t("foundry.masters.capacityKg")} hint={t("foundry.masters.capacityHint")} error={err === "capacity" ? t("foundry.masters.capacityInvalid") : undefined}>
          <NumberInput value={form.capacityKg} suffix={t("units.kg")} onValueChange={(v) => setForm({ ...form, capacityKg: v })} data-testid="furnace-capacity" />
        </Field>
        <Field label={t("foundry.masters.billetDia")} error={err === "dia" ? t("foundry.masters.diaInvalid") : undefined}>
          <NumberInput decimal={false} value={form.billetDiaMm} suffix={t("units.mm")} onValueChange={(v) => setForm({ ...form, billetDiaMm: v })} data-testid="furnace-dia" />
        </Field>
        {row ? (
          <div>
            <Button
              type="button"
              variant="secondary"
              loading={update.isPending}
              data-testid="furnace-toggle"
              onClick={() => update.mutate({ id: row.id, status: row.status === "active" ? "retired" : "active" })}
            >
              {row.status === "active" ? t("foundry.masters.retire") : t("foundry.masters.reactivate")}
            </Button>
          </div>
        ) : null}
        <ErrorLine error={create.error ?? update.error} />
      </div>
    </Sheet>
  );
}

// --- Alloys ------------------------------------------------------------------------------------------------------

/** `/masters/alloys` (FP-FD-09): alloys and their element limits, percent on the screen, ppm stored. */
export function AlloysPage() {
  const { t } = useT();
  const queryClient = useQueryClient();
  const query = useQuery({ ...trpc.foundry.alloys.list.queryOptions(), meta: INLINE_ERROR_META });
  const [editing, setEditing] = useState<AlloyRow | "new" | null>(null);
  const [limits, setLimits] = useState<AlloyRow | null>(null);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: trpc.foundry.alloys.pathKey() });
  const seed = useMutation(trpc.foundry.alloys.seedDefaults.mutationOptions({ onSuccess: () => { toast.success(t("foundry.masters.seeded")); refresh(); } }));
  const header = (
    <PageHeader
      title={t("foundry.masters.alloys")}
      subtitle={t("foundry.masters.alloysSubtitle")}
      back={{ to: "/masters", label: t("nav.masters") }}
      actions={
        <Can do="masters.publish">
          <Button onClick={() => setEditing("new")} data-testid="add-alloy">{t("foundry.masters.addAlloy")}</Button>
        </Can>
      }
    />
  );
  if (showsQueryError(query)) return <>{header}<LoadFailed title={t("foundry.masters.loadFailed")} onRetry={() => void query.refetch()} /></>;
  const words = { max: t("foundry.spectro.max"), min: t("foundry.spectro.min"), to: t("foundry.spectro.to") };
  const columns: ResponsiveListColumn<AlloyRow>[] = [
    { key: "code", header: t("foundry.masters.code"), cell: (a) => <span className="font-mono text-[16px] font-bold">{a.code}</span> },
    { key: "name", header: t("foundry.masters.name"), cell: (a) => <span className="break-words">{a.name}</span> },
    {
      key: "limits",
      header: t("foundry.masters.limits"),
      cell: (a) =>
        a.limits.length === 0 ? (
          <span className="text-muted-foreground">{t("foundry.masters.noLimits")}</span>
        ) : (
          <span className="font-mono text-[13px] tabular-nums break-words">
            {a.limits.map((l) => `${ELEMENT_LABEL[l.element]} ${limitText(l as SpectroLimit, words)}`).join(" · ")}
          </span>
        ),
    },
    { key: "status", header: t("foundry.masters.status"), phoneWide: true, cell: (a) => <Chip tone={STATUS_TONE[a.status]}>{t(`foundry.masters.state.${a.status}`)}</Chip> },
    {
      key: "edit",
      header: t("foundry.masters.edit"),
      headerHidden: true,
      cell: (a) => (
        <Can do="masters.publish">
          <span className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => setLimits(a)} data-testid="edit-limits">{t("foundry.masters.editLimits")}</Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(a)} data-testid="edit-alloy">{t("foundry.masters.edit")}</Button>
          </span>
        </Can>
      ),
    },
  ];
  return (
    <>
      {header}
      <ResponsiveList
        rows={query.data?.items ?? []}
        columns={columns}
        rowKey={(a) => a.id}
        loading={query.isLoading}
        label={t("foundry.masters.alloys")}
        empty={
          <EmptyState
            title={t("foundry.masters.noAlloy")}
            description={t("foundry.masters.noAlloyBody")}
            action={
              <Can do="masters.publish">
                <Button variant="secondary" loading={seed.isPending} onClick={() => seed.mutate()} data-testid="seed-alloy">{t("foundry.masters.seedAlloy")}</Button>
              </Can>
            }
          />
        }
      />
      <ErrorLine error={seed.error} />
      <AlloySheet editing={editing} onClose={() => setEditing(null)} onSaved={refresh} />
      <LimitsSheet alloy={limits} onClose={() => setLimits(null)} onSaved={refresh} />
    </>
  );
}

function AlloySheet({ editing, onClose, onSaved }: { editing: AlloyRow | "new" | null; onClose(): void; onSaved(): void }) {
  const { t } = useT();
  const row = editing && editing !== "new" ? editing : null;
  const [form, setForm] = useState({ code: "", name: "", note: "" });
  const [seeded, setSeeded] = useState<string | null>(null);
  const key = editing === null ? null : row ? row.id : "new";
  if (seeded !== key) {
    setSeeded(key);
    setForm(row ? { code: row.code, name: row.name, note: row.note ?? "" } : { code: "", name: "", note: "" });
  }
  const [tried, setTried] = useState(false);
  const finish = () => {
    toast.success(t("foundry.masters.saved"));
    onSaved();
    close();
  };
  const create = useMutation(trpc.foundry.alloys.create.mutationOptions({ onSuccess: finish }));
  const update = useMutation(trpc.foundry.alloys.update.mutationOptions({ onSuccess: finish }));
  const close = () => {
    setTried(false);
    create.reset();
    update.reset();
    onClose();
  };
  const code = form.code.trim().toUpperCase();
  const codeBad = !row && !/^[A-Z0-9-]{1,12}$/.test(code);
  const nameBad = form.name.trim() === "";
  return (
    <Sheet
      open={editing !== null}
      onOpenChange={(o) => (o ? undefined : close())}
      title={row ? t("foundry.masters.editAlloy", { code: row.code }) : t("foundry.masters.addAlloy")}
      footer={
        <>
          <Button variant="secondary" size="lg" onClick={close}>{t("common.cancel")}</Button>
          <Button
            size="lg"
            loading={create.isPending || update.isPending}
            data-testid="alloy-save"
            onClick={() => {
              setTried(true);
              if (codeBad || nameBad) return;
              if (row) update.mutate({ id: row.id, name: form.name.trim(), note: form.note.trim() || null });
              else create.mutate({ code, name: form.name.trim(), ...(form.note.trim() ? { note: form.note.trim() } : {}) });
            }}
          >
            {t("common.save")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 pt-1">
        {!row ? (
          <Field label={t("foundry.masters.code")} error={tried && codeBad ? t("foundry.masters.codeInvalid") : undefined}>
            <TextInput value={form.code} maxLength={12} autoCapitalize="characters" onChange={(e) => setForm({ ...form, code: e.currentTarget.value })} data-testid="alloy-code" />
          </Field>
        ) : null}
        <Field label={t("foundry.masters.name")} error={tried && nameBad ? t("foundry.masters.nameRequired") : undefined}>
          <TextInput value={form.name} maxLength={60} onChange={(e) => setForm({ ...form, name: e.currentTarget.value })} data-testid="alloy-name" />
        </Field>
        <Field label={t("foundry.masters.note")}>
          <FieldTextArea value={form.note} maxLength={500} onChange={(e) => setForm({ ...form, note: e.currentTarget.value })} />
        </Field>
        {row ? (
          <div>
            <Button type="button" variant="secondary" loading={update.isPending} data-testid="alloy-toggle" onClick={() => update.mutate({ id: row.id, status: row.status === "active" ? "retired" : "active" })}>
              {row.status === "active" ? t("foundry.masters.retire") : t("foundry.masters.reactivate")}
            </Button>
          </div>
        ) : null}
        <ErrorLine error={create.error ?? update.error} />
      </div>
    </Sheet>
  );
}

function LimitsSheet({ alloy, onClose, onSaved }: { alloy: AlloyRow | null; onClose(): void; onSaved(): void }) {
  const { t } = useT();
  const [draft, setDraft] = useState<LimitDraft>(() => limitDraft([]));
  const [seeded, setSeeded] = useState<string | null>(null);
  if (seeded !== (alloy?.id ?? null)) {
    setSeeded(alloy?.id ?? null);
    setDraft(limitDraft((alloy?.limits ?? []) as SpectroLimit[]));
  }
  const [tried, setTried] = useState(false);
  const save = useMutation(
    trpc.foundry.alloys.setLimits.mutationOptions({
      onSuccess: () => {
        toast.success(t("foundry.masters.saved"));
        onSaved();
        close();
      },
    }),
  );
  const close = () => {
    setTried(false);
    save.reset();
    onClose();
  };
  const rows = limitRows(draft);
  return (
    <Sheet
      open={alloy !== null}
      onOpenChange={(o) => (o ? undefined : close())}
      title={t("foundry.masters.limitsTitle", { code: alloy?.code ?? "" })}
      footer={
        <>
          <Button variant="secondary" size="lg" onClick={close}>{t("common.cancel")}</Button>
          <Button
            size="lg"
            loading={save.isPending}
            data-testid="limits-save"
            onClick={() => {
              setTried(true);
              if (alloy && rows.ok) save.mutate({ alloyId: alloy.id, limits: rows.limits });
            }}
          >
            {t("foundry.masters.saveLimits")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 pt-1">
        <p className="m-0 text-[14px] text-muted-foreground">{t("foundry.masters.limitsHint")}</p>
        <div className="flex flex-col gap-3" data-testid="limits-editor">
          {SPECTRO_ELEMENTS.map((el) => {
            const bad = tried && !rows.ok && rows.element === el;
            return (
              <div key={el} className="grid grid-cols-[3rem_1fr_1fr] items-end gap-3" data-element={el}>
                <span className="pb-3 font-mono text-[16px] font-bold">{ELEMENT_LABEL[el]}</span>
                <Field label={t("foundry.masters.min")} error={bad ? t(rows.ok ? "foundry.masters.limitInvalid" : rows.reason === "order" ? "foundry.masters.limitOrder" : "foundry.masters.limitInvalid") : undefined}>
                  <NumberInput value={draft[el].min} onValueChange={(v) => setDraft({ ...draft, [el]: { ...draft[el], min: v } })} data-testid={`limit-min-${el}`} />
                </Field>
                <Field label={t("foundry.masters.max")}>
                  <NumberInput value={draft[el].max} onValueChange={(v) => setDraft({ ...draft, [el]: { ...draft[el], max: v } })} data-testid={`limit-max-${el}`} />
                </Field>
              </div>
            );
          })}
        </div>
        <Note>{t("foundry.masters.limitsSnapshot")}</Note>
        <ErrorLine error={save.error} />
      </div>
    </Sheet>
  );
}

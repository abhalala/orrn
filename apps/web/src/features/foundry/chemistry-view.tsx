import type { SpectroElementKey } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Field, NumberInput } from "@orrn/ui/components/field";
import { PageHeader } from "@orrn/ui/components/page-header";
import { Sheet } from "@orrn/ui/components/sheet";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { Can } from "@/shared/components/can";
import { INLINE_ERROR_META, showsQueryError } from "@/shared/lib/query-errors";
import { trpc } from "@/shared/utils/trpc";

import { chemistryDraft, chemistryPayload, setCount, type ChemistryDraft, type PpmMap } from "./chemistry-model";
import { ELEMENT_LABEL, ppmPct } from "./model";
import { ErrorLine, LoadFailed, Note, Panel } from "./ui";

type Subject = { kind: "item" | "stream"; id: string; label: string; ppm: PpmMap | null };

/**
 * `/foundry/chemistry` (row 47): the typical chemistry of each scrap item and each charge stream, which the "Suggest a mix"
 * panel works from. Stored in ppm, shown and typed as percent. Anyone reads; masters.publish edits. A blank box clears the element.
 */
export function ChemistryScreen() {
  const { t } = useT();
  const query = useQuery({ ...trpc.foundry.chargeMix.chemistry.queryOptions(), meta: INLINE_ERROR_META });
  const [editing, setEditing] = useState<Subject | null>(null);
  const header = <PageHeader title={t("fdy2.chemistry.title")} subtitle={t("fdy2.chemistry.subtitle")} back={{ to: "/foundry/stock", label: t("foundry.stock.title") }} />;
  if (showsQueryError(query)) return <>{header}<LoadFailed title={t("fdy2.chemistry.loadFailed")} onRetry={() => void query.refetch()} /></>;
  const d = query.data;
  if (!d) return <>{header}<Skeleton className="h-40 rounded-card" /></>;
  const elements = d.elements as readonly SpectroElementKey[];
  const rows = (kind: Subject["kind"]): Subject[] =>
    kind === "item"
      ? d.items.map((i) => ({ kind, id: i.id, label: i.name, ppm: i.ppm as PpmMap | null }))
      : d.streams.map((s) => ({ kind, id: s.id, label: `${s.code} · ${s.name}`, ppm: s.ppm as PpmMap | null }));
  const lists: { kind: Subject["kind"]; active: (id: string) => boolean }[] = [
    { kind: "item", active: (id) => d.items.find((i) => i.id === id)?.active !== false },
    { kind: "stream", active: (id) => d.streams.find((s) => s.id === id)?.active !== false },
  ];
  return (
    <>
      {header}
      <Note>{t("fdy2.chemistry.hint")}</Note>
      {lists.map(({ kind, active }) => {
        const subjects = rows(kind);
        return (
          <Panel key={kind} id={`chem-${kind}`} title={t(`fdy2.chemistry.group.${kind}`)} testId={`chem-${kind}`}>
            {subjects.length === 0 ? (
              <EmptyState title={t(`fdy2.chemistry.empty.${kind}`)} />
            ) : (
              <ul className="m-0 flex list-none flex-col divide-y divide-border p-0">
                {subjects.map((s) => (
                  <li key={s.id} className="flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 py-2.5" data-subject={s.id}>
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="flex flex-wrap items-center gap-2 text-[15px] font-semibold break-words">
                        {s.label}
                        {!active(s.id) ? <Chip tone="neutral" truncate={false}>{t("fdy2.chemistry.retired")}</Chip> : null}
                      </span>
                      {setCount(s.ppm) === 0 ? (
                        <span className="text-[13px] text-muted-foreground">{t("fdy2.chemistry.notSet")}</span>
                      ) : (
                        <span className="font-mono text-[13px] tabular-nums text-muted-foreground">
                          {elements.filter((el) => s.ppm?.[el] != null).map((el) => `${ELEMENT_LABEL[el]} ${ppmPct(s.ppm![el]!)}`).join(" · ")}
                        </span>
                      )}
                    </span>
                    <Can do="masters.publish">
                      <Button size="sm" variant="secondary" onClick={() => setEditing(s)} data-testid="chem-edit">{t("fdy2.chemistry.edit")}</Button>
                    </Can>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        );
      })}
      <ChemistrySheet subject={editing} elements={elements} onClose={() => setEditing(null)} />
    </>
  );
}

function ChemistrySheet({ subject, elements, onClose }: { subject: Subject | null; elements: readonly SpectroElementKey[]; onClose(): void }) {
  const { t } = useT();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<ChemistryDraft>({});
  const [bad, setBad] = useState<SpectroElementKey | null>(null);
  const [loaded, setLoaded] = useState<string | null>(null);
  // Fill the boxes once per subject opened.
  if (subject && loaded !== subject.id) {
    setLoaded(subject.id);
    setDraft(chemistryDraft(subject.ppm, elements));
    setBad(null);
  }
  const post = useMutation(
    trpc.foundry.chargeMix.setChemistry.mutationOptions({
      onSuccess: () => {
        toast.success(t("fdy2.chemistry.saved"));
        void queryClient.invalidateQueries({ queryKey: trpc.foundry.chargeMix.pathKey() });
        done();
      },
    }),
  );
  const done = () => {
    setLoaded(null);
    setBad(null);
    post.reset();
    onClose();
  };
  return (
    <Sheet
      open={subject !== null}
      onOpenChange={(o) => (o ? undefined : done())}
      title={t("fdy2.chemistry.sheetTitle", { name: subject?.label ?? "" })}
      footer={
        <>
          <Button variant="secondary" size="lg" onClick={done}>{t("common.cancel")}</Button>
          <Button
            size="lg"
            loading={post.isPending}
            data-testid="chem-save"
            onClick={() => {
              if (!subject) return;
              const r = chemistryPayload(draft, elements);
              if (!r.ok) return setBad(r.element);
              setBad(null);
              post.mutate({ subjectKind: subject.kind, subjectId: subject.id, ppm: r.ppm });
            }}
          >
            {t("fdy2.chemistry.save")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 pt-1">
        <p className="m-0 text-[14px] text-muted-foreground">{t("fdy2.chemistry.sheetHint")}</p>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {elements.map((el) => (
            <Field key={el} label={`${ELEMENT_LABEL[el]} %`} error={bad === el ? t("foundry.spectro.badNumber") : undefined}>
              <NumberInput value={draft[el] ?? ""} onValueChange={(v) => setDraft((x) => ({ ...x, [el]: v }))} data-testid={`chem-${el}`} />
            </Field>
          ))}
        </div>
        <ErrorLine error={post.error} />
      </div>
    </Sheet>
  );
}

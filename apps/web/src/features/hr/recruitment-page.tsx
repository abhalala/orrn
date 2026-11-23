/** `/hr/recruitment`: openings and the candidates for each, with the stage a candidate has reached. */
import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Field, NumberInput, TextInput } from "@orrn/ui/components/field";
import { PageHeader } from "@orrn/ui/components/page-header";
import { SegmentedControl } from "@orrn/ui/components/segmented-control";
import { Sheet } from "@orrn/ui/components/sheet";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Can } from "@/shared/components/can";
import { MasterPicker } from "@/shared/components/master-picker";
import { trpc } from "@/shared/utils/trpc";

import { HrGate, HrTabs, LoadError, Pick, Section, errorText } from "./ui";

const STAGES = ["applied", "called", "interviewed", "offered", "joined", "dropped"] as const;
type Stage = (typeof STAGES)[number];
type StatusTab = "open" | "closed" | "all";

export function RecruitmentPage() {
  const { t } = useT();
  const [status, setStatus] = useState<StatusTab>("open");
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<OpeningRow | "new" | null>(null);
  const list = useQuery(trpc.hr.recruitment.openings.queryOptions({ status }));
  type OpeningRow = NonNullable<typeof list.data>[number];
  const opening = (list.data ?? []).find((o) => o.id === selected) ?? null;

  return (
    <HrGate needs={["hr.view"]}>
      <PageHeader
        title={t("hr.recruit.title")}
        subtitle={t("hr.recruit.subtitle")}
        back={{ to: "/hr", label: t("hr.title") }}
        actions={
          <Can do="hr.manage">
            <Button className="max-md:h-14 max-md:w-full max-md:text-[17px]" onClick={() => setEditing("new")}>
              {t("hr.recruit.addOpening")}
            </Button>
          </Can>
        }
      />
      <HrTabs current="recruitment" />
      <SegmentedControl
        label={t("hr.recruit.statusLabel")}
        value={status}
        onChange={(v) => {
          setStatus(v);
          setSelected(null);
        }}
        options={[
          { value: "open" as StatusTab, label: t("hr.recruit.status.open") },
          { value: "closed" as StatusTab, label: t("hr.recruit.status.closed") },
          { value: "all" as StatusTab, label: t("hr.people.all") },
        ]}
      />
      {list.isPending ? <Skeleton className="h-32 w-full rounded-card" /> : null}
      {list.isError ? <LoadError onRetry={() => void list.refetch()} /> : null}
      {list.data && list.data.length === 0 ? <EmptyState title={t("hr.recruit.empty")} /> : null}
      <ul className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2 lg:grid-cols-3">
        {(list.data ?? []).map((o) => (
          <li key={o.id} className={`flex flex-col gap-2 rounded-card border bg-card p-3 ${o.id === selected ? "border-foreground" : "border-border"}`}>
            <p className="m-0 flex items-start justify-between gap-2 text-[15px] font-semibold">
              <span className="min-w-0">{o.title}</span>
              <Chip tone={o.status === "open" ? "green" : "neutral"} truncate={false}>
                {t(`hr.recruit.status.${o.status}`)}
              </Chip>
            </p>
            <p className="m-0 text-[13px] text-muted-foreground">{t("hr.recruit.figures", { positions: o.positions, candidates: o.candidates, joined: o.joined })}</p>
            {o.note ? <p className="m-0 text-[13px]">{o.note}</p> : null}
            <div className="flex flex-wrap gap-2">
              <Button variant={o.id === selected ? "primary" : "secondary"} size="sm" aria-pressed={o.id === selected} onClick={() => setSelected(o.id === selected ? null : o.id)}>
                {t("hr.recruit.candidates")}
              </Button>
              <Can do="hr.manage">
                <Button variant="secondary" size="sm" onClick={() => setEditing(o)}>
                  {t("hr.recruit.editOpening")}
                </Button>
              </Can>
            </div>
          </li>
        ))}
      </ul>
      {opening ? <Candidates key={opening.id} openingId={opening.id} title={opening.title} /> : null}
      <OpeningSheet opening={editing === "new" ? null : editing} open={editing !== null} onOpenChange={(o) => !o && setEditing(null)} />
    </HrGate>
  );
}

function Candidates({ openingId, title }: { openingId: string; title: string }) {
  const { t } = useT();
  const qc = useQueryClient();
  const q = useQuery(trpc.hr.recruitment.candidates.queryOptions({ openingId }));
  type Cand = NonNullable<typeof q.data>[number];
  const [editing, setEditing] = useState<Cand | "new" | null>(null);
  const move = useMutation({
    ...trpc.hr.recruitment.saveCandidate.mutationOptions(),
    onSuccess: () => qc.invalidateQueries({ queryKey: trpc.hr.recruitment.pathKey() }),
    onError: (e) => toast.error(errorText(e, t("hr.saveFailed"))),
  });
  return (
    <Section
      id="hr-candidates"
      title={t("hr.recruit.candidatesFor", { title })}
      actions={
        <Can do="hr.manage">
          <Button variant="secondary" onClick={() => setEditing("new")}>
            {t("hr.recruit.addCandidate")}
          </Button>
        </Can>
      }
    >
      {q.isPending ? <Skeleton className="h-20 w-full rounded-card" /> : null}
      {q.isError ? <LoadError onRetry={() => void q.refetch()} /> : null}
      {q.data && q.data.length === 0 ? <p className="m-0 text-[14px] text-muted-foreground">{t("hr.recruit.noCandidates")}</p> : null}
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {(q.data ?? []).map((c) => (
          <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-border p-3">
            <div className="min-w-0">
              <p className="m-0 text-[14px] font-semibold">{c.name}</p>
              <p className="m-0 text-xs text-muted-foreground">{c.phone || t("hr.recruit.noPhone")}</p>
              {c.notes ? <p className="m-0 text-[13px]">{c.notes}</p> : null}
            </div>
            <div className="flex items-center gap-2">
              <Can do="hr.manage" fallback={<Chip tone={c.stage === "joined" ? "green" : c.stage === "dropped" ? "neutral" : "blue"} truncate={false}>{t(`hr.recruit.stage.${c.stage}`)}</Chip>}>
                <div className="w-40">
                  <Pick
                    compact
                    aria-label={t("hr.recruit.stageFor", { name: c.name })}
                    value={c.stage}
                    disabled={move.isPending}
                    onChange={(v) => move.mutate({ id: c.id, openingId, name: c.name, phone: c.phone, stage: v as Stage, notes: c.notes })}
                    options={STAGES.map((s) => ({ value: s, label: t(`hr.recruit.stage.${s}`) }))}
                  />
                </div>
                <Button variant="secondary" size="sm" onClick={() => setEditing(c)}>
                  {t("hr.recruit.editCandidate")}
                </Button>
              </Can>
            </div>
          </li>
        ))}
      </ul>
      <CandidateSheet openingId={openingId} candidate={editing === "new" ? null : editing} open={editing !== null} onOpenChange={(o) => !o && setEditing(null)} />
    </Section>
  );
}

function CandidateSheet({ openingId, candidate, open, onOpenChange }: { openingId: string; candidate: { id: string; name: string; phone: string | null; stage: Stage; notes: string | null } | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useT();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [stage, setStage] = useState<Stage>("applied");
  const [notes, setNotes] = useState("");
  const [tried, setTried] = useState(false);
  useEffect(() => {
    if (!open) return;
    setName(candidate?.name ?? "");
    setPhone(candidate?.phone ?? "");
    setStage(candidate?.stage ?? "applied");
    setNotes(candidate?.notes ?? "");
    setTried(false);
  }, [open, candidate]);
  const save = useMutation({
    ...trpc.hr.recruitment.saveCandidate.mutationOptions(),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: trpc.hr.recruitment.pathKey() });
      toast.success(t("hr.recruit.candidateSaved"));
      onOpenChange(false);
    },
    onError: (e) => toast.error(errorText(e, t("hr.saveFailed"))),
  });
  const nameOk = name.trim().length > 0;
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={candidate ? t("hr.recruit.editCandidate") : t("hr.recruit.addCandidate")}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button
            loading={save.isPending}
            onClick={() => {
              setTried(true);
              if (nameOk) save.mutate({ id: candidate?.id, openingId, name: name.trim(), phone: phone.trim() || null, stage, notes: notes.trim() || null });
            }}
          >
            {t("hr.recruit.save")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label={t("hr.recruit.candidateName")} required error={tried && !nameOk ? t("hr.recruit.nameBad") : undefined}>
          <TextInput value={name} onChangeText={setName} maxLength={80} />
        </Field>
        <Field label={t("hr.person.phone")}>
          <TextInput type="tel" value={phone} onChangeText={setPhone} maxLength={16} />
        </Field>
        <Field label={t("hr.recruit.stageLabel")}>
          <Pick value={stage} onChange={(v) => setStage(v as Stage)} options={STAGES.map((s) => ({ value: s, label: t(`hr.recruit.stage.${s}`) }))} />
        </Field>
        <Field label={t("hr.recruit.notes")}>
          <TextInput value={notes} onChangeText={setNotes} maxLength={1000} />
        </Field>
      </div>
    </Sheet>
  );
}

function OpeningSheet({ opening, open, onOpenChange }: { opening: { id: string; title: string; departmentId: string | null; positions: number; status: "open" | "closed"; note: string | null } | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useT();
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [departmentId, setDepartmentId] = useState<string | null>(null);
  const [positions, setPositions] = useState("1");
  const [status, setStatus] = useState<"open" | "closed">("open");
  const [note, setNote] = useState("");
  const [tried, setTried] = useState(false);
  useEffect(() => {
    if (!open) return;
    setTitle(opening?.title ?? "");
    setDepartmentId(opening?.departmentId ?? null);
    setPositions(String(opening?.positions ?? 1));
    setStatus(opening?.status ?? "open");
    setNote(opening?.note ?? "");
    setTried(false);
  }, [open, opening]);
  const save = useMutation({
    ...trpc.hr.recruitment.saveOpening.mutationOptions(),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: trpc.hr.recruitment.pathKey() });
      toast.success(t("hr.recruit.openingSaved"));
      onOpenChange(false);
    },
    onError: (e) => toast.error(errorText(e, t("hr.saveFailed"))),
  });
  const titleOk = title.trim().length > 0;
  const posN = /^\d{1,3}$/.test(positions.trim()) ? Number(positions) : 0;
  const posOk = posN >= 1 && posN <= 500;
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={opening ? t("hr.recruit.editOpening") : t("hr.recruit.addOpening")}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button
            loading={save.isPending}
            onClick={() => {
              setTried(true);
              if (titleOk && posOk) save.mutate({ id: opening?.id, title: title.trim(), departmentId, positions: posN, status, note: note.trim() || null });
            }}
          >
            {t("hr.recruit.save")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label={t("hr.recruit.openingTitle")} required error={tried && !titleOk ? t("hr.recruit.titleBad") : undefined}>
          <TextInput value={title} onChangeText={setTitle} maxLength={80} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("hr.person.department")}>
            <MasterPicker kind="department" value={departmentId} onChange={setDepartmentId} />
          </Field>
          <Field label={t("hr.recruit.positions")} error={tried && !posOk ? t("hr.recruit.positionsBad") : undefined}>
            <NumberInput value={positions} onValueChange={setPositions} decimal={false} />
          </Field>
        </div>
        <Field label={t("hr.recruit.statusLabel")}>
          <Pick
            value={status}
            onChange={(v) => setStatus(v as "open" | "closed")}
            options={[
              { value: "open", label: t("hr.recruit.status.open") },
              { value: "closed", label: t("hr.recruit.status.closed") },
            ]}
          />
        </Field>
        <Field label={t("hr.recruit.notes")}>
          <TextInput value={note} onChangeText={setNote} maxLength={500} />
        </Field>
      </div>
    </Sheet>
  );
}

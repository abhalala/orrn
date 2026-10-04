import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Dialog } from "@orrn/ui/components/dialog";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { HowToButton } from "@orrn/ui/components/how-to-button";
import { UiLink } from "@orrn/ui/components/link";
import { usePrefersReducedMotion } from "@orrn/ui/components/motion";
import { PageHeader } from "@orrn/ui/components/page-header";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { Stepper } from "@orrn/ui/components/stepper";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { BundlesStep } from "@/features/pack/bundles-step";
import { DieStep, type DieOption } from "@/features/pack/die-step";
import { lengthUnitOf } from "@/features/pack/pack-ui";
import { ReviewStep } from "@/features/pack/review-step";
import { reachableStep, toReceiptInput, usePackDraft, type PackStep } from "@/features/pack/use-pack-draft";
import { sessionPrintQueue, useCanPrintLabels } from "@/features/pack/use-print-labels";
import { useYards, writeLastYard } from "@/features/pack/use-yards";
import { can, useMe } from "@/shared/lib/me";
import { trpc } from "@/shared/utils/trpc";

export const Route = createFileRoute("/_tenant/pack/new")({
  component: NewPackSession,
});

/** How long the totals block pops before the session page opens (the `pop` keyframe is 600 ms). */
const POP_MS = 420;

function NewPackSession() {
  const { t } = useT();
  const { data: me } = useMe();
  if (!me?.company) return null;
  if (!can(me, "bundle.pack")) {
    return (
      <>
        <PageHeader title={t("pack.new.title")} back={{ to: "/pack", label: t("pack.title") }} />
        <div className="rounded-card border border-border bg-card">
          <EmptyState
            title={t("pack.new.forbidden")}
            action={
              <Button asChild variant="secondary">
                <UiLink to="/pack">{t("pack.title")}</UiLink>
              </Button>
            }
          />
        </div>
      </>
    );
  }
  return <PackFlow companyId={me.company.id} settings={me.company.settings} />;
}

function PackFlow({ companyId, settings }: { companyId: string; settings: unknown }) {
  const { t } = useT();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const reduced = usePrefersReducedMotion();
  const unit = lengthUnitOf(settings);
  const { draft, update, discard, finish, restored } = usePackDraft(companyId);
  const { canPrint } = useCanPrintLabels();
  const yards = useYards();
  // While the yards load, a restored draft waits on its own step (no flash of step 1 then back to the yard).
  const step: PackStep = yards.loading ? draft.step : reachableStep(draft, { yardIds: yards.yardIds });
  const yardCode = yards.yards.find((y) => y.id === draft.defaults.locationId)?.code ?? null;
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [popped, setPopped] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [showRestored, setShowRestored] = useState(restored);
  const stepChanged = useRef(false);

  const die = useQuery({
    ...trpc.die.get.queryOptions({ id: draft.dieId ?? "" }),
    enabled: draft.dieId !== null,
  });
  const dieOption = (die.data as DieOption | undefined) ?? null;

  const create = useMutation(trpc.bundle.createReceipt.mutationOptions());

  const goTo = (next: PackStep) => {
    stepChanged.current = true;
    setSaveError(null);
    update((d) => ({ ...d, step: next }));
  };

  // Each step change starts at its heading (step 2 moves on to the weight field itself).
  useEffect(() => {
    if (!stepChanged.current) return;
    stepChanged.current = false;
    // Step 2 focuses its weight field, which scrolls the open card into view.
    if (step === 1) return;
    headingRef.current?.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: reduced ? "auto" : "smooth" });
  }, [step, reduced]);

  // Leaving before the pop finishes cancels the hop to the session page.
  const leaveTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(leaveTimer.current), []);

  const announce = (message: string) => {
    // Same text twice in a row still has to be read out: clear first.
    setAnnouncement("");
    requestAnimationFrame(() => setAnnouncement(message));
  };

  const save = async () => {
    const input = toReceiptInput(draft, unit, { yardIds: yards.yardIds });
    if (!input || create.isPending) return;
    setSaveError(null);
    try {
      const res = await create.mutateAsync(input);
      finish();
      if (input.locationId) writeLastYard(companyId, input.locationId);
      setPopped(true);
      announce(t("pack.new.saved"));
      toast.success(t("pack.new.saved"));
      void queryClient.invalidateQueries({ queryKey: trpc.bundle.pathKey() });
      void queryClient.invalidateQueries({ queryKey: trpc.dashboard.pathKey() });
      if (canPrint) {
        // Labels print one by one in the background; the session page shows the progress.
        void queryClient
          .fetchQuery(trpc.bundle.getGroup.queryOptions({ id: res.groupId }))
          .then((group) =>
            sessionPrintQueue(res.groupId).run(group.bundles.map((b) => ({ bundleId: b.id, serial: b.serial }))),
          )
          .catch(() => {
            // The session page still offers "Print all labels".
          });
      }
      leaveTimer.current = window.setTimeout(
        () => navigate({ to: "/pack/$id", params: { id: res.groupId } }),
        reduced ? 0 : POP_MS,
      );
    } catch (error) {
      const err = error as { data?: { code?: string }; message?: string } | null;
      const code = err?.data?.code;
      // A yard added or retired since the yards loaded.
      const yardProblem = code === "BAD_REQUEST" && /yard/i.test(err?.message ?? "");
      // Fresh yards move the packer back to step 1 by themselves when the chosen yard is gone.
      if (yardProblem) yards.retry();
      setSaveError(
        code === "FORBIDDEN"
          ? t("pack.new.forbidden")
          : yardProblem
            ? t("pack.new.yardRequired")
            : t("pack.new.saveFailed"),
      );
    }
  };

  const steps = [t("pack.new.steps.die"), t("pack.new.steps.bundles"), t("pack.new.steps.review")];

  return (
    <>
      <PageHeader
        title={t("pack.new.title")}
        back={{ to: "/pack", label: t("pack.title") }}
        actions={<HowToButton slug="pack-session" />}
      />

      <p aria-live="polite" role="status" className="sr-only">
        {announcement}
      </p>

      {showRestored && draft.bundles.length > 0 ? (
        <div
          data-slot="draft-restored"
          className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-card border border-border bg-card px-4 py-2.5"
        >
          <p className="m-0 min-w-0 flex-1 text-[14px] font-medium">{t("pack.new.draftKept")}</p>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setDiscardOpen(true)}>
              {t("pack.new.discardDraft")}
            </Button>
            <Button variant="secondary" onClick={() => setShowRestored(false)}>
              {t("common.close")}
            </Button>
          </div>
        </div>
      ) : null}

      <Stepper steps={steps} current={step} />

      <section aria-labelledby="pack-step-heading" className="flex flex-col gap-4">
        <h2
          id="pack-step-heading"
          ref={headingRef}
          tabIndex={-1}
          className="m-0 font-display text-[22px] font-bold tracking-[-0.025em] outline-none max-sm:sr-only"
        >
          {steps[step]}
        </h2>

        {step === 0 ? (
          <DieStep draft={draft} update={update} unit={unit} yards={yards} onNext={() => goTo(1)} />
        ) : yards.loading ? (
          <div aria-busy="true" className="flex flex-col gap-3">
            <Skeleton className="h-12 rounded-card" />
            <Skeleton className="h-[220px] rounded-card" />
          </div>
        ) : step === 1 ? (
          <BundlesStep
            draft={draft}
            update={update}
            unit={unit}
            die={dieOption}
            dieLoading={die.isPending && draft.dieId !== null}
            yardCode={yardCode}
            onChangeDefaults={() => goTo(0)}
            onReview={() => goTo(2)}
            announce={announce}
          />
        ) : (
          <ReviewStep
            draft={draft}
            unit={unit}
            die={dieOption}
            yardCode={yardCode}
            canPrint={canPrint}
            saving={create.isPending || popped}
            saveError={saveError}
            popped={popped}
            onBack={() => goTo(1)}
            onSave={save}
          />
        )}
      </section>

      <Dialog
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        title={t("pack.new.discardTitle")}
        description={t("pack.new.discardBody", { count: draft.bundles.length })}
        actions={
          <>
            <Button variant="secondary" onClick={() => setDiscardOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                setDiscardOpen(false);
                setShowRestored(false);
                stepChanged.current = true;
                discard();
              }}
            >
              {t("pack.new.discard")}
            </Button>
          </>
        }
      />
    </>
  );
}

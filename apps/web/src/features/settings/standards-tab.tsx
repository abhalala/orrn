import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@orrn/ui/components/card";
import { Field, TextInput } from "@orrn/ui/components/field";
import { FormActions } from "@orrn/ui/components/form-actions";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { Can } from "@/shared/components/can";
import { trpc } from "@/shared/utils/trpc";

import { MAX_STANDARD_TEXT, STANDARD_KINDS, standardBlank, standardsDraft, standardsPatch, type StandardsDraft } from "./model";
import { Note, TabState, usePlantSettings } from "./ui";
import { AgeingSettingsCard } from "@/features/ageing/settings-card";
import { CastBookCard } from "./cast-book-card";
import { CollectorsCard } from "./collectors-card";
import { ThresholdsCard } from "./thresholds-card";

/**
 * Standards (FP-PF-09): the BIS designation and the CM/L licence printed on the label and the test
 * certificate, one pair per profile kind. Semi hollow prints the solid pair while its own is blank.
 * A blank CM/L prints no licence line. Owners and admins edit; everyone else reads.
 */
export function StandardsTab() {
  const settings = usePlantSettings();
  const signature = JSON.stringify(settings.data?.standards ?? {});
  return (
    <TabState query={settings}>
      {settings.data ? (
        <div className="flex min-w-0 flex-col gap-6">
          <StandardsForm key={signature} saved={standardsDraft(settings.data.standards)} />
          <ThresholdsCard settings={settings.data} />
          <AgeingSettingsCard settings={settings.data} />
          <CastBookCard key={JSON.stringify(settings.data.castSeriesStart)} settings={settings.data} />
          {/* I-5: the press reading limits live with the other plant standards, where managers
              (masters.publish) reach them; the card gates its own editing. */}
          <CollectorsCard />
        </div>
      ) : null}
    </TabState>
  );
}

function StandardsForm({ saved }: { saved: StandardsDraft }) {
  const { t } = useT();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<StandardsDraft>(saved);
  const patch = standardsPatch(draft, saved);
  const dirty = Object.keys(patch).length > 0;

  const save = useMutation(
    trpc.company.updateSettings.mutationOptions({
      onSuccess: () => {
        toast.success(t("settings.standards.saved"));
        void queryClient.invalidateQueries({ queryKey: trpc.company.getSettings.queryKey() });
        void queryClient.invalidateQueries({ queryKey: trpc.company.standards.queryKey() });
      },
      onError: () => toast.error(t("settings.standards.saveFailed")),
    }),
  );

  return (
    <form
      noValidate
      className="flex min-w-0 flex-col gap-4"
      data-testid="settings-standards"
      onSubmit={(e) => {
        e.preventDefault();
        if (dirty && !save.isPending) save.mutate({ standards: patch });
      }}
    >
      <p className="m-0 text-[15px] leading-6 text-muted-foreground">{t("settings.standards.intro")}</p>
      <Can do="settings.update" fallback={<Note testId="standards-read-only">{t("settings.standards.readOnly")}</Note>}>
        {null}
      </Can>
      {STANDARD_KINDS.map((kind) => {
        const pair = draft[kind];
        return (
          <Card key={kind} data-testid={`standard-${kind}`}>
            <CardHeader>
              <CardTitle>{t(`plantSettings.standards.${kind}`)}</CardTitle>
              {kind === "semi" && standardBlank(pair) ? <CardDescription>{t("settings.standards.semiSolid")}</CardDescription> : null}
            </CardHeader>
            <CardContent>
              <Can
                do="settings.update"
                fallback={
                  <dl className="m-0 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <ReadFact label={t("plantSettings.standards.standard")} value={pair.standard} />
                    <ReadFact label={t("plantSettings.standards.cml")} value={pair.cml} mono />
                  </dl>
                }
              >
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <Field label={t("plantSettings.standards.standard")} hint={t("settings.standards.designationHint")}>
                    <TextInput
                      value={pair.standard}
                      maxLength={MAX_STANDARD_TEXT}
                      autoComplete="off"
                      data-testid={`standard-${kind}-designation`}
                      onChange={(e) => setDraft({ ...draft, [kind]: { ...pair, standard: e.currentTarget.value } })}
                    />
                  </Field>
                  <Field label={t("plantSettings.standards.cml")} hint={t("settings.standards.cmlHint")}>
                    <TextInput
                      value={pair.cml}
                      maxLength={MAX_STANDARD_TEXT}
                      autoComplete="off"
                      className="font-mono"
                      data-testid={`standard-${kind}-cml`}
                      onChange={(e) => setDraft({ ...draft, [kind]: { ...pair, cml: e.currentTarget.value } })}
                    />
                  </Field>
                </div>
              </Can>
            </CardContent>
          </Card>
        );
      })}
      <Can do="settings.update">
        <FormActions sticky={false}>
          <Button type="submit" disabled={!dirty} loading={save.isPending} data-testid="standards-save">
            {t("settings.standards.save")}
          </Button>
        </FormActions>
      </Can>
    </form>
  );
}

function ReadFact({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-[13px] font-semibold text-muted-foreground">{label}</dt>
      <dd className={mono ? "m-0 font-mono text-[15px] break-words" : "m-0 text-[15px] break-words"}>{value || "-"}</dd>
    </div>
  );
}

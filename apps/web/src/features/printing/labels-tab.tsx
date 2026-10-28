import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@orrn/ui/components/card";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { UiLink } from "@orrn/ui/components/link";
import { Field, TextInput } from "@orrn/ui/components/field";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Pencil, Printer, Send } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { useCompanyWhen } from "@/features/stock/use-company-when";
import { Can } from "@/shared/components/can";
import { bundleDetailPath } from "@/shared/lib/paths";
import { trpc } from "@/shared/utils/trpc";

import { reprintTarget } from "./model";

/**
 * Labels: the reprint entry (a bundle number that opens the bundle, where
 * Reprint label already lives) and the label designs with the time each was
 * last sent to the print computer. Sending a design needs `spool.push_templates`.
 */
export function LabelsTab() {
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <ReprintEntry />
      <Designs />
    </div>
  );
}

function ReprintEntry() {
  const { t } = useT();
  const navigate = useNavigate();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | undefined>();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const serial = reprintTarget(value);
    if (!serial) {
      setError(t("printing.reprint.required"));
      return;
    }
    setError(undefined);
    void navigate({ to: bundleDetailPath({ serial }) as never });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("printing.reprint.title")}</CardTitle>
        <CardDescription>{t("printing.reprint.body")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-end" noValidate>
          <Field label={t("printing.reprint.field")} error={error} className="sm:max-w-xs sm:flex-1">
            <TextInput
              value={value}
              onChangeText={(next) => {
                setValue(next);
                if (error) setError(undefined);
              }}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              enterKeyHint="go"
              className="font-mono"
              data-testid="reprint-serial"
            />
          </Field>
          <Button type="submit" variant="secondary" className="self-start sm:mb-0.5">
            <Printer aria-hidden="true" strokeWidth={2} />
            {t("printing.reprint.open")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function Designs() {
  const { t } = useT();
  const when = useCompanyWhen();
  const queryClient = useQueryClient();
  const templates = useQuery(trpc.spool.listTemplates.queryOptions());
  const push = useMutation(
    trpc.spool.pushTemplate.mutationOptions({
      onSuccess: () => {
        toast.success(t("printing.labels.pushed"));
        void queryClient.invalidateQueries({ queryKey: trpc.spool.listTemplates.queryKey() });
      },
      onError: () => toast.error(t("printing.designs.pushFailed")),
    }),
  );

  return (
    <section aria-labelledby="label-designs" className="flex min-w-0 flex-col gap-3">
      <h2 id="label-designs" className="m-0 text-[17px] font-semibold">
        {t("printing.designs.title")}
      </h2>
      {templates.isPending ? (
        <Skeleton className="h-20 w-full rounded-card" aria-busy="true" />
      ) : templates.isError ? (
        <div className="rounded-card border border-border bg-card">
          <EmptyState
            title={t("printing.loadFailed")}
            action={
              <Button variant="secondary" onClick={() => void templates.refetch()}>
                {t("common.retry")}
              </Button>
            }
          />
        </div>
      ) : templates.data.length === 0 ? (
        <div className="rounded-card border border-border bg-card">
          <EmptyState title={t("printing.designs.empty")} />
        </div>
      ) : (
        <ul className="m-0 grid list-none grid-cols-1 gap-3 p-0 md:grid-cols-2">
          {templates.data.map((template) => (
            <li key={template.id} className="min-w-0" data-testid="label-design">
              <Card className="h-full">
                <CardHeader>
                  <CardTitle className="break-words">{template.name}</CardTitle>
                  <CardDescription>
                    {template.spoolPushedAt
                      ? t("printing.designs.sent", { time: when(template.spoolPushedAt) })
                      : t("printing.designs.notSent")}
                  </CardDescription>
                </CardHeader>
                <Can do="spool.push_templates">
                  <CardContent className="flex flex-wrap gap-2">
                    <Button asChild variant="secondary" className="self-start">
                      <UiLink to={`/printing/templates/${template.id}`}>
                        <Pencil aria-hidden="true" strokeWidth={2} />
                        Edit label
                      </UiLink>
                    </Button>
                    <Button
                      variant="secondary"
                      className="self-start"
                      loading={push.isPending && push.variables?.templateId === template.id}
                      onClick={() => push.mutate({ templateId: template.id })}
                    >
                      <Send aria-hidden="true" strokeWidth={2} />
                      {t("printing.labels.push")}
                    </Button>
                  </CardContent>
                </Can>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

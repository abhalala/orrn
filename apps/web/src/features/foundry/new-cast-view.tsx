import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { Field, TextInput } from "@orrn/ui/components/field";
import { UiLink } from "@orrn/ui/components/link";
import { PageHeader } from "@orrn/ui/components/page-header";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { Can } from "@/shared/components/can";
import { INLINE_ERROR_META, showsQueryError } from "@/shared/lib/query-errors";
import { trpc } from "@/shared/utils/trpc";

import { kgFromG } from "@/features/press/model";
import { ErrorLine, LoadFailed, Note, FieldSelect } from "./ui";

/**
 * `/casts/new` (FP-FD-02): pick the alloy the cast aims at. The number comes from the plant's series
 * on the server. The furnace is chosen on each melt; it is shown here so a plant with none sees why
 * a melt will not start.
 */
export function NewCastScreen() {
  const { t } = useT();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const alloys = useQuery({ ...trpc.foundry.alloys.list.queryOptions(), meta: INLINE_ERROR_META });
  const furnaces = useQuery({ ...trpc.foundry.furnaces.list.queryOptions(), meta: INLINE_ERROR_META });
  const [alloyId, setAlloyId] = useState("");
  const [legacyCode, setLegacyCode] = useState("");
  // One id per screen visit: a double tap or a retried request opens one cast.
  const requestId = useRef(crypto.randomUUID());
  const open = useMutation(
    trpc.foundry.casts.open.mutationOptions({
      onSuccess: (res) => {
        toast.success(t("foundry.newCast.opened", { number: res.number }));
        void queryClient.invalidateQueries({ queryKey: trpc.foundry.casts.pathKey() });
        void navigate({ to: "/casts/$id", params: { id: res.id } });
      },
    }),
  );
  const header = <PageHeader title={t("foundry.newCast.title")} subtitle={t("foundry.newCast.subtitle")} back={{ to: "/casts", label: t("foundry.casts.title") }} />;
  if (showsQueryError(alloys)) return <>{header}<LoadFailed title={t("foundry.newCast.loadFailed")} onRetry={() => void alloys.refetch()} /></>;
  if (!alloys.data || !furnaces.data) return <>{header}<Skeleton className="h-40 rounded-card" /></>;
  const activeAlloys = alloys.data.items.filter((a) => a.status === "active");
  const activeFurnaces = furnaces.data.items.filter((f) => f.status === "active");

  return (
    <>
      {header}
      <form
        className="flex max-w-xl flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (alloyId) open.mutate({ alloyId, ...(legacyCode.trim() ? { legacyCode: legacyCode.trim() } : {}), clientRequestId: requestId.current });
        }}
      >
        {activeAlloys.length === 0 ? (
          <Note tone="amber" testId="no-alloy">
            {t("foundry.newCast.noAlloy")}{" "}
            <Can do="masters.publish">
              <UiLink to="/masters/alloys" className="font-semibold underline underline-offset-4">
                {t("foundry.newCast.addAlloy")}
              </UiLink>
            </Can>
          </Note>
        ) : (
          <Field label={t("foundry.newCast.alloy")} hint={t("foundry.newCast.alloyHint")}>
            <FieldSelect value={alloyId} onChange={(e) => {
                // A new choice is a new request: the same id for another alloy is refused.
                requestId.current = crypto.randomUUID();
                setAlloyId(e.currentTarget.value);
              }} data-testid="alloy-pick">
              <option value="">{t("foundry.newCast.alloyPick")}</option>
              {activeAlloys.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code}
                  {a.name && a.name !== `Alloy ${a.code}` ? ` · ${a.name}` : ""}
                </option>
              ))}
            </FieldSelect>
          </Field>
        )}
        <Field label={t("foundry.newCast.legacy")} hint={t("foundry.newCast.legacyHint")}>
          <TextInput
            value={legacyCode}
            maxLength={20}
            autoComplete="off"
            autoCapitalize="characters"
            className="font-mono"
            placeholder={t("foundry.newCast.legacyPlaceholder")}
            data-testid="legacy-code"
            onChange={(e) => {
              requestId.current = crypto.randomUUID();
              setLegacyCode(e.currentTarget.value);
            }}
          />
        </Field>
        <div className="flex min-w-0 flex-col gap-2" data-testid="furnace-line">
          <span className="text-[14px] font-medium">{t("foundry.newCast.furnace")}</span>
          {activeFurnaces.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {activeFurnaces.map((f) => (
                <Chip key={f.id} tone="neutral" truncate={false}>
                  {f.code} · {kgFromG(f.capacityG)} {t("units.kg")}
                  {f.billetDiaMm ? ` · ${f.billetDiaMm} ${t("units.mm")}` : ""}
                </Chip>
              ))}
            </div>
          ) : (
            <Note tone="amber" testId="no-furnace">
              <Can do="masters.publish" fallback={t("foundry.newCast.noFurnaceAsk")}>
                {t("foundry.newCast.noFurnace")}{" "}
                <UiLink to="/masters/furnaces" className="font-semibold underline underline-offset-4">
                  {t("foundry.newCast.addFurnace")}
                </UiLink>
              </Can>
            </Note>
          )}
        </div>
        <ErrorLine error={open.error} />
        <div>
          <Can do="cast.enter" fallback={<Note>{t("foundry.common.notAllowed")}</Note>}>
            <Button type="submit" size="lg" loading={open.isPending} disabled={!alloyId} data-testid="open-cast-submit">
              {t("foundry.casts.open")}
            </Button>
          </Can>
        </div>
      </form>
    </>
  );
}

import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { Dialog } from "@orrn/ui/components/dialog";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Field, TextInput } from "@orrn/ui/components/field";
import { ListCard } from "@orrn/ui/components/list-card";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AppRouter } from "@orrn/server/routers/index";
import type { inferRouterOutputs } from "@trpc/server";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { useCompanyWhen } from "@/features/stock/use-company-when";
import { Can } from "@/shared/components/can";
import { INLINE_ERROR_META } from "@/shared/lib/query-errors";
import { trpc } from "@/shared/utils/trpc";

import { CollectorsCard } from "./collectors-card";
import type { DeviceGate } from "./model";
import { Note, usePlantSettings } from "./ui";

type Device = inferRouterOutputs<AppRouter>["device"]["list"][number];

/** The one app id every build ships under (FP-PF-11). */
export const APP_ID = "in.orrn.app";

const GATE_CHANNELS = [
  { platform: "android", channel: "floor", title: "devices.platformAndroid" },
  { platform: "android", channel: "production", title: "devices.platformAndroidProduction" },
  { platform: "ios", channel: "production", title: "devices.platformIos" },
] as const;

const GATE_TONE: Record<DeviceGate, "green" | "red" | "neutral"> = { current: "green", blocked: "red", revoked: "red", web: "neutral", unknown: "neutral" };

/**
 * Devices (FP-PF-11): the published builds and their minimum, then every device that opened the
 * app, with its build against that minimum. Owners and admins (`users.manage`) name a device, sign
 * it out and allow it again; a signed-out device keeps its row.
 */
export function DevicesTab() {
  const { t } = useT();
  const when = useCompanyWhen();
  const settings = usePlantSettings();
  const list = useQuery({ ...trpc.device.list.queryOptions(), meta: INLINE_ERROR_META });
  // The public gate answers per platform and channel; build 0 asks "what is published, and what is the floor".
  const gates = useQueries({
    queries: GATE_CHANNELS.map((g) => ({
      ...trpc.release.check.queryOptions({ platform: g.platform, channel: g.channel, buildNumber: 0 }),
      meta: INLINE_ERROR_META,
    })),
  });
  const [renaming, setRenaming] = useState<Device | null>(null);
  const [revoking, setRevoking] = useState<Device | null>(null);

  const published = GATE_CHANNELS.map((g, i) => ({ ...g, data: gates[i]?.data })).filter((g) => g.data?.latest);
  const dayStart = settings.data?.productionDay.startMs ?? 0;

  return (
    <div className="flex min-w-0 flex-col gap-5" data-testid="settings-devices">
      <section aria-labelledby="gate-heading" className="flex min-w-0 flex-col gap-3 rounded-card border border-border bg-card p-4 sm:p-5">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 id="gate-heading" className="m-0 text-[17px] font-semibold">
            {t("devices.gateTitle")}
          </h2>
          <Note>{t("devices.gateHint", { app: APP_ID })}</Note>
        </div>
        {gates.some((g) => g.isPending) ? (
          <Skeleton className="h-16 w-full rounded-card" aria-busy="true" />
        ) : published.length === 0 ? (
          <p className="m-0 text-[15px] text-muted-foreground" data-testid="gate-empty">
            {t("devices.nothing")}
          </p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-3 p-0" data-testid="gate-list">
            {published.map((g) => (
              <li key={`${g.platform}-${g.channel}`} className="flex min-w-0 flex-col gap-1" data-testid="gate-row">
                <p className="m-0 text-[15px] font-semibold">{t(g.title)}</p>
                <p className="m-0 font-mono text-[14px] tabular-nums">
                  {t("devices.latest", { version: g.data!.latest!.version, build: g.data!.latest!.buildNumber })}
                  {" · "}
                  {t("devices.minimum", { build: g.data!.minBuild })}
                </p>
                {g.data!.notes ? (
                  <p className="m-0 text-[13px] leading-5 text-muted-foreground break-words">
                    {t("devices.notesLabel")}: {g.data!.notes}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="device-list-heading" className="flex min-w-0 flex-col gap-3">
        <h2 id="device-list-heading" className="m-0 text-[17px] font-semibold">
          {t("devices.listTitle")}
        </h2>
        {list.isPending ? (
          <Skeleton className="h-32 w-full rounded-card" aria-busy="true" />
        ) : list.isError ? (
          <div className="rounded-card border border-border bg-card">
            <EmptyState
              title={t("devices.loadFailed")}
              action={
                <Button variant="secondary" onClick={() => void list.refetch()}>
                  {t("common.retry")}
                </Button>
              }
            />
          </div>
        ) : list.data.length === 0 ? (
          <div className="rounded-card border border-border bg-card">
            <EmptyState title={t("devices.empty")} />
          </div>
        ) : (
          <ul className="m-0 grid list-none grid-cols-1 gap-3 p-0 md:grid-cols-2 xl:grid-cols-3" data-testid="device-list">
            {list.data.map((d) => {
              const gate = d.gate;
              const thisDay = new Date(d.lastSeenAt).getTime() >= dayStart;
              const name = d.label?.trim() || t("devices.unnamed");
              return (
                <li key={d.id} className="min-w-0" data-testid="device-card" data-gate={gate}>
                  <ListCard
                    title={name}
                    titleText={name}
                    subtitle={d.userName ? t("devices.person", { name: d.userName }) : (d.userEmail ?? undefined)}
                    status={<Chip tone={GATE_TONE[gate]}>{t(`devices.status.${gate}`)}</Chip>}
                    facts={[
                      { label: t("devices.factPlatform"), value: d.platform, mono: true },
                      { label: t("devices.factApp"), value: d.appVersion ?? "-", mono: true },
                      { label: t("devices.factSeen"), value: when(d.lastSeenAt), mono: true },
                      { label: t("devices.factDay"), value: thisDay ? t("devices.seenThisDay") : t("devices.seenEarlier") },
                    ]}
                    footer={
                      <Can do="users.manage">
                        <div className="flex flex-wrap gap-2">
                          <Button variant="secondary" size="sm" onClick={() => setRenaming(d)}>
                            {t("devices.rename")}
                          </Button>
                          {d.revokedAt ? (
                            <RestoreButton device={d} />
                          ) : (
                            <Button variant="danger" size="sm" onClick={() => setRevoking(d)}>
                              {t("devices.revoke")}
                            </Button>
                          )}
                        </div>
                      </Can>
                    }
                  />
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <CollectorsCard />

      <RenameDialog device={renaming} onClose={() => setRenaming(null)} />
      <RevokeDialog device={revoking} onClose={() => setRevoking(null)} />
    </div>
  );
}

function useRefreshDevices() {
  const queryClient = useQueryClient();
  return () => void queryClient.invalidateQueries({ queryKey: trpc.device.list.queryKey() });
}

function RestoreButton({ device }: { device: Device }) {
  const { t } = useT();
  const refresh = useRefreshDevices();
  const restore = useMutation(
    trpc.device.restore.mutationOptions({
      onSuccess: () => {
        toast.success(t("devices.restored"));
        refresh();
      },
      onError: () => toast.error(t("devices.actionFailed")),
    }),
  );
  return (
    <Button variant="secondary" size="sm" loading={restore.isPending} onClick={() => restore.mutate({ id: device.id })}>
      {t("devices.restore")}
    </Button>
  );
}

function RenameDialog({ device, onClose }: { device: Device | null; onClose(): void }) {
  const { t } = useT();
  const refresh = useRefreshDevices();
  const [label, setLabel] = useState("");
  const [forId, setForId] = useState<string | null>(null);
  // Start from the device's current name each time a different device opens.
  if (device && device.id !== forId) {
    setForId(device.id);
    setLabel(device.label ?? "");
  }
  const rename = useMutation(
    trpc.device.rename.mutationOptions({
      onSuccess: () => {
        toast.success(t("devices.renamed"));
        refresh();
        onClose();
      },
      onError: () => toast.error(t("devices.renameFailed")),
    }),
  );
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (device) rename.mutate({ id: device.id, label });
  };
  return (
    <Dialog
      open={device !== null}
      onOpenChange={(open) => !open && onClose()}
      title={t("devices.renameTitle")}
      actions={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" form="rename-device-form" loading={rename.isPending}>
            {t("settings.company.submit")}
          </Button>
        </>
      }
    >
      <form id="rename-device-form" onSubmit={submit} noValidate>
        <Field label={t("devices.label")}>
          <TextInput value={label} maxLength={60} autoComplete="off" data-testid="device-label" onChange={(e) => setLabel(e.currentTarget.value)} />
        </Field>
      </form>
    </Dialog>
  );
}

function RevokeDialog({ device, onClose }: { device: Device | null; onClose(): void }) {
  const { t } = useT();
  const refresh = useRefreshDevices();
  const revoke = useMutation(
    trpc.device.revoke.mutationOptions({
      onSuccess: () => {
        toast.success(t("devices.revokedDone"));
        refresh();
        onClose();
      },
      onError: () => toast.error(t("devices.actionFailed")),
    }),
  );
  const name = device?.label?.trim() || t("devices.unnamed");
  return (
    <Dialog
      open={device !== null}
      onOpenChange={(open) => !open && onClose()}
      title={t("devices.revokeTitle")}
      description={t("devices.revokeBody", { name })}
      actions={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="button" variant="danger" loading={revoke.isPending} onClick={() => device && revoke.mutate({ id: device.id })}>
            {t("devices.revokeConfirm")}
          </Button>
        </>
      }
    />
  );
}

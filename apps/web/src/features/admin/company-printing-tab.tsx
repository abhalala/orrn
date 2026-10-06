import { useT, type MessageKey } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Field, TextInput } from "@orrn/ui/components/field";
import { Sheet } from "@orrn/ui/components/sheet";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { cn } from "@orrn/ui/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, CircleCheck, Download, KeyRound, Power, TerminalSquare } from "lucide-react";
import { Fragment, useId, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Can } from "@/shared/components/can";
import { trpc } from "@/shared/utils/trpc";

import { formatAgo, formatDay } from "./format";
import { freeStationName, inactiveReason, printingKey, printingTone, validateStationName } from "./status";
import type { CreatedDeployment, DeploymentRow } from "./types";
import { ConfirmDialog, CopyField, errorCode, errorText, Fact, LoadError, Panel, useLastValue } from "./ui";

/** The print station address suffix. The server builds the real one; this is only the live preview. */
const ADDRESS_SUFFIX = ".spool.orrn.in";

const PLATFORMS = [
  { value: "darwin-arm64", key: "admin.printing.platforms.darwinArm64" },
  { value: "darwin-amd64", key: "admin.printing.platforms.darwinAmd64" },
  { value: "linux-amd64", key: "admin.printing.platforms.linuxAmd64" },
  { value: "windows-amd64", key: "admin.printing.platforms.windowsAmd64" },
] as const satisfies readonly { value: string; key: MessageKey }[];
type DownloadPlatform = (typeof PLATFORMS)[number]["value"];

export type PrintingCompany = { id: string; name: string; slug: string; status: string };

type Action =
  | { kind: "rotate"; row: DeploymentRow }
  | { kind: "install"; row: DeploymentRow }
  | { kind: "downloads"; row: DeploymentRow }
  | { kind: "turnOff"; row: DeploymentRow };

/**
 * Godseye company tab "Printing" (spec §3; moved from /admin/spool): the
 * company's print stations with set up, rotate secret, install script,
 * app downloads and turn off. Secrets are shown once, in a copy field.
 * The company page only shows this tab to roles with `platform.spool.manage`.
 */
export function CompanyPrintingTab({ company }: { company: PrintingCompany }) {
  const { t } = useT();
  const list = useQuery(trpc.platform.spoolDeploymentsList.queryOptions({ companyId: company.id, limit: 50 }));
  const [setupOpen, setSetupOpen] = useState(false);
  const [action, setAction] = useState<Action | null>(null);

  if (list.isPending) {
    return (
      <div aria-busy="true" className="flex flex-col gap-3">
        <Skeleton className="h-[188px] rounded-card" />
      </div>
    );
  }
  // Error panel only with nothing to show: a failed refetch keeps the last good data (showsLoadError).
  if (!list.data) {
    return <LoadError message={t("admin.printing.loadError")} onRetry={() => void list.refetch()} />;
  }

  const rows = list.data.items;
  const live = rows.filter((r) => r.status !== "revoked");
  const history = rows.filter((r) => r.status === "revoked");
  const blocked = inactiveReason(company.status);
  const active = blocked === null;
  const inactiveText =
    blocked === "waiting"
      ? t("admin.printing.waiting", { company: company.name })
      : t("admin.printing.inactive", { company: company.name });

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {live.length === 0 ? (
        <Panel>
          <EmptyState
            title={t("admin.printing.noneTitle")}
            body={active ? t("admin.printing.noneBody", { company: company.name }) : inactiveText}
            action={
              <Can do="platform.spool.manage">
                <Button disabled={!active} onPress={() => setSetupOpen(true)} className="pointer-coarse:h-14">
                  {t("admin.printing.setUp")}
                </Button>
              </Can>
            }
          />
        </Panel>
      ) : (
        <>
          <ul aria-label={t("admin.printing.stationsLabel")} className="m-0 flex list-none flex-col gap-3 p-0">
            {live.map((row) => (
              <li key={row.id} className="min-w-0">
                <StationCard row={row} onAction={setAction} />
              </li>
            ))}
          </ul>
          <Can do="platform.spool.manage">
            <div className="flex min-w-0 flex-col gap-2">
              <div>
                <Button variant="secondary" disabled={!active} onPress={() => setSetupOpen(true)}>
                  {t("admin.printing.addAnother")}
                </Button>
              </div>
              {active ? null : <p className="m-0 text-[14px] leading-6 text-muted-foreground">{inactiveText}</p>}
            </div>
          </Can>
        </>
      )}

      {history.length > 0 ? <History rows={history} /> : null}

      <SetupSheet
        open={setupOpen}
        onOpenChange={setSetupOpen}
        company={company}
        taken={rows.map((r) => r.subdomain)}
      />
      <RotateDialog action={action} onClose={() => setAction(null)} />
      <InstallDialog action={action} onClose={() => setAction(null)} />
      <DownloadsSheet action={action} onClose={() => setAction(null)} />
      <TurnOffDialog action={action} company={company} onClose={() => setAction(null)} />
    </div>
  );
}

function StationCard({ row, onAction }: { row: DeploymentRow; onAction(action: Action): void }) {
  const { t, locale } = useT();
  return (
    <Panel as="article" aria-labelledby={`station-${row.id}`} className="flex flex-col gap-5 p-5 sm:p-6">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-col gap-1">
          <p className="m-0 text-[13px] font-medium text-muted-foreground">{t("admin.printing.station")}</p>
          <h2
            id={`station-${row.id}`}
            data-no-truncate=""
            className="m-0 font-mono text-[15px] font-semibold text-foreground [overflow-wrap:anywhere] sm:text-[17px]"
          >
            {row.spoolDomain}
          </h2>
        </div>
        <Chip tone={printingTone(row.status)} truncate={false}>{t(printingKey(row.status))}</Chip>
      </div>

      <dl className="m-0 grid grid-cols-1 gap-4 min-[420px]:grid-cols-3">
        <Fact label={t("admin.printing.version")}>
          {row.spoolVersion ? <span className="font-mono">{row.spoolVersion}</span> : t("admin.printing.versionUnknown")}
        </Fact>
        <Fact label={t("admin.printing.lastSeen")}>
          {row.lastSeenAt ? formatAgo(row.lastSeenAt, { locale }) : t("admin.printing.never")}
        </Fact>
        <Fact label={t("admin.printing.setUpOn")}>{formatDay(row.createdAt, { locale })}</Fact>
      </dl>

      <Can do="platform.spool.manage">
      <div className="grid grid-cols-1 gap-2 border-t border-border pt-4 min-[420px]:grid-cols-2 lg:flex lg:flex-wrap">
        <Button variant="secondary" onPress={() => onAction({ kind: "install", row })}>
          <TerminalSquare aria-hidden="true" strokeWidth={2} />
          {t("admin.printing.installScript")}
        </Button>
        <Button variant="secondary" onPress={() => onAction({ kind: "downloads", row })}>
          <Download aria-hidden="true" strokeWidth={2} />
          {t("admin.printing.downloads")}
        </Button>
        <Button variant="secondary" onPress={() => onAction({ kind: "rotate", row })}>
          <KeyRound aria-hidden="true" strokeWidth={2} />
          {t("admin.printing.rotateSecret")}
        </Button>
        <Button
          variant="secondary"
          className="text-destructive lg:ml-auto"
          onPress={() => onAction({ kind: "turnOff", row })}
        >
          <Power aria-hidden="true" strokeWidth={2} />
          {t("admin.printing.turnOff")}
        </Button>
      </div>
      </Can>
    </Panel>
  );
}

function History({ rows }: { rows: DeploymentRow[] }) {
  const { t, locale } = useT();
  return (
    <details className="group rounded-card border border-border bg-card">
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 rounded-card px-5 text-[15px] font-semibold text-foreground [&::-webkit-details-marker]:hidden">
        <span>{t("admin.printing.history")}</span>
        <span className="flex items-center gap-2">
          <span className="font-mono text-[13px] text-muted-foreground tabular-nums">{rows.length}</span>
          {/* The disclosure's affordance: points down when closed, up when open. */}
          <ChevronDown
            aria-hidden="true"
            strokeWidth={2}
            className="size-4 text-muted-foreground transition-transform duration-[var(--dur-fast)] group-open:rotate-180"
          />
        </span>
      </summary>
      <ul className="m-0 flex list-none flex-col border-t border-border p-0">
        {rows.map((row) => (
          <li
            key={row.id}
            className="flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-border px-5 py-3 first:border-t-0"
          >
            <span className="min-w-0 font-mono text-[13px] text-foreground [overflow-wrap:anywhere]">{row.spoolDomain}</span>
            <span className="flex items-center gap-3 text-[13px] text-muted-foreground">
              <Chip tone="red" truncate={false}>{t("status.printSetup.revoked")}</Chip>
              {/* The set-up day (when it was turned off is not recorded): labelled, so it never reads as the turn-off day. */}
              <span className="whitespace-nowrap">{t("admin.printing.setUpDay", { date: formatDay(row.createdAt, { locale }) })}</span>
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}

function useInvalidateStations() {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: trpc.platform.spoolDeploymentsList.queryKey() }),
      qc.invalidateQueries({ queryKey: trpc.platform.companiesList.queryKey() }),
    ]);
}

/** A station address that wraps after a dot (`review-x.` / `spool.orrn.in`), not in the middle of a word. */
function Address({ value }: { value: string }) {
  const parts = value.split(".");
  return (
    <code className="font-mono text-foreground [overflow-wrap:anywhere]">
      {parts.map((part, i) => (
        <Fragment key={i}>
          {part}
          {i < parts.length - 1 ? (
            <>
              .<wbr />
            </>
          ) : null}
        </Fragment>
      ))}
    </code>
  );
}

/** Splits a translated sentence around one `{address}` so the address can be set in mono. */
function AddressSentence({ messageKey, address }: { messageKey: MessageKey; address: string }) {
  const { t } = useT();
  const [before = "", after = ""] = t(messageKey, { address: "\u0000" }).split("\u0000");
  return (
    <>
      {before}
      <Address value={address} />
      {after}
    </>
  );
}

function SetupSheet({
  open,
  onOpenChange,
  company,
  taken,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  company: PrintingCompany;
  /** Every station name this company has used, turned off ones included (the server counts them). */
  taken: string[];
}) {
  const { t } = useT();
  const formId = useId();
  const invalidate = useInvalidateStations();
  const [name, setName] = useState(() => freeStationName(company.slug, taken));
  // A new suggestion each time it opens: the list may have changed (a station added or turned off).
  const [openedFor, setOpenedFor] = useState(open);
  if (open !== openedFor) {
    setOpenedFor(open);
    if (open) setName(freeStationName(company.slug, taken));
  }
  const [error, setError] = useState<string | undefined>();
  const [created, setCreated] = useState<CreatedDeployment | null>(null);

  const create = useMutation({
    ...trpc.platform.spoolDeploymentCreate.mutationOptions(),
    onSuccess: async (result) => {
      // No toast here: it would sit over the sheet's Done button. The sheet says it instead.
      setCreated(result);
      await invalidate();
    },
    onError: (err) => {
      if (errorCode(err) === "CONFLICT") setError(t("admin.printing.nameTaken"));
      else toast.error(errorText(t, err));
    },
  });

  const reset = () => {
    setCreated(null);
    setError(undefined);
    create.reset();
  };
  // The one way to close (Cancel, Done, Escape, the X): never mid-request, and it forgets the last attempt.
  const close = () => {
    if (create.isPending) return;
    onOpenChange(false);
    reset();
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const problem = validateStationName(name);
    if (problem) {
      setError(
        t(
          problem === "required"
            ? "admin.printing.nameRequired"
            : problem === "length"
              ? "admin.printing.nameLength"
              : "admin.printing.nameFormat",
        ),
      );
      return;
    }
    setError(undefined);
    create.mutate({ companyId: company.id, subdomain: name });
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
      title={created ? t("admin.printing.secretsTitle") : t("admin.printing.setUp")}
      description={created ? t("admin.printing.secretsBody") : undefined}
      footer={
        created ? (
          <Button className="pointer-coarse:h-14" onPress={close}>
            {t("common.done")}
          </Button>
        ) : (
          <>
            <Button variant="secondary" disabled={create.isPending} onPress={close}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" form={formId} loading={create.isPending} className="pointer-coarse:h-14">
              {t("admin.printing.create")}
            </Button>
          </>
        )
      }
    >
      {created ? (
        <div className="flex flex-col gap-4">
          <p
            role="status"
            className="m-0 flex items-center gap-2 rounded-input bg-tone-green-tint px-4 py-3 text-[15px] font-semibold text-tone-green-ink"
          >
            <CircleCheck aria-hidden="true" className="size-5 shrink-0" strokeWidth={2} />
            {t("admin.printing.created")}
          </p>
          <CopyField label={t("admin.printing.address")} value={created.spoolDomain} />
          <CopyField label={t("admin.printing.instanceId")} value={created.instanceId} />
          <CopyField label={t("admin.printing.sharedSecret")} value={created.sharedSecret} />
          <CopyField label={t("admin.printing.tunnelToken")} value={created.cfTunnelToken} />
        </div>
      ) : (
        <form id={formId} onSubmit={submit} noValidate className="flex flex-col gap-3">
          <Field label={t("admin.printing.nameLabel")} hint={t("admin.printing.nameHint")} error={error}>
            <TextInput
              value={name}
              onChange={(e) => {
                setName(e.target.value.toLowerCase().replace(/\s+/g, "-"));
                if (error) setError(undefined);
              }}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              autoComplete="off"
              maxLength={63}
              className="font-mono"
            />
          </Field>
          <p className="m-0 text-[14px] leading-6 text-muted-foreground" aria-live="polite">
            <AddressSentence messageKey="admin.printing.namePreview" address={`${name || "…"}${ADDRESS_SUFFIX}`} />
          </p>
        </form>
      )}
    </Sheet>
  );
}

/**
 * Rotate the shared secret: a confirmation (Dialog), then the new secret in
 * a sheet, shown once, the same way Set up shows its secrets.
 */
function RotateDialog({ action, onClose }: { action: Action | null; onClose(): void }) {
  const { t } = useT();
  const invalidate = useInvalidateStations();
  const [secret, setSecret] = useState<{ address: string; value: string } | null>(null);
  const row = action?.kind === "rotate" ? action.row : null;
  const shown = useLastValue(row);
  const rotate = useMutation({
    ...trpc.platform.spoolDeploymentRegenerateSecret.mutationOptions(),
    onSuccess: async (result, variables) => {
      const address = shown?.id === variables.id ? shown.spoolDomain : "";
      setSecret({ address, value: result.sharedSecret });
      onClose();
      await invalidate();
    },
    onError: (err) => toast.error(errorText(t, err)),
  });

  return (
    <>
      <ConfirmDialog
        open={row !== null}
        onOpenChange={(open) => (open ? undefined : onClose())}
        title={shown ? <AddressSentence messageKey="admin.printing.rotateTitle" address={shown.spoolDomain} /> : ""}
        body={t("admin.printing.rotateBody")}
        confirmLabel={t("admin.printing.rotateSecret")}
        pending={rotate.isPending}
        onConfirm={() => row && rotate.mutate({ id: row.id })}
      />
      <Sheet
        open={secret !== null}
        onOpenChange={(open) => (open ? undefined : setSecret(null))}
        title={t("admin.printing.rotated")}
        description={t("admin.printing.secretsBody")}
        footer={
          <Button className="pointer-coarse:h-14" onPress={() => setSecret(null)}>
            {t("common.done")}
          </Button>
        }
      >
        {secret ? (
          <div className="flex flex-col gap-4">
            {secret.address ? <CopyField label={t("admin.printing.address")} value={secret.address} /> : null}
            <CopyField label={t("admin.printing.newSecret")} value={secret.value} />
          </div>
        ) : null}
      </Sheet>
    </>
  );
}

/** Saves text as a file in the browser (the script is built by the server, nothing is fetched). */
function saveTextFile(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/x-shellscript;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function InstallDialog({ action, onClose }: { action: Action | null; onClose(): void }) {
  const { t } = useT();
  const row = action?.kind === "install" ? action.row : null;
  const shown = useLastValue(row);
  const install = useMutation({
    ...trpc.platform.spoolDeploymentDockerInstallScript.mutationOptions(),
    onSuccess: (result) => {
      saveTextFile(result.filename, result.script);
      toast.success(t("admin.printing.installed"));
      onClose();
    },
    onError: (err) => toast.error(errorText(t, err)),
  });
  return (
    <ConfirmDialog
      open={row !== null}
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={t("admin.printing.installTitle")}
      body={shown ? <AddressSentence messageKey="admin.printing.installBody" address={shown.spoolDomain} /> : ""}
      confirmLabel={t("admin.printing.installDownload")}
      pending={install.isPending}
      onConfirm={() => row && install.mutate({ id: row.id })}
    />
  );
}

/** Pick the computer, then download the print station app (a form, so a sheet). */
function DownloadsSheet({ action, onClose }: { action: Action | null; onClose(): void }) {
  const { t } = useT();
  const groupId = useId();
  const row = action?.kind === "downloads" ? action.row : null;
  const shown = useLastValue(row);
  const [platform, setPlatform] = useState<DownloadPlatform>("darwin-arm64");
  const download = useMutation({
    ...trpc.platform.spoolDeploymentDownloadUrl.mutationOptions(),
    onSuccess: (result) => {
      const a = document.createElement("a");
      a.href = result.downloadUrl;
      a.download = result.filename;
      a.rel = "noopener";
      a.click();
      toast.success(t("admin.printing.downloadStarted"));
      onClose();
    },
    onError: (err) => toast.error(errorText(t, err)),
  });
  const close = () => {
    if (!download.isPending) onClose();
  };

  return (
    <Sheet
      open={row !== null}
      onOpenChange={(open) => (open ? undefined : close())}
      title={t("admin.printing.downloadsTitle")}
      footer={
        <>
          <Button variant="secondary" disabled={download.isPending} onPress={close}>
            {t("common.cancel")}
          </Button>
          <Button
            loading={download.isPending}
            className="pointer-coarse:h-14"
            onPress={() => row && download.mutate({ id: row.id, platform })}
          >
            <Download aria-hidden="true" strokeWidth={2} />
            {t("admin.printing.download")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        {shown ? (
          <p className="m-0 text-[15px] leading-6 text-muted-foreground">
            <AddressSentence messageKey="admin.printing.downloadsBody" address={shown.spoolDomain} />
          </p>
        ) : null}
        <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
          <legend className="mb-2 p-0 text-[14px] font-semibold text-foreground">{t("admin.printing.computer")}</legend>
          {PLATFORMS.map((p) => {
            const id = `${groupId}-${p.value}`;
            const checked = platform === p.value;
            return (
              <label
                key={p.value}
                htmlFor={id}
                className={cn(
                  "flex min-h-12 cursor-pointer items-center gap-3 rounded-input border px-4 text-[15px] font-medium transition-colors duration-[var(--dur-fast)]",
                  checked ? "border-primary bg-tone-violet-tint text-foreground" : "border-border bg-card hover:bg-surface-sunken",
                )}
              >
                <input
                  id={id}
                  type="radio"
                  name={groupId}
                  value={p.value}
                  checked={checked}
                  onChange={() => setPlatform(p.value)}
                  className="size-[18px] accent-[var(--primary)]"
                />
                {t(p.key)}
              </label>
            );
          })}
        </fieldset>
      </div>
    </Sheet>
  );
}

function TurnOffDialog({
  action,
  company,
  onClose,
}: {
  action: Action | null;
  company: PrintingCompany;
  onClose(): void;
}) {
  const { t } = useT();
  const invalidate = useInvalidateStations();
  const row = action?.kind === "turnOff" ? action.row : null;
  const shown = useLastValue(row);
  const revoke = useMutation({
    ...trpc.platform.spoolDeploymentRevoke.mutationOptions(),
    onSuccess: async () => {
      toast.success(t("admin.printing.turnedOff"));
      await invalidate();
      onClose();
    },
    onError: (err) => toast.error(errorText(t, err)),
  });
  return (
    <ConfirmDialog
      open={row !== null}
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={shown ? <AddressSentence messageKey="admin.printing.turnOffTitle" address={shown.spoolDomain} /> : ""}
      body={t("admin.printing.turnOffBody", { company: company.name })}
      confirmLabel={t("admin.printing.turnOffShort")}
      tone="danger"
      pending={revoke.isPending}
      onConfirm={() => row && revoke.mutate({ id: row.id })}
    />
  );
}

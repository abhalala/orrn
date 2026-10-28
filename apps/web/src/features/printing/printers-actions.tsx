import { useT } from "@orrn/i18n";
import { Button, IconButton } from "@orrn/ui/components/button";
import { Dialog } from "@orrn/ui/components/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@orrn/ui/components/dropdown-menu";
import { Field, useFieldControl } from "@orrn/ui/components/field";
import { useMutation } from "@tanstack/react-query";
import { Clock, EllipsisVertical, Printer, Ruler, SlidersHorizontal, Type } from "lucide-react";
import { useState, type ChangeEvent } from "react";
import { toast } from "sonner";

import { errorCode } from "@/features/admin/error-code";
import { trpc } from "@/shared/utils/trpc";

import { FONT_MAX_BYTES, testPrinterId } from "./printers-model";

/** What went wrong sending a printer command, in floor words. */
export function useCommandError() {
  const { t } = useT();
  return (error: unknown) => {
    const code = errorCode(error);
    if (code === "NOT_FOUND") return t("printing.printers.errors.noComputer");
    if (code === "BAD_REQUEST") return t("printing.printers.errors.notSupported");
    if (code === "FORBIDDEN") return t("printing.printers.errors.forbidden");
    return t("printing.printers.errors.failed");
  };
}

/**
 * The admin actions on one label printer (`spool.manage_printers`): settings, a test label, and the device
 * commands the server supports (calibrate, set the clock, load a font). Calibrating wastes labels and a font
 * replaces one in the printer's memory, so both ask first. Each is a command the print computer picks up when it
 * next checks in, and the toast says so.
 */
export function PrinterActions({
  profile,
  onOpenSettings,
}: {
  profile: { id: string; name: string; spoolPrinterId: string };
  onOpenSettings(): void;
}) {
  const { t } = useT();
  const commandError = useCommandError();
  const [confirm, setConfirm] = useState<"calibrate" | "font" | null>(null);
  const onSent = () => toast.success(t("printing.printers.sent"));
  const onError = (error: unknown) => toast.error(commandError(error));
  const testPrint = useMutation(trpc.spool.testPrinter.mutationOptions({ onSuccess: onSent, onError }));
  const device = useMutation(
    trpc.spool.deviceAction.mutationOptions({
      onSuccess: () => {
        setConfirm(null);
        onSent();
      },
      onError,
    }),
  );

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton
            label={t("printing.printers.actionsFor", { name: profile.name })}
            icon={<EllipsisVertical strokeWidth={2} />}
            variant="secondary"
            aria-busy={testPrint.isPending || (device.isPending && confirm === null) || undefined}
            data-testid="printer-actions"
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-56">
          <DropdownMenuItem onSelect={onOpenSettings} data-testid="printer-settings-open">
            <SlidersHorizontal aria-hidden="true" strokeWidth={2} />
            {t("printing.printers.settings.open")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => testPrint.mutate({ printerId: testPrinterId(profile.spoolPrinterId) })} data-testid="printer-test">
            <Printer aria-hidden="true" strokeWidth={2} />
            {t("printing.printers.testPrint")}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setConfirm("calibrate")} data-testid="printer-calibrate">
            <Ruler aria-hidden="true" strokeWidth={2} />
            {t("printing.printers.calibrate.open")}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => device.mutate({ profileId: profile.id, action: "set_rtc", rtc: new Date().toISOString() })}
            data-testid="printer-clock"
          >
            <Clock aria-hidden="true" strokeWidth={2} />
            {t("printing.printers.setClock")}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setConfirm("font")} data-testid="printer-font">
            <Type aria-hidden="true" strokeWidth={2} />
            {t("printing.printers.font.open")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog
        open={confirm === "calibrate"}
        onOpenChange={(open) => !open && !device.isPending && setConfirm(null)}
        title={t("printing.printers.calibrate.title", { name: profile.name })}
        description={t("printing.printers.calibrate.body")}
        actions={
          <>
            <Button variant="secondary" onClick={() => setConfirm(null)} disabled={device.isPending}>
              {t("common.cancel")}
            </Button>
            <Button
              loading={device.isPending}
              onClick={() => device.mutate({ profileId: profile.id, action: "calibrate" })}
              data-testid="printer-calibrate-confirm"
            >
              {t("printing.printers.calibrate.confirm")}
            </Button>
          </>
        }
      />

      {confirm === "font" ? (
        <FontDialog
          name={profile.name}
          pending={device.isPending}
          onCancel={() => setConfirm(null)}
          onLoad={(fontBase64) => device.mutate({ profileId: profile.id, action: "download_font", fontBase64 })}
        />
      ) : null}
    </>
  );
}

function FontDialog({ name, pending, onCancel, onLoad }: { name: string; pending: boolean; onCancel(): void; onLoad(fontBase64: string): void }) {
  const { t } = useT();
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [reading, setReading] = useState(false);

  const load = async () => {
    if (!file) {
      setError(t("printing.printers.font.required"));
      return;
    }
    setReading(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      onLoad(btoa(binary));
    } catch {
      setError(t("printing.printers.font.unreadable"));
    } finally {
      setReading(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && !pending && onCancel()}
      title={t("printing.printers.font.title", { name })}
      description={t("printing.printers.font.body")}
      actions={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={pending}>
            {t("common.cancel")}
          </Button>
          <Button loading={pending || reading} onClick={() => void load()} data-testid="printer-font-confirm">
            {t("printing.printers.font.confirm")}
          </Button>
        </>
      }
    >
      <Field label={t("printing.printers.font.field")} hint={t("printing.printers.font.hint")} error={error}>
        <FileInput
          accept=".ttf,font/ttf"
          onChange={(event) => {
            const next = event.currentTarget.files?.[0] ?? null;
            if (next && next.size > FONT_MAX_BYTES) {
              setFile(null);
              setError(t("printing.printers.font.tooBig"));
              return;
            }
            setFile(next);
            setError(undefined);
          }}
        />
      </Field>
    </Dialog>
  );
}

function FileInput({ accept, onChange }: { accept: string; onChange(event: ChangeEvent<HTMLInputElement>): void }) {
  const a11y = useFieldControl();
  return (
    <input
      type="file"
      accept={accept}
      onChange={onChange}
      data-testid="printer-font-file"
      className="block w-full min-w-0 rounded-input border border-input bg-card p-1.5 text-[14px] text-foreground file:mr-3 file:h-10 file:cursor-pointer file:rounded-full file:border-0 file:bg-surface-sunken file:px-4 file:text-[14px] file:font-semibold file:text-foreground"
      {...a11y}
    />
  );
}

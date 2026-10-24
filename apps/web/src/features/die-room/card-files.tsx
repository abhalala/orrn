import { useT } from "@orrn/i18n";
import { Badge } from "@orrn/ui/components/badge";
import { Button } from "@orrn/ui/components/button";
import { Checkbox } from "@orrn/ui/components/checkbox";
import { Dialog } from "@orrn/ui/components/dialog";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { useMutation } from "@tanstack/react-query";
import { useId, useRef, useState } from "react";
import { toast } from "sonner";

import { Can } from "@/shared/components/can";
import { trpc, trpcClient } from "@/shared/utils/trpc";

import { uploadDieFile } from "./die-file-upload";
import { bytesText, dieFileKind } from "./die-room-model";
import type { CardData } from "./types";
import { useRefreshDieRoom, useRefusal } from "./use-die-room";

/** Files of the section and of this copy: open (signed link), add, remove. The press drawing is the PDF the press reads. */
export function FilesPanel({ card }: { card: CardData }) {
  const { t } = useT();
  const refresh = useRefreshDieRoom();
  const refusal = useRefusal();
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [drawing, setDrawing] = useState(false);
  const [removing, setRemoving] = useState<{ id: string; filename: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const upload = useMutation({
    mutationFn: uploadDieFile,
    onSuccess: async () => {
      await refresh();
      toast.success(t("dieRoom.files.added"));
      setDrawing(false);
      setError(null);
      if (input.current) input.current.value = "";
    },
    onError: (e) => setError(refusal(e)),
  });
  const remove = useMutation({
    ...trpc.dieInstance.files.remove.mutationOptions(),
    onSuccess: async () => {
      await refresh();
      setRemoving(null);
      toast.success(t("dieRoom.files.removed"));
    },
    onError: (e) => {
      setRemoving(null);
      toast.error(refusal(e));
    },
  });

  const open = async (id: string) => {
    try {
      const { url } = await trpcClient.dieInstance.files.url.query({ id });
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (e) {
      toast.error(refusal(e));
    }
  };

  const pick = (file: File | undefined) => {
    if (!file) return;
    const kind = dieFileKind(file);
    if (!kind) return setError(t("dieRoom.files.badType"));
    if (drawing && kind !== "pdf") return setError(t("dieRoom.files.drawingPdf"));
    setError(null);
    upload.mutate({ sectionId: card.instance.sectionId, dieInstanceId: card.instance.id, kind, file, pressDrawing: drawing });
  };

  return (
    <div className="flex flex-col gap-3">
      {card.files.length === 0 ? (
        <EmptyState title={t("dieRoom.files.empty")} body={t("dieRoom.files.emptyBody")} />
      ) : (
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {card.files.map((f) => (
            <li key={f.id} className="flex min-w-0 flex-wrap items-center gap-3 rounded-card border border-border bg-card p-4">
              <div className="min-w-0 flex-1">
                <p className="m-0 font-mono text-[14px] font-semibold break-all">{f.filename}</p>
                <p className="m-0 text-[13px] text-muted-foreground">
                  {f.kind.toUpperCase()} · {bytesText(f.bytes)}
                  {f.dieInstanceId ? "" : ` · ${t("dieRoom.files.wholeSection")}`}
                </p>
              </div>
              {f.pressDrawing ? <Badge tone="info">{t("dieRoom.card.drawing")}</Badge> : null}
              <Button variant="secondary" onClick={() => open(f.id)}>
                {f.pressDrawing ? t("dieRoom.files.openDrawing") : t("common.download")}
              </Button>
              <Can do={["die.card", "masters.publish"]}>
                <Button variant="secondary" onClick={() => setRemoving({ id: f.id, filename: f.filename })}>
                  {t("common.remove")}
                </Button>
              </Can>
            </li>
          ))}
        </ul>
      )}

      <Can do={["die.card", "masters.publish"]}>
        <div className="flex min-w-0 flex-col gap-3 rounded-card border border-border bg-card p-4">
          <label htmlFor={inputId} className="text-[14px] font-semibold">
            {t("dieRoom.card.addFile")}
          </label>
          <input
            ref={input}
            id={inputId}
            type="file"
            disabled={upload.isPending}
            onChange={(e) => pick(e.target.files?.[0])}
            className="min-h-11 text-[14px]"
          />
          <label className="flex min-h-11 items-center gap-3 text-[14px]">
            <Checkbox checked={drawing} onCheckedChange={(v) => setDrawing(v === true)} />
            {t("dieRoom.files.asDrawing")}
          </label>
          <p className="m-0 text-[13px] leading-5 text-muted-foreground">{t("dieRoom.files.limits")}</p>
          {error ? (
            <p role="alert" className="m-0 text-[14px] leading-5 font-medium text-destructive">
              {error}
            </p>
          ) : null}
        </div>
      </Can>

      <Dialog
        open={removing !== null}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={t("dieRoom.files.removeTitle", { name: removing?.filename ?? "" })}
        description={t("dieRoom.files.removeBody")}
        actions={
          <>
            <Button variant="secondary" onClick={() => setRemoving(null)}>
              {t("common.cancel")}
            </Button>
            <Button variant="danger" loading={remove.isPending} onClick={() => removing && remove.mutate({ id: removing.id })}>
              {t("common.remove")}
            </Button>
          </>
        }
      />
    </div>
  );
}

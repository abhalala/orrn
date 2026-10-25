import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { useMutation } from "@tanstack/react-query";

import { trpcClient } from "@/shared/utils/trpc";

import { base64ToBlob, savedName } from "./spectro-file";
import { ErrorLine } from "./ui";

/**
 * "View file" for an attached spectro result (FP-FD-11): fetches the stored file (`foundry.spectro.file`,
 * any member of the plant) and opens it in a new tab as a short-lived blob address. A blocked pop-up
 * falls back to saving the file. Shown only for a result that has its bytes (`hasFile`).
 */
export function SpectroFileLink({ id, fileName, className }: { id: string; fileName: string; className?: string }) {
  const { t } = useT();
  const open = useMutation({
    mutationFn: async () => {
      // The tab opens on the tap itself (a pop-up blocker allows that), the file follows when it arrives.
      const tab = window.open("", "_blank");
      try {
        const file = await trpcClient.foundry.spectro.file.query({ id });
        const url = URL.createObjectURL(base64ToBlob(file.base64, file.mime));
        if (tab) tab.location.href = url;
        else {
          const a = document.createElement("a");
          a.href = url;
          a.download = savedName(file.fileName);
          a.click();
        }
        window.setTimeout(() => URL.revokeObjectURL(url), 10 * 60_000);
      } catch (e) {
        tab?.close();
        throw e;
      }
    },
  });
  return (
    <>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className={`print:hidden ${className ?? ""}`}
        loading={open.isPending}
        onClick={() => open.mutate()}
        aria-label={t("foundry.spectro.viewFileOf", { name: fileName })}
        data-testid="spectro-view-file"
      >
        {t("foundry.spectro.viewFile")}
      </Button>
      {open.error ? <ErrorLine error={open.error} className="print:hidden" /> : null}
    </>
  );
}

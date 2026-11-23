import { useT } from "@orrn/i18n";
import { useCallback, useMemo } from "react";

import { usePaperFmt } from "@/shared/lib/fmt";
import { paperT } from "@/shared/lib/fmt-text";

import { buildProformaPaper, type ProformaSnapshot } from "./docs-model";

/**
 * Print a proforma invoice from its frozen snapshot (A4). A paper: today's units and words (`paper-guard.test.ts`
 * lists this file). It says "Proforma invoice. Not a tax invoice.", shows the tax as an estimate and the bank line
 * (or "Bank details not set"). The page builder loads on click.
 */
export function usePrintProforma(): (snapshot: ProformaSnapshot) => Promise<void> {
  const fmt = usePaperFmt();
  const { t: tUi } = useT();
  const t = useMemo(() => paperT(tUi), [tUi]);
  return useCallback(
    async (snapshot: ProformaSnapshot) => {
      const doc = buildProformaPaper(snapshot, fmt, t);
      const { buildPaperHtml, printPaperHtml } = await import("./paper-html");
      printPaperHtml(buildPaperHtml(doc));
    },
    [fmt, t],
  );
}

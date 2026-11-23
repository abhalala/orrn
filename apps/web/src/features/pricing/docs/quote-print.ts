import { useT } from "@orrn/i18n";
import { useCallback, useMemo } from "react";

import { usePaperFmt } from "@/shared/lib/fmt";
import { paperT } from "@/shared/lib/fmt-text";

import { buildQuotePaper, type QuoteGet } from "./docs-model";

/**
 * Print the quote (A4, the browser's print dialog also saves a PDF). A paper: today's units, words, date order and
 * clock whatever the plant chose for its screens (`paper-guard.test.ts` lists this file). The page builder loads on click.
 */
export function usePrintQuote(): (data: QuoteGet) => Promise<void> {
  const fmt = usePaperFmt();
  const { t: tUi } = useT();
  const t = useMemo(() => paperT(tUi), [tUi]);
  return useCallback(
    async (data: QuoteGet) => {
      const doc = buildQuotePaper(data, fmt, t);
      const { buildPaperHtml, printPaperHtml } = await import("./paper-html");
      printPaperHtml(buildPaperHtml(doc));
    },
    [fmt, t],
  );
}

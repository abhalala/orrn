import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { trpc } from "@/shared/utils/trpc";

import { SAMPLE_BUNDLE, type LabelValues } from "./label-metrics";

/**
 * Label values for previews: the given bundle, else the company's newest bundle, exactly as a print
 * of it would send them. Falls back to example values when the company has no bundles yet.
 */
export function useLabelSample(serial?: string) {
  // A typed bundle number that does not exist is said inline by the sample panel, not as a toast.
  const query = useQuery({ ...trpc.spool.labelDocuments.sample.queryOptions({ serial }), retry: false, staleTime: 60_000, meta: { inlineError: true } });
  const values: LabelValues = useMemo(() => (query.data ? { ...SAMPLE_BUNDLE, ...query.data.variables } : SAMPLE_BUNDLE), [query.data]);
  return { values, serial: query.data?.serial, query };
}

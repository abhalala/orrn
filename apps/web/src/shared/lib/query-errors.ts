/**
 * Queries whose screen shows its own error state (an inline "didn't load"
 * with Try again, a ChartCard error) pass `meta: INLINE_ERROR_META`, so the
 * global error toast in shared/utils/trpc.ts stays quiet and the person sees
 * one message, in the screen's words, not two.
 */
export const INLINE_ERROR_META = { inlineError: true } as const;

export function hasInlineError(query: { meta?: Record<string, unknown> }): boolean {
  return query.meta?.inlineError === true;
}

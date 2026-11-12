export function storeReadState<T>(data: { items: T[] } | undefined, error: unknown): { items: T[]; inlineError: unknown } {
  return { items: data?.items ?? [], inlineError: error ?? null };
}

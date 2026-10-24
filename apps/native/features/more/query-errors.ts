/** A tRPC NOT_FOUND: the die or customer was deleted, or belongs to another company. */
export function isNotFound(error: unknown): boolean {
  return (error as { data?: { code?: unknown } } | null | undefined)?.data?.code === "NOT_FOUND";
}

import { TRPCError } from "@trpc/server";

type Code = ConstructorParameters<typeof TRPCError>[0]["code"];

/**
 * A TRPCError that carries a machine-readable `meta` for the screen (e.g. the band a duplicate
 * guard hit, the owner a die belongs to). The error formatter copies it to `error.data.meta`;
 * server callers (tests, other procedures) read `.meta` on the error itself.
 */
export class TRPCMetaError extends TRPCError {
  readonly meta: Record<string, unknown>;
  constructor(opts: { code: Code; message: string; meta: Record<string, unknown> }) {
    super({ code: opts.code, message: opts.message });
    this.meta = opts.meta;
  }
}

export function errorMetaOf(error: unknown): Record<string, unknown> | undefined {
  return error instanceof TRPCMetaError ? error.meta : undefined;
}

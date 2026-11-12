/**
 * Provenance in audit rows (plan A6). The merge adapters put an `IngestSource` on the caller context;
 * every procedure they call spreads `sourceMeta(ctx)` into the audit meta it already writes. Outside a
 * merge the context has no source and the meta is unchanged.
 */
import type { IngestSource } from "../source";

export function sourceMeta(ctx: { ingestSource?: IngestSource }): { source?: IngestSource } {
  return ctx.ingestSource ? { source: ctx.ingestSource } : {};
}

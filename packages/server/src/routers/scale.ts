import { TRPCError } from "@trpc/server";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { spoolDeployment } from "@orrn/db/schema/spool";
import { unwrapSecret } from "@orrn/crypto";
import { env } from "@orrn/env/server";

import {
  normalizeScaleReading,
  scaleSimulatorEnabled,
  scaleUnavailable,
  simulatedScaleReading,
  type ScaleReading,
} from "../lib/scale";
import { SpoolClient, spoolBaseUrl } from "../lib/spool-client";
import { actionProcedure, router } from "../index";

/**
 * `scale.reading`: the packing-bay scale through the plant's edge node (FP-PK-02).
 * Holders of `bundle.pack` only (they are the ones filling a bundle weight). The node is looked up
 * inside the caller's company; another company's node id is a plain "Not found".
 * Never throws for a slow, offline or misbehaving node: the answer is `{ stable: false }`.
 */
export const scaleRouter = router({
  reading: actionProcedure("bundle.pack")
    .input(z.object({ nodeId: z.string().uuid().optional() }).optional())
    .query(async ({ ctx, input }): Promise<ScaleReading> => {
      const companyId = ctx.companyId;
      const nodeId = input?.nodeId;

      const node = nodeId
        ? await ctx.db
            .select()
            .from(spoolDeployment)
            .where(and(eq(spoolDeployment.id, nodeId), eq(spoolDeployment.companyId, companyId)))
            .get()
        : await ctx.db
            .select()
            .from(spoolDeployment)
            .where(and(eq(spoolDeployment.companyId, companyId), eq(spoolDeployment.status, "active")))
            .orderBy(desc(spoolDeployment.createdAt))
            .limit(1)
            .get();

      if (nodeId && !node) throw new TRPCError({ code: "NOT_FOUND", message: "Not found" });

      if (scaleSimulatorEnabled(env)) {
        return { ...simulatedScaleReading(Date.now()), nodeId: node?.id ?? null };
      }

      if (!node) return scaleUnavailable("no_node", null, false);
      const configured = node.scaleConfigured ?? false;
      if (node.status !== "active") return scaleUnavailable("node_inactive", node.id, configured);

      try {
        const secret = await unwrapSecret(node.sharedSecretWrapped, env.ORRN_MASTER_KEY);
        const client = new SpoolClient(spoolBaseUrl(node.nodeDomain), secret);
        return normalizeScaleReading(await client.scaleReading(), node.id);
      } catch {
        return scaleUnavailable("unreachable", node.id, configured);
      }
    }),
});

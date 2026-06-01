/**
 * Hono routes for orrn-spool integration.
 *
 * These are non-tRPC HTTP endpoints that receive:
 * 1. Webhook callbacks from spool instances (job status updates)
 * 2. Activation heartbeats from spool instances
 * 3. Update check requests from spool instances
 * 4. Signed download URLs for spool deliverables (GitHub binary + trailer patching)
 */

import { and, eq } from "drizzle-orm";
import { spoolDeployment } from "@orrn/db/schema/spool";
import { printLog } from "@orrn/db/schema/printing";
import { unwrapSecret } from "@orrn/crypto";
import { createDb } from "@orrn/db";
import { env } from "@orrn/env/server";
import { Hono } from "hono";
import type { Context as HonoContext } from "hono";

import { verifyWebhookSignature, verifySpoolToken, verifyDownloadToken } from "@orrn/server/lib/spool-crypto";
import { fetchSpoolBinary, normalizePlatform, resolveSpoolRelease } from "@orrn/server/lib/spool-release";
import { patchBinaryWithConfig, getDeliverableFilename, type Platform, type PackageConfig } from "@orrn/server/lib/spool-packager";

const spoolRoutes = new Hono();

// ─── Webhook: Spool → ORRN (job status updates) ──────────────────────────────

interface SpoolWebhookPayload {
  event: string;
  timestamp: string;
  data: {
    job_id: number;
    printer_id?: number;
    template_id?: number;
    status?: string;
    error_message?: string;
    duration_ms?: number;
    retry_count?: number;
  };
  signature?: string;
}

spoolRoutes.post("/webhooks/spool", async (c: HonoContext) => {
  const rawBody = await c.req.raw.arrayBuffer();
  const signature = c.req.header("X-Webhook-Signature");
  const subdomain = c.req.header("X-Spool-Subdomain");

  if (!signature || !subdomain) {
    return c.json({ error: "Missing signature or subdomain header" }, 400);
  }

  const db = createDb();

  // Find the deployment by subdomain
  const deployment = await db
    .select()
    .from(spoolDeployment)
    .where(and(eq(spoolDeployment.subdomain, subdomain), eq(spoolDeployment.status, "active")))
    .get();

  if (!deployment) {
    return c.json({ error: "Unknown or inactive deployment" }, 403);
  }

  // Verify webhook signature
  const sharedSecret = await unwrapSecret(deployment.sharedSecretWrapped, env.ORRN_MASTER_KEY);
  const isValid = await verifyWebhookSignature(new Uint8Array(rawBody), signature, sharedSecret);

  if (!isValid) {
    return c.json({ error: "Invalid signature" }, 403);
  }

  // Parse the payload
  let payload: SpoolWebhookPayload;
  try {
    payload = JSON.parse(new TextDecoder().decode(rawBody));
  } catch {
    return c.json({ error: "Invalid JSON payload" }, 400);
  }

  // Update print_log based on event type
  const { event, data } = payload;

  if (data.job_id && event !== "printer_status_changed") {
    const spoolJobId = String(data.job_id);

    // Find the print log entry for this spool job
    const log = await db
      .select()
      .from(printLog)
      .where(and(eq(printLog.companyId, deployment.companyId), eq(printLog.spoolJobId, spoolJobId)))
      .get();

    if (log) {
      const updates: Record<string, unknown> = {};

      switch (event) {
        case "job_started":
          updates.status = "sent";
          break;
        case "job_completed":
          updates.status = "success";
          if (data.duration_ms) updates.responseText = `Completed in ${data.duration_ms}ms`;
          break;
        case "job_failed":
          updates.status = "failed";
          updates.responseText = data.error_message ?? "Print job failed";
          break;
      }

      if (Object.keys(updates).length > 0) {
        await db.update(printLog).set(updates).where(eq(printLog.id, log.id));
      }
    }
  }

  return c.json({ ok: true });
});

// ─── Activation: Spool → ORRN (heartbeat + registration) ────────────────────

spoolRoutes.post("/webhooks/spool/activate", async (c: HonoContext) => {
  const body = await c.req.json<{
    instance_id: string;
    version?: string;
  }>();

  if (!body.instance_id) {
    return c.json({ error: "Missing instance_id" }, 400);
  }

  const db = createDb();

  const deployment = await db
    .select()
    .from(spoolDeployment)
    .where(eq(spoolDeployment.instanceId, body.instance_id))
    .get();

  if (!deployment) {
    return c.json({ error: "Unknown instance" }, 403);
  }

  if (deployment.status === "revoked") {
    return c.json({ error: "Deployment revoked" }, 403);
  }

  // Update status and last seen
  await db
    .update(spoolDeployment)
    .set({
      status: "active",
      lastSeenAt: new Date(),
      ...(body.version ? { spoolVersion: body.version } : {}),
    })
    .where(eq(spoolDeployment.id, deployment.id));

  return c.json({ status: "active", spool_domain: deployment.spoolDomain });
});

// ─── Update Check: Spool → ORRN (auto-update) ──────────────────────────────

interface UpdateCheckResponse {
  update_available: boolean;
  latest_version?: string;
  download_url?: string;
  checksum?: string;
}

spoolRoutes.get("/api/spool/update-check", async (c: HonoContext) => {
  const instanceId = c.req.query("instance_id");
  const currentVersion = c.req.query("version");
  const platform = c.req.query("platform");
  const authHeader = c.req.header("Authorization");

  if (!instanceId || !authHeader) {
    return c.json({ error: "Missing parameters" }, 400);
  }

  const db = createDb();

  const deployment = await db
    .select()
    .from(spoolDeployment)
    .where(eq(spoolDeployment.instanceId, instanceId))
    .get();

  if (!deployment || deployment.status === "revoked") {
    return c.json({ error: "Unknown or revoked instance" }, 403);
  }

  // Verify the auth token
  const token = authHeader.replace("Bearer ", "");
  const sharedSecret = await unwrapSecret(deployment.sharedSecretWrapped, env.ORRN_MASTER_KEY);
  const isValid = await verifySpoolToken("GET", "/api/spool/update-check", null, token, sharedSecret);

  if (!isValid) {
    return c.json({ error: "Invalid authentication" }, 403);
  }

  const response: UpdateCheckResponse = { update_available: false };
  const normalizedPlatform = normalizePlatform(platform);
  if (!normalizedPlatform) {
    return c.json(response);
  }

  try {
    const release = await resolveSpoolRelease(normalizedPlatform);
    const current = currentVersion ? currentVersion.replace(/^v/, "") : null;

    if (release && release.version !== current) {
      response.update_available = true;
      response.latest_version = release.version;
      response.download_url = release.downloadUrl;
      response.checksum = release.checksum ?? undefined;
    }
  } catch {
    // If GitHub is unavailable, just return no update
  }

  return c.json(response);
});

// ─── Deliverable Download: Platform Admin → ORRN ────────────────────────────
//
// Ninite-style: fetches the platform binary from GitHub releases, patches it
// with the deployment config trailer, and streams the result. The customer gets
// a single executable with their auth secrets baked in — no config editing needed.

spoolRoutes.get("/api/spool/deployments/:id/download/:platform", async (c: HonoContext) => {
  const { id, platform } = c.req.param();
  const token = c.req.query("token");

  if (!token || !id || !platform) {
    return c.json({ error: "Missing required parameters" }, 400);
  }

  // Validate platform
  const normalizedPlatform = normalizePlatform(platform);
  if (!normalizedPlatform) {
    return c.json({ error: "Invalid platform" }, 400);
  }

  // Verify download token
  const isValid = await verifyDownloadToken(id, platform, token, env.ORRN_MASTER_KEY);
  if (!isValid) {
    return c.json({ error: "Invalid or expired download token" }, 403);
  }

  const db = createDb();

  // Look up deployment
  const deployment = await db
    .select()
    .from(spoolDeployment)
    .where(eq(spoolDeployment.id, id))
    .get();

  if (!deployment || deployment.status === "revoked") {
    return c.json({ error: "Deployment not found or revoked" }, 404);
  }

  let release: Awaited<ReturnType<typeof resolveSpoolRelease>>;
  let binaryData: Uint8Array;
  try {
    release = await resolveSpoolRelease(normalizedPlatform, deployment.spoolVersion ?? undefined);
    binaryData = await fetchSpoolBinary(release.downloadUrl);
  } catch (error) {
    return c.json(
      {
        error: error instanceof Error ? error.message : "Failed to fetch spool binary from GitHub.",
      },
      404,
    );
  }

  if (!release) {
    return c.json({ error: "Failed to resolve spool release." }, 404);
  }

  // Unwrap secrets for the embedded config
  const sharedSecret = await unwrapSecret(deployment.sharedSecretWrapped, env.ORRN_MASTER_KEY);
  const cfTunnelToken = await unwrapSecret(deployment.cfTunnelTokenWrapped, env.ORRN_MASTER_KEY);

  // Build the config and patch the binary
  const config: PackageConfig = {
    instanceId: deployment.instanceId,
    subdomain: deployment.subdomain,
    spoolDomain: deployment.spoolDomain,
    sharedSecret,
    cfTunnelToken,
    orrnServerUrl: env.BETTER_AUTH_URL,
    tunnelEnabled: true,
    platform: normalizedPlatform as Platform,
    spoolVersion: release.version,
  };

  const patchedBinary = patchBinaryWithConfig(binaryData, config);
  const filename = getDeliverableFilename(deployment.subdomain, normalizedPlatform as Platform);

  // Stream the patched binary back
  return new Response(patchedBinary, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
      "X-Spool-Version": release.version,
    },
  });
});

export { spoolRoutes };
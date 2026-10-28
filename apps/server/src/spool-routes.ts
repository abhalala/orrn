/**
 * Hono routes for orrn-spool integration.
 *
 * These are non-tRPC HTTP endpoints that receive:
 * 1. Webhook callbacks from spool instances (job status updates)
 * 2. Activation heartbeats from spool instances
 * 3. Update check requests from spool instances
 * 4. Signed legacy spool downloads and immutable ORRN Edge release redirects
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
import {
  fetchSpoolBinary,
  normalizePlatform,
  resolveSpoolRelease,
  type ResolvedSpoolRelease,
} from "@orrn/server/lib/spool-release";
import { handleNodeHeartbeat } from "@orrn/server/lib/edge-heartbeat";
import { resolveEdgeReleaseArtifact } from "@orrn/server/lib/edge-release";
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

  // Update print_log based on event type. A signed body without `data` used to crash the handler
  // (500, so the spool retried forever); it is malformed, so say 400 (audit S18).
  if (!payload || typeof payload !== "object" || !payload.data || typeof payload.data !== "object") {
    return c.json({ error: "Missing data" }, 400);
  }
  const { event, data } = payload;

  if (data.job_id && event !== "printer_status_changed") {
    const spoolJobId = String(data.job_id);

    // Every print log row of this spool job: a retry answered as a duplicate records the first job's id
    // too, so more than one row can share it (BACKLOG 44).
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
      await db
        .update(printLog)
        .set(updates)
        .where(and(eq(printLog.companyId, deployment.companyId), eq(printLog.spoolJobId, spoolJobId)));
    }
  }

  return c.json({ ok: true });
});

// ─── Activation: Spool → ORRN (heartbeat + registration) ────────────────────

spoolRoutes.post("/webhooks/spool/activate", async (c: HonoContext) => {
  const rawBody = new Uint8Array(await c.req.raw.arrayBuffer());
  const result = await handleNodeHeartbeat(createDb(), {
    rawBody,
    authorization: c.req.header("Authorization"),
    masterKey: env.ORRN_MASTER_KEY,
  });
  return c.json(result.body, result.status);
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
  if (deployment.installId !== null || deployment.enrollmentIssuedAt !== null) {
    return c.json({ error: "ORRN Edge releases are immutable; use the Edge node download path." }, 400);
  }


  let release: ResolvedSpoolRelease;
  let binaryData: Uint8Array;
  try {
    const resolvedRelease = await resolveSpoolRelease(normalizedPlatform, deployment.runtimeVersion ?? undefined);
    if (!resolvedRelease) {
      throw new Error("Failed to resolve spool release.");
    }
    release = resolvedRelease;
    binaryData = await fetchSpoolBinary(release.downloadUrl);
  } catch (error) {
    return c.json(
      {
        error: error instanceof Error ? error.message : "Failed to fetch spool binary from GitHub.",
      },
      404,
    );
  }

  // Unwrap secrets for the embedded config
  const sharedSecret = await unwrapSecret(deployment.sharedSecretWrapped, env.ORRN_MASTER_KEY);
  const cfTunnelToken = await unwrapSecret(deployment.cfTunnelTokenWrapped, env.ORRN_MASTER_KEY);

  // Build the config and patch the binary
  const config: PackageConfig = {
    instanceId: deployment.instanceId,
    subdomain: deployment.subdomain,
    spoolDomain: deployment.nodeDomain,
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

async function forwardAlias(c: HonoContext, targetPath: string) {
  const url = new URL(c.req.url);
  const targetUrl = new URL(targetPath, url.origin);
  targetUrl.search = url.search;
  const body = c.req.method === "GET" || c.req.method === "HEAD" ? undefined : await c.req.raw.clone().arrayBuffer();
  const request = new Request(targetUrl, {
    method: c.req.method,
    headers: c.req.raw.headers,
    body,
  });
  return spoolRoutes.fetch(request);
}

spoolRoutes.post("/webhooks/edge/print-events", async (c: HonoContext) => {
  return forwardAlias(c, "/webhooks/spool");
});

spoolRoutes.post("/webhooks/edge/heartbeat", async (c: HonoContext) => {
  return forwardAlias(c, "/webhooks/spool/activate");
});

spoolRoutes.get("/api/edge/update-check", async (c: HonoContext) => {
  return forwardAlias(c, "/api/spool/update-check");
});

spoolRoutes.get("/api/edge/nodes/:id/download/:platform", async (c: HonoContext) => {
  const { id, platform } = c.req.param();
  const token = c.req.query("token");
  if (!token || !id || !platform) {
    return c.json({ error: "Missing required parameters" }, 400);
  }
  if (platform !== "linux-amd64" && platform !== "linux-arm64" && platform !== "windows-amd64") {
    return c.json({ error: "Invalid ORRN Edge platform" }, 400);
  }
  if (!(await verifyDownloadToken(id, platform, token, env.ORRN_MASTER_KEY))) {
    return c.json({ error: "Invalid or expired download token" }, 403);
  }

  const deployment = await createDb().select().from(spoolDeployment).where(eq(spoolDeployment.id, id)).get();
  if (
    !deployment ||
    deployment.status === "revoked" ||
    (deployment.installId === null && deployment.enrollmentIssuedAt === null)
  ) {
    return c.json({ error: "Edge deployment not found or revoked" }, 404);
  }
  const version = c.req.query("version") ?? deployment.runtimeVersion;
  if (!version) {
    return c.json({ error: "An explicit ORRN Edge release version is required" }, 400);
  }

  try {
    const release = await resolveEdgeReleaseArtifact(version, platform);
    return new Response(null, {
      status: 302,
      headers: {
        Location: release.artifact.url,
        "Cache-Control": "no-store",
        "X-Edge-Release-Version": release.version,
        "X-Edge-Artifact-Sha256": release.artifact.sha256,
      },
    });
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : "Failed to resolve ORRN Edge release" },
      502,
    );
  }
});

export { spoolRoutes };
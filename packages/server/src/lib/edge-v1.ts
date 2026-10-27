import { and, asc, eq, gte, inArray, isNull, lte, ne, or, sql } from "drizzle-orm";

import { unwrapSecret, wrapSecret } from "@orrn/crypto";
import type { OrrnDb } from "@orrn/db";
import { bundle } from "@orrn/db/schema/inventory";
import { labelTemplate, printerProfile, printLog, type PrintStatus } from "@orrn/db/schema/printing";
import { edgeCommand, edgeEventReceipt, spoolDeployment } from "@orrn/db/schema/spool";
import { company } from "@orrn/db/schema/tenant";
import {
  type EdgeCommandAckRequest,
  edgeCommandAckRequestSchema,
  type EdgeCommandKind,
  type EdgeCommandResolution,
  type EdgeConfigResponse,
  edgeConfirmCredentialRequestSchema,
  type EdgeDesiredPrinter,
  edgeDesiredPrintersSchema,
  type EdgeEnrollResponse,
  edgeEnrollRequestSchema,
  type EdgeEventItem,
  edgeEventsBatchRequestSchema,
  type EdgeLeasedCommand,
  type EdgePollPrinterReport,
  type EdgePollResponse,
  edgePrinterEndpointVerifiedPayloadSchema,
} from "@orrn/edge-runtime";

import { SPOOL_TOKEN_MAX_SKEW_MS, verifySpoolToken } from "./spool-crypto";
import { atomicBatch, type SqliteBatchItem } from "./atomic";

export const EDGE_ENROLLMENT_TTL_MS = 15 * 60_000;
export const EDGE_COMMAND_LEASE_TTL_MS = 60_000;

/**
 * In-memory replay cache keyed by `${deploymentId}:${ts}:${hmac}` -> expiry timestamp (ms).
 */
const replayCache = new Map<string, number>();

export function clearEdgeV1ReplayCache(): void {
  replayCache.clear();
}

function pruneReplayCache(nowMs: number): void {
  if (replayCache.size < 512) return;
  for (const [k, exp] of replayCache) {
    if (exp <= nowMs) replayCache.delete(k);
  }
}

async function sha256HexString(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function randomHex(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function slugifySubdomain(label: string, id: string): string {
  const base = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
  const suffix = id.replace(/[^a-z0-9]/gi, "").toLowerCase().slice(0, 12);
  return `${base || "edge"}-${suffix}`;
}

export type CreateEdgeEnrollmentNodeInput = {
  companyId: string;
  nodeName: string;
  siteLabel: string;
  subdomain?: string;
  masterKey: string;
  nowMs?: number;
};

export type CreateEdgeEnrollmentNodeResult = {
  deploymentId: string;
  instanceId: string;
  subdomain: string;
  nodeDomain: string;
  enrollmentToken: string;
  enrollmentExpiresAt: Date;
  credentialVersion: number;
  configVersion: number;
};

/**
 * Creates a site edge node record with a 15-minute single-use enrollment token and wrapped sharedSecret.
 * Does NOT call Cloudflare Tunnel or DNS APIs.
 */
export async function createEdgeEnrollmentNode(
  db: OrrnDb,
  input: CreateEdgeEnrollmentNodeInput,
): Promise<CreateEdgeEnrollmentNodeResult> {
  const nowMs = input.nowMs ?? Date.now();
  const deploymentId = crypto.randomUUID();
  const instanceId = crypto.randomUUID();
  const subdomain = input.subdomain?.trim() || slugifySubdomain(input.siteLabel || input.nodeName, deploymentId);
  const nodeDomain = `${subdomain}.edge.orrn.in`;

  const enrollmentToken = `enr_${randomHex(24)}`;
  const enrollmentTokenHash = await sha256HexString(enrollmentToken);
  const enrollmentIssuedAt = new Date(nowMs);
  const enrollmentExpiresAt = new Date(nowMs + EDGE_ENROLLMENT_TTL_MS);

  const sharedSecret = `nsec_${randomHex(32)}`;
  const sharedSecretHash = await sha256HexString(sharedSecret);
  const sharedSecretWrapped = await wrapSecret(sharedSecret, input.masterKey);
  const cfTunnelTokenWrapped = await wrapSecret("edge-v1-outbound-only", input.masterKey);

  await db.insert(spoolDeployment).values({
    id: deploymentId,
    companyId: input.companyId,
    instanceId,
    status: "pending",
    nodeName: input.nodeName.trim() || "Primary edge node",
    siteLabel: input.siteLabel.trim() || "Main facility",
    subdomain,
    nodeDomain,
    cfTunnelId: null,
    cfTunnelTokenWrapped,
    sharedSecretHash,
    sharedSecretWrapped,
    enrollmentTokenHash,
    enrollmentIssuedAt,
    enrollmentExpiresAt,
    enrollmentUsedAt: null,
    installId: null,
    credentialVersion: 1,
    pendingCredentialVersion: null,
    pendingSecretHash: null,
    pendingSecretWrapped: null,
    configVersion: 1,
    appliedConfigVersion: 0,
    reportedPrinters: [],
  });

  return {
    deploymentId,
    instanceId,
    subdomain,
    nodeDomain,
    enrollmentToken,
    enrollmentExpiresAt,
    credentialVersion: 1,
    configVersion: 1,
  };
}

/**
 * Issues a fresh 15-minute enrollment token for an existing non-revoked deployment.
 */
export async function issueEdgeEnrollmentToken(
  db: OrrnDb,
  input: { deploymentId: string; nowMs?: number },
): Promise<{ enrollmentToken: string; enrollmentExpiresAt: Date }> {
  const nowMs = input.nowMs ?? Date.now();
  const enrollmentToken = `enr_${randomHex(24)}`;
  const enrollmentTokenHash = await sha256HexString(enrollmentToken);
  const enrollmentIssuedAt = new Date(nowMs);
  const enrollmentExpiresAt = new Date(nowMs + EDGE_ENROLLMENT_TTL_MS);

  await db
    .update(spoolDeployment)
    .set({
      enrollmentTokenHash,
      enrollmentIssuedAt,
      enrollmentExpiresAt,
      enrollmentUsedAt: null,
    })
    .where(eq(spoolDeployment.id, input.deploymentId));

  return { enrollmentToken, enrollmentExpiresAt };
}

export type ExchangeEdgeEnrollmentInput = {
  enrollmentToken: string;
  agentVersion: string;
  os: "windows" | "linux";
  arch: "amd64" | "arm64";
  installId: string;
  apiOrigin: string;
  masterKey: string;
  nowMs?: number;
};

export type ExchangeEdgeEnrollmentResult =
  | { ok: true; status: 200; value: EdgeEnrollResponse }
  | { ok: false; status: 400 | 403 | 404 | 409; body: { code: string; error: string } };

/**
 * Validates and consumes a 15-minute single-use enrollment token.
 * Atomically claims an unused token; a matching installId may idempotently recover a lost response.
 */
export async function exchangeEdgeEnrollmentToken(
  db: OrrnDb,
  input: ExchangeEdgeEnrollmentInput,
): Promise<ExchangeEdgeEnrollmentResult> {
  const nowMs = input.nowMs ?? Date.now();
  const parsed = edgeEnrollRequestSchema.safeParse({
    enrollmentToken: input.enrollmentToken,
    agentVersion: input.agentVersion,
    os: input.os,
    arch: input.arch,
    installId: input.installId,
  });
  if (!parsed.success) {
    return {
      ok: false,
      status: 400,
      body: { code: "invalid_enrollment_request", error: parsed.error.issues[0]?.message ?? "Invalid request" },
    };
  }

  const tokenHash = await sha256HexString(parsed.data.enrollmentToken);
  const row = await db
    .select()
    .from(spoolDeployment)
    .where(eq(spoolDeployment.enrollmentTokenHash, tokenHash))
    .get();

  if (!row) {
    return {
      ok: false,
      status: 403,
      body: { code: "invalid_enrollment_token", error: "Invalid or unknown enrollment token" },
    };
  }

  if (row.status === "revoked") {
    return {
      ok: false,
      status: 403,
      body: { code: "node_revoked", error: "Node revoked" },
    };
  }

  const expiresAtMs = row.enrollmentExpiresAt ? row.enrollmentExpiresAt.getTime() : 0;
  if (row.enrollmentUsedAt === null && (!expiresAtMs || nowMs > expiresAtMs)) {
    return {
      ok: false,
      status: 403,
      body: { code: "enrollment_token_expired", error: "Enrollment token has expired" },
    };
  }

  if ((row.installId !== null || row.enrollmentUsedAt !== null) && row.installId !== parsed.data.installId) {
    return {
      ok: false,
      status: 409,
      body: {
        code: "install_id_mismatch",
        error: "Enrollment token belongs to a different installation; reset local state first",
      },
    };
  }

  // A consumed token is replayable only by the installation that claimed it.

  let enrolledRow = row;
  if (row.enrollmentUsedAt === null) {
    const claimed = await db
      .update(spoolDeployment)
      .set({
        status: "active",
        enrollmentUsedAt: new Date(nowMs),
        installId: parsed.data.installId,
        runtimeVersion: parsed.data.agentVersion,
        runtimePlatform: `${parsed.data.os}-${parsed.data.arch}`,
        lastHeartbeatAt: new Date(nowMs),
        updatedAt: new Date(nowMs),
      })
      .where(
        and(
          eq(spoolDeployment.id, row.id),
          eq(spoolDeployment.enrollmentTokenHash, tokenHash),
          ne(spoolDeployment.status, "revoked"),
          gte(spoolDeployment.enrollmentExpiresAt, new Date(nowMs)),
          isNull(spoolDeployment.enrollmentUsedAt),
          or(isNull(spoolDeployment.installId), eq(spoolDeployment.installId, parsed.data.installId)),
        ),
      )
      .returning()
      .get();

    if (claimed) {
      enrolledRow = claimed;
    } else {
      const current = await db.select().from(spoolDeployment).where(eq(spoolDeployment.id, row.id)).get();
      if (!current || current.enrollmentTokenHash !== tokenHash) {
        return {
          ok: false,
          status: 403,
          body: { code: "invalid_enrollment_token", error: "Invalid or unknown enrollment token" },
        };
      }
      if (current.installId !== parsed.data.installId) {
        return {
          ok: false,
          status: 409,
          body: { code: "install_id_mismatch", error: "Enrollment token belongs to a different installation" },
        };
      }
      if (current.enrollmentUsedAt === null) {
        return {
          ok: false,
          status: 409,
          body: { code: "enrollment_claim_conflict", error: "Enrollment changed while claiming the token" },
        };
      }
      enrolledRow = current;
    }
  }

  const nodeSecret = await unwrapSecret(enrolledRow.sharedSecretWrapped, input.masterKey);
  return {
    ok: true,
    status: 200,
    value: {
      protocolVersion: 1,
      deploymentId: enrolledRow.id,
      instanceId: enrolledRow.instanceId,
      nodeName: enrolledRow.nodeName,
      siteLabel: enrolledRow.siteLabel,
      apiOrigin: input.apiOrigin,
      nodeSecret,
      credentialVersion: enrolledRow.credentialVersion,
      configVersion: enrolledRow.configVersion,
    },
  };
}

/**
 * Stages a pending secret rotation without invalidating the active secret until confirmed.
 */
export async function stageEdgeSecretRotation(
  db: OrrnDb,
  input: { deploymentId: string; masterKey: string; nowMs?: number },
): Promise<{
  deploymentId: string;
  credentialVersion: number;
  pendingCredentialVersion: number;
  pendingSecret: string;
  configVersion: number;
}> {
  for (;;) {
    const row = await db
      .select()
      .from(spoolDeployment)
      .where(eq(spoolDeployment.id, input.deploymentId))
      .get();

    if (!row) throw new Error("Deployment not found");
    if (row.status === "revoked") throw new Error("Cannot rotate secret for a revoked deployment");

    if (row.pendingCredentialVersion !== null || row.pendingSecretHash !== null || row.pendingSecretWrapped !== null) {
      if (
        row.pendingCredentialVersion === null ||
        row.pendingSecretHash === null ||
        row.pendingSecretWrapped === null
      ) {
        throw new Error("Pending credential rotation is incomplete");
      }
      return {
        deploymentId: row.id,
        credentialVersion: row.credentialVersion,
        pendingCredentialVersion: row.pendingCredentialVersion,
        pendingSecret: await unwrapSecret(row.pendingSecretWrapped, input.masterKey),
        configVersion: row.configVersion,
      };
    }

    const pendingCredentialVersion = row.credentialVersion + 1;
    const pendingSecret = `nsec_${randomHex(32)}`;
    const pendingSecretHash = await sha256HexString(pendingSecret);
    const pendingSecretWrapped = await wrapSecret(pendingSecret, input.masterKey);
    const staged = await db
      .update(spoolDeployment)
      .set({
        pendingCredentialVersion,
        pendingSecretHash,
        pendingSecretWrapped,
        configVersion: sql`${spoolDeployment.configVersion} + 1`,
        updatedAt: new Date(input.nowMs ?? Date.now()),
      })
      .where(
        and(
          eq(spoolDeployment.id, row.id),
          eq(spoolDeployment.credentialVersion, row.credentialVersion),
          eq(spoolDeployment.sharedSecretWrapped, row.sharedSecretWrapped),
          isNull(spoolDeployment.pendingCredentialVersion),
          isNull(spoolDeployment.pendingSecretHash),
          isNull(spoolDeployment.pendingSecretWrapped),
        ),
      )
      .returning({ configVersion: spoolDeployment.configVersion })
      .get();

    if (staged) {
      return {
        deploymentId: row.id,
        credentialVersion: row.credentialVersion,
        pendingCredentialVersion,
        pendingSecret,
        configVersion: staged.configVersion,
      };
    }
  }
}

export type AuthenticatedEdgeNode = typeof spoolDeployment.$inferSelect;

export type AuthenticateEdgeV1Result =
  | {
      ok: true;
      node: AuthenticatedEdgeNode;
      matchedSlot: "active" | "pending";
    }
  | {
      ok: false;
      status: 401 | 403;
      body: { code: string; error: string };
    };

/**
 * Verifies `X-ORRN-Node-ID` and `Authorization: Bearer v1:<ts>:<hmac>` against active or pending secret,
 * with replay protection and revocation enforcement.
 */
export async function authenticateEdgeV1Request(
  db: OrrnDb,
  input: {
    method: string;
    path: string;
    rawBody: Uint8Array | null;
    nodeIdHeader: string | null | undefined;
    authorization: string | null | undefined;
    masterKey: string;
    nowMs?: number;
    enforceReplayCache?: boolean;
  },
): Promise<AuthenticateEdgeV1Result> {
  const instanceId = (input.nodeIdHeader ?? "").trim();
  if (!instanceId) {
    return { ok: false, status: 401, body: { code: "missing_node_id", error: "Missing X-ORRN-Node-ID header" } };
  }

  const authHeader = (input.authorization ?? "").trim();
  if (!authHeader.startsWith("Bearer ")) {
    return {
      ok: false,
      status: 401,
      body: { code: "missing_authorization", error: "Missing Bearer authorization token" },
    };
  }
  const token = authHeader.slice("Bearer ".length).trim();
  const parts = token.split(":");
  if (parts.length !== 3 || parts[0] !== "v1") {
    return { ok: false, status: 401, body: { code: "malformed_token", error: "Malformed Bearer token" } };
  }
  const tsPart = parts[1]!;
  const hmacPart = parts[2]!;
  const tokenTimestampMs = parseInt(tsPart, 36);
  const nowMs = input.nowMs ?? (Number.isFinite(tokenTimestampMs) ? Date.now() : Date.now());

  const node = await db
    .select()
    .from(spoolDeployment)
    .where(eq(spoolDeployment.instanceId, instanceId))
    .get();

  if (!node) {
    return { ok: false, status: 403, body: { code: "unknown_node", error: "Unknown node" } };
  }

  if (node.status === "revoked") {
    return { ok: false, status: 403, body: { code: "node_revoked", error: "Node revoked" } };
  }

  const companyRow = await db
    .select({ status: company.status })
    .from(company)
    .where(eq(company.id, node.companyId))
    .get();
  if (!companyRow || companyRow.status !== "active") {
    return { ok: false, status: 403, body: { code: "company_inactive", error: "Company is not active" } };
  }

  const activeSecret = await unwrapSecret(node.sharedSecretWrapped, input.masterKey);
  let matchedSlot: "active" | "pending" | null = null;

  if (await verifySpoolToken(input.method, input.path, input.rawBody, token, activeSecret, SPOOL_TOKEN_MAX_SKEW_MS, nowMs)) {
    matchedSlot = "active";
  } else if (node.pendingSecretWrapped) {
    const pendingSecret = await unwrapSecret(node.pendingSecretWrapped, input.masterKey);
    if (
      await verifySpoolToken(input.method, input.path, input.rawBody, token, pendingSecret, SPOOL_TOKEN_MAX_SKEW_MS, nowMs)
    ) {
      matchedSlot = "pending";
    }
  }

  if (!matchedSlot) {
    return { ok: false, status: 403, body: { code: "invalid_signature", error: "Invalid signature" } };
  }

  if (input.enforceReplayCache) {
    pruneReplayCache(nowMs);
    const replayKey = `${node.id}:${tsPart}:${hmacPart}`;
    const existingExp = replayCache.get(replayKey);
    if (existingExp && existingExp > nowMs) {
      return { ok: false, status: 403, body: { code: "token_replayed", error: "Replayed request token" } };
    }
    replayCache.set(replayKey, nowMs + SPOOL_TOKEN_MAX_SKEW_MS);
  }

  return { ok: true, node, matchedSlot };
}

/**
 * Confirms a pending credential rotation.
 * Requires the request to be signed by `pendingSecretWrapped` when `pendingCredentialVersion === requestedVersion`,
 * or signed by `sharedSecretWrapped` if `credentialVersion === requestedVersion` (idempotent retry).
 */
export async function confirmEdgeCredentialRotation(
  db: OrrnDb,
  input: {
    rawBody: Uint8Array;
    nodeIdHeader: string | null | undefined;
    authorization: string | null | undefined;
    masterKey: string;
    path?: string;
    nowMs?: number;
  },
): Promise<
  | { ok: true; status: 200; body: { ok: true; credentialVersion: number } }
  | { ok: false; status: 400 | 401 | 403 | 409; body: { code: string; error: string } }
> {
  const path = input.path ?? "/api/edge/v1/credentials/confirm";
  const auth = await authenticateEdgeV1Request(db, {
    method: "POST",
    path,
    rawBody: input.rawBody,
    nodeIdHeader: input.nodeIdHeader,
    authorization: input.authorization,
    masterKey: input.masterKey,
    nowMs: input.nowMs,
  });
  if (!auth.ok) {
    return auth;
  }

  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(input.rawBody));
  } catch {
    return { ok: false, status: 400, body: { code: "invalid_json", error: "Invalid JSON body" } };
  }
  const parsed = edgeConfirmCredentialRequestSchema.safeParse(json);
  if (!parsed.success) {
    return {
      ok: false,
      status: 400,
      body: { code: "invalid_request", error: parsed.error.issues[0]?.message ?? "Invalid credentialVersion" },
    };
  }
  const requestedVersion = parsed.data.credentialVersion;
  const { node, matchedSlot } = auth;

  // Idempotent case: already promoted to requestedVersion and signed with the active secret
  if (node.credentialVersion === requestedVersion && matchedSlot === "active") {
    return {
      ok: true,
      status: 200,
      body: { ok: true, credentialVersion: node.credentialVersion },
    };
  }

  if (
    node.pendingCredentialVersion !== requestedVersion ||
    !node.pendingSecretWrapped ||
    !node.pendingSecretHash ||
    matchedSlot !== "pending"
  ) {
    return {
      ok: false,
      status: 409,
      body: {
        code: "credential_version_mismatch",
        error: "Confirmation must be signed by the pending credential for the requested version",
      },
    };
  }

  const promoted = await db
    .update(spoolDeployment)
    .set({
      sharedSecretHash: node.pendingSecretHash,
      sharedSecretWrapped: node.pendingSecretWrapped,
      credentialVersion: requestedVersion,
      pendingCredentialVersion: null,
      pendingSecretHash: null,
      pendingSecretWrapped: null,
      updatedAt: new Date(input.nowMs ?? Date.now()),
    })
    .where(
      and(
        eq(spoolDeployment.id, node.id),
        eq(spoolDeployment.credentialVersion, node.credentialVersion),
        eq(spoolDeployment.pendingCredentialVersion, requestedVersion),
        eq(spoolDeployment.pendingSecretHash, node.pendingSecretHash),
        eq(spoolDeployment.pendingSecretWrapped, node.pendingSecretWrapped),
      ),
    )
    .returning({ credentialVersion: spoolDeployment.credentialVersion })
    .get();

  if (!promoted) {
    const current = await db.select().from(spoolDeployment).where(eq(spoolDeployment.id, node.id)).get();
    if (
      !current ||
      current.credentialVersion !== requestedVersion ||
      current.sharedSecretHash !== node.pendingSecretHash ||
      current.sharedSecretWrapped !== node.pendingSecretWrapped
    ) {
      return {
        ok: false,
        status: 409,
        body: { code: "credential_version_mismatch", error: "Pending credential changed before confirmation" },
      };
    }
  }

  return {
    ok: true,
    status: 200,
    body: { ok: true, credentialVersion: requestedVersion },
  };
}

export type EnqueueEdgePrintCommandInput = {
  companyId: string;
  deploymentId: string;
  templateId: string;
  profileId: string;
  bundleId?: string | null;
  requestedBy?: string | null;
  jobKey: string;
  payloadHash: string;
  copies: number;
  labelVersion: number;
  attempt: number;
  layout?: string;
  variables: Record<string, unknown>;
  printLogId?: string;
  nowMs?: number;
};

/**
 * Enqueues a `print_job` command in `edge_command` and creates/updates the corresponding `print_log` row.
 */
export async function enqueueEdgePrintCommand(
  db: OrrnDb,
  input: EnqueueEdgePrintCommandInput,
): Promise<{ commandId: string; printLogId: string; jobKey: string; status: "queued" }> {
  const now = new Date(input.nowMs ?? Date.now());
  const commandId = crypto.randomUUID();
  const printLogId = input.printLogId ?? crypto.randomUUID();

  const [profileRow, templateRow] = await Promise.all([
    db
      .select()
      .from(printerProfile)
      .where(and(eq(printerProfile.id, input.profileId), eq(printerProfile.companyId, input.companyId)))
      .get(),
    db
      .select()
      .from(labelTemplate)
      .where(and(eq(labelTemplate.id, input.templateId), eq(labelTemplate.companyId, input.companyId)))
      .get(),
  ]);

  const payload = {
    printLogId,
    profileId: input.profileId,
    printerId: profileRow?.spoolPrinterId ?? input.profileId,
    templateId: input.templateId,
    spoolTemplateId: templateRow?.spoolTemplateId ?? null,
    templateSchema: templateRow?.schema ?? {},
    bundleId: input.bundleId ?? null,
    jobKey: input.jobKey,
    payloadHash: input.payloadHash,
    copies: input.copies,
    labelVersion: input.labelVersion,
    attempt: input.attempt,
    layout: input.layout ?? "x0",
    variables: input.variables,
  };

  await db.batch([
    db.insert(printLog).values({
      id: printLogId,
      companyId: input.companyId,
      bundleId: input.bundleId ?? null,
      templateId: input.templateId,
      profileId: input.profileId,
      requestedBy: input.requestedBy ?? null,
      status: "queued",
      deploymentId: input.deploymentId,
      copies: input.copies,
      commandId,
      layout: input.layout ?? "x0",
      variables: input.variables,
      payloadHash: input.payloadHash,
      attempt: input.attempt,
      labelVersion: input.labelVersion,
      jobKey: input.jobKey,
      createdAt: now,
      updatedAt: now,
    }),
    db.insert(edgeCommand).values({
      id: commandId,
      companyId: input.companyId,
      deploymentId: input.deploymentId,
      kind: "print_job",
      payloadJson: JSON.stringify(payload),
      jobKey: input.jobKey,
      payloadHash: input.payloadHash,
      printLogId,
      state: "queued",
      leaseId: null,
      leaseExpiresAt: null,
      deliveryCount: 0,
      resolvedAt: null,
      resolutionJson: null,
      createdAt: now,
      updatedAt: now,
    }),
  ]);

  return { commandId, printLogId, jobKey: input.jobKey, status: "queued" };
}

/** Creates a new durable print attempt; it never redelivers the prior command. */
export async function retryEdgePrintCommand(
  db: OrrnDb,
  input: {
    companyId: string;
    deploymentId: string;
    printLogId: string;
    requestedBy?: string | null;
    nowMs?: number;
  },
) {
  const source = await db
    .select()
    .from(printLog)
    .where(
      and(
        eq(printLog.id, input.printLogId),
        eq(printLog.companyId, input.companyId),
        eq(printLog.deploymentId, input.deploymentId),
      ),
    )
    .get();
  if (!source) throw new Error("Print history not found for this node");
  if (!source.jobKey || !source.payloadHash) throw new Error("Print history has no frozen V1 payload");

  const attempt = source.attempt + 1;
  const jobKey = source.jobKey.includes(":attempt:")
    ? source.jobKey.replace(/:attempt:\d+(?::.*)?$/, `:attempt:${attempt}`)
    : `${source.jobKey}:attempt:${attempt}`;
  return enqueueEdgePrintCommand(db, {
    companyId: input.companyId,
    deploymentId: input.deploymentId,
    templateId: source.templateId,
    profileId: source.profileId,
    bundleId: source.bundleId,
    requestedBy: input.requestedBy === undefined ? source.requestedBy : input.requestedBy,
    jobKey,
    payloadHash: source.payloadHash,
    copies: source.copies,
    labelVersion: source.labelVersion ?? 1,
    attempt,
    layout: source.layout ?? "x0",
    variables: source.variables ?? {},
    nowMs: input.nowMs,
  });
}

/**
 * Enqueues a `test_print` command for a specific deployment and printer.
 */
export async function enqueueEdgeTestPrintCommand(
  db: OrrnDb,
  input: {
    companyId: string;
    deploymentId: string;
    printerId: string;
    requestedBy?: string | null;
    nowMs?: number;
  },
): Promise<{ commandId: string }> {
  const now = new Date(input.nowMs ?? Date.now());
  const commandId = crypto.randomUUID();
  const payload = {
    printerId: input.printerId,
    requestedBy: input.requestedBy ?? null,
  };

  await db.insert(edgeCommand).values({
    id: commandId,
    companyId: input.companyId,
    deploymentId: input.deploymentId,
    kind: "test_print",
    payloadJson: JSON.stringify(payload),
    jobKey: null,
    payloadHash: null,
    printLogId: null,
    state: "queued",
    leaseId: null,
    leaseExpiresAt: null,
    deliveryCount: 0,
    resolvedAt: null,
    resolutionJson: null,
    createdAt: now,
    updatedAt: now,
  });

  return { commandId };
}

/**
 * Enqueues a `cancel_job` command for a job on a deployment.
 */
export async function enqueueEdgeCancelCommand(
  db: OrrnDb,
  input: {
    companyId: string;
    deploymentId: string;
    printLogId?: string | null;
    agentJobId?: string | null;
    jobKey?: string | null;
    reason?: string;
    nowMs?: number;
  },
): Promise<{ commandId: string }> {
  const now = new Date(input.nowMs ?? Date.now());
  const commandId = crypto.randomUUID();
  const payload = {
    printLogId: input.printLogId ?? null,
    agentJobId: input.agentJobId ?? null,
    jobKey: input.jobKey ?? null,
    reason: input.reason ?? "Cancelled by operator",
  };

  await db.insert(edgeCommand).values({
    id: commandId,
    companyId: input.companyId,
    deploymentId: input.deploymentId,
    kind: "cancel_job",
    payloadJson: JSON.stringify(payload),
    jobKey: input.jobKey ?? null,
    payloadHash: null,
    printLogId: input.printLogId ?? null,
    state: "queued",
    leaseId: null,
    leaseExpiresAt: null,
    deliveryCount: 0,
    resolvedAt: null,
    resolutionJson: null,
    createdAt: now,
    updatedAt: now,
  });

  return { commandId };
}

/**
 * Polls up to `limit` (max 10) eligible commands for the node, leasing each for 60 seconds.
 * Re-leases expired `leased` rows with the same `commandId` and incremented `deliveryCount`.
 * Also updates node heartbeat, `appliedConfigVersion`, and `reportedPrinters`.
 */
export async function pollEdgeCommands(
  db: OrrnDb,
  input: {
    deploymentId: string;
    companyId: string;
    limit?: number;
    appliedConfigVersion?: number;
    printers?: EdgePollPrinterReport[];
    nowMs?: number;
  },
): Promise<EdgePollResponse> {
  const nowMs = input.nowMs ?? Date.now();
  const now = new Date(nowMs);
  const leaseExpiresAt = new Date(nowMs + EDGE_COMMAND_LEASE_TTL_MS);
  const limit = Math.min(Math.max(input.limit ?? 10, 1), 10);

  const nodeUpdate: Record<string, unknown> = {
    status: "active",
    lastHeartbeatAt: now,
    updatedAt: now,
  };
  if (typeof input.appliedConfigVersion === "number" && input.appliedConfigVersion > 0) {
    nodeUpdate.appliedConfigVersion = input.appliedConfigVersion;
  }
  if (input.printers !== undefined) {
    nodeUpdate.reportedPrinters = input.printers;
  }

  await db
    .update(spoolDeployment)
    .set(nodeUpdate)
    .where(and(eq(spoolDeployment.id, input.deploymentId), eq(spoolDeployment.companyId, input.companyId)));

  for (const report of input.printers ?? []) {
    const capabilities = report.capabilities;
    if (!capabilities) continue;
    await db
      .update(printerProfile)
      .set({
        macAddress: capabilities.macAddress ?? null,
        verifiedHost: capabilities.host,
        verifiedPort: capabilities.port,
        discoveredFeatures: capabilities.features,
        capabilitiesVerifiedAt: new Date(capabilities.verifiedAt),
        updatedAt: now,
      })
      .where(
        and(
          eq(printerProfile.companyId, input.companyId),
          eq(printerProfile.spoolPrinterId, report.printerId),
          or(isNull(printerProfile.deploymentId), eq(printerProfile.deploymentId, input.deploymentId)),
        ),
      );
  }

  const node = await db
    .select({
      configVersion: spoolDeployment.configVersion,
      pendingCredentialVersion: spoolDeployment.pendingCredentialVersion,
    })
    .from(spoolDeployment)
    .where(and(eq(spoolDeployment.id, input.deploymentId), eq(spoolDeployment.companyId, input.companyId)))
    .get();

  const candidates = await db
    .select()
    .from(edgeCommand)
    .where(
      and(
        eq(edgeCommand.deploymentId, input.deploymentId),
        eq(edgeCommand.companyId, input.companyId),
        or(
          eq(edgeCommand.state, "queued"),
          and(eq(edgeCommand.state, "leased"), lte(edgeCommand.leaseExpiresAt, now)),
        ),
      ),
    )
    .orderBy(asc(edgeCommand.createdAt), asc(edgeCommand.id))
    .limit(limit)
    .all();

  const leasedCommands: EdgeLeasedCommand[] = [];
  for (const row of candidates) {
    const leaseId = crypto.randomUUID();
    const nextDeliveryCount = row.deliveryCount + 1;
    const claimed = await db
      .update(edgeCommand)
      .set({
        state: "leased",
        leaseId,
        leaseExpiresAt,
        deliveryCount: nextDeliveryCount,
        updatedAt: now,
      })
      .where(
        and(
          eq(edgeCommand.id, row.id),
          eq(edgeCommand.deploymentId, input.deploymentId),
          eq(edgeCommand.companyId, input.companyId),
          eq(edgeCommand.deliveryCount, row.deliveryCount),
          or(
            eq(edgeCommand.state, "queued"),
            and(
              eq(edgeCommand.state, "leased"),
              lte(edgeCommand.leaseExpiresAt, now),
              row.leaseId ? eq(edgeCommand.leaseId, row.leaseId) : isNull(edgeCommand.leaseId),
            ),
          ),
        ),
      )
      .returning({ deliveryCount: edgeCommand.deliveryCount })
      .get();
    if (!claimed) continue;

    let parsedPayload: Record<string, unknown> = {};
    try {
      parsedPayload = JSON.parse(row.payloadJson) as Record<string, unknown>;
    } catch {
      parsedPayload = {};
    }

    leasedCommands.push({
      commandId: row.id,
      leaseId,
      leaseExpiresAt: leaseExpiresAt.toISOString(),
      kind: row.kind as EdgeCommandKind,
      jobKey: row.jobKey ?? null,
      payloadHash: row.payloadHash ?? null,
      deliveryCount: claimed.deliveryCount,
      payload: parsedPayload,
    });
  }

  return {
    protocolVersion: 1,
    configVersion: node?.configVersion ?? 1,
    pendingCredentialVersion: node?.pendingCredentialVersion ?? null,
    commands: leasedCommands,
  };
}

export type AcknowledgeEdgeCommandResult = {
  commandId: string;
  outcome: "accepted" | "rejected";
  resolution: EdgeCommandResolution;
  agentJobId: string | null;
  detail: string | null;
  staleLeaseIgnored?: boolean;
};

type EdgeCommandRow = typeof edgeCommand.$inferSelect;
type PrintLogRow = typeof printLog.$inferSelect;

function commandResolution(
  cmd: EdgeCommandRow,
  fallback?: EdgeCommandAckRequest,
): AcknowledgeEdgeCommandResult | null {
  if ((cmd.state !== "accepted" && cmd.state !== "rejected") || !cmd.resolutionJson) return null;
  try {
    const existing = JSON.parse(cmd.resolutionJson) as AcknowledgeEdgeCommandResult;
    return {
      commandId: cmd.id,
      outcome: existing.outcome,
      resolution: existing.resolution,
      agentJobId: existing.agentJobId ?? null,
      detail: existing.detail ?? null,
    };
  } catch {
    return fallback
      ? {
          commandId: cmd.id,
          outcome: cmd.state,
          resolution: fallback.resolution,
          agentJobId: fallback.agentJobId,
          detail: fallback.detail ?? null,
        }
      : null;
  }
}

function ackProjectionStatements(
  db: OrrnDb,
  input: {
    companyId: string;
    deploymentId: string;
    cmd: EdgeCommandRow;
    logRow: PrintLogRow;
    resolution: AcknowledgeEdgeCommandResult;
    resolutionJson: string;
    now: Date;
  },
): SqliteBatchItem[] {
  const { companyId, deploymentId, cmd, logRow, resolution, resolutionJson, now } = input;
  const matchingResolution = sql`exists (
    select 1 from ${edgeCommand}
    where ${edgeCommand.id} = ${cmd.id}
      and ${edgeCommand.companyId} = ${companyId}
      and ${edgeCommand.deploymentId} = ${deploymentId}
      and ${edgeCommand.state} = ${resolution.outcome}
      and ${edgeCommand.resolutionJson} = ${resolutionJson}
  )`;
  const logWhere = and(
    eq(printLog.id, logRow.id),
    eq(printLog.companyId, companyId),
    eq(printLog.deploymentId, deploymentId),
    matchingResolution,
  );
  const statements: SqliteBatchItem[] = [];

  if (resolution.outcome === "accepted") {
    if (cmd.kind === "cancel_job") {
      if (resolution.resolution === "cancelled" || resolution.resolution === "already_cancelled") {
        statements.push(
          db
            .update(printLog)
            .set({
              status: "cancelled",
              responseText: resolution.detail ?? "Cancelled before transmission",
              updatedAt: now,
            })
            .where(and(logWhere, inArray(printLog.status, ["queued", "accepted", "cancelled"]))),
        );
      }
    } else {
      statements.push(
        db
          .update(printLog)
          .set({
            status: sql`case when ${printLog.status} = 'queued' then 'accepted' else ${printLog.status} end`,
            ...(resolution.agentJobId ? { spoolJobId: resolution.agentJobId } : {}),
            updatedAt: now,
          })
          .where(logWhere),
      );
      if (logRow.bundleId) {
        statements.push(
          db
            .update(bundle)
            .set({ stickerStale: false, updatedAt: now })
            .where(
              and(
                eq(bundle.id, logRow.bundleId),
                eq(bundle.companyId, companyId),
                eq(bundle.stickerStale, true),
                matchingResolution,
              ),
            ),
        );
      }
    }
  } else if (cmd.kind !== "cancel_job") {
    statements.push(
      db
        .update(printLog)
        .set({
          status: "failed",
          responseText: resolution.detail ? `${resolution.resolution}: ${resolution.detail}` : resolution.resolution,
          updatedAt: now,
        })
        .where(and(logWhere, inArray(printLog.status, ["queued", "accepted", "failed"]))),
    );
  }
  return statements;
}

/**
 * Records durable command acknowledgement and its product-history projection atomically.
 * A repeated terminal acknowledgement also repairs a missing history projection.
 */
export async function acknowledgeEdgeCommand(
  db: OrrnDb,
  input: EdgeCommandAckRequest & {
    deploymentId: string;
    companyId: string;
    nowMs?: number;
  },
): Promise<AcknowledgeEdgeCommandResult> {
  const now = new Date(input.nowMs ?? Date.now());
  const parsed = edgeCommandAckRequestSchema.parse({
    commandId: input.commandId,
    leaseId: input.leaseId,
    outcome: input.outcome,
    resolution: input.resolution,
    agentJobId: input.agentJobId,
    detail: input.detail ?? null,
  });
  const cmd = await db
    .select()
    .from(edgeCommand)
    .where(
      and(
        eq(edgeCommand.id, parsed.commandId),
        eq(edgeCommand.deploymentId, input.deploymentId),
        eq(edgeCommand.companyId, input.companyId),
      ),
    )
    .get();
  if (!cmd) throw new Error("Command not found for this node");

  const alreadyResolved = commandResolution(cmd, parsed);
  if (!alreadyResolved && cmd.leaseId && cmd.leaseId !== parsed.leaseId) {
    return { ...parsed, staleLeaseIgnored: true };
  }

  const storedResolution: AcknowledgeEdgeCommandResult = alreadyResolved ?? {
    commandId: cmd.id,
    outcome: parsed.outcome,
    resolution: parsed.resolution,
    agentJobId: parsed.agentJobId,
    detail: parsed.detail,
  };
  const resolutionJson = alreadyResolved ? cmd.resolutionJson! : JSON.stringify(storedResolution);
  const logRow = cmd.printLogId
    ? await db
        .select()
        .from(printLog)
        .where(
          and(
            eq(printLog.id, cmd.printLogId),
            eq(printLog.companyId, input.companyId),
            eq(printLog.deploymentId, input.deploymentId),
          ),
        )
        .get()
    : undefined;
  const statements: SqliteBatchItem[] = [];

  if (!alreadyResolved) {
    statements.push(
      db
        .update(edgeCommand)
        .set({
          state: parsed.outcome,
          resolvedAt: now,
          resolutionJson,
          updatedAt: now,
        })
        .where(
          and(
            eq(edgeCommand.id, cmd.id),
            eq(edgeCommand.deploymentId, input.deploymentId),
            eq(edgeCommand.companyId, input.companyId),
            eq(edgeCommand.leaseId, parsed.leaseId),
            inArray(edgeCommand.state, ["queued", "leased"]),
          ),
        ),
    );
  }
  if (logRow) {
    statements.push(
      ...ackProjectionStatements(db, {
        companyId: input.companyId,
        deploymentId: input.deploymentId,
        cmd,
        logRow,
        resolution: storedResolution,
        resolutionJson,
        now,
      }),
    );
  }
  if (statements.length > 0) await atomicBatch(db, statements);

  const current = await db
    .select()
    .from(edgeCommand)
    .where(
      and(
        eq(edgeCommand.id, cmd.id),
        eq(edgeCommand.deploymentId, input.deploymentId),
        eq(edgeCommand.companyId, input.companyId),
      ),
    )
    .get();
  return commandResolution(current ?? cmd) ?? storedResolution;
}

/**
 * Builds the desired-state configuration for a node.
 * Includes `pendingCredentialVersion` and `pendingSecret` only when a rotation is pending.
 */
/**
 * Replace a node's complete desired printer list and bump `configVersion` so the
 * agent downloads and applies it on its next poll.
 */
export async function setEdgeNodePrinters(
  db: OrrnDb,
  input: { deploymentId: string; printers: unknown; nowMs?: number },
): Promise<{ configVersion: number; printers: EdgeDesiredPrinter[] }> {
  const printers = edgeDesiredPrintersSchema.parse(input.printers);
  const updated = await db
    .update(spoolDeployment)
    .set({
      desiredPrinters: printers,
      configVersion: sql`${spoolDeployment.configVersion} + 1`,
      updatedAt: new Date(input.nowMs ?? Date.now()),
    })
    .where(eq(spoolDeployment.id, input.deploymentId))
    .returning({ configVersion: spoolDeployment.configVersion })
    .get();
  if (!updated) {
    throw new Error("Node not found");
  }
  return { configVersion: updated.configVersion, printers };
}

export async function buildEdgeDesiredConfig(
  db: OrrnDb,
  input: {
    deploymentId: string;
    companyId: string;
    masterKey: string;
  },
): Promise<EdgeConfigResponse> {
  const [node, profiles, templates] = await Promise.all([
    db
      .select()
      .from(spoolDeployment)
      .where(and(eq(spoolDeployment.id, input.deploymentId), eq(spoolDeployment.companyId, input.companyId)))
      .get(),
    db
      .select()
      .from(printerProfile)
      .where(and(eq(printerProfile.companyId, input.companyId), isNull(printerProfile.deletedAt)))
      .all(),
    db
      .select()
      .from(labelTemplate)
      .where(and(eq(labelTemplate.companyId, input.companyId), isNull(labelTemplate.deletedAt)))
      .all(),
  ]);

  if (!node) {
    throw new Error("Node not found");
  }

  const nodeProfiles = profiles.filter((p) => !p.deploymentId || p.deploymentId === node.id);

  let pendingSecret: string | undefined;
  let pendingCredentialVersion: number | undefined;
  if (node.pendingCredentialVersion && node.pendingSecretWrapped) {
    pendingCredentialVersion = node.pendingCredentialVersion;
    pendingSecret = await unwrapSecret(node.pendingSecretWrapped, input.masterKey);
  }

  return {
    protocolVersion: 1,
    configSchemaVersion: 1,
    deploymentId: node.id,
    instanceId: node.instanceId,
    nodeName: node.nodeName,
    siteLabel: node.siteLabel,
    configVersion: node.configVersion,
    credentialVersion: node.credentialVersion,
    ...(pendingCredentialVersion !== undefined && pendingSecret !== undefined
      ? { pendingCredentialVersion, pendingSecret }
      : {}),
    printers: node.desiredPrinters ?? [],
    profiles: nodeProfiles.map((p) => ({
      id: p.id,
      name: p.name,
      spoolPrinterId: p.spoolPrinterId,
      deploymentId: p.deploymentId ?? node.id,
      templateId: p.templateId,
      defaultCopies: p.defaultCopies,
    })),
    templates: templates.map((t) => ({
      id: t.id,
      name: t.name,
      kind: t.kind,
      version: t.version,
      spoolTemplateId: t.spoolTemplateId,
      schema: t.schema,
    })),
  };
}

const PRINT_STATUS_RANK: Record<PrintStatus, number> = {
  queued: 1,
  accepted: 2,
  sent: 3,
  outcome_unknown: 3,
  failed: 3,
  cancelled: 3,
  success: 4,
};

function mapAgentJobStateToPrintStatus(agentState: string): PrintStatus | null {
  switch (agentState) {
    case "accepted":
    case "device_open":
    case "transmitting":
    case "failed_retryable":
      return "accepted";
    case "sent":
      return "sent";
    case "failed_final":
      return "failed";
    case "outcome_unknown":
      return "outcome_unknown";
    case "cancelled":
      return "cancelled";
    case "success":
      return "success";
    default:
      return null;
  }
}

function canTransitionPrintStatus(current: PrintStatus, next: PrintStatus): boolean {
  const curRank = PRINT_STATUS_RANK[current] ?? 0;
  const nextRank = PRINT_STATUS_RANK[next] ?? 0;
  // Terminal states (sent, outcome_unknown, failed, cancelled, success) never regress to queued or accepted
  if (curRank >= 3 && nextRank < 3) {
    return false;
  }
  return nextRank >= curRank;
}

/**
 * Ingests an ordered batch of agent events idempotently via `edge_event_receipt`.
 * Enforces monotonic `print_log` status transitions and records `offline_reprint` events.
 */
export async function ingestEdgeEventBatch(
  db: OrrnDb,
  input: {
    deploymentId: string;
    companyId: string;
    events: EdgeEventItem[];
    nowMs?: number;
  },
): Promise<{
  processed: number;
  deduplicated: number;
  results: Array<{ eventId: string; status: "applied" | "duplicate" }>;
}> {
  const nowMs = input.nowMs ?? Date.now();
  const now = new Date(nowMs);
  const parsedBatch = edgeEventsBatchRequestSchema.parse({ events: input.events });

  const eventIds = parsedBatch.events.map((e) => e.eventId);
  const existingReceipts =
    eventIds.length > 0
      ? await db
          .select()
          .from(edgeEventReceipt)
          .where(
            and(
              eq(edgeEventReceipt.deploymentId, input.deploymentId),
              inArray(edgeEventReceipt.eventId, eventIds),
              eq(edgeEventReceipt.companyId, input.companyId),
            ),
          )
          .all()
      : [];
  const receiptMap = new Map(existingReceipts.map((r) => [r.eventId, r]));

  let processed = 0;
  let deduplicated = 0;
  const results: Array<{ eventId: string; status: "applied" | "duplicate" }> = [];

  for (const ev of parsedBatch.events) {
    if (receiptMap.has(ev.eventId)) {
      deduplicated += 1;
      results.push({ eventId: ev.eventId, status: "duplicate" });
      continue;
    }

    const receiptResponse = { eventId: ev.eventId, status: "applied" as const };
    const statements: SqliteBatchItem[] = [
      db.insert(edgeEventReceipt).values({
        eventId: ev.eventId,
        deploymentId: input.deploymentId,
        companyId: input.companyId,
        kind: ev.kind,
        responseJson: JSON.stringify(receiptResponse),
        receivedAt: now,
      }),
    ];

    if (ev.kind === "job_state_changed") {
      const stateStr = typeof ev.payload.state === "string" ? ev.payload.state : "";
      const jobKey = typeof ev.payload.jobKey === "string" ? ev.payload.jobKey : null;
      const reason = typeof ev.payload.reason === "string" ? ev.payload.reason : null;
      const targetStatus = mapAgentJobStateToPrintStatus(stateStr);

      if (targetStatus) {
        const candidates = await db
          .select()
          .from(printLog)
          .where(
            and(
              eq(printLog.companyId, input.companyId),
              eq(printLog.deploymentId, input.deploymentId),
              or(
                eq(printLog.spoolJobId, ev.aggregateId),
                ...(jobKey ? [eq(printLog.jobKey, jobKey)] : []),
              ),
            ),
          )
          .all();
        const allowedCurrentStatuses = (Object.keys(PRINT_STATUS_RANK) as PrintStatus[]).filter((status) =>
          canTransitionPrintStatus(status, targetStatus),
        );
        for (const row of candidates) {
          statements.push(
            db
              .update(printLog)
              .set({
                status: targetStatus,
                ...(row.spoolJobId ? {} : { spoolJobId: ev.aggregateId }),
                ...(reason ? { responseText: reason } : {}),
                updatedAt: now,
              })
              .where(
                and(
                  eq(printLog.id, row.id),
                  eq(printLog.companyId, input.companyId),
                  eq(printLog.deploymentId, input.deploymentId),
                  inArray(printLog.status, allowedCurrentStatuses),
                ),
              ),
          );
        }
      }
    } else if (ev.kind === "config_applied") {
      const version = Number(ev.payload.configVersion ?? 0);
      if (Number.isInteger(version) && version > 0) {
        statements.push(
          db
            .update(spoolDeployment)
            .set({ appliedConfigVersion: version, updatedAt: now })
            .where(and(eq(spoolDeployment.id, input.deploymentId), eq(spoolDeployment.companyId, input.companyId))),
        );
      }
    } else if (ev.kind === "printer_endpoint_verified") {
      const parsed = edgePrinterEndpointVerifiedPayloadSchema.safeParse(ev.payload);
      if (parsed.success) {
        const endpoint = parsed.data;
        statements.push(
          db.update(printerProfile).set({
            macAddress: endpoint.macAddress,
            verifiedHost: endpoint.host,
            verifiedPort: endpoint.port,
            capabilitiesVerifiedAt: new Date(endpoint.verifiedAt),
            updatedAt: now,
          }).where(and(
            eq(printerProfile.companyId, input.companyId),
            eq(printerProfile.spoolPrinterId, endpoint.printerId),
            or(isNull(printerProfile.deploymentId), eq(printerProfile.deploymentId, input.deploymentId)),
          )),
        );
      }
    } else if (ev.kind === "offline_reprint") {
      const sourceJobKey = typeof ev.payload.sourceJobKey === "string" ? ev.payload.sourceJobKey : null;
      const reprintJobKey =
        typeof ev.payload.jobKey === "string" ? ev.payload.jobKey : `offline:reprint:${ev.eventId}`;
      const operator = typeof ev.payload.operator === "string" ? ev.payload.operator : "local_operator";
      const reason = typeof ev.payload.reason === "string" ? ev.payload.reason : "offline_reprint";
      const sourceLog = sourceJobKey
        ? await db
            .select()
            .from(printLog)
            .where(
              and(
                eq(printLog.companyId, input.companyId),
                eq(printLog.deploymentId, input.deploymentId),
                eq(printLog.jobKey, sourceJobKey),
              ),
            )
            .get()
        : undefined;
      const existingReprint = await db
        .select({ id: printLog.id })
        .from(printLog)
        .where(
          and(
            eq(printLog.companyId, input.companyId),
            eq(printLog.deploymentId, input.deploymentId),
            eq(printLog.jobKey, reprintJobKey),
          ),
        )
        .get();

      if (sourceLog && !existingReprint) {
        statements.push(
          db.insert(printLog).values({
            id: `offline_${await sha256HexString(`${input.deploymentId}:${reprintJobKey}`)}`,
            companyId: input.companyId,
            bundleId: sourceLog.bundleId,
            templateId: sourceLog.templateId,
            profileId: sourceLog.profileId,
            requestedBy: null,
            spoolJobId: ev.aggregateId,
            status: "accepted",
            deploymentId: input.deploymentId,
            copies: Number(ev.payload.copies ?? sourceLog.copies ?? 1),
            commandId: null,
            layout: sourceLog.layout ?? "x0",
            variables: { origin: "offline_reprint", operator, reason },
            payloadHash: sourceLog.payloadHash,
            responseText: `origin=offline_reprint operator=${operator} reason=${reason}`,
            attempt: sourceLog.attempt + 1,
            labelVersion: sourceLog.labelVersion ?? 1,
            jobKey: reprintJobKey,
            createdAt: new Date(ev.occurredAt),
            updatedAt: now,
          }).onConflictDoNothing(),
        );
      }
    }

    try {
      await atomicBatch(db, statements);
    } catch (error) {
      const concurrentReceipt = await db
        .select()
        .from(edgeEventReceipt)
        .where(
          and(
            eq(edgeEventReceipt.deploymentId, input.deploymentId),
            eq(edgeEventReceipt.companyId, input.companyId),
            eq(edgeEventReceipt.eventId, ev.eventId),
          ),
        )
        .get();
      if (!concurrentReceipt) throw error;
      receiptMap.set(ev.eventId, concurrentReceipt);
      deduplicated += 1;
      results.push({ eventId: ev.eventId, status: "duplicate" });
      continue;
    }
    receiptMap.set(ev.eventId, {
      eventId: ev.eventId,
      deploymentId: input.deploymentId,
      companyId: input.companyId,
      kind: ev.kind,
      responseJson: JSON.stringify(receiptResponse),
      receivedAt: now,
    });
    processed += 1;
    results.push(receiptResponse);
  }

  return { processed, deduplicated, results };
}

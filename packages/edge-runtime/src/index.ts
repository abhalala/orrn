import { z } from "zod";

export const edgeCapabilityKeys = [
  "catalog.read",
  "customer.read",
  "bundle.read",
  "bundle.create",
  "bundle.transition",
  "dispatch.add_bundle",
  "print.queue",
] as const;
export type EdgeCapability = (typeof edgeCapabilityKeys)[number];

export const edgeRuntimeFlavors = ["native", "desktop", "docker", "legacy-spool"] as const;
export type EdgeRuntimeFlavor = (typeof edgeRuntimeFlavors)[number];

export const edgeNodeStatuses = ["pending", "active", "offline", "revoked"] as const;
export type EdgeNodeStatus = (typeof edgeNodeStatuses)[number];

export const edgeSyncEntityKeys = ["dies", "customers", "bundles", "dispatches", "print_jobs"] as const;
export type EdgeSyncEntity = (typeof edgeSyncEntityKeys)[number];

export const edgeMutationOperationKeys = [
  "bundle.create",
  "bundle.transition",
  "dispatch.add_bundle",
  "print.queue",
] as const;
export type EdgeMutationOperation = (typeof edgeMutationOperationKeys)[number];

export const defaultEdgeCapabilities = [...edgeCapabilityKeys] satisfies EdgeCapability[];

export const edgeNodeEnrollmentInputSchema = z.object({
  nodeName: z.string().trim().min(2).max(64),
  siteLabel: z.string().trim().min(2).max(64),
  subdomain: z
    .string()
    .trim()
    .min(3)
    .max(63)
    .regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/)
    .optional(),
  runtimeFlavor: z.enum(edgeRuntimeFlavors).default("native"),
  runtimePlatform: z.string().trim().min(2).max(64).optional(),
  fingerprint: z.string().trim().min(8).max(256).optional(),
  capabilities: z.array(z.enum(edgeCapabilityKeys)).min(1).max(edgeCapabilityKeys.length).default(defaultEdgeCapabilities),
});
export type EdgeNodeEnrollmentInput = z.infer<typeof edgeNodeEnrollmentInputSchema>;

export const edgeNodeConfigSchema = z.object({
  deploymentId: z.string().uuid(),
  instanceId: z.string().uuid(),
  companyId: z.string().uuid(),
  nodeName: z.string(),
  siteLabel: z.string(),
  subdomain: z.string(),
  nodeDomain: z.string(),
  runtimeFlavor: z.enum(edgeRuntimeFlavors),
  runtimePlatform: z.string().nullable(),
  sharedSecret: z.string(),
  cfTunnelToken: z.string(),
  orrnServerUrl: z.string().url(),
  capabilities: z.array(z.enum(edgeCapabilityKeys)),
  runtimeVersion: z.string().nullable(),
  heartbeatPath: z.string().default("/webhooks/edge/heartbeat"),
  webhookPath: z.string().default("/webhooks/edge/print-events"),
  updateCheckPath: z.string().default("/api/edge/update-check"),
});
export type EdgeNodeConfig = z.infer<typeof edgeNodeConfigSchema>;

export const edgeHeartbeatPayloadSchema = z.object({
  instanceId: z.string().uuid(),
  version: z.string().min(1),
  fingerprint: z.string().min(8).max(256).optional(),
  runtimeFlavor: z.enum(edgeRuntimeFlavors).optional(),
  runtimePlatform: z.string().min(2).max(64).optional(),
  capabilities: z.array(z.enum(edgeCapabilityKeys)).optional(),
  pendingMutations: z.number().int().min(0).default(0),
  printerCount: z.number().int().min(0).default(0),
});
export type EdgeHeartbeatPayload = z.infer<typeof edgeHeartbeatPayloadSchema>;

export const edgeMutationEnvelopeSchema = z.object({
  id: z.string().uuid(),
  clientMutationId: z.string().min(1).max(128),
  companyId: z.string().uuid(),
  entity: z.enum(edgeSyncEntityKeys),
  op: z.enum(edgeMutationOperationKeys),
  payload: z.record(z.string(), z.unknown()),
  createdAt: z.string().datetime(),
});
export type EdgeMutationEnvelope = z.infer<typeof edgeMutationEnvelopeSchema>;

export type LocalEdgePaths = {
  rootDir: string;
  dataDir: string;
  configDir: string;
  logsDir: string;
  diagnosticsDir: string;
  databasePath: string;
  journalPath: string;
};

export function buildLocalEdgePaths(rootDir: string, nodeSlug: string): LocalEdgePaths {
  const normalizedRoot = rootDir.replace(/\/$/, "");
  const normalizedSlug = nodeSlug.replace(/[^a-z0-9-]/gi, "-").toLowerCase();
  const base = `${normalizedRoot}/${normalizedSlug}`;
  const dataDir = `${base}/data`;
  return {
    rootDir: base,
    dataDir,
    configDir: `${base}/config`,
    logsDir: `${base}/logs`,
    diagnosticsDir: `${base}/diagnostics`,
    databasePath: `${dataDir}/edge.db`,
    journalPath: `${dataDir}/journal.json`,
  };
}

export function isOfflineCapableOperation(op: EdgeMutationOperation): boolean {
  return edgeMutationOperationKeys.includes(op);
}

export const releaseSemverSchema = z
  .string()
  .trim()
  .regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/, "Release version must be explicit semver (never dev)");

export const edgeCommandKinds = ["print_job", "test_print", "cancel_job"] as const;
export type EdgeCommandKind = (typeof edgeCommandKinds)[number];

export const edgeCommandStates = ["queued", "leased", "accepted", "rejected"] as const;
export type EdgeCommandState = (typeof edgeCommandStates)[number];

export const edgeJobStates = [
  "accepted",
  "device_open",
  "transmitting",
  "sent",
  "failed_retryable",
  "failed_final",
  "outcome_unknown",
  "cancelled",
] as const;
export type EdgeJobState = (typeof edgeJobStates)[number];

export const edgeEnrollRequestSchema = z.object({
  enrollmentToken: z.string().trim().min(24).max(256),
  agentVersion: releaseSemverSchema,
  os: z.enum(["windows", "linux"]),
  arch: z.enum(["amd64", "arm64"]),
  installId: z.string().uuid(),
});
export type EdgeEnrollRequest = z.infer<typeof edgeEnrollRequestSchema>;

export const edgeEnrollResponseSchema = z.object({
  protocolVersion: z.literal(1),
  deploymentId: z.string().uuid(),
  instanceId: z.string().uuid(),
  nodeName: z.string(),
  siteLabel: z.string(),
  apiOrigin: z.string().url(),
  nodeSecret: z.string().min(32),
  credentialVersion: z.number().int().positive(),
  configVersion: z.number().int().positive(),
});
export type EdgeEnrollResponse = z.infer<typeof edgeEnrollResponseSchema>;

/** One printer in a node's desired config; the agent prints raw TSPL to host:port. */
export const edgeDesiredPrinterSchema = z.object({
  printerId: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(128),
  host: z.string().trim().min(1).max(253),
  port: z.number().int().min(1).max(65535).default(9100),
  paused: z.boolean().default(false),
  labelWidthMm: z.number().positive().max(300).optional(),
  labelHeightMm: z.number().positive().max(300).optional(),
  gapMm: z.number().min(0).max(50).optional(),
  dpi: z.union([z.literal(203), z.literal(300), z.literal(600)]).optional(),
  mediaType: z.enum(["gap", "black_mark", "continuous"]).optional(),
  speedInSec: z.number().int().min(1).max(12).optional(),
  density: z.number().int().min(0).max(15).optional(),
  cutterEnabled: z.boolean().optional(),
});
export type EdgeDesiredPrinter = z.infer<typeof edgeDesiredPrinterSchema>;

export const edgeDesiredPrintersSchema = z
  .array(edgeDesiredPrinterSchema)
  .max(32)
  .refine((list) => new Set(list.map((p) => p.printerId)).size === list.length, "printerId must be unique");

export const edgePrinterCapabilitiesSchema = z.object({
  macAddress: z.string().regex(/^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/).optional(),
  host: z.string().min(1).max(253),
  port: z.number().int().min(1).max(65535),
  features: z.array(z.string().min(1).max(64)).max(64),
  mediaType: z.string().max(32).optional(),
  mediaWidthMm: z.number().positive().max(300).optional(),
  mediaHeightMm: z.number().positive().max(300).optional(),
  gapMm: z.number().min(0).max(50).optional(),
  dpi: z.number().int().positive().max(1200).optional(),
  speedInSec: z.number().int().positive().max(20).optional(),
  density: z.number().int().min(0).max(30).optional(),
  cutter: z.boolean().optional(),
  verifiedAt: z.string().datetime(),
});
export type EdgePrinterCapabilities = z.infer<typeof edgePrinterCapabilitiesSchema>;

export const edgePollPrinterReportSchema = z.object({
  printerId: z.string().min(1).max(64),
  name: z.string().min(1).max(128),
  ipAddress: z.string().min(1).max(128),
  port: z.number().int().min(1).max(65535),
  status: z.enum(["online", "offline", "error", "paused", "unknown"]),
  canPrint: z.boolean(),
  lastSeenAt: z.string().datetime().nullable(),
  lastError: z.string().max(512).nullable(),
  capabilities: edgePrinterCapabilitiesSchema.optional(),
});
export type EdgePollPrinterReport = z.infer<typeof edgePollPrinterReportSchema>;

export const edgePollRequestSchema = z.object({
  limit: z.number().int().min(1).max(10).default(10),
  appliedConfigVersion: z.number().int().min(0).default(0),
  activeCredentialVersion: z.number().int().min(1).default(1),
  printers: z.array(edgePollPrinterReportSchema).max(32).optional(),
});
export type EdgePollRequest = z.infer<typeof edgePollRequestSchema>;

export const edgeLeasedCommandSchema = z.object({
  commandId: z.string().uuid(),
  leaseId: z.string().uuid(),
  leaseExpiresAt: z.string().datetime(),
  kind: z.enum(edgeCommandKinds),
  jobKey: z.string().nullable(),
  payloadHash: z.string().nullable(),
  deliveryCount: z.number().int().positive(),
  payload: z.record(z.string(), z.unknown()),
});
export type EdgeLeasedCommand = z.infer<typeof edgeLeasedCommandSchema>;

export const edgePollResponseSchema = z.object({
  protocolVersion: z.literal(1),
  configVersion: z.number().int().positive(),
  pendingCredentialVersion: z.number().int().positive().nullable(),
  commands: z.array(edgeLeasedCommandSchema),
});
export type EdgePollResponse = z.infer<typeof edgePollResponseSchema>;

export const edgeCommandResolutions = [
  "accepted",
  "already_accepted",
  "cancelled",
  "already_cancelled",
  "job_key_conflict",
  "job_not_found",
  "transmission_started",
  "job_not_cancellable",
  "invalid_payload",
] as const;
export type EdgeCommandResolution = (typeof edgeCommandResolutions)[number];

export const edgeCommandAckRequestSchema = z.object({
  commandId: z.string().uuid(),
  leaseId: z.string().uuid(),
  outcome: z.enum(["accepted", "rejected"]),
  resolution: z.enum(edgeCommandResolutions),
  agentJobId: z.string().min(1).max(64).nullable(),
  detail: z.string().max(512).nullable().default(null),
});
export type EdgeCommandAckRequest = z.infer<typeof edgeCommandAckRequestSchema>;

export const edgeConfirmCredentialRequestSchema = z.object({
  credentialVersion: z.number().int().positive(),
});
export type EdgeConfirmCredentialRequest = z.infer<typeof edgeConfirmCredentialRequestSchema>;

export const edgeEventKinds = [
  "job_state_changed",
  "command_resolved",
  "config_applied",
  "offline_reprint",
  "test_print_result",
  "printer_endpoint_verified",
] as const;
export type EdgeEventKind = (typeof edgeEventKinds)[number];

export const edgePrinterEndpointVerifiedPayloadSchema = z.object({
  printerId: z.string().min(1).max(64),
  host: z.string().min(1).max(253),
  port: z.number().int().min(1).max(65535),
  macAddress: z.string().regex(/^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/),
  model: z.enum(["TA220", "TE200"]),
  verifiedAt: z.string().datetime(),
});

export const edgeEventItemSchema = z.object({
  eventId: z.string().uuid(),
  aggregateId: z.string().min(1).max(128),
  sequence: z.number().int().positive(),
  kind: z.enum(edgeEventKinds),
  occurredAt: z.string().datetime(),
  payload: z.record(z.string(), z.unknown()),
});
export type EdgeEventItem = z.infer<typeof edgeEventItemSchema>;

export const edgeEventsBatchRequestSchema = z.object({
  events: z.array(edgeEventItemSchema).min(1).max(50),
});
export type EdgeEventsBatchRequest = z.infer<typeof edgeEventsBatchRequestSchema>;

export const edgeConfigResponseSchema = z.object({
  protocolVersion: z.literal(1),
  configSchemaVersion: z.literal(1),
  deploymentId: z.string().uuid(),
  instanceId: z.string().uuid(),
  nodeName: z.string(),
  siteLabel: z.string(),
  configVersion: z.number().int().positive(),
  credentialVersion: z.number().int().positive(),
  pendingCredentialVersion: z.number().int().positive().optional(),
  pendingSecret: z.string().min(32).optional(),
  printers: z.array(z.record(z.string(), z.unknown())),
  profiles: z.array(z.record(z.string(), z.unknown())),
  templates: z.array(z.record(z.string(), z.unknown())),
});
export type EdgeConfigResponse = z.infer<typeof edgeConfigResponseSchema>;

export const edgeSnapshotSections = [
  "stock",
  "orders",
  "dies",
  "print_status",
  "company_format",
] as const;
export type EdgeSnapshotSection = (typeof edgeSnapshotSections)[number];

export const edgeSnapshotChunkDescriptorSchema = z.object({
  sequence: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  recordCount: z.number().int().nonnegative(),
  byteLength: z.number().int().nonnegative(),
});
export type EdgeSnapshotChunkDescriptor = z.infer<typeof edgeSnapshotChunkDescriptorSchema>;

export const edgeSnapshotSectionDescriptorSchema = z.object({
  section: z.enum(edgeSnapshotSections),
  snapshotId: z.string().min(1),
  generatedAt: z.string().datetime(),
  contentSha256: z.string().regex(/^[0-9a-f]{64}$/),
  recordCount: z.number().int().nonnegative(),
  chunkCount: z.number().int().positive(),
  complete: z.boolean(),
  chunks: z.array(edgeSnapshotChunkDescriptorSchema),
});
export type EdgeSnapshotSectionDescriptor = z.infer<typeof edgeSnapshotSectionDescriptorSchema>;

export const edgeSnapshotManifestSchema = z.object({
  protocolVersion: z.literal(1),
  cacheSchemaVersion: z.literal(1),
  companyId: z.string().min(1),
  minAgentVersion: releaseSemverSchema,
  generatedAt: z.string().datetime(),
  sections: z.array(edgeSnapshotSectionDescriptorSchema),
});
export type EdgeSnapshotManifest = z.infer<typeof edgeSnapshotManifestSchema>;

export const edgeSnapshotRecordItemSchema = z.object({
  entityId: z.string().min(1),
  sortKey: z.string(),
  dto: z.record(z.string(), z.unknown()),
});
export type EdgeSnapshotRecordItem = z.infer<typeof edgeSnapshotRecordItemSchema>;

export const edgeSnapshotChunkPayloadSchema = z.object({
  protocolVersion: z.literal(1),
  cacheSchemaVersion: z.literal(1),
  companyId: z.string().min(1),
  section: z.enum(edgeSnapshotSections),
  snapshotId: z.string().min(1),
  sequence: z.number().int().nonnegative(),
  recordCount: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  records: z.array(edgeSnapshotRecordItemSchema),
  summaries: z.array(z.record(z.string(), z.unknown())),
});
export type EdgeSnapshotChunkPayload = z.infer<typeof edgeSnapshotChunkPayloadSchema>;

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

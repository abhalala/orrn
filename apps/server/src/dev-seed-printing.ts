/**
 * Printing demo for the dev seed: one label template, one printer profile, two print jobs waiting
 * (queued) and one edge (spool) node that has not connected yet (status pending, never seen),
 * reporting no scale (`scale_configured = false`), so the weigh-from-scale path shows "type the
 * weight" and the Printing page has a queue to show.
 *
 * Nothing here is a secret: the node's tunnel token and shared secret columns hold fixed placeholder
 * text (`dev-placeholder-...`), no real token and no key material. The node can never connect with them.
 */
import { edgeNodeDeployment } from "@orrn/db/schema/spool";
import { labelTemplate, printLog, printerProfile } from "@orrn/db/schema/printing";

import type { SeedBundle, SeedClock } from "./dev-seed-kit";

type InsertRow<T extends { $inferInsert: unknown }> = T["$inferInsert"];

export type PrintingSeed = {
  template: InsertRow<typeof labelTemplate>;
  profile: InsertRow<typeof printerProfile>;
  jobs: InsertRow<typeof printLog>[];
  node: InsertRow<typeof edgeNodeDeployment>;
};

export function buildPrinting(input: {
  companyId: string;
  clock: SeedClock;
  requestedBy: string;
  nextSeq: () => number;
  /** The two bundles packed most recently: their labels are waiting. */
  waiting: readonly SeedBundle[];
}): PrintingSeed {
  const { companyId, clock } = input;
  const createdAt = new Date(clock.pastAt(10, 9));
  const template: PrintingSeed["template"] = {
    id: "dev-label-template-1",
    companyId,
    serverSeq: input.nextSeq(),
    name: "Bundle label 100x50",
    kind: "bundle",
    schema: { width_mm: 100, height_mm: 50, elements: [] },
    variables: {},
    createdAt,
    updatedAt: createdAt,
  };
  const profile: PrintingSeed["profile"] = {
    id: "dev-printer-profile-1",
    companyId,
    serverSeq: input.nextSeq(),
    name: "Packing bay",
    spoolPrinterId: "dev-printer-1",
    templateId: template.id!,
    defaultCopies: 1,
    notes: "TSC TTP-244, bay 1. Waiting for the plant node to be switched on.",
    createdAt,
    updatedAt: createdAt,
  };
  const jobs: PrintingSeed["jobs"] = input.waiting.slice(0, 2).map((b, i) => ({
    id: `dev-print-job-${i + 1}`,
    companyId,
    bundleId: b.id,
    templateId: template.id!,
    profileId: profile.id!,
    requestedBy: input.requestedBy,
    status: "queued" as const,
    layout: "x0",
    variables: { serialNumber: b.serial },
    attempt: 1,
    createdAt: new Date(clock.dayAt(0.7 + i * 0.05)),
    updatedAt: new Date(clock.dayAt(0.7 + i * 0.05)),
  }));
  const node: PrintingSeed["node"] = {
    id: "dev-spool-node-1",
    companyId,
    instanceId: "dev-spool-instance-1",
    status: "pending",
    nodeName: "Packing bay node",
    siteLabel: "Main plant",
    subdomain: "dev-fourcubes",
    nodeDomain: "dev-fourcubes.spool.invalid",
    cfTunnelId: null,
    cfTunnelTokenWrapped: "dev-placeholder-not-a-token",
    sharedSecretHash: "dev-placeholder-not-a-hash",
    sharedSecretWrapped: "dev-placeholder-not-a-secret",
    runtimeFlavor: "native",
    runtimePlatform: null,
    lastHeartbeatAt: null,
    scaleConfigured: false,
    scaleSimulated: false,
    scaleReportedAt: new Date(clock.pastAt(1, 10)),
    createdAt,
    updatedAt: createdAt,
  };
  return { template, profile, jobs, node };
}

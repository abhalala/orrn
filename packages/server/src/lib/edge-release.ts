import { z } from "zod";

import { releaseSemverSchema } from "@orrn/edge-runtime";

export const edgeTargetPlatforms = ["windows-amd64", "linux-amd64", "linux-arm64"] as const;
export type EdgeTargetPlatform = (typeof edgeTargetPlatforms)[number];

const sha256HexSchema = z
  .string()
  .trim()
  .regex(/^[0-9a-f]{64}$/, "Must be a 64-character lowercase hex SHA-256 digest");

export const edgeArtifactDescriptorSchema = z
  .object({
    filename: z.string().trim().min(1).max(128),
    url: z.string().url(),
    sha256: sha256HexSchema,
  })
  .strict();
export type EdgeArtifactDescriptor = z.infer<typeof edgeArtifactDescriptorSchema>;

export const edgeReleaseManifestSchema = z
  .object({
    version: releaseSemverSchema,
    protocolVersion: z.literal(1),
    configSchemaVersion: z.literal(1),
    cacheSchemaVersion: z.literal(1),
    dockerImage: z
      .string()
      .trim()
      .regex(
        /^[a-z0-9./_-]+@sha256:[0-9a-f]{64}$/,
        "Docker image must be pinned to an immutable @sha256:<64-hex> digest",
      ),
    artifacts: z
      .object({
        "windows-amd64": edgeArtifactDescriptorSchema,
        "linux-amd64": edgeArtifactDescriptorSchema,
        "linux-arm64": edgeArtifactDescriptorSchema,
      })
      .strict(),
  })
  .strict()
  .superRefine((manifest, ctx) => {
    for (const platform of edgeTargetPlatforms) {
      const artifact = manifest.artifacts[platform];
      const suffix = platform === "windows-amd64" ? ".exe" : "";
      const expectedFilename = `orrn-edge-${platform}${suffix}`;
      const expectedUrl = `https://github.com/${EDGE_RELEASE_REPOSITORY}/releases/download/v${manifest.version}/${expectedFilename}`;
      if (artifact.filename !== expectedFilename || artifact.url !== expectedUrl) {
        ctx.addIssue({
          code: "custom",
          path: ["artifacts", platform],
          message: `${platform} must reference the canonical immutable executable ${expectedUrl}`,
        });
      }
    }
  });
export type EdgeReleaseManifest = z.infer<typeof edgeReleaseManifestSchema>;

export function selectEdgeArtifact(
  manifest: EdgeReleaseManifest,
  platform: EdgeTargetPlatform,
): EdgeArtifactDescriptor {
  const parsed = edgeReleaseManifestSchema.parse(manifest);
  const artifact = parsed.artifacts[platform];
  if (!artifact) {
    throw new Error(`Unsupported edge platform: ${platform}`);
  }
  return artifact;
}

const EDGE_RELEASE_REPOSITORY = "abhalala/orrn-spool";

/** The release manifest is addressed by an explicit version, never a mutable latest tag. */
export function edgeReleaseManifestUrl(version: string): string {
  const parsedVersion = releaseSemverSchema.parse(version);
  return `https://github.com/${EDGE_RELEASE_REPOSITORY}/releases/download/v${parsedVersion}/orrn-edge-release.json`;
}

/** Fetch and validate a versioned manifest, then select one immutable artifact from it. */
export async function resolveEdgeReleaseArtifact(
  version: string,
  platform: EdgeTargetPlatform,
  fetcher: typeof fetch = fetch,
): Promise<{ version: string; artifact: EdgeArtifactDescriptor; dockerImage: string; manifestUrl: string }> {
  const parsedVersion = releaseSemverSchema.parse(version);
  const manifestUrl = edgeReleaseManifestUrl(parsedVersion);
  const response = await fetcher(manifestUrl, { headers: { Accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`Edge release manifest ${version} is unavailable (${response.status})`);
  }
  const rawManifest = (await response.json()) as { version?: unknown };
  if (rawManifest.version !== parsedVersion) {
    throw new Error(`Edge release manifest version mismatch: expected ${parsedVersion}, received ${String(rawManifest.version)}`);
  }
  const manifest = edgeReleaseManifestSchema.parse(rawManifest);
  return { version: parsedVersion, artifact: selectEdgeArtifact(manifest, platform), dockerImage: manifest.dockerImage, manifestUrl };
}

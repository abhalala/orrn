import { describe, expect, test } from "bun:test";

import { edgeReleaseManifestSchema, resolveEdgeReleaseArtifact, selectEdgeArtifact } from "../src/lib/edge-release";

describe("edge release manifest contract", () => {
  test("accepts only explicit semver manifests with sha256 and image digest and rejects dev or secret fields", () => {
    const valid = edgeReleaseManifestSchema.parse({
      version: "1.0.0",
      protocolVersion: 1,
      configSchemaVersion: 1,
      cacheSchemaVersion: 1,
      dockerImage: "ghcr.io/abhalala/orrn-edge@sha256:" + "a".repeat(64),
      artifacts: {
        "windows-amd64": {
          filename: "orrn-edge-windows-amd64.exe",
          url: "https://github.com/abhalala/orrn-spool/releases/download/v1.0.0/orrn-edge-windows-amd64.exe",
          sha256: "b".repeat(64),
        },
        "linux-amd64": {
          filename: "orrn-edge-linux-amd64",
          url: "https://github.com/abhalala/orrn-spool/releases/download/v1.0.0/orrn-edge-linux-amd64",
          sha256: "c".repeat(64),
        },
        "linux-arm64": {
          filename: "orrn-edge-linux-arm64",
          url: "https://github.com/abhalala/orrn-spool/releases/download/v1.0.0/orrn-edge-linux-arm64",
          sha256: "d".repeat(64),
        },
      },
    });
    expect(selectEdgeArtifact(valid, "windows-amd64").filename).toBe("orrn-edge-windows-amd64.exe");
    expect(selectEdgeArtifact(valid, "linux-amd64").filename).toBe("orrn-edge-linux-amd64");
    expect(selectEdgeArtifact(valid, "linux-arm64").filename).toBe("orrn-edge-linux-arm64");

    expect(() =>
      edgeReleaseManifestSchema.parse({
        ...valid,
        version: "dev",
      }),
    ).toThrow();

    expect(() =>
      edgeReleaseManifestSchema.parse({
        ...valid,
        dockerImage: "ghcr.io/abhalala/orrn-edge:latest",
      }),
    ).toThrow();

    expect(() =>
      edgeReleaseManifestSchema.parse({
        ...valid,
        artifacts: {
          ...valid.artifacts,
          "linux-amd64": {
            ...valid.artifacts["linux-amd64"],
            filename: "orrn-edge-linux-amd64.zip",
            url: "http://github.com/abhalala/orrn-spool/releases/download/v1.0.0/orrn-edge-linux-amd64.zip",
          },
        },
      }),
    ).toThrow();
  });

  test("resolves linux-arm64 from an immutable versioned manifest and rejects a version mismatch", async () => {
    const manifest = edgeReleaseManifestSchema.parse({
      version: "1.2.3",
      protocolVersion: 1,
      configSchemaVersion: 1,
      cacheSchemaVersion: 1,
      dockerImage: "ghcr.io/abhalala/orrn-edge@sha256:" + "a".repeat(64),
      artifacts: {
        "windows-amd64": { filename: "orrn-edge-windows-amd64.exe", url: "https://github.com/abhalala/orrn-spool/releases/download/v1.2.3/orrn-edge-windows-amd64.exe", sha256: "b".repeat(64) },
        "linux-amd64": { filename: "orrn-edge-linux-amd64", url: "https://github.com/abhalala/orrn-spool/releases/download/v1.2.3/orrn-edge-linux-amd64", sha256: "c".repeat(64) },
        "linux-arm64": { filename: "orrn-edge-linux-arm64", url: "https://github.com/abhalala/orrn-spool/releases/download/v1.2.3/orrn-edge-linux-arm64", sha256: "d".repeat(64) },
      },
    });
    const requested: string[] = [];
    const release = await resolveEdgeReleaseArtifact("1.2.3", "linux-arm64", Object.assign(async (input: Parameters<typeof fetch>[0]) => {
      requested.push(String(input));
      return Response.json(manifest);
    }, { preconnect: () => {} }));
    expect(requested).toEqual(["https://github.com/abhalala/orrn-spool/releases/download/v1.2.3/orrn-edge-release.json"]);
    expect(release.artifact).toEqual(manifest.artifacts["linux-arm64"]);

    await expect(
      resolveEdgeReleaseArtifact("1.2.3", "linux-amd64", Object.assign(async () => Response.json({ ...manifest, version: "1.2.4" }), { preconnect: () => {} })),
    ).rejects.toThrow("version mismatch");
  });
});

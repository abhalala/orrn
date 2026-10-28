import { expect, mock, spyOn, test } from "bun:test";

import { signDownloadToken } from "@orrn/server/lib/spool-crypto";

const masterKey = Buffer.from("orrn-test-master-key-0123456789a").toString("base64");
const deployment = {
  id: crypto.randomUUID(),
  status: "active",
  installId: crypto.randomUUID(),
  enrollmentIssuedAt: new Date(),
  runtimeVersion: "1.2.3",
};
const createDb = mock(() => ({
  select: () => ({
    from: () => ({
      where: () => ({ get: async () => deployment }),
    }),
  }),
}));
mock.module("cloudflare:workers", () => ({ env: { ORRN_MASTER_KEY: masterKey } }));
// Capture the real module before replacing its Workers database binding for this route test.
const actualDb = await import("@orrn/db");
mock.module("@orrn/db", () => ({ createDb }));

// The route reads the mocked Workers and database bindings when its module is evaluated.
const { spoolRoutes } = await import("./spool-routes");

test("the Edge HTTP path redirects to the selected artifact and never enters legacy binary patching", async () => {
  const manifest = {
    version: "1.2.3",
    protocolVersion: 1,
    configSchemaVersion: 1,
    cacheSchemaVersion: 1,
    dockerImage: `ghcr.io/abhalala/orrn-edge@sha256:${"a".repeat(64)}`,
    artifacts: {
      "windows-amd64": { filename: "orrn-edge-windows-amd64.exe", url: "https://github.com/abhalala/orrn-spool/releases/download/v1.2.3/orrn-edge-windows-amd64.exe", sha256: "b".repeat(64) },
      "linux-amd64": { filename: "orrn-edge-linux-amd64", url: "https://github.com/abhalala/orrn-spool/releases/download/v1.2.3/orrn-edge-linux-amd64", sha256: "c".repeat(64) },
      "linux-arm64": { filename: "orrn-edge-linux-arm64", url: "https://github.com/abhalala/orrn-spool/releases/download/v1.2.3/orrn-edge-linux-arm64", sha256: "d".repeat(64) },
    },
  };
  const fetcher = spyOn(globalThis, "fetch").mockImplementation(Object.assign(async () => Response.json(manifest), { preconnect: () => {} }));
  try {
    const armToken = await signDownloadToken(deployment.id, "linux-arm64", masterKey);
    const response = await spoolRoutes.fetch(
      new Request(`https://api.orrn.test/api/edge/nodes/${deployment.id}/download/linux-arm64?token=${encodeURIComponent(armToken)}`),
    );
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(manifest.artifacts["linux-arm64"].url);
    expect(response.headers.get("x-edge-artifact-sha256")).toBe("d".repeat(64));

    const legacyToken = await signDownloadToken(deployment.id, "linux-amd64", masterKey);
    const legacyPath = await spoolRoutes.fetch(
      new Request(`https://api.orrn.test/api/spool/deployments/${deployment.id}/download/linux-amd64?token=${encodeURIComponent(legacyToken)}`),
    );
    expect(legacyPath.status).toBe(400);
    expect(await legacyPath.json()).toMatchObject({ error: "ORRN Edge releases are immutable; use the Edge node download path." });
    expect(fetcher).toHaveBeenCalledTimes(1);
  } finally {
    fetcher.mockRestore();
    mock.module("@orrn/db", () => actualDb);
  }
});

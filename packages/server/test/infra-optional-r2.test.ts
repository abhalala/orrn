import { describe, expect, test } from "bun:test";

import { optionalR2Bucket } from "../src/infra/optionalR2";

function providerError(status: number, code: number, message: string) {
  return Object.assign(new Error(message), { status, errorData: [{ code, message }] });
}

const unavailable = providerError(403, 10042, "Please enable R2 through the Cloudflare Dashboard.");

/** Deployment failures are observable: unrelated provider errors must never silently disable storage. */
describe("optional R2 deployment failures", () => {
  test("missing subscription omits each bucket and names its disabled feature in a warning", async () => {
    const warnings: string[] = [];
    for (const [name, feature] of [["die-files", "die files"], ["backups", "backups"]] as const) {
      const result = await optionalR2Bucket(name, {
        feature, env: {}, warn: (line) => warnings.push(line),
        probe: async () => { throw unavailable; },
        create: async () => { throw new Error("A missing subscription must not start a resource"); },
      });
      expect(result).toBeUndefined();
      expect(warnings.at(-1)).toContain(`R2 bucket "${name}" not created: Cloudflare 403 [10042]`);
      expect(warnings.at(-1)).toContain(`${feature} disabled`);
    }
    expect(warnings).toHaveLength(2);
  });

  test("explicit opt-out works without contacting the provider", async () => {
    const fail = async () => { throw new Error("Unexpected R2 provider request"); };
    expect(await optionalR2Bucket("backups", { feature: "backups", env: { ORRN_SKIP_R2: "1" }, probe: fail, create: fail, warn: () => {} })).toBeUndefined();
  });

  test("auth, unrelated subscription, network and provider failures remain deployment errors", async () => {
    for (const error of [
      providerError(403, 10000, "Authentication error"),
      providerError(403, 10001, "Workers subscription required"),
      providerError(403, 10001, "User is not subscribed to Workers"),
      providerError(403, 10001, "Forbidden"),
      providerError(500, 10042, "Please enable R2"),
      new Error("Network connection failed"),
    ]) {
      for (const phase of ["probe", "create"] as const) {
        await expect(optionalR2Bucket("backups", {
          feature: "backups", env: {},
          probe: async () => { if (phase === "probe") throw error; },
          create: async () => { throw error; },
        })).rejects.toBe(error);
      }
    }
  });
});

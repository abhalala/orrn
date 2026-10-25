/**
 * The collectors e2e adds and removes its own spectro inbox files (BACKLOG 97): the hook the dev server
 * mounts at POST /dev/spectro-file. Added files are the plant's own pending rows; removing one (also after
 * it was attached) leaves the demo plant's inbox as the seed made it.
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";

import { createTestEnv, type TestEnv } from "./harness";
import { DEV_SEED_COMPANY, DEV_SEED_PASSWORD, loadDevSeed, loadDevSpectro, precreateDevSeedUsers } from "./dev-seed-fixture";

setDefaultTimeout(60_000);
let env: TestEnv;
let devSpectroInput: Awaited<ReturnType<typeof loadDevSpectro>>["devSpectroInput"];
let runDevSpectro: Awaited<ReturnType<typeof loadDevSpectro>>["runDevSpectro"];
beforeAll(async () => {
  ({ devSpectroInput, runDevSpectro } = await loadDevSpectro());
  env = await createTestEnv();
  await precreateDevSeedUsers(env);
  const seed = await loadDevSeed();
  await seed(env.db, { password: DEV_SEED_PASSWORD });
}, 120_000);
afterAll(async () => {
  await env.dispose();
});

const names = async () => {
  const rows = await env.caller({ role: "owner", companyId: DEV_SEED_COMPANY }).foundry.spectroInbox.list({ status: ["pending_review"] });
  return rows.map((r) => r.fileName).sort();
};

describe("dev spectro hook", () => {
  test("add shows a real pending file, remove takes it away, the seed's simulated file stays", async () => {
    expect(await names()).toEqual(["simulated-6063.csv"]);
    await runDevSpectro(env.db, devSpectroInput.parse({ action: "add", id: "e2e-attach-1", fileName: "6063-1-attach.csv" }));
    expect(await names()).toEqual(["6063-1-attach.csv", "simulated-6063.csv"]);
    // A second add of the same id is a no-op, not an error.
    await runDevSpectro(env.db, devSpectroInput.parse({ action: "add", id: "e2e-attach-1", fileName: "6063-1-attach.csv" }));
    await runDevSpectro(env.db, devSpectroInput.parse({ action: "remove", id: "e2e-attach-1" }));
    expect(await names()).toEqual(["simulated-6063.csv"]);
    // Removing what is not there is fine.
    await runDevSpectro(env.db, devSpectroInput.parse({ action: "remove", id: "e2e-attach-1" }));
  });

  test("only ids a spec owns (e2e-...) are accepted, never a seeded row", () => {
    expect(devSpectroInput.safeParse({ action: "remove", id: "dev-inbox-sim" }).success).toBe(false);
    expect(devSpectroInput.safeParse({ action: "add", id: "x", fileName: "a.csv" }).success).toBe(false);
  });
});

import { describe, expect, test } from "bun:test";

import { canRunDevSeed } from "../src/lib/devSeedGate";

const dev = { NODE_ENV: "development", ORRN_LOCAL_PASSWORD: "x" };

describe("canRunDevSeed", () => {
  test("refused when ORRN_LOCAL_PASSWORD is unset or empty", () => {
    expect(canRunDevSeed({ NODE_ENV: "development" }, "http://localhost:3000/dev/seed")).toBe(false);
    expect(
      canRunDevSeed({ NODE_ENV: "development", ORRN_LOCAL_PASSWORD: "" }, "http://localhost:3000/dev/seed"),
    ).toBe(false);
  });

  test("refused on a non-loopback host even with the binding", () => {
    expect(canRunDevSeed(dev, "https://api.dev.orrn.app/dev/seed")).toBe(false);
    expect(canRunDevSeed(dev, "http://localhost.evil.example/dev/seed")).toBe(false);
    expect(canRunDevSeed(dev, "not a url")).toBe(false);
  });

  test("refused outside development", () => {
    expect(canRunDevSeed({ ...dev, NODE_ENV: "production" }, "http://localhost:3000/dev/seed")).toBe(false);
  });

  test("allowed with binding on loopback hosts", () => {
    expect(canRunDevSeed(dev, "http://localhost:3000/dev/seed")).toBe(true);
    expect(canRunDevSeed(dev, "http://127.0.0.1:3000/dev/seed")).toBe(true);
    expect(canRunDevSeed(dev, "http://[::1]:3000/dev/seed")).toBe(true);
  });
});

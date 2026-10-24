/**
 * Shared ORRN <-> orrn-spool machine-token vectors. The same JSON file lives in orrn-spool at
 * internal/api/middleware/testdata/orrn_hmac_vectors.json, where Go verifies every vector and
 * re-signs the valid ones to the identical token. If either side changes the format, both fail.
 */
import { describe, expect, test } from "bun:test";

import { vectors } from "./fixtures/spool-hmac-vectors";
import { SPOOL_TOKEN_MAX_SKEW_MS, signSpoolRequest, verifySpoolToken } from "../src/lib/spool-crypto";

type Vector = (typeof vectors.vectors)[number];
const bodyOf = (v: Vector) => (v.body === null ? null : new TextEncoder().encode(v.body));

describe("spool machine-token vectors (shared with orrn-spool)", () => {
  test("the file carries the agreed skew and a full set", () => {
    expect(vectors.maxSkewMs).toBe(SPOOL_TOKEN_MAX_SKEW_MS);
    expect(vectors.vectors.length).toBeGreaterThanOrEqual(10);
    expect(vectors.vectors.some((v) => v.valid)).toBe(true);
    expect(vectors.vectors.some((v) => !v.valid)).toBe(true);
  });

  for (const v of vectors.vectors) {
    test(`verify ${v.name}: ${v.valid ? "accepted" : "refused"} (${v.why})`, async () => {
      const ok = await verifySpoolToken(v.method, v.path, bodyOf(v), v.token, v.secret, vectors.maxSkewMs, v.verifyAtMs);
      expect(ok).toBe(v.valid);
    });
  }

  for (const v of vectors.vectors.filter((x) => x.valid)) {
    test(`sign ${v.name}: ORRN reproduces the token Go also produces`, async () => {
      expect(await signSpoolRequest(v.method, v.path, bodyOf(v), v.secret, v.timestampMs)).toBe(v.token);
    });
  }
});

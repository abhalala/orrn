/** Loads the shared ORRN <-> orrn-spool token vectors (identical JSON in both repos). */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type SpoolHmacVector = {
  name: string;
  secret: string;
  method: string;
  path: string;
  body: string | null;
  timestampMs: number;
  token: string;
  verifyAtMs: number;
  valid: boolean;
  why: string;
};

export const vectors: { description: string; maxSkewMs: number; vectors: SpoolHmacVector[] } = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "spool-hmac-vectors.json"), "utf8"),
);

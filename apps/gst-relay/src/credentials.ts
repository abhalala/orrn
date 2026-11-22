import { readFileSync, statSync } from "node:fs";

export interface Credentials {
  username: string;
  password: string;
  clientId: string;
  clientSecret: string;
}

export interface CredentialStore {
  get(gstin: string): Credentials | null;
}

export function memoryCredentialStore(record: Record<string, Credentials>): CredentialStore {
  return { get: (gstin) => (Object.hasOwn(record, gstin) ? (record[gstin] ?? null) : null) };
}

function isCred(v: unknown): v is Credentials {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return ["username", "password", "clientId", "clientSecret"].every((k) => typeof o[k] === "string" && (o[k] as string).length > 0);
}

/** Loads the JSON file once at start. Throws (without echoing contents) when it is malformed. */
export function fileCredentialStore(path: string, warn: (msg: string) => void = console.warn): CredentialStore {
  const mode = statSync(path).mode & 0o777;
  if ((mode & 0o077) !== 0) warn(`credentials file ${path} has mode ${mode.toString(8)}; it should be 600`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error(`credentials file ${path} is not valid JSON`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("credentials file must be a JSON object keyed by GSTIN");
  const record: Record<string, Credentials> = {};
  for (const [gstin, v] of Object.entries(parsed)) {
    if (!isCred(v)) throw new Error(`credentials entry for ${gstin} needs username, password, clientId, clientSecret`);
    record[gstin] = { username: v.username, password: v.password, clientId: v.clientId, clientSecret: v.clientSecret };
  }
  return memoryCredentialStore(record);
}

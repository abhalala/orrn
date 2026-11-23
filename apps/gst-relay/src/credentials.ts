import { readFileSync, statSync } from "node:fs";

/**
 * Review S2: the relay's config binds each orrn tenant (company id) to its own signing key and to the GSTINs
 * it may act for. A request is authorised by the tenant's signature; the GSTIN in its body only picks one of
 * that tenant's bound GSTINs and is refused otherwise.
 *
 * File shape (mode 600):
 *   { "tenants": { "<companyId>": { "key": "<64 hex, relayTenantKey(GST_RELAY_SECRET, companyId)>",
 *                                   "gstins": { "<GSTIN>": { "username", "password", "clientId", "clientSecret" } } } } }
 */
export interface Credentials {
  username: string;
  password: string;
  clientId: string;
  clientSecret: string;
}

export interface TenantBinding {
  key: string;
  gstins: Record<string, Credentials>;
}

export interface CredentialStore {
  /** The tenant's key and bound GSTINs, or null when the relay does not know it. */
  tenant(tenantId: string): TenantBinding | null;
}

export function memoryCredentialStore(record: Record<string, TenantBinding>): CredentialStore {
  return { tenant: (id) => (Object.hasOwn(record, id) ? (record[id] ?? null) : null) };
}

const GSTIN_RE = /^[0-9]{2}[A-Z0-9]{13}$/;
const KEY_RE = /^[0-9a-f]{64}$/;
const TENANT_RE = /^[A-Za-z0-9_-]{1,64}$/;

function isCred(v: unknown): v is Credentials {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return ["username", "password", "clientId", "clientSecret"].every((k) => typeof o[k] === "string" && (o[k] as string).length > 0);
}

/** Check a parsed config. Throws (never echoing secrets) when it is malformed. A GSTIN bound to two tenants is refused. */
export function parseTenantConfig(parsed: unknown): Record<string, TenantBinding> {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("credentials file must be a JSON object");
  const tenants = (parsed as { tenants?: unknown }).tenants;
  if (!tenants || typeof tenants !== "object" || Array.isArray(tenants)) throw new Error('credentials file needs a "tenants" object keyed by orrn company id');
  const record: Record<string, TenantBinding> = {};
  const owner = new Map<string, string>();
  for (const [tenantId, raw] of Object.entries(tenants)) {
    if (!TENANT_RE.test(tenantId)) throw new Error(`tenant id ${JSON.stringify(tenantId.slice(0, 64))} is malformed`);
    const t = raw as { key?: unknown; gstins?: unknown };
    if (typeof t?.key !== "string" || !KEY_RE.test(t.key)) throw new Error(`tenant ${tenantId} needs "key": 64 lower-case hex characters`);
    if (!t.gstins || typeof t.gstins !== "object" || Array.isArray(t.gstins)) throw new Error(`tenant ${tenantId} needs a "gstins" object`);
    const gstins: Record<string, Credentials> = {};
    for (const [gstin, v] of Object.entries(t.gstins as Record<string, unknown>)) {
      if (!GSTIN_RE.test(gstin)) throw new Error(`tenant ${tenantId}: ${gstin} is not a GSTIN`);
      if (!isCred(v)) throw new Error(`tenant ${tenantId}: credentials for ${gstin} need username, password, clientId, clientSecret`);
      const other = owner.get(gstin);
      if (other) throw new Error(`GSTIN ${gstin} is bound to two tenants (${other} and ${tenantId})`);
      owner.set(gstin, tenantId);
      gstins[gstin] = { username: v.username, password: v.password, clientId: v.clientId, clientSecret: v.clientSecret };
    }
    record[tenantId] = { key: t.key, gstins };
  }
  return record;
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
  return memoryCredentialStore(parseTenantConfig(parsed));
}

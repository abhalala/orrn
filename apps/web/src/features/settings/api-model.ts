/**
 * Pure rules of Settings > Plant API (XE PLATFORM row 83): which scopes a token form offers, token and delivery
 * states, the form checks that mirror the server's, and the text of the docs section. The server judges every call.
 */
import { API_RATE_PER_MINUTE, API_TOKEN_SCOPES, WEBHOOK_EVENT_KEYS, type ApiTokenScope, type WebhookEventKey } from "@orrn/domain";
import type { MessageKey } from "@orrn/i18n";

export const TOKEN_NAME_MAX = 60;
export const EXPIRY_DAYS_MAX = 730;
export const WEBHOOK_URL_MAX = 500;

export const scopeKey = (scope: ApiTokenScope) => `plat3.api.scopes.${scope.replace(/\./g, "__")}` as MessageKey;
export const eventKey = (event: WebhookEventKey | string) => `plat3.api.events.${event.replace(/\./g, "__")}` as MessageKey;

/** The scope boxes the form offers. Invoices are readable only while billing is on, so that box is disabled otherwise. */
export function scopeOptions(billingOn: boolean): { scope: ApiTokenScope; disabled: boolean; includesRates: boolean }[] {
  return API_TOKEN_SCOPES.map((scope) => ({
    scope,
    disabled: scope === "invoices.read" && !billingOn,
    includesRates: scope === "prices.read",
  }));
}

export function toggleScope(selected: readonly ApiTokenScope[], scope: ApiTokenScope): ApiTokenScope[] {
  return selected.includes(scope) ? selected.filter((s) => s !== scope) : [...selected, scope];
}

/** What is sent: in scope order, without invoices when billing is off. */
export function sendableScopes(selected: readonly ApiTokenScope[], billingOn: boolean): ApiTokenScope[] {
  return API_TOKEN_SCOPES.filter((s) => selected.includes(s) && (s !== "invoices.read" || billingOn));
}

/** "" is no expiry; otherwise whole days from 1 to 730. */
export function parseExpiryDays(text: string): { ok: true; days: number | null } | { ok: false } {
  const v = text.trim();
  if (v === "") return { ok: true, days: null };
  if (!/^\d{1,4}$/.test(v)) return { ok: false };
  const days = Number(v);
  return days >= 1 && days <= EXPIRY_DAYS_MAX ? { ok: true, days } : { ok: false };
}

export type TokenFormError = "nameRequired" | "needScope" | "invalidExpiry";

export function tokenFormErrors(form: { name: string; scopes: readonly ApiTokenScope[]; expiry: string }, billingOn: boolean): TokenFormError[] {
  const out: TokenFormError[] = [];
  if (form.name.trim().length === 0 || form.name.trim().length > TOKEN_NAME_MAX) out.push("nameRequired");
  if (sendableScopes(form.scopes, billingOn).length === 0) out.push("needScope");
  if (!parseExpiryDays(form.expiry).ok) out.push("invalidExpiry");
  return out;
}

export type TokenState = "active" | "revoked" | "expired";

/** A revoked token reads revoked even when it has also run out. */
export function tokenState(token: { revokedAt?: Date | string | null; expiresAt?: Date | string | null }, nowMs = Date.now()): TokenState {
  if (token.revokedAt) return "revoked";
  if (token.expiresAt && new Date(token.expiresAt).getTime() <= nowMs) return "expired";
  return "active";
}

export const canRevoke = (state: TokenState) => state === "active";

/** A full https address (the server also refuses local and private hosts). */
export function validWebhookUrl(text: string): boolean {
  const v = text.trim();
  if (v.length === 0 || v.length > WEBHOOK_URL_MAX) return false;
  try {
    const u = new URL(v);
    return u.protocol === "https:" && u.hostname.includes(".") && !u.username && !u.password;
  } catch {
    return false;
  }
}

export type WebhookFormError = "invalidUrl" | "needEvent";

export function webhookFormErrors(form: { url: string; events: readonly string[] }): WebhookFormError[] {
  const out: WebhookFormError[] = [];
  if (!validWebhookUrl(form.url)) out.push("invalidUrl");
  if (form.events.length === 0) out.push("needEvent");
  return out;
}

export function toggleEvent(selected: readonly WebhookEventKey[], event: WebhookEventKey): WebhookEventKey[] {
  return selected.includes(event) ? selected.filter((e) => e !== event) : [...selected, event];
}

export const ALL_EVENTS: readonly WebhookEventKey[] = WEBHOOK_EVENT_KEYS;

export type DeliveryStatus = "pending" | "delivered" | "failed";
export const deliveryTone = (status: DeliveryStatus): "amber" | "green" | "red" => (status === "failed" ? "red" : status === "delivered" ? "green" : "amber");
/** Send again is offered only on a failed row. */
export const canResend = (status: string) => status === "failed";

/** The API address on the host the web already talks to. */
export function apiBaseUrl(serverUrl: string): string {
  return `${serverUrl.replace(/\/+$/, "")}/api/v1`;
}

export const OPENAPI_PATH = "/api/v1/openapi.json";
export const openApiUrl = (serverUrl: string) => `${serverUrl.replace(/\/+$/, "")}${OPENAPI_PATH}`;

/** The endpoints the docs list; `billing` marks the ones that need tax invoices on. */
export const API_ENDPOINTS: readonly { path: string; word: "endpointOrders" | "endpointStock" | "endpointDispatches" | "endpointInvoices"; billing: boolean }[] = [
  { path: "/orders", word: "endpointOrders", billing: false },
  { path: "/stock", word: "endpointStock", billing: false },
  { path: "/dispatches", word: "endpointDispatches", billing: false },
  { path: "/invoices", word: "endpointInvoices", billing: true },
];

export const RATE_PER_MINUTE = API_RATE_PER_MINUTE;

export const authHeaderExample = "Authorization: Bearer orrna_...";

/** A few lines of Node that check `x-orrn-signature` (code is English on every language). */
export const SIGNATURE_EXAMPLE = `import { createHmac, timingSafeEqual } from "node:crypto";

// header: x-orrn-signature: t=<seconds>,v1=<hex>
export function verify(rawBody, header, secret) {
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=")));
  const expected = createHmac("sha256", secret).update(parts.t + "." + rawBody).digest("hex");
  const sent = Buffer.from(parts.v1 ?? "", "hex");
  const want = Buffer.from(expected, "hex");
  const fresh = Math.abs(Date.now() / 1000 - Number(parts.t)) < 300;
  return fresh && sent.length === want.length && timingSafeEqual(sent, want);
}`;

export const curlExample = (serverUrl: string) => `curl -H "${authHeaderExample}" "${apiBaseUrl(serverUrl)}/orders?limit=20"`;

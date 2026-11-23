import { describe, expect, test } from "bun:test";

import { API_TOKEN_SCOPES, WEBHOOK_EVENT_KEYS } from "@orrn/domain";
import { en } from "@orrn/i18n/en";
import { hi } from "@orrn/i18n/hi";

import {
  apiBaseUrl,
  canResend,
  canRevoke,
  curlExample,
  deliveryTone,
  eventKey,
  openApiUrl,
  parseExpiryDays,
  scopeKey,
  scopeOptions,
  sendableScopes,
  SIGNATURE_EXAMPLE,
  toggleEvent,
  toggleScope,
  tokenFormErrors,
  tokenState,
  validWebhookUrl,
  webhookFormErrors,
} from "./api-model";

const get = (dict: unknown, key: string) => key.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], dict);

describe("token scopes", () => {
  test("invoices can be picked only with billing on; rates are the one that includes rates", () => {
    const off = scopeOptions(false);
    expect(off.map((o) => o.scope)).toEqual([...API_TOKEN_SCOPES]);
    expect(off.filter((o) => o.disabled).map((o) => o.scope)).toEqual(["invoices.read"]);
    expect(scopeOptions(true).some((o) => o.disabled)).toBe(false);
    expect(scopeOptions(true).filter((o) => o.includesRates).map((o) => o.scope)).toEqual(["prices.read"]);
  });

  test("the rates label says it includes rates, in English and Hindi", () => {
    expect(get(en, scopeKey("prices.read"))).toContain("includes rates");
    expect(typeof get(hi, scopeKey("prices.read"))).toBe("string");
  });

  test("every scope and event has words in English and Hindi", () => {
    for (const s of API_TOKEN_SCOPES) expect([typeof get(en, scopeKey(s)), typeof get(hi, scopeKey(s))]).toEqual(["string", "string"]);
    for (const e of WEBHOOK_EVENT_KEYS) expect([typeof get(en, eventKey(e)), typeof get(hi, eventKey(e))]).toEqual(["string", "string"]);
  });

  test("what is sent follows scope order and never carries invoices while billing is off", () => {
    expect(sendableScopes(["prices.read", "orders.read", "invoices.read"], false)).toEqual(["orders.read", "prices.read"]);
    expect(sendableScopes(["prices.read", "invoices.read"], true)).toEqual(["invoices.read", "prices.read"]);
    expect(toggleScope(["orders.read"], "stock.read")).toEqual(["orders.read", "stock.read"]);
    expect(toggleScope(["orders.read"], "orders.read")).toEqual([]);
  });
});

describe("token form", () => {
  test("expiry is empty or whole days from 1 to 730", () => {
    expect(parseExpiryDays("")).toEqual({ ok: true, days: null });
    expect(parseExpiryDays(" 30 ")).toEqual({ ok: true, days: 30 });
    expect(parseExpiryDays("730")).toEqual({ ok: true, days: 730 });
    for (const bad of ["0", "731", "1.5", "-3", "ten", "1e2"]) expect(parseExpiryDays(bad)).toEqual({ ok: false });
  });

  test("a name, one readable scope and a good expiry", () => {
    expect(tokenFormErrors({ name: "Tally", scopes: ["orders.read"], expiry: "" }, false)).toEqual([]);
    expect(tokenFormErrors({ name: " ", scopes: [], expiry: "x" }, false)).toEqual(["nameRequired", "needScope", "invalidExpiry"]);
    // Only invoices picked, billing off: nothing readable is left.
    expect(tokenFormErrors({ name: "A", scopes: ["invoices.read"], expiry: "" }, false)).toEqual(["needScope"]);
  });

  test("a token is working, revoked or expired; revoke is offered only while working", () => {
    const now = Date.parse("2026-11-22T10:00:00Z");
    expect(tokenState({}, now)).toBe("active");
    expect(tokenState({ expiresAt: "2026-11-23T00:00:00Z" }, now)).toBe("active");
    expect(tokenState({ expiresAt: "2026-11-22T10:00:00Z" }, now)).toBe("expired");
    expect(tokenState({ revokedAt: "2026-11-01T00:00:00Z", expiresAt: "2026-01-01T00:00:00Z" }, now)).toBe("revoked");
    expect(canRevoke("active")).toBe(true);
    expect(canRevoke("revoked")).toBe(false);
    expect(canRevoke("expired")).toBe(false);
  });
});

describe("webhooks", () => {
  test("only a full https address passes", () => {
    expect(validWebhookUrl("https://hooks.example.com/orrn")).toBe(true);
    for (const bad of ["", "http://hooks.example.com", "hooks.example.com", "https://localhost/x", "https://user:pw@example.com/", "ftp://example.com", "https://" + "a".repeat(500) + ".com"]) {
      expect({ bad, ok: validWebhookUrl(bad) }).toEqual({ bad, ok: false });
    }
  });

  test("an address and at least one event", () => {
    expect(webhookFormErrors({ url: "https://a.example.com", events: ["order.confirmed"] })).toEqual([]);
    expect(webhookFormErrors({ url: "nope", events: [] })).toEqual(["invalidUrl", "needEvent"]);
    expect(toggleEvent(["order.confirmed"], "dispatch.done")).toEqual(["order.confirmed", "dispatch.done"]);
    expect(toggleEvent(["order.confirmed"], "order.confirmed")).toEqual([]);
  });

  test("only a failed delivery can be sent again, and each state has its own tone", () => {
    expect(canResend("failed")).toBe(true);
    expect(canResend("pending")).toBe(false);
    expect(canResend("delivered")).toBe(false);
    expect([deliveryTone("pending"), deliveryTone("delivered"), deliveryTone("failed")]).toEqual(["amber", "green", "red"]);
  });
});

describe("docs", () => {
  test("the address is on the host the web talks to, with and without a trailing slash", () => {
    expect(apiBaseUrl("https://api.orrn.in")).toBe("https://api.orrn.in/api/v1");
    expect(apiBaseUrl("https://api.orrn.in//")).toBe("https://api.orrn.in/api/v1");
    expect(openApiUrl("https://api.orrn.in/")).toBe("https://api.orrn.in/api/v1/openapi.json");
    expect(curlExample("https://api.orrn.in")).toContain("Authorization: Bearer orrn");
  });

  test("the signature example signs timestamp, dot and raw body, as the server does", () => {
    expect(SIGNATURE_EXAMPLE).toContain('createHmac("sha256", secret)');
    expect(SIGNATURE_EXAMPLE).toContain('parts.t + "." + rawBody');
    expect(SIGNATURE_EXAMPLE).toContain("timingSafeEqual");
  });
});

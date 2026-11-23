import { describe, expect, test } from "bun:test";

import {
  apiPageLimit,
  decodeApiCursor,
  encodeApiCursor,
  isBlockedAddress,
  nextWebhookAttemptAt,
  WEBHOOK_GIVE_UP_MS,
  webhookSignatureHeader,
  webhookSigningInput,
  webhookUrlProblem,
} from "./platformApi";

describe("SSRF classifier (XE PLATFORM row 83)", () => {
  test.each([
    "10.0.0.1", "127.0.0.1", "0.0.0.0", "169.254.169.254", "172.16.0.1", "172.31.255.255", "192.168.1.10",
    "100.64.0.1", "100.100.100.100", "100.127.255.255", "224.0.0.1", "255.255.255.255", "198.18.0.1", "192.0.2.5",
    "::1", "::", "fe80::1", "fc00::1", "fd7a:115c:a1e0::1", "::ffff:127.0.0.1", "::ffff:10.1.2.3", "64:ff9b::a00:1",
    "2002:0a00:0001::", "ff02::1", "2001:db8::1", "fe80::1%eth0", "not-an-ip",
  ])("blocks %s", (ip) => {
    expect(isBlockedAddress(ip)).toBe(true);
  });

  test.each(["1.1.1.1", "8.8.8.8", "100.63.255.255", "100.128.0.1", "172.32.0.1", "2606:4700:4700::1111", "::ffff:8.8.8.8"])(
    "allows %s",
    (ip) => {
      expect(isBlockedAddress(ip)).toBe(false);
    },
  );

  test("URL rules", () => {
    expect(webhookUrlProblem("https://hooks.example.com/orrn")).toBeNull();
    expect(webhookUrlProblem("https://hooks.example.com:443/x")).toBeNull();
    expect(webhookUrlProblem("http://hooks.example.com/")).toBe("not_https");
    expect(webhookUrlProblem("https://user:pw@hooks.example.com/")).toBe("credentials");
    expect(webhookUrlProblem("https://hooks.example.com:8443/")).toBe("port");
    expect(webhookUrlProblem("https://localhost/")).toBe("private_host");
    expect(webhookUrlProblem("https://box.tail1234.ts.net/")).toBe("private_host");
    expect(webhookUrlProblem("https://printer.local/")).toBe("private_host");
    expect(webhookUrlProblem("https://10.0.0.5/")).toBe("private_host");
    expect(webhookUrlProblem("https://[::1]/")).toBe("private_host");
    expect(webhookUrlProblem("https://2130706433/")).toBe("private_host");
    expect(webhookUrlProblem("https://0x7f000001/")).toBe("private_host");
    expect(webhookUrlProblem("https://intranet/")).toBe("private_host");
    expect(webhookUrlProblem("nonsense")).toBe("not_url");
    expect(webhookUrlProblem(`https://a.com/${"x".repeat(600)}`)).toBe("too_long");
  });
});

describe("retries and signatures", () => {
  test("backoff grows and stops after 24 h", () => {
    const t0 = 1_000_000;
    expect(nextWebhookAttemptAt(1, t0, t0)).toBe(t0 + 60_000);
    expect(nextWebhookAttemptAt(2, t0, t0)).toBe(t0 + 5 * 60_000);
    expect(nextWebhookAttemptAt(6, t0, t0)).toBe(t0 + 6 * 3_600_000);
    expect(nextWebhookAttemptAt(9, t0, t0 + WEBHOOK_GIVE_UP_MS - 1000)).toBeNull();
  });

  test("signing input and header", () => {
    expect(webhookSigningInput(1700000000, '{"a":1}')).toBe('1700000000.{"a":1}');
    expect(webhookSignatureHeader(1700000000, "ab")).toBe("t=1700000000,v1=ab");
  });
});

describe("pages", () => {
  test("cursor round trip and refusals", () => {
    expect(decodeApiCursor(encodeApiCursor(250))).toBe(250);
    expect(decodeApiCursor(null)).toBe(0);
    expect(decodeApiCursor("%%%")).toBeNull();
    expect(decodeApiCursor(btoa(JSON.stringify({ o: -1 })))).toBeNull();
  });
  test("limit", () => {
    expect(apiPageLimit(null)).toBe(50);
    expect(apiPageLimit("500")).toBe(100);
    expect(apiPageLimit("0")).toBe(1);
    expect(apiPageLimit("abc")).toBeNull();
  });
});

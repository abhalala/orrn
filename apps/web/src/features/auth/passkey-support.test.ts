import { describe, expect, test } from "bun:test";

import { passkeySupport } from "./passkey-support";

/** A stand-in window: only the field `passkeySupport` reads. */
const fakeWindow = (credential: unknown) => ({ PublicKeyCredential: credential }) as unknown as Window;

describe("passkeySupport", () => {
  test("no PublicKeyCredential (old WebView, WebAuthn turned off): no passkey button, no autofill", async () => {
    const support = passkeySupport(fakeWindow(undefined));
    expect(support.available).toBe(false);
    expect(await support.conditional).toBe(false);
  });

  test("PublicKeyCredential with conditional mediation: button and autofill", async () => {
    function PublicKeyCredential() {}
    PublicKeyCredential.isConditionalMediationAvailable = async () => true;
    const support = passkeySupport(fakeWindow(PublicKeyCredential));
    expect(support.available).toBe(true);
    expect(await support.conditional).toBe(true);
  });

  test("PublicKeyCredential without the conditional check (older Safari): button, no autofill", async () => {
    function PublicKeyCredential() {}
    const support = passkeySupport(fakeWindow(PublicKeyCredential));
    expect(support.available).toBe(true);
    expect(await support.conditional).toBe(false);
  });

  test("a conditional check that throws or says no reads as no autofill", async () => {
    function Throws() {}
    Throws.isConditionalMediationAvailable = async () => {
      throw new Error("blocked");
    };
    expect(await passkeySupport(fakeWindow(Throws)).conditional).toBe(false);
    function SaysNo() {}
    SaysNo.isConditionalMediationAvailable = async () => false;
    expect(await passkeySupport(fakeWindow(SaysNo)).conditional).toBe(false);
  });

  test("a PublicKeyCredential that is not a function (a stub object) is not support", async () => {
    const support = passkeySupport(fakeWindow({}));
    expect(support.available).toBe(false);
    expect(await support.conditional).toBe(false);
  });

  test("no window at all (server render, bun tests) is not support", async () => {
    const support = passkeySupport(undefined);
    expect(support.available).toBe(false);
    expect(await support.conditional).toBe(false);
  });
});

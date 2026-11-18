import { describe, expect, test } from "bun:test";

import { addPasskeyWith, defaultPasskeyName, passkeyAddErrorKey } from "./passkey-add";

describe("defaultPasskeyName: the device, so the Settings list tells passkeys apart", () => {
  test("phones, tablets and computers", () => {
    expect(defaultPasskeyName("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15")).toBe("iPhone");
    expect(defaultPasskeyName("Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15")).toBe("iPad");
    expect(defaultPasskeyName("Mozilla/5.0 (Linux; Android 14; SM-A146B) AppleWebKit/537.36 Chrome/130 Mobile")).toBe("Android");
    expect(defaultPasskeyName("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131")).toBe("Mac");
    expect(defaultPasskeyName("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131")).toBe("Windows");
    expect(defaultPasskeyName("Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36")).toBe("Chromebook");
    expect(defaultPasskeyName("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131")).toBe("Linux");
  });

  test("an agent it cannot read gives no name (the list says Passkey)", () => {
    expect(defaultPasskeyName("")).toBeUndefined();
    expect(defaultPasskeyName("curl/8.0")).toBeUndefined();
  });
});

describe("passkeyAddErrorKey", () => {
  test("the person closed the sheet, or the ceremony was aborted", () => {
    expect(passkeyAddErrorKey({ code: "ERROR_CEREMONY_ABORTED", status: 400 })).toBe("auth.errors.passkeyAddCancelled");
    expect(passkeyAddErrorKey({ code: "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY", status: 400 })).toBe("auth.errors.passkeyAddCancelled");
  });

  test("this device already holds a passkey for the account", () => {
    expect(passkeyAddErrorKey({ code: "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED", status: 400 })).toBe("auth.errors.passkeyExists");
  });

  test("a session older than a day: sign in again (the plugin's fresh-session rule)", () => {
    expect(passkeyAddErrorKey({ code: "SESSION_NOT_FRESH", status: 403 })).toBe("auth.errors.signInAgain");
  });

  test("network, rate limit and anything else, never the server's text", () => {
    expect(passkeyAddErrorKey(new TypeError("Failed to fetch"))).toBe("errors.network");
    expect(passkeyAddErrorKey({ status: 0 })).toBe("errors.network");
    expect(passkeyAddErrorKey({ status: 429 })).toBe("auth.errors.tooMany");
    expect(passkeyAddErrorKey({ code: "FAILED_TO_VERIFY_REGISTRATION", status: 400, message: "Failed to verify registration" })).toBe(
      "auth.errors.passkeyAddFailed",
    );
  });
});

describe("addPasskeyWith", () => {
  test("cancels any pending passkey request (the sign-in autofill) before it asks the browser", async () => {
    const calls: string[] = [];
    const result = await addPasskeyWith(
      async (opts) => {
        calls.push(`add:${opts.name ?? ""}`);
        return { data: { id: "p1" }, error: null };
      },
      () => calls.push("cancel"),
      "Mac",
    );
    expect(calls).toEqual(["cancel", "add:Mac"]);
    expect(result).toBeNull();
  });

  test("a refusal comes back as a message key; a throw too", async () => {
    expect(await addPasskeyWith(async () => ({ data: null, error: { code: "SESSION_NOT_FRESH", status: 403 } }), () => {}, undefined)).toBe(
      "auth.errors.signInAgain",
    );
    expect(
      await addPasskeyWith(
        async () => {
          throw new TypeError("Failed to fetch");
        },
        () => {},
        undefined,
      ),
    ).toBe("errors.network");
  });
});

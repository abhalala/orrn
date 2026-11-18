import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { startPasskeyAutofill, type PasskeyAutofillDeps, type PasskeyAutofillResult } from "./passkey-autofill";

/**
 * Saved passkeys in the email field's autofill (conditional mediation) on /login. Council r1, B5
 * (Gemini I2): a cleanup that ran while the challenge request was in flight left the browser request
 * to start afterwards, outliving the page. The ceremony now checks it is still wanted after each step.
 */

type Answer = { data: unknown; error: { code?: string; status?: number } | null };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const OPTIONS = { challenge: "chal", rpId: "orrn.in", allowCredentials: [], userVerification: "preferred" };
const ASSERTION = {
  id: "cred-1",
  rawId: "cred-1",
  type: "public-key",
  response: { authenticatorData: "ad", clientDataJSON: "cd", signature: "sig", userHandle: "uh" },
  clientExtensionResults: {},
  authenticatorAttachment: "platform",
};

function harness(over: Partial<PasskeyAutofillDeps> = {}) {
  const log: string[] = [];
  const results: PasskeyAutofillResult[] = [];
  const optionsCall = deferred<Answer>();
  const startCall = deferred<unknown>();
  const verifyCall = deferred<Answer>();
  let verifiedBody: unknown;
  const deps: PasskeyAutofillDeps = {
    conditional: Promise.resolve(true),
    fetchOptions: () => {
      log.push("options");
      return optionsCall.promise;
    },
    start: (options) => {
      log.push(`start:${(options as { challenge: string }).challenge}`);
      return startCall.promise as never;
    },
    verify: (body) => {
      log.push("verify");
      verifiedBody = body;
      return verifyCall.promise;
    },
    signedIn: () => log.push("signal"),
    cancel: () => log.push("cancel"),
    ...over,
  };
  const stop = startPasskeyAutofill(deps, (r) => results.push(r));
  return { log, results, stop, optionsCall, startCall, verifyCall, body: () => verifiedBody };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

describe("the autofill ceremony", () => {
  test("a pick signs in: options, the browser request, verify without the extension results, then the session signal", async () => {
    const h = harness();
    await settle();
    h.optionsCall.resolve({ data: OPTIONS, error: null });
    await settle();
    h.startCall.resolve(ASSERTION);
    await settle();
    h.verifyCall.resolve({ data: { session: {} }, error: null });
    await settle();
    expect(h.log).toEqual(["options", "start:chal", "verify", "signal"]);
    const { clientExtensionResults: _dropped, ...expected } = ASSERTION;
    expect(h.body()).toEqual(expected);
    expect(h.results).toEqual([{ kind: "signedIn" }]);
  });

  test("cleanup while the challenge request is in flight: the browser request never starts", async () => {
    const h = harness();
    await settle();
    expect(h.log).toEqual(["options"]);
    h.stop();
    h.optionsCall.resolve({ data: OPTIONS, error: null });
    await settle();
    expect(h.log).toEqual(["options", "cancel"]);
    expect(h.results).toEqual([]);
  });

  test("cleanup before the browser says it can autofill: nothing is asked of the server", async () => {
    const conditional = deferred<boolean>();
    const h = harness({ conditional: conditional.promise });
    h.stop();
    conditional.resolve(true);
    await settle();
    expect(h.log).toEqual(["cancel"]);
  });

  test("cleanup while the browser request is open cancels it, and a late pick is not verified", async () => {
    const h = harness();
    await settle();
    h.optionsCall.resolve({ data: OPTIONS, error: null });
    await settle();
    h.stop();
    h.startCall.resolve(ASSERTION);
    await settle();
    expect(h.log).toEqual(["options", "start:chal", "cancel"]);
    expect(h.results).toEqual([]);
  });

  test("a refused pick is reported with the server's code; a failed challenge or a cancelled request says nothing", async () => {
    const refused = harness();
    await settle();
    refused.optionsCall.resolve({ data: OPTIONS, error: null });
    await settle();
    refused.startCall.resolve(ASSERTION);
    await settle();
    refused.verifyCall.resolve({ data: null, error: { code: "PASSKEY_NOT_FOUND", status: 401 } });
    await settle();
    expect(refused.results).toEqual([{ kind: "refused", error: { code: "PASSKEY_NOT_FOUND", status: 401 } }]);

    const offline = harness();
    await settle();
    offline.optionsCall.resolve({ data: null, error: { status: 0 } });
    await settle();
    expect(offline.log).toEqual(["options"]);
    expect(offline.results).toEqual([]);

    const cancelled = harness();
    await settle();
    cancelled.optionsCall.resolve({ data: OPTIONS, error: null });
    await settle();
    cancelled.startCall.reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
    await settle();
    expect(cancelled.log).toEqual(["options", "start:chal"]);
    expect(cancelled.results).toEqual([]);
  });

  test("a browser that cannot autofill asks nothing", async () => {
    const h = harness({ conditional: Promise.resolve(false) });
    await settle();
    expect(h.log).toEqual([]);
  });
});

describe("wiring", () => {
  test("the sign-in form runs this ceremony, not the plugin's one-shot autofill call", () => {
    const form = readFileSync(join(import.meta.dir, "sign-in-form.tsx"), "utf8");
    expect(form).toContain("startPasskeyAutofill(");
    expect(form).not.toContain("signIn.passkey({ autoFill: true })");
    expect(form).toContain("WebAuthnAbortService.cancelCeremony()");
  });
});

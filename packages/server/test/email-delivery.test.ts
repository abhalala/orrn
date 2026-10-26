import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";

import { EmailDeliveryError, sendTransactionalEmail } from "@orrn/auth/email-delivery";

const email = {
  to: "owner@example.net",
  subject: "Your ORRN invitation",
  html: '<a href="https://app.test/invite/secret-token">Accept</a>',
  text: "Accept: https://app.test/invite/secret-token",
};

afterEach(() => mock.restore());

describe("transactional email provider selection", () => {
  test("a Cloudflare binding takes precedence over a configured Resend key", async () => {
    const send = mock(async () => ({ messageId: "cf-message" }));
    const fetchSpy = spyOn(globalThis, "fetch").mockRejectedValue(new Error("Resend must not run"));
    const result = await sendTransactionalEmail({ EMAIL: { send }, RESEND_API_KEY: "resend-key", NODE_ENV: "production" }, email);
    expect(result).toEqual({ success: true, messageId: "cf-message" });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({ from: { email: "no-reply@orrn.in", name: "ORRN" }, ...email });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("Cloudflare send exceptions retain their code and identity and do not trigger Resend", async () => {
    const error = Object.assign(new Error("sender is not verified"), { code: "E_SENDER_NOT_VERIFIED" });
    const send = mock(async () => { throw error; });
    const fetchSpy = spyOn(globalThis, "fetch").mockRejectedValue(new Error("Resend must not run"));
    await expect(sendTransactionalEmail({ EMAIL: { send }, RESEND_API_KEY: "resend-key" }, email)).rejects.toBe(error);
    expect(send).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("without a binding, Resend sends the existing sender and returns its real ID", async () => {
    const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ id: "resend-message" }));
    const result = await sendTransactionalEmail({ RESEND_API_KEY: "resend-key", NODE_ENV: "production" }, email);
    expect(result).toEqual({ success: true, messageId: "resend-message" });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe("https://api.resend.com/emails");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toEqual({ "Content-Type": "application/json", Authorization: "Bearer resend-key" });
    expect(JSON.parse(String(init?.body))).toEqual({ from: "ORRN <no-reply@orrn.in>", ...email });
  });

  test("configured providers also send on development stacks instead of returning mock success", async () => {
    const send = mock(async () => ({ messageId: "dev-real-provider" }));
    expect(await sendTransactionalEmail({ NODE_ENV: "development", EMAIL: { send } }, email)).toEqual({ success: true, messageId: "dev-real-provider" });
    const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ id: "dev-resend" }));
    expect(await sendTransactionalEmail({ NODE_ENV: "development", RESEND_API_KEY: "dev-key" }, email)).toEqual({ success: true, messageId: "dev-resend" });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  test("Resend failures retain HTTP status without logging a sensitive provider body", async () => {
    const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(new Response(`${email.html} resend-key`, { status: 429 }));
    const log = spyOn(console, "log").mockImplementation(() => {});
    const errorLog = spyOn(console, "error").mockImplementation(() => {});
    let failure: unknown;
    try { await sendTransactionalEmail({ RESEND_API_KEY: "resend-key", NODE_ENV: "production" }, email); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(EmailDeliveryError);
    expect(failure).toMatchObject({ provider: "resend", status: 429 });
    expect(String(failure)).not.toContain("secret-token");
    expect(String(failure)).not.toContain("resend-key");
    expect(log).not.toHaveBeenCalled();
    expect(errorLog).not.toHaveBeenCalled();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  test("Resend network exceptions propagate intact", async () => {
    const error = new TypeError("network unavailable");
    spyOn(globalThis, "fetch").mockRejectedValue(error);
    await expect(sendTransactionalEmail({ RESEND_API_KEY: "resend-key" }, email)).rejects.toBe(error);
  });

  test("a provider response with no message ID is not reported as delivery", async () => {
    spyOn(globalThis, "fetch").mockResolvedValue(Response.json({}));
    await expect(sendTransactionalEmail({ RESEND_API_KEY: "resend-key" }, email)).rejects.toThrow("Resend returned no email message ID");
    await expect(sendTransactionalEmail({ EMAIL: { send: async () => ({ messageId: "" }) } }, email)).rejects.toThrow("Cloudflare returned no email message ID");
  });

  test("no configured provider fails without a network request", async () => {
    const fetchSpy = spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network must not run"));
    const log = spyOn(console, "log").mockImplementation(() => {});
    await expect(sendTransactionalEmail({ NODE_ENV: "production" }, email)).rejects.toMatchObject({ provider: "none" });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(log.mock.calls.flat().join(" ")).not.toContain("secret-token");
    expect(log.mock.calls.flat().join(" ")).not.toContain(email.to);
  });

});

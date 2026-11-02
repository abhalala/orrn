import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";

import { sendAuthEmail } from "@orrn/auth";
import { EmailDeliveryError, sendTransactionalEmail } from "@orrn/auth/email-delivery";
import { sendEmail } from "../src/lib/email";
import { workersEnv } from "./env-mock";

const email = {
  to: "owner@example.net",
  subject: "Your ORRN invitation",
  html: '<a href="https://app.test/invite/secret-token">Accept</a>',
  text: "Accept: https://app.test/invite/secret-token",
};

afterEach(() => mock.restore());

/** Scripted Purelymail SMTP conversation for the `SMTP_TRANSPORT` test hook. */
function smtp(replies: string[], written: string[] = []) {
  return async () => ({
    readLine: async () => replies.shift()!,
    write: async (text: string) => { written.push(text); },
    startTls: async () => {},
    close: () => {},
  });
}
const OK = ["220 hi", "250 ehlo", "220 tls", "250 ehlo", "334 u", "334 p", "235 ok", "250 from", "250 to", "354 data", "250 queued"];

describe("transactional email provider selection", () => {
  test("a Cloudflare binding takes precedence over Purelymail SMTP", async () => {
    const send = mock(async () => ({ messageId: "cf-message" }));
    const transport = mock(smtp([...OK]));
    const result = await sendTransactionalEmail({ EMAIL: { send }, PURELYMAIL_SMTP_PASSWORD: "smtp-pass", SMTP_TRANSPORT: transport, NODE_ENV: "production" }, email);
    expect(result).toEqual({ success: true, messageId: "cf-message" });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({ from: { email: "system@orrn.in", name: "ORRN" }, ...email });
    expect(transport).not.toHaveBeenCalled();
  });

  test("Cloudflare send exceptions retain their code and identity and do not fall through to SMTP", async () => {
    const error = Object.assign(new Error("sender is not verified"), { code: "E_SENDER_NOT_VERIFIED" });
    const send = mock(async () => { throw error; });
    const transport = mock(smtp([...OK]));
    await expect(sendTransactionalEmail({ EMAIL: { send }, PURELYMAIL_SMTP_PASSWORD: "smtp-pass", SMTP_TRANSPORT: transport }, email)).rejects.toBe(error);
    expect(send).toHaveBeenCalledTimes(1);
    expect(transport).not.toHaveBeenCalled();
  });

  test("without a binding, Purelymail SMTP sends from system@orrn.in without any HTTP call", async () => {
    const fetchSpy = spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network must not run"));
    const written: string[] = [];
    const result = await sendTransactionalEmail(
      { PURELYMAIL_SMTP_PASSWORD: "smtp-pass", NODE_ENV: "production", SMTP_TRANSPORT: smtp([...OK], written) },
      email,
    );
    expect(result.messageId).toContain("@orrn.in");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(written.join("")).toContain("MAIL FROM:<system@orrn.in>");
    expect(written.join("")).toContain("RCPT TO:<owner@example.net>");
  });

  test("a Purelymail refusal surfaces provider purelymail and its code, without secrets or links", async () => {
    const log = spyOn(console, "log").mockImplementation(() => {});
    let failure: unknown;
    try {
      await sendTransactionalEmail(
        { PURELYMAIL_SMTP_PASSWORD: "bad-pass", NODE_ENV: "production", SMTP_TRANSPORT: smtp(["220 hi", "250 ehlo", "220 tls", "250 ehlo", "334 u", "334 p", "535 auth failed"]) },
        email,
      );
    } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(EmailDeliveryError);
    expect(failure).toMatchObject({ provider: "purelymail", status: 535 });
    expect(String(failure)).not.toContain("secret-token");
    expect(String(failure)).not.toContain("bad-pass");
    expect(log).not.toHaveBeenCalled();
  });

  test("configured providers also send on development stacks instead of returning mock success", async () => {
    const send = mock(async () => ({ messageId: "dev-real-provider" }));
    expect(await sendTransactionalEmail({ NODE_ENV: "development", EMAIL: { send } }, email)).toEqual({ success: true, messageId: "dev-real-provider" });
    const result = await sendTransactionalEmail({ NODE_ENV: "development", PURELYMAIL_SMTP_PASSWORD: "dev-pass", SMTP_TRANSPORT: smtp([...OK]) }, email);
    expect(result.messageId).toContain("@orrn.in");
  });

  test("a provider response with no message ID is not reported as delivery", async () => {
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

  test("auth and invitation entry points both use the optional binding", async () => {
    const old = workersEnv.EMAIL;
    const send = mock(async () => ({ messageId: "binding-message" }));
    workersEnv.EMAIL = { send };
    try {
      expect(await sendAuthEmail(email)).toEqual({ success: true, messageId: "binding-message" });
      expect(await sendEmail(email)).toEqual({ success: true, messageId: "binding-message" });
      expect(send).toHaveBeenCalledTimes(2);
    } finally {
      if (old === undefined) delete workersEnv.EMAIL;
      else workersEnv.EMAIL = old;
    }
  });
});

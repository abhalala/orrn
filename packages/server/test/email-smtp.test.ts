import { describe, expect, test } from "bun:test";

import { buildMimeMessage, sendSmtpMail, SmtpError, type SmtpTransport } from "@orrn/auth/smtp";

function fakeTransport(replies: string[]) {
  const written: string[] = [];
  let tls = false;
  let closed = false;
  const transport: SmtpTransport = {
    readLine: async () => {
      const line = replies.shift();
      if (line === undefined) throw new Error("reply script exhausted");
      return line;
    },
    write: async (text) => { written.push(text); },
    startTls: async () => { tls = true; },
    close: () => { closed = true; },
  };
  return { transport, written, isTls: () => tls, isClosed: () => closed };
}

const OK_SCRIPT = [
  "220 mailserver.purelymail.com ready",
  "250-mailserver.purelymail.com",
  "250 STARTTLS",
  "220 Go ahead",
  "250-mailserver.purelymail.com",
  "250 AUTH LOGIN",
  "334 VXNlcm5hbWU6",
  "334 UGFzc3dvcmQ6",
  "235 Authentication successful",
  "250 OK",
  "250 OK",
  "354 End data with <CR><LF>.<CR><LF>",
  "250 Accepted",
];

const mail = {
  from: "system@orrn.in",
  fromName: "ORRN",
  to: "owner@example.net",
  subject: "Reset your ORRN password",
  html: '<a href="https://orrn.in/reset/secret-token">Reset</a>',
  text: "Reset: https://orrn.in/reset/secret-token",
};

describe("Purelymail SMTP conversation", () => {
  test("EHLO, STARTTLS, AUTH LOGIN, then a MIME message", async () => {
    const fake = fakeTransport([...OK_SCRIPT]);
    const result = await sendSmtpMail(fake.transport, { user: "system@orrn.in", password: "smtp-pass" }, mail);
    expect(result.messageId).toEndWith("@orrn.in");
    expect(fake.isTls()).toBe(true);
    expect(fake.isClosed()).toBe(true);
    const sent = fake.written.join("");
    expect(sent).toContain("EHLO orrn.in\r\n");
    expect(sent).toContain("STARTTLS\r\n");
    expect(sent).toContain("AUTH LOGIN\r\n");
    // Base64 credentials, never the plain password on the wire log surface we build.
    expect(sent).toContain(`${btoa("system@orrn.in")}\r\n`);
    expect(sent).not.toContain("smtp-pass\r\n");
    expect(sent).toContain("MAIL FROM:<system@orrn.in>\r\n");
    expect(sent).toContain("RCPT TO:<owner@example.net>\r\n");
    expect(sent).toContain("DATA\r\n");
    expect(sent).toContain("Subject: Reset your ORRN password\r\n");
    expect(sent).toContain("multipart/alternative");
    expect(sent).toContain(btoa("Reset: https://orrn.in/reset/secret-token"));
    expect(sent).toContain("\r\n.\r\n");
    expect(sent).toContain("QUIT\r\n");
  });

  test("a refused recipient stops the send with its SMTP code", async () => {
    const fake = fakeTransport([...OK_SCRIPT.slice(0, 10), "550 No such user"]);
    let failure: unknown;
    try {
      await sendSmtpMail(fake.transport, { user: "system@orrn.in", password: "smtp-pass" }, mail);
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(SmtpError);
    expect(failure).toMatchObject({ smtpCode: 550 });
    expect(fake.isClosed()).toBe(true);
    expect(fake.written.join("")).not.toContain("DATA\r\n");
  });

  test("html-only mail is a single text/html part", () => {
    const { text: _text, ...htmlOnly } = mail;
    const message = buildMimeMessage(htmlOnly, "boundary", "id@orrn.in", new Date(0));
    expect(message).toContain('Content-Type: text/html; charset="utf-8"');
    expect(message).not.toContain("multipart/alternative");
    expect(message).toContain("Message-ID: <id@orrn.in>");
  });
});

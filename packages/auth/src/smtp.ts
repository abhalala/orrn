/**
 * Minimal SMTP client for Purelymail, used from Cloudflare Workers via
 * `cloudflare:sockets` (STARTTLS on port 587). No third-party SMTP library
 * runs in Workers, so this speaks just enough RFC 5321/4954: EHLO, STARTTLS,
 * AUTH LOGIN, MAIL/RCPT/DATA, QUIT. The transport is injectable so the
 * protocol conversation is unit-testable without a network.
 */

export const PURELYMAIL_SMTP_HOST = "smtp.purelymail.com";
export const PURELYMAIL_SMTP_PORT = 587;
export const PURELYMAIL_SMTP_USER = "system@orrn.in";

export class SmtpError extends Error {
  constructor(
    message: string,
    /** SMTP reply code when the server refused a command, if any. */
    readonly smtpCode?: number,
  ) {
    super(message);
    this.name = "SmtpError";
  }
}

/** Line-oriented transport over a (possibly TLS-upgraded) socket. */
export interface SmtpTransport {
  /** Next CRLF-terminated line, without the terminator. */
  readLine(): Promise<string>;
  /** Write raw bytes (caller includes CRLF). */
  write(text: string): Promise<void>;
  /** Upgrade the live connection to TLS (STARTTLS). */
  startTls(): Promise<void>;
  close(): void;
}

export interface SmtpMail {
  from: string;
  fromName: string;
  to: string;
  subject: string;
  html: string;
  text?: string;
}

const encoder = new TextEncoder();

export function base64Utf8(value: string): string {
  let binary = "";
  for (const byte of encoder.encode(value)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64Wrap(value: string): string {
  const encoded = base64Utf8(value);
  return encoded.replace(/.{1,76}/g, "$&\r\n").trimEnd();
}

/** RFC 2047 encoding only when the header value is not printable ASCII. */
function headerValue(value: string): string {
  // eslint-disable-next-line no-control-regex
  return /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${base64Utf8(value)}?=`;
}

export function buildMimeMessage(mail: SmtpMail, boundary: string, messageId: string, date: Date): string {
  const headers = [
    `From: ${headerValue(mail.fromName)} <${mail.from}>`,
    `To: ${mail.to}`,
    `Subject: ${headerValue(mail.subject)}`,
    `Date: ${date.toUTCString()}`,
    `Message-ID: <${messageId}>`,
    "MIME-Version: 1.0",
  ];
  if (mail.text === undefined) {
    return [
      ...headers,
      'Content-Type: text/html; charset="utf-8"',
      "Content-Transfer-Encoding: base64",
      "",
      base64Wrap(mail.html),
      "",
    ].join("\r\n");
  }
  return [
    ...headers,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    'Content-Type: text/plain; charset="utf-8"',
    "Content-Transfer-Encoding: base64",
    "",
    base64Wrap(mail.text),
    `--${boundary}`,
    'Content-Type: text/html; charset="utf-8"',
    "Content-Transfer-Encoding: base64",
    "",
    base64Wrap(mail.html),
    `--${boundary}--`,
    "",
  ].join("\r\n");
}

/** SMTP transparency: lines starting with "." get one extra dot (RFC 5321 §4.5.2). */
function dotStuff(message: string): string {
  return message.replace(/^\./gm, "..");
}

async function readReply(transport: SmtpTransport): Promise<{ code: number; text: string }> {
  const lines: string[] = [];
  for (;;) {
    const line = await transport.readLine();
    lines.push(line);
    // "250-more" continues; "250 done" (or a short line) ends the reply.
    if (line.length < 4 || line[3] !== "-") break;
  }
  const code = Number.parseInt(lines[0]?.slice(0, 3) ?? "", 10);
  if (!Number.isFinite(code)) throw new SmtpError(`Malformed SMTP reply: ${lines[0] ?? "(empty)"}`);
  return { code, text: lines.join("\n") };
}

async function expect(transport: SmtpTransport, command: string | null, codes: number[]): Promise<{ code: number; text: string }> {
  if (command !== null) await transport.write(`${command}\r\n`);
  const reply = await readReply(transport);
  if (!codes.includes(reply.code)) {
    throw new SmtpError(`SMTP ${command ? command.split(" ")[0] : "greeting"} refused (${reply.code})`, reply.code);
  }
  return reply;
}

/** Run one full send conversation over an already-connected transport. */
export async function sendSmtpMail(
  transport: SmtpTransport,
  credentials: { user: string; password: string },
  mail: SmtpMail,
): Promise<{ messageId: string }> {
  try {
    await expect(transport, null, [220]);
    await expect(transport, "EHLO orrn.in", [250]);
    await expect(transport, "STARTTLS", [220]);
    await transport.startTls();
    await expect(transport, "EHLO orrn.in", [250]);
    await expect(transport, "AUTH LOGIN", [334]);
    await expect(transport, base64Utf8(credentials.user), [334]);
    await expect(transport, base64Utf8(credentials.password), [235]);
    await expect(transport, `MAIL FROM:<${mail.from}>`, [250]);
    await expect(transport, `RCPT TO:<${mail.to}>`, [250, 251]);
    await expect(transport, "DATA", [354]);
    const messageId = `${crypto.randomUUID()}@orrn.in`;
    const boundary = `orrn-${crypto.randomUUID()}`;
    await transport.write(`${dotStuff(buildMimeMessage(mail, boundary, messageId, new Date()))}.\r\n`);
    const accepted = await readReply(transport);
    if (accepted.code !== 250) throw new SmtpError(`SMTP DATA refused (${accepted.code})`, accepted.code);
    await transport.write("QUIT\r\n").catch(() => {});
    return { messageId };
  } finally {
    transport.close();
  }
}

/** Default transport: a Cloudflare Workers TCP socket with STARTTLS upgrade. */
export async function workersSmtpTransport(host = PURELYMAIL_SMTP_HOST, port = PURELYMAIL_SMTP_PORT): Promise<SmtpTransport> {
  const { connect } = await import("cloudflare:sockets");
  let socket = connect({ hostname: host, port }, { secureTransport: "starttls", allowHalfOpen: false });
  await socket.opened;
  let writer = socket.writable.getWriter() as WritableStreamDefaultWriter<Uint8Array>;
  let reader = socket.readable.getReader() as ReadableStreamDefaultReader<Uint8Array>;
  const decoder = new TextDecoder();
  let buffer = "";

  async function readLine(): Promise<string> {
    for (;;) {
      const end = buffer.indexOf("\r\n");
      if (end >= 0) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        return line;
      }
      const { done, value } = await reader!.read();
      if (done) throw new SmtpError("SMTP connection closed mid-reply");
      buffer += decoder.decode(value, { stream: true });
    }
  }

  return {
    readLine,
    async write(text: string) {
      await writer!.write(encoder.encode(text));
    },
    async startTls() {
      writer!.releaseLock();
      reader!.releaseLock();
      socket = socket.startTls();
      writer = socket.writable.getWriter() as WritableStreamDefaultWriter<Uint8Array>;
      reader = socket.readable.getReader() as ReadableStreamDefaultReader<Uint8Array>;
      buffer = "";
    },
    close() {
      try {
        void socket.close();
      } catch {
        // Already closed.
      }
    },
  };
}

/** Send one message through Purelymail with the system mailbox credentials. */
export async function sendViaPurelymail(
  password: string,
  mail: SmtpMail,
  transportFactory: () => Promise<SmtpTransport> = workersSmtpTransport,
): Promise<{ messageId: string }> {
  const transport = await transportFactory();
  return sendSmtpMail(transport, { user: PURELYMAIL_SMTP_USER, password }, mail);
}

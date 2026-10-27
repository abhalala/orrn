import { sendViaPurelymail, SmtpError, type SmtpTransport } from "./smtp";
import { unsentEmailLog } from "./unsent-email";

export interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

/** Outward sender for every transactional email (Purelymail mailbox, also the SMTP user). */
export const EMAIL_FROM = "system@orrn.in";
export const EMAIL_FROM_NAME = "ORRN";

export interface EmailEnvironment {
  EMAIL?: SendEmail;
  /** Purelymail SMTP password for `system@orrn.in`; when set, SMTP is the primary sender. */
  PURELYMAIL_SMTP_PASSWORD?: string;
  RESEND_API_KEY?: string;
  NODE_ENV?: string;
  /** Test hook: replaces the Workers socket transport for Purelymail SMTP. */
  SMTP_TRANSPORT?: () => Promise<SmtpTransport>;
}

/** Safe to surface in invitation handovers: never includes a provider response body. */
export class EmailDeliveryError extends Error {
  constructor(
    message: string,
    readonly provider: "cloudflare" | "purelymail" | "resend" | "none",
    readonly status?: number,
  ) {
    super(message);
    this.name = "EmailDeliveryError";
  }
}

/** Choose once, before sending. A failed send is never retried through a second provider. */
export async function sendTransactionalEmail(
  environment: EmailEnvironment,
  options: EmailOptions,
  label = "Email",
): Promise<{ success: true; messageId: string }> {
  if (environment.EMAIL) {
    const result = await environment.EMAIL.send({
      from: { email: EMAIL_FROM, name: EMAIL_FROM_NAME },
      to: options.to,
      subject: options.subject,
      html: options.html,
      ...(options.text === undefined ? {} : { text: options.text }),
    });
    if (!result.messageId) {
      throw new EmailDeliveryError("Cloudflare returned no email message ID", "cloudflare");
    }
    return { success: true, messageId: result.messageId };
  }

  if (environment.PURELYMAIL_SMTP_PASSWORD) {
    try {
      const sent = await sendViaPurelymail(
        environment.PURELYMAIL_SMTP_PASSWORD,
        {
          from: EMAIL_FROM,
          fromName: EMAIL_FROM_NAME,
          to: options.to,
          subject: options.subject,
          html: options.html,
          ...(options.text === undefined ? {} : { text: options.text }),
        },
        environment.SMTP_TRANSPORT,
      );
      return { success: true as const, messageId: sent.messageId };
    } catch (error) {
      if (error instanceof SmtpError) {
        // Never retain a server reply: it can echo addresses or the mailbox user.
        throw new EmailDeliveryError(`Purelymail email send failed (${error.message})`, "purelymail", error.smtpCode);
      }
      throw error;
    }
  }

  if (!environment.RESEND_API_KEY) {
    console.log(unsentEmailLog(environment.NODE_ENV, options, label));
    throw new EmailDeliveryError("Email sending is not set up on this server", "none");
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${environment.RESEND_API_KEY}`,
    },
    body: JSON.stringify({ from: `${EMAIL_FROM_NAME} <${EMAIL_FROM}>`, ...options }),
  });
  if (!response.ok) {
    // Provider bodies can contain addresses, credentials or links. Retain the HTTP status, not
    // an unsafe body in logs or a public error. Network and binding exceptions propagate intact.
    throw new EmailDeliveryError(`Resend email send failed (HTTP ${response.status})`, "resend", response.status);
  }
  const result: { id?: string } = await response.json();
  if (typeof result.id !== "string" || !result.id) {
    throw new EmailDeliveryError("Resend returned no email message ID", "resend", response.status);
  }
  return { success: true, messageId: result.id };
}

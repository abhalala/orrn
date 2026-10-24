/**
 * What a server may print when it does not send an email (no Resend key, or
 * the local dev stack, which never sends). Auth emails carry live sign-in
 * links, which are credentials, so the body is printed only on a development
 * stack (NODE_ENV=development: the local worker and the deployed dev stage).
 * Anywhere else only the recipient's domain and the subject are printed.
 */
export function unsentEmailLog(
  nodeEnv: string | undefined,
  email: { to: string; subject: string; html: string },
  label = "Email",
): string {
  if (nodeEnv === "development") {
    return [
      "----------------------------------------",
      `Mock ${label} sent to: ${email.to}`,
      `Subject: ${email.subject}`,
      `Body:\n${email.html}`,
      "----------------------------------------",
    ].join("\n");
  }
  const at = email.to.lastIndexOf("@");
  const domain = at >= 0 ? email.to.slice(at + 1) : "unknown";
  return `${label} not sent: no provider (to: @${domain}, subject: ${JSON.stringify(email.subject)})`;
}

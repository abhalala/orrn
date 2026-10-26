/**
 * A missing provider is a failed send on every stack. Only development may print a body to help
 * local sign-in; elsewhere log just the domain and subject, never a live sign-in link or address.
 */
export function unsentEmailLog(
  nodeEnv: string | undefined,
  email: { to: string; subject: string; html: string },
  label = "Email",
): string {
  if (nodeEnv === "development") {
    return [
      "----------------------------------------",
      `${label} not sent: no provider (to: ${email.to})`,
      `Subject: ${email.subject}`,
      `Body:\n${email.html}`,
      "----------------------------------------",
    ].join("\n");
  }
  const at = email.to.lastIndexOf("@");
  const domain = at >= 0 ? email.to.slice(at + 1) : "unknown";
  return `${label} not sent: no provider (to: @${domain}, subject: ${JSON.stringify(email.subject)})`;
}

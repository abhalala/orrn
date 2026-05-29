import { env } from "@orrn/env/server";

export interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
}

export async function sendEmail(options: SendEmailOptions) {
  if (env.NODE_ENV === "development" || !env.RESEND_API_KEY) {
    console.log("----------------------------------------");
    console.log(`Mock Email sent to: ${options.to}`);
    console.log(`Subject: ${options.subject}`);
    console.log(`Body:\n${options.html}`);
    console.log("----------------------------------------");
    return { success: true, messageId: "mock-message-id" };
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      from: "ORRN <no-reply@orrn.in>",
      to: options.to,
      subject: options.subject,
      html: options.html,
    }),
  });

  if (!res.ok) {
    const errorText = await res.text();
    console.error("Failed to send email via Resend:", errorText);
    throw new Error("Failed to send email");
  }

  const data = await res.json();
  return { success: true, messageId: (data as any).id as string };
}

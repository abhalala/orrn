import { expo } from "@better-auth/expo";
import { createDb } from "@orrn/db";
import * as schema from "@orrn/db/schema/auth";
import { env } from "@orrn/env/server";
import { trustedWebOrigins } from "./origins";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { twoFactor } from "better-auth/plugins/two-factor";
import { magicLink } from "better-auth/plugins";

async function sendAuthEmail(options: { to: string; subject: string; html: string }) {
  if (env.NODE_ENV === "development" || !env.RESEND_API_KEY) {
    console.log("----------------------------------------");
    console.log(`Mock Auth Email sent to: ${options.to}`);
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
    console.error("Failed to send auth email via Resend:", errorText);
    throw new Error("Failed to send email");
  }

  const data = await res.json();
  return { success: true, messageId: (data as any).id as string };
}

export function createAuth() {
  const db = createDb();

  return betterAuth({
    database: drizzleAdapter(db, {
      provider: "sqlite",

      schema: schema,
    }),
    trustedOrigins: [
      ...trustedWebOrigins({
        corsOrigin: env.CORS_ORIGIN,
        corsAllowedOrigins: env.CORS_ALLOWED_ORIGINS,
      }),
      "orrn://",
      ...(env.NODE_ENV === "development"
        ? ["exp://", "exp://**", "exp://192.168.*.*:*/**", "http://localhost:8081"]
        : []),
    ],
    emailAndPassword: {
      enabled: true,
    },
    // uncomment cookieCache setting when ready to deploy to Cloudflare using *.workers.dev domains
    // session: {
    //   cookieCache: {
    //     enabled: true,
    //     maxAge: 60,
    //   },
    // },
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    advanced: {
      defaultCookieAttributes: {
        sameSite: "none",
        secure: true,
        httpOnly: true,
      },
      crossSubDomainCookies: {
        enabled: !!env.COOKIE_DOMAIN,
        domain: env.COOKIE_DOMAIN || undefined,
      },
    },
    plugins: [
      expo(),
      twoFactor(),
      magicLink({
        sendMagicLink: async ({ email, url }) => {
          await sendAuthEmail({
            to: email,
            subject: "Your ORRN Magic Sign-In Link",
            html: `<p>Click the link below to sign in to your ORRN account:</p>
                   <p><a href="${url}">${url}</a></p>`,
          });
        },
      }),
    ],
  });
}

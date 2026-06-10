import { expo } from "@better-auth/expo";
import { createDb } from "@orrn/db";
import * as schema from "@orrn/db/schema/auth";
import { env } from "@orrn/env/server";
import { trustedWebOrigins } from "./origins";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { twoFactor } from "better-auth/plugins/two-factor";
import { magicLink } from "better-auth/plugins";
import { hashPassword, verifyPassword } from "./password";

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

function renderOrrnEmailHtml(options: {
  title: string;
  description: string;
  buttonText: string;
  buttonUrl: string;
  footerText: string;
}) {
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${options.title}</title>
    </head>
    <body style="margin: 0; padding: 0; background-color: #0b0f1a; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
      <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #0b0f1a; padding: 40px 20px;">
        <tr>
          <td align="center">
            <table width="100%" max-width="560px" border="0" cellspacing="0" cellpadding="0" style="max-width: 560px; background-color: #121826; border: 1px solid #1e293b; border-radius: 16px; padding: 40px; box-shadow: 0 12px 32px rgba(15, 23, 42, 0.25);">
              <tr>
                <td>
                  <!-- Header Logo -->
                  <div style="text-align: center; margin-bottom: 32px;">
                    <span style="font-size: 26px; font-weight: 900; color: #f5f7ff; letter-spacing: 5px;">ORRN</span>
                    <span style="display: block; font-size: 9px; color: #4f7cff; font-family: monospace; letter-spacing: 2px; text-transform: uppercase; margin-top: 6px; font-weight: bold;">Plant Operations Console</span>
                  </div>

                  <!-- Title -->
                  <h1 style="color: #f5f7ff; font-size: 22px; font-weight: 800; margin-top: 0; margin-bottom: 12px; text-align: center; letter-spacing: -0.5px;">${options.title}</h1>

                  <!-- Description -->
                  <p style="color: #a3acc4; font-size: 14px; line-height: 1.6; margin-top: 0; margin-bottom: 24px; text-align: center;">${options.description}</p>

                  <!-- Action Button -->
                  <div style="text-align: center; margin: 32px 0;">
                    <a href="${options.buttonUrl}" style="background-color: #4f7cff; color: #ffffff; font-size: 14px; font-weight: bold; text-decoration: none; padding: 12px 32px; border-radius: 8px; display: inline-block; box-shadow: 0 4px 12px rgba(79, 124, 255, 0.25); text-align: center;">${options.buttonText}</a>
                  </div>

                  <!-- Divider -->
                  <div style="height: 1px; background-color: #1e293b; margin: 32px 0;"></div>

                  <!-- Footer Notes -->
                  <p style="color: #6c7591; font-size: 12px; line-height: 1.6; text-align: center; margin-top: 0; margin-bottom: 0;">${options.footerText}</p>
                </td>
              </tr>
            </table>

            <!-- Copyright footer -->
            <div style="text-align: center; margin-top: 32px; font-size: 10px; color: #4e5670; font-family: monospace; text-transform: uppercase; letter-spacing: 1.5px;">
              &copy; ${new Date().getFullYear()} ORRN.IN &bull; AUTOMATED CONSOLE SYSTEM
            </div>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;
}

let authSingleton: ReturnType<typeof buildAuth> | undefined;

function buildAuth() {
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
      password: {
        hash: hashPassword,
        verify: verifyPassword,
      },
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
            html: renderOrrnEmailHtml({
              title: "Authorized Access Request",
              description: "You (or someone requesting access as you) requested a link to log in to your ORRN plant workspace. Click the button below to complete the authorization.",
              buttonText: "Sign In to Console",
              buttonUrl: url,
              footerText: "If you did not request this link, you can safely ignore this email. This login link is only valid for 15 minutes."
            }),
          });
        },
      }),
    ],
  });
}

export function createAuth() {
  if (!authSingleton) {
    authSingleton = buildAuth();
  }
  return authSingleton;
}


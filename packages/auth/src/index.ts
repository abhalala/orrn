import { expo } from "@better-auth/expo";
import { createDb } from "@orrn/db";
import * as schema from "@orrn/db/schema/auth";
import { eq } from "drizzle-orm";
import { env } from "@orrn/env/server";
import { trustedOriginsFor } from "./origins";
import { createAuthMiddleware } from "better-auth/api";
import { magicLinkGuardBody } from "./magic-link-guard";
import { signUpGuardBody } from "./sign-up-guard";
import { limitPasswordReset, RESET_REQUEST_PATH } from "./reset-throttle";
import { writeAuthLog } from "./logger";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { twoFactor } from "better-auth/plugins/two-factor";
import { magicLink } from "better-auth/plugins";
import { hashPassword, verifyPassword } from "./password";
import { sendTransactionalEmail, type EmailOptions, type EmailEnvironment } from "./email-delivery";

export function sendAuthEmail(options: EmailOptions, environment: EmailEnvironment = env) {
  return sendTransactionalEmail(environment, options, "Auth email");
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

// Reuse configuration only for the same binding environment. Never replace a cached instance's
// environment while another request's email callback is awaiting a provider.
let authInstances = new WeakMap<Env, ReturnType<typeof buildAuth>>();

/**
 * How the magic-link plugin stores its token in `verification.identifier`. Production keeps the
 * default `"plain"`: Godseye writes owner links straight into `verification` with the plain token
 * (routers/platform/waitlist.ts). The guard looks a token up both ways, so switching to `"hashed"`
 * cannot open a bypass (tested). Never use a custom hasher: the guard could not find its rows.
 */
type MagicLinkStoreToken = "plain" | "hashed";

/** Better Auth's default cookie prefix; the native client matches cookies on it (prefixes stripped). */
const AUTH_COOKIE_PREFIX = "better-auth";

/** `__Host-better-auth` on an https API, `better-auth` on a local http one (a browser refuses `__Host-` over http). */
export function hostCookiePrefix(baseUrl: string | undefined): string {
  return (baseUrl ?? "").startsWith("https://") ? `__Host-${AUTH_COOKIE_PREFIX}` : AUTH_COOKIE_PREFIX;
}

function buildAuth(opts: { magicLinkStoreToken?: MagicLinkStoreToken } = {}, environment: Env = env) {
  const db = createDb(environment.DB);

  return betterAuth({
    logger: { log: writeAuthLog },
    database: drizzleAdapter(db, {
      provider: "sqlite",

      schema: schema,
    }),
    // Tested in packages/server/test/authTrustedOrigins.test.ts (production never trusts localhost).
    trustedOrigins: trustedOriginsFor(environment),
    // FP-PF-08: a magic link never signs in an account that has a password or a second factor,
    // and the public `/sign-in/magic-link` request is refused outright (D14; no client asks for a
    // link, Godseye issues owner links server-side). Tested in
    // packages/server/test/platform-w1-auth.test.ts.
    // BACKLOG 23: `/request-password-reset` is limited per address and per IP (reset-throttle.ts).
    // Security review 2026-11-04 (HIGH 3): no public sign-up. An HTTP `/sign-up/email` needs a live
    // invite for that email (sign-up-guard.ts); server code still creates accounts in-process.
    // Tested in packages/server/test/auth-signup-invite.test.ts.
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        await signUpGuardBody(db, ctx);
        if (ctx.path === RESET_REQUEST_PATH) {
          await limitPasswordReset(db, { email: (ctx.body as { email?: unknown } | undefined)?.email, headers: ctx.request?.headers ?? ctx.headers });
        }
        return magicLinkGuardBody(db, ctx);
      }),
    },
    emailAndPassword: {
      enabled: true,
      password: {
        hash: hashPassword,
        verify: verifyPassword,
      },
      // Forgot password (backlog 9). `/request-password-reset` answers the same neutral message
      // whether or not the address has an account, and this runs only for one that does. The
      // email carries a live reset link (a credential): the sender logs its body only when an
      // unconfigured development stack cannot send. The authenticator code is untouched: a reset
      // sets the password, the next sign-in still asks for the code.
      resetPasswordTokenExpiresIn: 60 * 60,
      revokeSessionsOnPasswordReset: true,
      // The reset link went only to the account's address, so finishing it proves the mailbox
      // (security review 2026-11-04, HIGH 3). Waitlist approval gives the owner role only to an
      // address proved this way or by Godseye's own sign-in link (routers/platform/waitlist.ts).
      onPasswordReset: async ({ user }) => {
        await db.update(schema.user).set({ emailVerified: true }).where(eq(schema.user.id, user.id));
      },
      sendResetPassword: async ({ user, url }) => {
        // The answer must be the same whether or not the address has an account, so a failed send
        // (Purelymail refused or unreachable, password unset) is swallowed here: it must never turn into a 500 that only a real
        // account gets. The log names the recipient domain only, never the link or the address.
        try {
          await sendAuthEmail({
            to: user.email,
            subject: "Reset your ORRN password",
            text: `Choose a new ORRN password: ${url}\n\nIf you did not ask for this, ignore this email. This link works for one hour.`,
            html: renderOrrnEmailHtml({
              title: "Reset your password",
              description: "Someone asked to reset the password for your ORRN account. Click the button below to choose a new password.",
              buttonText: "Choose a new password",
              buttonUrl: url,
              footerText: "If you did not ask for this, you can ignore this email; your password stays as it is. This link works for one hour.",
            }),
          }, environment);
        } catch {
          console.error(`reset email not sent (recipient domain ${user.email.split("@")[1] ?? "unknown"})`);
        }
      },
    },
    // uncomment cookieCache setting when ready to deploy to Cloudflare using *.workers.dev domains
    // session: {
    //   cookieCache: {
    //     enabled: true,
    //     maxAge: 60,
    //   },
    // },
    secret: environment.BETTER_AUTH_SECRET,
    baseURL: environment.BETTER_AUTH_URL,
    // Security review 2026-11-04 (CRITICAL 1): auth cookies are host-only on the API host. They
    // never carry a Domain attribute, so no other `*.orrn.in` host (a plant's `*.spool.orrn.in`
    // tunnel included) ever receives them. On an https API the names carry the `__Host-` prefix,
    // which a browser refuses with a Domain attribute, so no subdomain can set or toss one either.
    // Better Auth's own `__Secure-` prefix is switched off because the `__Host-` prefix replaces
    // it; the Secure attribute stays on every cookie. A local http API keeps the plain names.
    // The SPA on orrn.in still reaches api.orrn.in with credentials (same site). Old
    // `__Secure-better-auth.*` cookies are cleared by lib/legacyCookies.ts in @orrn/server.
    // Tested in packages/server/test/auth-session-cookie.test.ts.
    advanced: {
      useSecureCookies: false,
      cookiePrefix: hostCookiePrefix(environment.BETTER_AUTH_URL),
      defaultCookieAttributes: {
        sameSite: "none",
        secure: true,
        httpOnly: true,
        path: "/",
      },
      crossSubDomainCookies: { enabled: false },
    },
    plugins: [
      expo(),
      twoFactor(),
      magicLink({
        // Every link requested here (the public endpoint) goes to the address by email and
        // nowhere else. Godseye's owner links are written server-side (platform/waitlist.ts).
        // D14: a link never creates an account. Accounts come only from an approved access request
        // (Godseye) or an invite; verify for an unknown email gives no session and no user row.
        disableSignUp: true,
        storeToken: opts.magicLinkStoreToken ?? "plain",
        sendMagicLink: async ({ email, url }) => {
          await sendAuthEmail({
            to: email,
            subject: "Your ORRN Magic Sign-In Link",
            text: `Sign in to ORRN: ${url}\n\nIf you did not request this link, ignore this email. This link works for 15 minutes.`,
            html: renderOrrnEmailHtml({
              title: "Authorized Access Request",
              description: "You (or someone requesting access as you) requested a link to log in to your ORRN plant workspace. Click the button below to complete the authorization.",
              buttonText: "Sign In to Console",
              buttonUrl: url,
              footerText: "If you did not request this link, you can safely ignore this email. This login link is only valid for 15 minutes."
            }),
          }, environment);
        },
      }),
    ],
  });
}

/** Each cached instance and its callbacks belong to exactly one environment. */
export function createAuth(environment: Env = env) {
  let auth = authInstances.get(environment);
  if (!auth) {
    auth = buildAuth({}, environment);
    authInstances.set(environment, auth);
  }
  return auth;
}

/** Test hook for alternate magic-link token storage. */
export function buildAuthForTests(opts: { magicLinkStoreToken?: MagicLinkStoreToken } = {}) {
  return buildAuth(opts);
}

/** Tests mutate the mocked environment between D1 harnesses. */
export function resetAuthForTests(): void {
  authInstances = new WeakMap();
}

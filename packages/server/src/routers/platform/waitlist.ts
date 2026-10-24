import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import { company, membership, waitlistRequest } from "@orrn/db/schema/tenant";
import { account, user, verification } from "@orrn/db/schema/auth";
import { createAuth, takeCapturedMagicLink } from "@orrn/auth";
import type { createDb } from "@orrn/db";

import { atomicBatch, type SqliteBatchItem } from "../../lib/atomic";
import { renderOrrnEmailHtml, sendEmail } from "../../lib/email";
import { webBaseUrl } from "../../lib/webUrl";
import { platformGuard } from "../../index";

type Db = ReturnType<typeof createDb>;
type WaitlistRequestRow = typeof waitlistRequest.$inferSelect;

/** Long enough to pass the link on by WhatsApp when the email does not arrive. */
const OWNER_LINK_TTL_MS = 3 * 24 * 60 * 60 * 1000;

function escapeHtml(text: string) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Issues a one-time sign-in link for an approved company's owner, tries to
 * email it, and always returns the same message so Godseye can show it for
 * copying when the email cannot be sent (Resend failed for the Fourcubes
 * approval on 23 Oct 2026).
 *
 * The link opens `/continue` on the web app, not the one-time verify URL:
 * WhatsApp and mail scanners open links to build previews, which used up the
 * token before the owner tapped it. `/continue` spends the token only when the
 * person taps Continue.
 */
async function issueOwnerSignIn(db: Db, headers: Headers, request: WaitlistRequestRow) {
  const webBase = webBaseUrl();
  const captureKey = crypto.randomUUID();

  const auth = createAuth();
  await auth.api.signInMagicLink({
    body: {
      email: request.requesterEmail,
      callbackURL: `${webBase}/setup-credentials`,
      metadata: { captureKey },
    },
    headers,
  });

  const link = takeCapturedMagicLink(captureKey);
  if (!link) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Could not create a sign-in link" });
  }
  const signInUrl = `${webBase}/continue?token=${encodeURIComponent(link.token)}`;

  const expiresAt = new Date(Date.now() + OWNER_LINK_TTL_MS);
  await db.update(verification).set({ expiresAt }).where(eq(verification.identifier, link.token));

  const companyName = request.companyName.trim();
  const subject = `Your ORRN workspace for ${companyName} is ready`;
  const intro = `Your request for ORRN access for ${companyName} has been approved.`;
  const action = "Open this link to sign in and set your password:";
  const footer =
    "The link works once and expires in 3 days. If you did not ask for ORRN access, you can ignore this message.";
  const text = [`Hi ${request.requesterName},`, "", intro, "", action, signInUrl, "", footer, "", "ORRN"].join("\n");

  let emailSent = false;
  let emailError: string | null = null;
  try {
    const result = await sendEmail({
      to: request.requesterEmail,
      subject,
      html: renderOrrnEmailHtml({
        title: "Your workspace is ready",
        description: `Hi ${escapeHtml(request.requesterName)}, ${escapeHtml(intro)} ${action}`,
        buttonText: "Sign in to ORRN",
        buttonUrl: signInUrl,
        footerText: footer,
      }),
    });
    // The mock sender (local dev, or no Resend key) logs instead of sending.
    emailSent = result.messageId !== "mock-message-id";
    if (!emailSent) emailError = "Email sending is not set up on this server";
  } catch (error) {
    emailError = error instanceof Error ? error.message : "Failed to send email";
  }

  return {
    emailSent,
    emailError,
    to: request.requesterEmail,
    requesterName: request.requesterName,
    companyName,
    subject,
    text,
    link: signInUrl,
    expiresAt,
  };
}

export const waitlistProcedures = {
  waitlistList: platformGuard("platform.waitlist.review").query(async ({ ctx }) => {
    return ctx.db
      .select()
      .from(waitlistRequest)
      .where(eq(waitlistRequest.status, "pending"))
      .all();
  }),

  waitlistApprove: platformGuard("platform.waitlist.review")
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const request = await ctx.db
        .select()
        .from(waitlistRequest)
        .where(eq(waitlistRequest.id, input.id))
        .get();

      if (!request) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Waitlist request not found" });
      }
      if (request.status !== "pending") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Request is already processed" });
      }

      const companyId = request.companyId ?? crypto.randomUUID();
      const companyExists = await ctx.db
        .select()
        .from(company)
        .where(eq(company.id, companyId))
        .get();

      const existingUser = await ctx.db
        .select()
        .from(user)
        .where(eq(user.email, request.requesterEmail))
        .get();

      const userId = existingUser?.id ?? crypto.randomUUID();

      const existingMembership = existingUser
        ? await ctx.db
            .select()
            .from(membership)
            .where(
              and(eq(membership.userId, userId), eq(membership.companyId, companyId)),
            )
            .get()
        : null;

      const batchStatements: SqliteBatchItem[] = [
        ctx.db
          .update(waitlistRequest)
          .set({
            status: "approved",
            reviewedBy: ctx.session.user.id,
            reviewedAt: new Date(),
          })
          .where(eq(waitlistRequest.id, input.id)),
      ];

      if (companyExists) {
        batchStatements.push(
          ctx.db
            .update(company)
            .set({ status: "active" })
            .where(eq(company.id, companyId)),
        );
      } else {
        const slugBase = request.companyName
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9]/g, "-")
          .replace(/-+/g, "-")
          .replace(/^-|-$/g, "");
        const slug = `${slugBase || "company"}-${crypto.randomUUID().split("-")[0]}`;
        batchStatements.push(
          ctx.db.insert(company).values({
            id: companyId,
            name: request.companyName.trim(),
            slug,
            status: "active",
            settings: {},
            modules: [],
          }),
        );
      }

      if (!existingUser) {
        batchStatements.push(
          ctx.db.insert(user).values({
            id: userId,
            name: request.requesterName,
            email: request.requesterEmail,
            emailVerified: true,
            onboardingCompleted: false,
          }),
        );
      }

      if (!existingMembership) {
        batchStatements.push(
          ctx.db.insert(membership).values({
            id: crypto.randomUUID(),
            userId,
            companyId,
            role: "owner",
          }),
        );
      }

      await atomicBatch(ctx.db, batchStatements);

      // The approval stands even if the email fails; the details come back for copying.
      try {
        const signIn = await issueOwnerSignIn(ctx.db, ctx.request.headers, request);
        return { success: true, signIn, signInError: null };
      } catch (error) {
        console.error("Approved waitlist request but could not issue a sign-in link:", error);
        const signInError = error instanceof Error ? error.message : "Could not create a sign-in link";
        return { success: true, signIn: null, signInError };
      }
    }),

  /** Approved requests whose owner has not set a password yet (for example, the email never arrived). */
  waitlistAwaitingSignIn: platformGuard("platform.waitlist.review").query(async ({ ctx }) => {
    const approved = await ctx.db
      .select()
      .from(waitlistRequest)
      .where(eq(waitlistRequest.status, "approved"))
      .orderBy(desc(waitlistRequest.reviewedAt))
      .all();
    if (approved.length === 0) return [];

    // `inArray` binds one parameter per email; D1 allows 100 per statement.
    const withPassword = new Set<string>();
    const emails = [...new Set(approved.map((r) => r.requesterEmail))];
    for (let i = 0; i < emails.length; i += 90) {
      const rows = await ctx.db
        .selectDistinct({ email: user.email })
        .from(account)
        .innerJoin(user, eq(user.id, account.userId))
        .where(and(eq(account.providerId, "credential"), inArray(user.email, emails.slice(i, i + 90))))
        .all();
      for (const r of rows) withPassword.add(r.email);
    }

    return approved.filter((r) => !withPassword.has(r.requesterEmail));
  }),

  /** Issues a fresh sign-in link for an approved request, emails it, and returns it for copying. */
  waitlistSignInDetails: platformGuard("platform.waitlist.review")
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const request = await ctx.db
        .select()
        .from(waitlistRequest)
        .where(eq(waitlistRequest.id, input.id))
        .get();

      if (!request) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Waitlist request not found" });
      }
      if (request.status !== "approved") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Request is not approved" });
      }

      return issueOwnerSignIn(ctx.db, ctx.request.headers, request);
    }),

  waitlistReject: platformGuard("platform.waitlist.review")
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const request = await ctx.db
        .select()
        .from(waitlistRequest)
        .where(eq(waitlistRequest.id, input.id))
        .get();

      if (!request) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Waitlist request not found" });
      }
      // An approved request already has a company + owner; rejecting it would leave that
      // access in place while the record says otherwise (audit S18).
      if (request.status !== "pending") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Request is already processed" });
      }

      const statements: SqliteBatchItem[] = [
        ctx.db
          .update(waitlistRequest)
          .set({
            status: "rejected",
            reviewedBy: ctx.session.user.id,
            reviewedAt: new Date(),
          })
          .where(and(eq(waitlistRequest.id, input.id), eq(waitlistRequest.status, "pending"))),
      ];
      if (request.companyId) {
        // `waitlist.submit` created a `pending` company for the request. It was
        // never approved, so it has no members and no data: remove it, or it
        // reads as "Waiting for approval" in Godseye forever and counts as a
        // company. Only while it is still pending with no members, and only
        // once this request really is rejected (a concurrent approve wins).
        // The request row stays on record. Its company_id is cleared first:
        // the live column (migration 0004) has no ON DELETE action.
        const shellId = request.companyId;
        const removable = sql`exists (select 1 from "company" c where c."id" = ${shellId} and c."status" = 'pending')
          and not exists (select 1 from "membership" m where m."company_id" = ${shellId})`;
        statements.push(
          ctx.db
            .update(waitlistRequest)
            .set({ companyId: null })
            .where(and(eq(waitlistRequest.id, input.id), eq(waitlistRequest.status, "rejected"), removable)),
          ctx.db
            .delete(company)
            .where(
              and(
                eq(company.id, shellId),
                removable,
                sql`exists (select 1 from "waitlist_request" w where w."id" = ${input.id} and w."status" = 'rejected' and w."company_id" is null)`,
                sql`not exists (select 1 from "waitlist_request" w where w."company_id" = ${shellId})`,
              ),
            ),
        );
      }
      await atomicBatch(ctx.db, statements);

      return { success: true };
    }),
};

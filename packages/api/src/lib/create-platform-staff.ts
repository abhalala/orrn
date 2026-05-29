import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";

import { createAuth } from "@orrn/auth";
import { user } from "@orrn/db/schema/auth";
import { platformAdmin, type PlatformStaffRole } from "@orrn/db/schema/tenant";
import type { createDb } from "@orrn/db";

type Db = ReturnType<typeof createDb>;

/** Provision a new orrn.app staff login (email + password). Staff are not tenant members. */
export async function createPlatformStaffAccount(
  db: Db,
  input: {
    name: string;
    email: string;
    password: string;
    role: PlatformStaffRole;
    createdByUserId: string;
  },
): Promise<{ userId: string }> {
  const email = input.email.trim().toLowerCase();

  const existing = await db.select({ id: user.id }).from(user).where(eq(user.email, email)).get();
  if (existing) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "An account with this email already exists",
    });
  }

  const auth = createAuth();
  const signUp = await auth.api.signUpEmail({
    body: {
      name: input.name.trim(),
      email,
      password: input.password,
    },
  });

  if (!signUp?.user?.id) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to create staff credentials",
    });
  }

  const userId = signUp.user.id;

  await db
    .update(user)
    .set({
      emailVerified: true,
      onboardingCompleted: true,
      mustChangePassword: true,
    })
    .where(eq(user.id, userId));

  await db.insert(platformAdmin).values({
    userId,
    role: input.role,
    createdBy: input.createdByUserId,
  });

  return { userId };
}

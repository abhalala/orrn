import { z } from "zod";

import { company, waitlistRequest } from "@orrn/db/schema/tenant";

import { atomicBatch } from "../lib/atomic";
import { publicProcedure, router } from "../index";

const submitWaitlistSchema = z.object({
  companyName: z.string().min(1, "Company name is required"),
  requesterName: z.string().min(1, "Your name is required"),
  requesterEmail: z.string().email("Invalid email address"),
  notes: z.string().optional(),
});

function slugFromCompanyName(companyName: string): string {
  const base = companyName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return `${base || "company"}-${crypto.randomUUID().split("-")[0]}`;
}

export const waitlistRouter = router({
  submit: publicProcedure.input(submitWaitlistSchema).mutation(async ({ ctx, input }) => {
    const id = crypto.randomUUID();
    const companyId = crypto.randomUUID();
    const slug = slugFromCompanyName(input.companyName);

    await atomicBatch(ctx.db, [
      ctx.db.insert(company).values({
        id: companyId,
        name: input.companyName.trim(),
        slug,
        status: "pending",
        settings: {},
        modules: [],
      }),
      ctx.db.insert(waitlistRequest).values({
        id,
        companyId,
        companyName: input.companyName.trim(),
        requesterName: input.requesterName.trim(),
        requesterEmail: input.requesterEmail.trim().toLowerCase(),
        notes: input.notes,
      }),
    ] as const);

    return { success: true, id };
  }),
});

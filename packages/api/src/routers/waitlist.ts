import { z } from "zod";

import { company, waitlistRequest } from "@orrn/db/schema/tenant";
import { publicProcedure, router } from "../index";

const submitWaitlistSchema = z.object({
  companyName: z.string().min(1, "Company name is required"),
  requesterName: z.string().min(1, "Your name is required"),
  requesterEmail: z.string().email("Invalid email address"),
  notes: z.string().optional(),
});

export const waitlistRouter = router({
  submit: publicProcedure.input(submitWaitlistSchema).mutation(async ({ ctx, input }) => {
    const id = crypto.randomUUID();
    const companyId = crypto.randomUUID();
    
    const slug =
      input.companyName
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "") +
      "-" +
      crypto.randomUUID().split("-")[0];

    await ctx.db.transaction(async (tx) => {
      await tx.insert(company).values({
        id: companyId,
        name: input.companyName,
        slug,
        status: "pending",
      });

      await tx.insert(waitlistRequest).values({
        id,
        companyId,
        companyName: input.companyName,
        requesterName: input.requesterName,
        requesterEmail: input.requesterEmail,
        notes: input.notes,
      });
    });

    return { success: true, id };
  }),
});

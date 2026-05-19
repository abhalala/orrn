import { z } from "zod";

import { waitlistRequest } from "@orrn/db/schema/tenant";
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
    await ctx.db.insert(waitlistRequest).values({
      id,
      companyName: input.companyName,
      requesterName: input.requesterName,
      requesterEmail: input.requesterEmail,
      notes: input.notes,
    });

    return { success: true, id };
  }),
});

import { protectedProcedure, publicProcedure, router } from "../index";
import { waitlistRouter } from "./waitlist";
import { platformRouter } from "./platform";
import { companyRouter } from "./company";
import { inviteRouter } from "./invite";

export const appRouter = router({
  healthCheck: publicProcedure.query(() => {
    return "OK";
  }),
  privateData: protectedProcedure.query(({ ctx }) => {
    return {
      message: "This is private",
      user: ctx.session.user,
    };
  }),
  waitlist: waitlistRouter,
  platform: platformRouter,
  company: companyRouter,
  invite: inviteRouter,
});
export type AppRouter = typeof appRouter;

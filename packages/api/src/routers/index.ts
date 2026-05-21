import { protectedProcedure, publicProcedure, router } from "../index";
import { waitlistRouter } from "./waitlist";
import { platformRouter } from "./platform";
import { companyRouter } from "./company";
import { inviteRouter } from "./invite";
import { customerRouter } from "./customer";
import { dieRouter } from "./die";
import { bundleRouter } from "./bundle";
import { dispatchRouter } from "./dispatch";

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
  customer: customerRouter,
  die: dieRouter,
  bundle: bundleRouter,
  dispatch: dispatchRouter,
});
export type AppRouter = typeof appRouter;

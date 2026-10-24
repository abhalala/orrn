import { protectedProcedure, publicProcedure, router } from "../index";
import { analyticsRouter } from "./analytics";
import { approvalRouter } from "./approval";
import { authRouter } from "./auth";
import { waitlistRouter } from "./waitlist";
import { platformRouter } from "./platform";
import { companyRouter } from "./company";
import { inviteRouter } from "./invite";
import { customerRouter } from "./customer";
import { dieRouter } from "./die";
import { dieInstanceRouter } from "./dieInstance";
import { bundleRouter } from "./bundle";
import { dispatchRouter } from "./dispatch";
import { foundryRouter } from "./foundry";
import { packingListRouter } from "./packingList";
import { spoolRouter } from "./spool";
import { scaleRouter } from "./scale";
import { edgeRouter } from "./edge";
import { dashboardRouter } from "./dashboard";
import { resolveRouter } from "./resolve";
import { stockRouter } from "./stock";
import { storeRouter } from "./store";
import { purchaseRouter } from "./purchase";
import { vendorRouter } from "./vendor";

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
  auth: authRouter,
  waitlist: waitlistRouter,
  platform: platformRouter,
  company: companyRouter,
  invite: inviteRouter,
  customer: customerRouter,
  die: dieRouter,
  dieInstance: dieInstanceRouter,
  bundle: bundleRouter,
  dispatch: dispatchRouter,
  packingList: packingListRouter,
  spool: spoolRouter,
  scale: scaleRouter,
  edge: edgeRouter,
  dashboard: dashboardRouter,
  approval: approvalRouter,
  resolve: resolveRouter,
  stock: stockRouter,
  store: storeRouter,
  vendor: vendorRouter,
  purchase: purchaseRouter,
  analytics: analyticsRouter,
  foundry: foundryRouter,
});
export type AppRouter = typeof appRouter;

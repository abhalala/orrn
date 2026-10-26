import { protectedProcedure, publicProcedure, router } from "../index";
import { analyticsRouter } from "./analytics";
import { approvalRouter } from "./approval";
import { authRouter } from "./auth";
import { waitlistRouter } from "./waitlist";
import { platformRouter } from "./platform";
import { companyRouter } from "./company";
import { countRouter } from "./count";
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
import { reportsRouter } from "./reports";
import { salesOrderRouter } from "./salesOrder";
import { pressPlanRouter } from "./pressPlan";
import { pressRouter } from "./press";
import { ageingRouter } from "./ageing";
import { reasonCodeRouter } from "./reasonCode";
import { vendorRouter } from "./vendor";
import { auditRouter } from "./audit";
import { backupRouter } from "./backup";
import { deviceRouter, releaseRouter } from "./release";
import { supportRouter } from "./support";
import { transporterRouter } from "./transporter";
import { portalRouter } from "./portal";

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
  count: countRouter,
  store: storeRouter,
  vendor: vendorRouter,
  purchase: purchaseRouter,
  analytics: analyticsRouter,
  orders: salesOrderRouter,
  plans: pressPlanRouter,
  press: pressRouter,
  ageing: ageingRouter,
  reasonCodes: reasonCodeRouter,
  reports: reportsRouter,
  foundry: foundryRouter,
  release: releaseRouter,
  device: deviceRouter,
  support: supportRouter,
  audit: auditRouter,
  backup: backupRouter,
  transporter: transporterRouter,
  portal: portalRouter,
});
export type AppRouter = typeof appRouter;

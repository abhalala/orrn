import { lazy } from "@trpc/server";
import { protectedProcedure, publicProcedure, router } from "../index";

/**
 * Every top-level router is loaded lazily (tRPC v11 `lazy`): its module, zod schemas and procedure
 * builders evaluate on the first call under that path, not at Worker startup. Startup CPU is capped
 * by Cloudflare (`[10021] Script startup exceeded CPU time limit`), and evaluating every router at
 * import was right at that cap. Paths, inputs, outputs and the inferred `AppRouter` type are unchanged.
 *
 * Add a router as `key: lazy(() => import("./file").then((m) => m.fileRouter)),` and never import a
 * router module statically from here, `lib/**`, `context.ts` or `apps/server/src` (test:
 * `test/router-lazy.test.ts`). Code that enumerates `appRouter._def.procedures` must first
 * `await loadAllRouters()`; `createCaller` and the fetch adapter load what they call on their own.
 */
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
  auth: lazy(() => import("./auth").then((m) => m.authRouter)),
  waitlist: lazy(() => import("./waitlist").then((m) => m.waitlistRouter)),
  platform: lazy(() => import("./platform").then((m) => m.platformRouter)),
  company: lazy(() => import("./company").then((m) => m.companyRouter)),
  invite: lazy(() => import("./invite").then((m) => m.inviteRouter)),
  customer: lazy(() => import("./customer").then((m) => m.customerRouter)),
  die: lazy(() => import("./die").then((m) => m.dieRouter)),
  dieInstance: lazy(() => import("./dieInstance").then((m) => m.dieInstanceRouter)),
  bundle: lazy(() => import("./bundle").then((m) => m.bundleRouter)),
  dispatch: lazy(() => import("./dispatch").then((m) => m.dispatchRouter)),
  packingList: lazy(() => import("./packingList").then((m) => m.packingListRouter)),
  spool: lazy(() => import("./spool").then((m) => m.spoolRouter)),
  scale: lazy(() => import("./scale").then((m) => m.scaleRouter)),
  edge: lazy(() => import("./edge").then((m) => m.edgeRouter)),
  dashboard: lazy(() => import("./dashboard").then((m) => m.dashboardRouter)),
  approval: lazy(() => import("./approval").then((m) => m.approvalRouter)),
  resolve: lazy(() => import("./resolve").then((m) => m.resolveRouter)),
  stock: lazy(() => import("./stock").then((m) => m.stockRouter)),
  count: lazy(() => import("./count").then((m) => m.countRouter)),
  store: lazy(() => import("./store").then((m) => m.storeRouter)),
  vendor: lazy(() => import("./vendor").then((m) => m.vendorRouter)),
  purchase: lazy(() => import("./purchase").then((m) => m.purchaseRouter)),
  analytics: lazy(() => import("./analytics").then((m) => m.analyticsRouter)),
  orders: lazy(() => import("./salesOrder").then((m) => m.salesOrderRouter)),
  plans: lazy(() => import("./pressPlan").then((m) => m.pressPlanRouter)),
  press: lazy(() => import("./press").then((m) => m.pressRouter)),
  ageing: lazy(() => import("./ageing").then((m) => m.ageingRouter)),
  reasonCodes: lazy(() => import("./reasonCode").then((m) => m.reasonCodeRouter)),
  reports: lazy(() => import("./reports").then((m) => m.reportsRouter)),
  foundry: lazy(() => import("./foundry").then((m) => m.foundryRouter)),
  release: lazy(() => import("./release").then((m) => m.releaseRouter)),
  device: lazy(() => import("./release").then((m) => m.deviceRouter)),
  support: lazy(() => import("./support").then((m) => m.supportRouter)),
  audit: lazy(() => import("./audit").then((m) => m.auditRouter)),
  backup: lazy(() => import("./backup").then((m) => m.backupRouter)),
  transporter: lazy(() => import("./transporter").then((m) => m.transporterRouter)),
  portal: lazy(() => import("./portal").then((m) => m.portalRouter)),
  ingest: lazy(() => import("./ingest/index").then((m) => m.ingestRouter)),
  buddy: lazy(() => import("./buddy").then((m) => m.buddyRouter)),
  // XE parity lane REG (#18, #34), module `complaints`.
  complaints: lazy(() => import("./complaint").then((m) => m.complaintRouter)),
  // XE parity lane ADM: plant masters and rules, tool room extras, the document register.
  masters: lazy(() => import("./plantMasters").then((m) => m.plantMastersRouter)),
  toolRoom: lazy(() => import("./toolRoom").then((m) => m.toolRoomRouter)),
  docs: lazy(() => import("./plantDocs").then((m) => m.plantDocsRouter)),
  // XE parity lane QA.
  qa: lazy(() => import("./qa").then((m) => m.qaRouter)),
  // XE-PRICE: price master, quotes, proforma, works order, enquiries (module `pricing`).
  pricing: lazy(() => import("./pricing").then((m) => m.pricingRouter)),
  // XE-BILL (opt-in modules).
  billing: lazy(() => import("./billing").then((m) => m.billingRouter)),
  einvoice: lazy(() => import("./einvoice").then((m) => m.einvoiceRouter)),
  // XE parity lane COST: cost per kg, margins, capacity, forecast, dies due (module `costing`, opt-in).
  costing: lazy(() => import("./costing").then((m) => m.costingRouter)),
});
export type AppRouter = typeof appRouter;

/** Loads every lazy router (nested ones too) so `appRouter._def.procedures` lists every procedure. */
export async function loadAllRouters(): Promise<void> {
  const lazyLoaders = appRouter._def.lazy as Record<string, { load: () => Promise<void> }>;
  for (;;) {
    const keys = Object.keys(lazyLoaders);
    if (keys.length === 0) return;
    await Promise.all(keys.map((key) => lazyLoaders[key]?.load()));
  }
}

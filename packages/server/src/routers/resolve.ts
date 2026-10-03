import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { company } from "@orrn/db/schema";
import { die } from "@orrn/db/schema/catalog";
import { bundle } from "@orrn/db/schema/inventory";

import { companyProcedure, publicProcedure, router } from "../index";
import { resolveCode } from "../lib/codeResolver";

const codeSchema = z.string().min(1).max(500);

/** `fourcubes.orrn.in`, `FOURCUBES.orrn.in:443` or a bare slug to the company slug. */
function slugFromHost(host: string): string {
  const name = host.trim().toLowerCase().replace(/:\d+$/, "");
  return name.split(".")[0] ?? "";
}

export const resolveRouter = router({
  /** Bundle behind a scanned/typed code for the signed-in plant (plant number, old number, legacy cuid, BG serial). */
  byCode: companyProcedure
    .input(z.object({ code: codeSchema }))
    .query(({ ctx, input }) => resolveCode(ctx.db, ctx.companyId, input.code)),

  /**
   * Signed-out view behind the label QR (`https://{host}/b/{number}`): only number, section, kg,
   * pcs and status. Unknown host, inactive company, unknown or ambiguous code all give the same
   * NOT_FOUND so nothing about other tenants or other fields can be probed.
   */
  publicBundle: publicProcedure
    .input(z.object({ code: codeSchema, companyHost: z.string().max(255) }))
    .query(async ({ ctx, input }) => {
      const notFound = () => new TRPCError({ code: "NOT_FOUND", message: "Not found" });

      const slug = slugFromHost(input.companyHost);
      if (!slug) throw notFound();
      const [co] = await ctx.db
        .select({ id: company.id })
        .from(company)
        .where(and(eq(company.slug, slug), eq(company.status, "active")))
        .limit(1);
      if (!co) throw notFound();

      const hit = await resolveCode(ctx.db, co.id, input.code);
      if (hit.kind !== "bundle") throw notFound();

      const [row] = await ctx.db
        .select({
          number: bundle.serial,
          series: die.series,
          sectionCode: die.sectionCode,
          weightG: bundle.weightG,
          quantity: bundle.quantity,
          status: bundle.status,
        })
        .from(bundle)
        .innerJoin(die, and(eq(die.id, bundle.dieId), eq(die.companyId, bundle.companyId)))
        .where(and(eq(bundle.id, hit.bundleId), eq(bundle.companyId, co.id)))
        .limit(1);
      if (!row) throw notFound();

      return {
        number: row.number,
        section: `${row.series} ${row.sectionCode}`,
        kg: row.weightG / 1000,
        pcs: row.quantity,
        status: row.status,
      };
    }),
});

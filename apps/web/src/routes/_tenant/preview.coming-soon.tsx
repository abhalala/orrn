import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * Old bookmark of the "module being built elsewhere" page (retired 2026-10-25). Every module is built, so
 * this only forwards: `?module=ageing` to the ageing board, `?module=foundry` to the casts, anything else
 * to Today. It renders nothing. Kept so a saved link still lands somewhere real.
 */
export const Route = createFileRoute("/_tenant/preview/coming-soon")({
  beforeLoad: ({ search }) => {
    const module = (search as Record<string, unknown>).module;
    throw redirect({ to: module === "foundry" ? "/casts" : module === "ageing" ? "/ageing" : "/today" });
  },
});

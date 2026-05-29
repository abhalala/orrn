import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";

import StaffSignInForm from "@orrn/web-shared/components/staff-sign-in-form";
import { trpc } from "@orrn/web-shared/utils/trpc";

export const Route = createFileRoute("/")({
  component: StaffLoginPage,
});

function StaffLoginPage() {
  const meQuery = useQuery(trpc.auth.me.queryOptions());

  useEffect(() => {
    if (meQuery.data?.isPlatformAdmin) {
      window.location.replace("/admin");
    }
  }, [meQuery.data]);

  if (meQuery.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (meQuery.data?.isPlatformAdmin) {
    return null;
  }

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center p-4 bg-background">
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[400px] h-[400px] bg-primary/10 rounded-full blur-[80px] pointer-events-none -z-10" />
      <div className="w-full max-w-md space-y-6">
        <div className="flex flex-col items-center gap-3 mb-6">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl shadow-lg border border-border/40 bg-gradient-to-br from-primary to-accent">
            <span className="text-3xl font-black text-primary-foreground">O</span>
          </div>
          <div className="text-center">
            <h2 className="text-sm font-bold tracking-[0.25em] text-foreground font-mono">
              ORRN SYSTEM CORES
            </h2>
            <span className="text-[10px] font-mono tracking-widest uppercase font-semibold text-primary">
              Staff Administration Gateway
            </span>
          </div>
        </div>
        <StaffSignInForm />
      </div>
    </div>
  );
}

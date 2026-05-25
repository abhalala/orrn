import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Button } from "@orrn/ui/components/button";
import { ShieldAlert } from "lucide-react";

import { authClient } from "@/lib/auth-client";
import { useMe } from "@/lib/me";
import { queryClient } from "@/utils/trpc";

export const Route = createFileRoute("/no-access")({
  component: NoAccessComponent,
});

function NoAccessComponent() {
  const navigate = useNavigate();
  const { data: me } = useMe();

  return (
    <div className="w-full max-w-md p-8 rounded-2xl border border-border/40 bg-card/60 backdrop-blur-md shadow-2xl space-y-6 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-500/10 text-amber-500">
        <ShieldAlert className="h-6 w-6" />
      </div>
      
      <div className="space-y-2">
        <h1 className="text-3xl font-extrabold tracking-tight">No Active Company</h1>
        <p className="text-sm text-muted-foreground leading-relaxed">
          Hi {me?.user?.name ?? "there"}, your account isn&apos;t associated with an active company tenant yet.
        </p>
        <p className="text-xs text-muted-foreground/80 leading-relaxed">
          Please ask your company workspace administrator to send you an invitation link, or contact support for assistance.
        </p>
      </div>

      <div className="flex justify-center gap-4 pt-4 border-t border-border/20">
        <Link to="/">
          <Button variant="outline" className="border-border">Back to Home</Button>
        </Link>
        <Button
          variant="ghost"
          className="hover:bg-muted/80 text-muted-foreground text-sm font-medium"
          onClick={() => {
            authClient.signOut({
              fetchOptions: {
                onSuccess: () => {
                  queryClient.clear();
                  navigate({ to: "/" });
                },
              },
            });
          }}
        >
          Sign Out
        </Button>
      </div>
    </div>
  );
}

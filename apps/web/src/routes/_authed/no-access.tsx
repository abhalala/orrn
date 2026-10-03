import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Button } from "@orrn/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader } from "@orrn/ui/components/card";
import { ShieldAlert } from "lucide-react";

import { authClient } from "@/shared/lib/auth-client";
import { useMe } from "@/shared/lib/me";
import { queryClient } from "@/shared/utils/trpc";

export const Route = createFileRoute("/_authed/no-access")({
  component: NoAccessComponent,
});

function NoAccessComponent() {
  const navigate = useNavigate();
  const { data: me } = useMe();

  return (
    <Card className="w-full max-w-md gap-6 p-6 text-center shadow-md sm:p-8">
      <CardHeader>
        <div className="mx-auto flex size-14 items-center justify-center rounded-card bg-tone-amber-tint text-tone-amber-ink">
          <ShieldAlert className="h-6 w-6" aria-hidden="true" />
        </div>
        <h1 className="orrn-auth-title">No active company</h1>
        <CardDescription>
          Hi {me?.user?.name ?? "there"}, your account is not associated with an active company tenant yet.
        </CardDescription>
      </CardHeader>

      <CardContent>
      <div className="flex justify-center gap-3">
        <Link to="/">
          <Button variant="outline">Back to home</Button>
        </Link>
        <Button
          variant="ghost"
          className="text-muted-foreground"
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
          Sign out
        </Button>
      </div>
      </CardContent>
    </Card>
  );
}

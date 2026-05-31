import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Button } from "@orrn/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@orrn/ui/components/card";
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
    <Card className="w-full max-w-md text-center">
      <CardHeader>
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-md bg-amber-500/10 text-amber-600">
          <ShieldAlert className="h-6 w-6" aria-hidden="true" />
        </div>
        <CardTitle>No Active Company</CardTitle>
        <CardDescription>
          Hi {me?.user?.name ?? "there"}, your account is not associated with an active company tenant yet.
        </CardDescription>
      </CardHeader>

      <CardContent>
      <div className="flex justify-center gap-3">
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
      </CardContent>
    </Card>
  );
}

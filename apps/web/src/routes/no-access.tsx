import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Button } from "@orrn/ui/components/button";

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
    <div className="p-8 max-w-xl mx-auto mt-16 space-y-6 text-center">
      <h1 className="text-3xl font-bold">No active company</h1>
      <p className="text-muted-foreground">
        Hi {me?.user.name ?? "there"}, your account isn&apos;t a member of any active company yet.
        Ask a workspace admin to invite you, or accept a pending invite link to get started.
      </p>
      <div className="flex justify-center gap-2 pt-4">
        <Link to="/">
          <Button variant="outline">Back to home</Button>
        </Link>
        <Button
          variant="ghost"
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
    </div>
  );
}

import { Button } from "@orrn/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@orrn/ui/components/dropdown-menu";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { Link, useNavigate } from "@tanstack/react-router";

import { authClient } from "../lib/auth-client";
import { queryClient } from "../utils/trpc";

export default function UserMenu({ signInTo = "/login" }: { signInTo?: string }) {
  const navigate = useNavigate();
  const { data: session, isPending } = authClient.useSession();

  if (isPending) {
    return <Skeleton className="h-11 w-28 rounded-full" />;
  }

  if (!session) {
    return (
      <Button asChild variant="outline">
        <Link to={signInTo as "/"}>Sign in</Link>
      </Button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="max-w-[40vw] truncate">{session.user.name}</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuGroup>
          <DropdownMenuLabel>My account</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem>{session.user.email}</DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            onClick={() => {
              authClient.signOut({
                fetchOptions: {
                  onSuccess: () => {
                    // Drop ALL cached data so a different user on the same
                    // browser doesn't see the previous tenant's lists.
                    queryClient.clear();
                    navigate({
                      to: "/",
                    });
                  },
                },
              });
            }}
          >
            Sign out
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

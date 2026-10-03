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
import { Truncate } from "@orrn/ui/components/truncate";
import { Link, useNavigate } from "@tanstack/react-router";

import { authClient } from "../lib/auth-client";
import { queryClient } from "../utils/trpc";

export default function UserMenu({ signInTo = "/login" }: { signInTo?: string }) {
  const navigate = useNavigate();
  const { data: session, isPending } = authClient.useSession();

  if (isPending) {
    return <Skeleton className="size-11 rounded-full sm:w-28" />;
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
        {/* Phones: an initials avatar. Wider screens: avatar plus the name,
            truncated so it never pushes the status bar. */}
        <Button
          variant="outline"
          aria-label={`Account menu for ${session.user.name}`}
          className="w-11 gap-2 px-0 sm:w-auto sm:max-w-60 sm:pl-1.5 sm:pr-4"
        >
          <span
            aria-hidden="true"
            className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground"
          >
            {initials(session.user.name || session.user.email)}
          </span>
          <Truncate aria-hidden="true" className="hidden sm:block">
            {session.user.name}
          </Truncate>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="flex min-w-0 flex-col gap-0.5">
            <Truncate className="text-sm font-semibold text-foreground">{session.user.name}</Truncate>
            <Truncate className="text-[13px] font-normal text-muted-foreground">{session.user.email}</Truncate>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
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

function initials(value: string): string {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : (parts[0] ?? "?").slice(0, 2);
  return letters.toUpperCase();
}

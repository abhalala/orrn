import { Button } from "@orrn/ui/components/button";
import { cn } from "@orrn/ui/lib/utils";
import { Link } from "@tanstack/react-router";

import type { FileRouteTypes } from "@/routeTree.gen";

const LINKS = [
  { id: "casts", label: "Casts", to: "/preview/foundry" },
  { id: "cast", label: "Cast K31", to: "/preview/foundry/cast" },
  { id: "stock", label: "Billet stock", to: "/preview/foundry/stock" },
  { id: "certificate", label: "Test certificate", to: "/preview/foundry/certificate" },
] as const satisfies readonly { id: string; label: string; to: FileRouteTypes["to"] }[];

export type FoundryScreenId = (typeof LINKS)[number]["id"];

export function FoundryScreenNav({ current }: { current: FoundryScreenId }) {
  return (
    <nav aria-label="Foundry screens" className="flex flex-wrap gap-2">
      {LINKS.map((item) =>
        item.id === current ? (
          <span
            key={item.id}
            aria-current="page"
            className={cn(
              "inline-flex h-11 items-center rounded-full border border-border bg-card px-5 text-[15px] font-semibold shadow-sm",
            )}
          >
            {item.label}
          </span>
        ) : (
          <Button key={item.id} variant="ghost" asChild>
            <Link to={item.to}>{item.label}</Link>
          </Button>
        ),
      )}
    </nav>
  );
}

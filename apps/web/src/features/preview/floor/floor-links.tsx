import { Button } from "@orrn/ui/components/button";
import { Link } from "@tanstack/react-router";

import type { FileRouteTypes } from "@/routeTree.gen";

const LINKS = [
  { id: "pack", to: "/preview/floor", label: "Pack" },
  { id: "dispatch", to: "/preview/floor/dispatch", label: "Dispatch" },
  { id: "list", to: "/preview/floor/list", label: "Packing list" },
  { id: "stock", to: "/preview/floor/stock", label: "Stock" },
] as const satisfies readonly { id: string; to: FileRouteTypes["to"]; label: string }[];

export type FloorScreen = (typeof LINKS)[number]["id"];

export function FloorLinks({ current }: { current: FloorScreen }) {
  return (
    <>
      {LINKS.filter((link) => link.id !== current).map((link) => (
        <Button key={link.id} variant="secondary" asChild>
          <Link to={link.to}>{link.label}</Link>
        </Button>
      ))}
    </>
  );
}

import { ActionTile } from "@orrn/ui/components/action-tile";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import type { FileRouteTypes } from "@/routeTree.gen";

type DieRoomPath = Extract<
  FileRouteTypes["to"],
  "/preview/die-room" | "/preview/die-room/card" | "/preview/die-room/lift" | "/preview/die-room/maker"
>;

export function PreviewLink({
  to,
  className,
  children,
}: {
  to: DieRoomPath;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link to={to} className={className}>
      {children}
    </Link>
  );
}

function TileIcon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d={d} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function DieRoomLinks() {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
      <ActionTile
        tone="ink"
        title="Die card"
        hint="12170-1 · readings, runs, drawing"
        icon={<TileIcon d="M7 3h8l4 4v14H7zM15 3v4h4M9 13h6M9 17h4" />}
        to="/preview/die-room/card"
      />
      <ActionTile
        tone="amber"
        title="Lift"
        hint="12170-2 · propose the next band"
        icon={<TileIcon d="M12 19V5M6 11l6-6 6 6" />}
        to="/preview/die-room/lift"
      />
      <ActionTile
        tone="blue"
        title="Maker and owner"
        hint="Receive DM-4 · block another customer's die"
        icon={<TileIcon d="M4 10h16v10H4zM8 10V7a4 4 0 0 1 8 0v3" />}
        to="/preview/die-room/maker"
      />
    </div>
  );
}

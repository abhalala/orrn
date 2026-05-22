import type { Action } from "@orrn/api/lib/permissions";
import { Link } from "@tanstack/react-router";

import { ImpersonationBanner } from "@/components/impersonation-banner";
import { canAny, useMe } from "@/lib/me";

import { ModeToggle } from "./mode-toggle";
import UserMenu from "./user-menu";

type NavLink = {
  to: string;
  label: string;
  /** If set, link is only shown when the user can perform at least one of these actions. */
  requires?: readonly Action[];
};

/**
 * Module-level so we don't allocate on every render. canAny is also pure so we
 * can drive nav purely off `me`.
 */
const NAV: readonly NavLink[] = [
  { to: "/dashboard", label: "Dashboard" },
  { to: "/customers", label: "Customers" },
  { to: "/dies", label: "Dies" },
  { to: "/receipts", label: "Receipts" },
  { to: "/bundles", label: "Bundles" },
  { to: "/dispatches", label: "Dispatches" },
  { to: "/stock", label: "Stock" },
  {
    to: "/settings/members",
    label: "Members",
    requires: ["member.invite", "member.updateRole", "member.remove"],
  },
];

const PLATFORM_NAV: readonly NavLink[] = [
  { to: "/platform/waitlist", label: "Platform" },
];

export default function Header() {
  const { data: me, isPending } = useMe();
  const signedIn = !!me;
  const role = me?.company?.role;

  const visibleNav = NAV.filter((link) => {
    if (!signedIn) return false;
    if (!me?.company) return false;
    if (!link.requires) return true;
    return canAny(me, link.requires);
  });

  return (
    <div>
      <ImpersonationBanner />
      <div className="flex flex-row items-center justify-between px-4 py-2 gap-4">
        <nav className="flex gap-4 text-base items-center flex-wrap">
          <Link to="/" className="font-semibold">
            ORRN
          </Link>
          {!isPending &&
            visibleNav.map((link) => (
              <Link key={link.to} to={link.to as any} className="hover:underline">
                {link.label}
              </Link>
            ))}
          {!isPending &&
            me?.isPlatformAdmin &&
            PLATFORM_NAV.map((link) => (
              <Link
                key={link.to}
                to={link.to as any}
                className="text-amber-600 dark:text-amber-400 hover:underline font-medium"
              >
                {link.label}
              </Link>
            ))}
        </nav>
        <div className="flex items-center gap-3">
          {me?.company && (
            <div className="hidden sm:flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">{me.company.name}</span>
              {role ? <RoleBadge role={role} /> : null}
            </div>
          )}
          <ModeToggle />
          <UserMenu />
        </div>
      </div>
      <hr />
    </div>
  );
}

function RoleBadge({ role }: { role: string }) {
  return (
    <span className="text-[10px] uppercase tracking-wide font-semibold px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
      {role}
    </span>
  );
}

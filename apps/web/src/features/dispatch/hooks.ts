import { can, useMe, type Action } from "@/shared/lib/me";

/** The company's time zone for calendar days (spec §5 default Asia/Kolkata). */
export function useCompanyTimeZone(): string {
  const { data: me } = useMe();
  const tz = me?.company?.settings?.timezone;
  return typeof tz === "string" && tz ? tz : "Asia/Kolkata";
}

/** Permission check for logic (buttons use `<Can>`). The server stays authoritative. */
export function useCan(): (action: Action) => boolean {
  const { data: me } = useMe();
  return (action) => can(me, action);
}

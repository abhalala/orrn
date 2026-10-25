import type { CompanyRole } from "./types";

/**
 * Who each FP guide is for, shared by the English and Hindi books (parity.test.ts requires the same roles).
 * Follows PLANT_ACTION_ROLES in packages/server/src/lib/permissions.ts; the owner holds every action.
 */

/** order.manage and order.plan. */
export const ORDER_OFFICE: CompanyRole[] = ["owner", "manager", "office"];
/** order.reallocate. */
export const REALLOCATE: CompanyRole[] = ["owner", "admin", "manager", "office", "supervisor"];
/** press.run: the press station. */
export const PRESS_FLOOR: CompanyRole[] = ["owner", "supervisor", "press"];
/** press.close: log, reopen, late entry. */
export const PRESS_LOG: CompanyRole[] = ["owner", "admin", "manager", "supervisor"];
/** die.reading. */
export const READERS: CompanyRole[] = ["owner", "supervisor", "press", "die_room"];
export const DIE_ROOM: CompanyRole[] = ["owner", "die_room"];
/** masters.publish. */
export const MASTERS: CompanyRole[] = ["owner", "admin", "manager"];
/** dispatch.complete and dispatch.scan, together. */
export const DISPATCH_OFFICE: CompanyRole[] = ["owner", "manager", "office", "supervisor"];
/** packingList.combine. */
export const PL_OFFICE: CompanyRole[] = ["owner", "admin", "manager", "office", "supervisor"];
/** portal.manage. */
export const PORTAL: CompanyRole[] = ["owner", "admin", "manager", "office"];

/** die trial: the die room, plus the people who may release a copy or log the trial run. */
export const TRIAL: CompanyRole[] = ["owner", "admin", "manager", "supervisor", "die_room"];
/** portal.manage or dispatch.complete. */
export const CERTIFICATE: CompanyRole[] = ["owner", "admin", "manager", "office", "supervisor"];
/** Settling a count: a manager asks and approves, the floor leads move what was found. */
export const COUNT_SETTLE: CompanyRole[] = ["owner", "admin", "manager", "supervisor", "office"];
/** packingList.regenerate and combine. */
export const PL_REVISE: CompanyRole[] = ["owner", "admin", "manager", "office", "supervisor"];

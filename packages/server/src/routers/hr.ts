/**
 * XE parity lane HR (module `hr`, opt-in): people, checklists, recruitment, attendance, roster,
 * holidays, biometric devices and punches, leave, training, performance notes, the incentive sheet,
 * HR rules and self-service. Payroll is its own router (routers/payroll.ts, module `payroll`).
 * Every procedure, reads included, needs `hr` on (lib/hr/core.ts `hrProcedure`).
 */
import { router } from "../index";
import { hrAttendanceRouters } from "./hrAttendance";
import { hrMoreRouters } from "./hrMore";
import { hrPeopleRouters } from "./hrPeople";

export const hrRouter = router({ ...hrPeopleRouters, ...hrAttendanceRouters, ...hrMoreRouters });

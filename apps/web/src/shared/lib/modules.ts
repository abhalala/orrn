/**
 * Module checks for screens (PROD-GATE, owner rule 2026-11-23). Every XE module is opt-in: a screen,
 * card, column or query that belongs to one renders and asks nothing unless the plant's effective
 * module list (`auth.me.company.modules`) names it. Same rule as the server (`isModuleOn`).
 */
import { isModuleOn, type CompanyModule } from "@orrn/domain";

import { useMe } from "./me";

export function useModuleOn(module: CompanyModule): boolean {
  const { data: me } = useMe();
  return isModuleOn(me?.company?.modules ?? [], module);
}

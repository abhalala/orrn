/** Plan and modules form state (Godseye company tab "Plan and modules"). */

export type PlanValues = { plan: string | null; modules: readonly string[] };

/** The plan the form starts on: the saved one, Starter when the company has none yet. */
export function initialPlan(saved: string | null): string {
  return saved ?? "starter";
}

function sameModules(a: readonly string[], b: readonly string[]) {
  return a.length === b.length && a.every((m) => b.includes(m));
}

/**
 * The ticked modules: the saved ones, or every standard module when no standard one is saved
 * (an empty list means "all on", and the boxes say so). Opt-in modules (`optIn`, billing and the
 * like) are ticked only when saved: an empty list never switches them on (XE-BILL).
 */
export function modulesOn<T extends string>(saved: readonly string[], all: readonly T[], optIn: readonly string[] = []): T[] {
  const standard = all.filter((m) => !optIn.includes(m));
  const known = standard.filter((m) => saved.includes(m));
  const extras = all.filter((m) => optIn.includes(m) && saved.includes(m));
  const on = known.length > 0 ? known : standard;
  return all.filter((m) => on.includes(m) || extras.includes(m));
}

/**
 * What to save for the ticked boxes: every standard box ticked is "all on" (only the ticked opt-in
 * keys are saved, else empty), otherwise the ticked ones in catalogue order.
 */
export function modulesToSave<T extends string>(on: readonly string[], all: readonly T[], optIn: readonly string[] = []): T[] {
  const ticked = all.filter((m) => on.includes(m));
  const standard = all.filter((m) => !optIn.includes(m));
  const tickedStandard = standard.filter((m) => on.includes(m));
  if (tickedStandard.length === standard.length) return ticked.filter((m) => optIn.includes(m));
  return ticked;
}

/**
 * `dirty` when the form differs from what is saved (`saved.modules` as the
 * boxes show it, see `modulesOn`). A company without a plan is always dirty
 * (`noPlanYet`): the form shows Starter, and saving it as is must be
 * possible, otherwise "No plan" could never become Starter. `noneOn`: no standard
 * box ticked, which cannot be saved (an empty list, or one of only opt-in keys, means every module on).
 */
export function planForm(saved: PlanValues, form: { plan: string; modules: readonly string[] }, optIn: readonly string[] = []) {
  const noPlanYet = saved.plan === null;
  return {
    dirty: noPlanYet || form.plan !== saved.plan || !sameModules(form.modules, saved.modules),
    noPlanYet,
    // No STANDARD box ticked cannot be saved: a list of only opt-in keys means every floor module on (B1).
    noneOn: !form.modules.some((m) => !optIn.includes(m)),
  };
}
